"""Local-only, optional GUI API and packaged static app."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .analysis import analyze_sequence
from .prediction import predict, read_config
from .regions import normalize_sequence

app = FastAPI(title="Signal Peptide Explorer")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


@app.middleware("http")
async def same_origin(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and origin != str(request.base_url).rstrip("/"):
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "cross-origin requests are disabled"}, status_code=403)
    if int(request.headers.get("content-length", "0")) > 2_000_000:
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "request too large"}, status_code=413)
    return await call_next(request)


@app.get("/api/status")
def status():
    return {"tsignal_configured": read_config() is not None, "version": "0.3.0"}


def compute(body: dict, cancel: Event | None = None):
    try:
        allowed = {
            "sequence",
            "mode",
            "cleavage",
            "sp_type",
            "has_sp",
            "boundaries",
            "estimate",
            "mature_window",
            "structure",
            "prediction",
        }
        if set(body) - allowed:
            raise ValueError("unknown request fields")
        body = dict(body)
        sequence = normalize_sequence(body.pop("sequence"))
        if len(sequence) > 10000:
            raise ValueError("maximum sequence length is 10000")
        analyze_sequence(sequence, **body)  # Validate before expensive inference.
        needs_prediction = (
            body.get("mode", "precursor") != "sp"
            and body.get("has_sp") is not False
            and any(body.get(key) is None for key in ("cleavage", "sp_type"))
        )
        warning = None
        if needs_prediction and not body.get("prediction"):
            if read_config():
                body["prediction"] = (
                    predict(sequence) if cancel is None else predict(sequence, cancel=cancel)
                )
            else:
                warning = "TSignal未設定です。未入力の注釈は不明として解析します。"
        result = analyze_sequence(sequence, **body)
        if warning:
            result["warnings"].insert(0, warning)
        return result
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/analyze")
def analyze(body: dict):
    return compute(body)


# One worker avoids simultaneous upstream model loads and shared upstream files.
POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sp-explorer")
JOBS: dict[str, dict] = {}
JOB_LOCK = Lock()


def execute_job(job_id: str, body: dict):
    with JOB_LOCK:
        job = JOBS[job_id]
        if job["cancel"].is_set():
            job["state"] = "cancelled"
            return
        job["state"] = "running"
    try:
        result = compute(body, cancel=job["cancel"])
        with JOB_LOCK:
            if job["cancel"].is_set():
                job["state"] = "cancelled"
            else:
                job.update(state="complete", result=result)
    except Exception as exc:
        with JOB_LOCK:
            if job["cancel"].is_set():
                job["state"] = "cancelled"
            else:
                job.update(state="failed", error=str(getattr(exc, "detail", exc)))


@app.post("/api/jobs", status_code=202)
def create_job(body: dict):
    with JOB_LOCK:
        if sum(j["state"] in {"queued", "running"} for j in JOBS.values()) >= 8:
            raise HTTPException(429, "analysis queue is full")
        while len(JOBS) >= 32:
            terminal = next(
                (k for k, j in JOBS.items() if j["state"] not in {"queued", "running"}), None
            )
            if terminal is None:
                break
            del JOBS[terminal]
        job_id = uuid4().hex
        JOBS[job_id] = {"state": "queued", "cancel": Event()}
    POOL.submit(execute_job, job_id, body)
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with JOB_LOCK:
        if job_id not in JOBS:
            raise HTTPException(404, "job not found")
        return {k: v for k, v in JOBS[job_id].items() if k != "cancel"}


@app.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str):
    with JOB_LOCK:
        if job_id not in JOBS:
            raise HTTPException(404, "job not found")
        JOBS[job_id]["cancel"].set()
    return {"cancellation_requested": True}


WEB = Path(__file__).parent / "web"
if (WEB / "assets").exists():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")


@app.get("/")
def index():
    if not (WEB / "index.html").exists():
        raise HTTPException(503, "Build frontend first: cd frontend && npm ci && npm run build")
    return FileResponse(WEB / "index.html")
