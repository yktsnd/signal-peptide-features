"""Content-free, opt-in usage recording for the loopback-only native GUI."""

import hashlib
import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()
ROOT = Path(__file__).parent
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SECRET = re.compile(r"^[0-9a-f]{64}$")
CONTRACT = json.loads((ROOT / "usage-contract.json").read_text())


@contextmanager
def connection():
    path = Path(os.environ.get("SP_USAGE_DB", Path.home() / ".local/share/sp-features/usage.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    if db.execute("PRAGMA user_version").fetchone()[0] == 0:
        db.executescript((ROOT / "usage.sql").read_text())
        db.execute("PRAGMA user_version=1")
        db.commit()
    try:
        with db:
            yield db
    finally:
        db.close()


def validate(value, now):
    fields = {"id", "session", "seq", "at", "schema", "ui", "event", "target", "props"}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError("envelope")
    if not UUID.fullmatch(str(value["id"])) or not UUID.fullmatch(str(value["session"])):
        raise ValueError("identifier")
    if value["schema"] != CONTRACT["schema_version"] or value["ui"] != CONTRACT["ui_version"]:
        raise ValueError("version")
    if type(value["seq"]) is not int or not 1 <= value["seq"] <= 1000000:
        raise ValueError("order")
    if type(value["at"]) is not int or not now - 86400000 <= value["at"] <= now + 300000:
        raise ValueError("clock")
    if value["event"] not in CONTRACT["events"] or value["target"] not in CONTRACT["targets"]:
        raise ValueError("action")
    if not isinstance(value["props"], dict) or len(value["props"]) > 20:
        raise ValueError("properties")
    for key, item in value["props"].items():
        if key in CONTRACT["enums"] and item in CONTRACT["enums"][key]:
            continue
        if key in CONTRACT["numeric"] and type(item) in (int, float):
            if 0 <= item <= CONTRACT["numeric"][key]:
                continue
        if key in CONTRACT["booleans"] and type(item) is bool:
            continue
        if key == "control" and item in CONTRACT["controls"]:
            continue
        raise ValueError("disallowed property")
    return value


def prune(db, now):
    db.execute("DELETE FROM ux_events WHERE received < ?", (now - 30 * 86400000,))
    db.execute(
        "DELETE FROM ux_sessions WHERE expires < ? AND id NOT IN (SELECT stream FROM ux_events)",
        (now,),
    )
    db.execute("DELETE FROM ux_daily WHERE day < date(?/1000,'unixepoch','-180 days')", (now,))


def authorized(request, db, identifier, now):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not UUID.fullmatch(identifier) or not SECRET.fullmatch(token):
        return False
    row = db.execute("SELECT * FROM ux_sessions WHERE id=?", (identifier,)).fetchone()
    return bool(
        row and not row["revoked"] and row["expires"] > now
        and row["token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    )


def response(data, status=200):
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


@router.api_route("/api/telemetry/{path:path}", methods=["GET", "POST", "DELETE"])
async def usage(request: Request, path: str):
    enabled = os.environ.get("SP_USAGE_DISABLED") != "1"
    if path == "config" and request.method == "GET":
        return response({"enabled": enabled, "retention": CONTRACT["retention"]})
    if not enabled:
        return response({"code": "disabled"}, 503)
    now = int(time.time() * 1000)
    try:
        with connection() as db:
            if path == "sessions" and request.method == "POST":
                raw = await request.body()
                if len(raw) > 24576:
                    return response({"code": "size"}, 413)
                data = json.loads(raw)
                if set(data) != {"id", "token", "consent"} or data["consent"] != "1":
                    return response({"code": "invalid"}, 422)
                if not UUID.fullmatch(data["id"]) or not SECRET.fullmatch(data["token"]):
                    return response({"code": "invalid"}, 422)
                digest = hashlib.sha256(data["token"].encode()).hexdigest()
                db.execute(
                    "INSERT OR IGNORE INTO ux_sessions(id,token_hash,created,expires) "
                    "VALUES(?,?,?,?)",
                    (data["id"], digest, now, now + 30 * 86400000),
                )
                row = db.execute("SELECT * FROM ux_sessions WHERE id=?", (data["id"],)).fetchone()
                if row["revoked"] or row["expires"] <= now or row["token_hash"] != digest:
                    return response({"code": "expired"}, 409)
                prune(db, now)
                return response({"enabled": True, "expires": row["expires"]})
            match = re.fullmatch(r"sessions/([0-9a-f-]+)(/events)?", path, re.I)
            if match:
                identifier = match[1]
                if not authorized(request, db, identifier, now):
                    return response({"code": "unauthorized"}, 401)
                if request.method == "DELETE" and not match[2]:
                    db.execute("UPDATE ux_sessions SET revoked=1 WHERE id=?", (identifier,))
                    db.execute("DELETE FROM ux_events WHERE stream=?", (identifier,))
                    return response({"deleted": True, "aggregates_retained": True})
                if request.method == "POST" and match[2]:
                    raw = await request.body()
                    if len(raw) > 24576:
                        return response({"code": "size"}, 413)
                    data = json.loads(raw)
                    if set(data) != {"events"} or not isinstance(data["events"], list):
                        return response({"code": "invalid"}, 422)
                    if not 1 <= len(data["events"]) <= 30:
                        return response({"code": "invalid"}, 422)
                    events = [validate(e, now) for e in data["events"]]
                    count = db.execute(
                        "SELECT count(*) FROM ux_events WHERE stream=? AND received>=?",
                        (identifier, now - 86400000),
                    ).fetchone()[0]
                    if count + len(events) > 5000:
                        return response({"code": "limit"}, 429)
                    for e in events:
                        db.execute(
                            "INSERT OR IGNORE INTO ux_events VALUES(?,?,?,?,?,?,?,?,?,?)",
                            (e["id"], identifier, e["session"], e["seq"], now, e["at"],
                             e["ui"], e["event"], e["target"], json.dumps(e["props"])),
                        )
                    return response({"accepted": [e["id"] for e in events]})
                return response({"code": "method"}, 405)
            if path == "report" and request.method == "GET":
                # Native server is restricted to trusted loopback hosts and same-origin requests.
                prune(db, now)
                days = 7 if request.query_params.get("days") == "7" else 30
                since = now - days * 86400000
                session = request.query_params.get("session")
                if session:
                    if not UUID.fullmatch(session):
                        return response({"code": "invalid"}, 422)
                    rows = db.execute(
                        "SELECT id,session,seq,at,ui,event,target,props FROM ux_events "
                        "WHERE session=? AND received>=? ORDER BY seq LIMIT 500", (session, since),
                    ).fetchall()
                    return response({
                        "events": [dict(r) for r in rows], "truncated": len(rows) == 500,
                    })
                daily = db.execute(
                    "SELECT * FROM ux_daily WHERE day>=date(?/1000,'unixepoch') "
                    "ORDER BY day DESC LIMIT 2000", (since,),
                ).fetchall()
                sessions = db.execute(
                    "SELECT session,count(*) AS events,min(at) AS started,max(at) AS ended "
                    "FROM ux_events WHERE received>=? GROUP BY session "
                    "ORDER BY started DESC LIMIT 100", (since,),
                ).fetchall()
                feedback = db.execute(
                    "SELECT props,at FROM ux_events WHERE event='feedback_submitted' "
                    "AND received>=? ORDER BY at DESC LIMIT 100", (since,),
                ).fetchall()
                health = db.execute(
                    "SELECT count(*) AS events,count(DISTINCT session) AS sessions "
                    "FROM ux_events WHERE received>=?", (since,),
                ).fetchone()
                transitions = db.execute(
                    "WITH ordered AS (SELECT event AS from_event,lead(event) OVER "
                    "(PARTITION BY stream,session ORDER BY seq) AS to_event FROM ux_events "
                    "WHERE received>=?) SELECT from_event,to_event,count(*) AS total "
                    "FROM ordered WHERE to_event IS NOT NULL GROUP BY from_event,to_event "
                    "ORDER BY total DESC LIMIT 50", (since,),
                ).fetchall()
                controls = db.execute(
                    "SELECT json_extract(props,'$.control') AS control,event,count(*) AS total "
                    "FROM ux_events WHERE received>=? AND "
                    "json_extract(props,'$.control') IS NOT NULL GROUP BY control,event "
                    "ORDER BY total DESC LIMIT 200", (since,),
                ).fetchall()
                timings_rows = db.execute(
                    "SELECT event,ui,json_extract(props,'$.width') AS width,"
                    "json_extract(props,'$.duration_ms') AS duration FROM ux_events "
                    "WHERE received>=? AND json_extract(props,'$.duration_ms') IS NOT NULL "
                    "ORDER BY received DESC LIMIT 5000", (since,),
                ).fetchall()
                grouped = {}
                for row in timings_rows:
                    grouped.setdefault((row["event"], row["ui"], row["width"]), []).append(
                        row["duration"]
                    )
                timings = []
                for (event, ui, width), values in grouped.items():
                    values.sort()
                    count = len(values)
                    timings.append({
                        "event": event, "ui": ui, "width": width, "count": count,
                        "p50": values[max(0, (count * 50 + 99) // 100 - 1)],
                        "p95": values[max(0, (count * 95 + 99) // 100 - 1)],
                    })
                return response({
                    "controls": [dict(r) for r in controls], "timings": timings,
                    "timing_limit": 5000,
                    "days": days, "retention": CONTRACT["retention"], "health": dict(health),
                    "daily": [dict(r) for r in daily], "sessions": [dict(r) for r in sessions],
                    "feedback": [dict(r) for r in feedback],
                    "transitions": [dict(r) for r in transitions],
                })
            return response({"code": "not_found"}, 404)
    except (ValueError, TypeError, KeyError, sqlite3.Error):
        return response({"code": "invalid_or_storage"}, 400)
