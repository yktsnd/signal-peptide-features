"""Usage records must not accept research content and deletion must revoke writes."""

import time
from uuid import uuid4

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from signal_peptide_features.server import app

    monkeypatch.setenv("SP_USAGE_DB", str(tmp_path / "usage.db"))
    with TestClient(app) as value:
        yield value


def envelope():
    return {
        "id": str(uuid4()), "session": str(uuid4()), "seq": 1,
        "at": int(time.time() * 1000), "schema": "1.0", "ui": "0.6",
        "event": "analysis_completed", "target": "analysis",
        "props": {"outcome": "success", "duration_ms": 20},
    }


def test_content_rejection_dedup_delete_and_report(client):
    identifier, token = str(uuid4()), "a" * 64
    assert client.post("/api/telemetry/sessions", json={
        "id": identifier, "token": token, "consent": "1",
    }).status_code == 200
    endpoint = f"/api/telemetry/sessions/{identifier}/events"
    headers = {"Authorization": "Bearer " + token}
    good = envelope()
    bad = envelope()
    bad["props"]["sequence"] = "MKKLLAAA"
    assert client.post(endpoint, json={"events": [good, bad]}, headers=headers).status_code == 400
    assert client.get("/api/telemetry/report").json()["health"]["events"] == 0
    assert client.post(endpoint, json={"events": [good]}).status_code == 401
    for _ in range(2):
        assert client.post(endpoint, json={"events": [good]}, headers=headers).status_code == 200
    report = client.get("/api/telemetry/report").json()
    assert report["health"]["events"] == 1
    assert sum(row["total"] for row in report["daily"]) == 1
    deleted = client.delete(f"/api/telemetry/sessions/{identifier}", headers=headers)
    assert deleted.status_code == 200
    report = client.get("/api/telemetry/report").json()
    assert report["health"]["events"] == 0
    assert sum(row["total"] for row in report["daily"]) == 1
    assert client.post(endpoint, json={"events": [good]}, headers=headers).status_code == 401


def test_bounds_origin_and_retention(client):
    from signal_peptide_features.usage import connection

    identifier, token = str(uuid4()), "b" * 64
    assert client.post("/api/telemetry/sessions", json={
        "id": identifier, "token": token, "consent": "1",
    }, headers={"Origin": "https://outside.example"}).status_code == 403
    assert client.post("/api/telemetry/sessions", json={
        "id": identifier, "token": token, "consent": "1",
    }).status_code == 200
    e = envelope()
    e["props"]["duration_ms"] = -1
    assert client.post(f"/api/telemetry/sessions/{identifier}/events", json={"events": [e]},
                       headers={"Authorization": "Bearer " + token}).status_code == 400
    with connection() as db:
        e = envelope()
        db.execute("INSERT INTO ux_events VALUES(?,?,?,?,?,?,?,?,?,?)", (
            e["id"], identifier, e["session"], 1, int(time.time() * 1000) - 31 * 86400000,
            e["at"], "0.5", "analysis_completed", "analysis", "{}",
        ))
    report = client.get("/api/telemetry/report").json()
    assert report["health"]["events"] == 0
    with connection() as db:
        assert db.execute("SELECT sum(total) FROM ux_daily").fetchone()[0] == 1
