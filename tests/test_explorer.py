"""Coordinates, evidence propagation and upstream adapter failure contracts."""

import csv
import hashlib
import sys
import time
from threading import Event

import pytest

from signal_peptide_features import analyze_sequence
from signal_peptide_features.analysis import REFERENCE, estimate_regions
from signal_peptide_features.prediction import parse_tsignal_csv

SEQ = "MKKLLLALALAVASASAADPEQKSTV"


def test_precursor_coordinate_and_region_evidence():
    r = analyze_sequence(SEQ, cleavage=18, sp_type="Sec/SPI")
    assert r["profiles"][17]["relative"] == -1
    assert r["profiles"][18]["relative"] == 1
    assert r["profiles"][18]["residue"] == "D"
    assert r["annotations"]["cleavage"]["basis"] == "provided"
    assert r["regions"]["basis"] == "rule_estimate"
    h = next(m for m in r["metrics"] if m["id"] == "H.hydrophobicity")
    assert h["basis"] == "rule_estimate" and h["boundary_basis"] == "provided"
    assert all(m["source"] and m["definition"] and m["range"] for m in r["metrics"])
    assert not any(m["scope"] == "mature_N" and m["range"][0] < 19 for m in r["metrics"])


def test_missing_endpoint_does_not_invent_sp_or_plus_one():
    r = analyze_sequence(SEQ)
    assert r["regions"]["intervals"] is None
    assert all(m["scope"] == "whole" for m in r["metrics"])
    assert all(p["relative"] is None for p in r["profiles"])
    r = analyze_sequence(SEQ[:18], mode="sp")
    assert not any(m["scope"] == "mature_N" for m in r["metrics"])
    assert not any(m["id"] == "junction.+1.identity" for m in r["metrics"])


def test_type_specific_rules_and_region_failures():
    r = analyze_sequence(SEQ, cleavage=18, sp_type="Tat/SPII")
    assert r["regions"]["intervals"] is None
    assert not any(m["id"] == "junction.small_neutral" for m in r["metrics"])
    assert estimate_regions("DDDDD") is None
    with pytest.raises(ValueError):
        analyze_sequence(SEQ, cleavage=18, boundaries=(18, 19))
    with pytest.raises(ValueError):
        analyze_sequence(SEQ, cleavage=18, has_sp=False)


def write_prediction(tmp_path, sequence, labels):
    path = tmp_path / "output.csv"
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["seqs", "pred_lbls", "SP_type_prob", "CS_prob"])
        writer.writeheader()
        writer.writerow(
            {"seqs": sequence[:70], "pred_lbls": labels, "SP_type_prob": "0.8", "CS_prob": "0.6"}
        )
    return path


def test_upstream_csv_transition_and_provided_precedence(tmp_path):
    p = parse_tsignal_csv(write_prediction(tmp_path, SEQ, "S" * 18 + "O" * 8), SEQ)
    assert p["cleavage"] == 18 and p["type"] == "Sec/SPI"
    r = analyze_sequence(SEQ, prediction=p, cleavage=17)
    assert r["annotations"]["cleavage"]["value"] == 17
    assert any("differs" in w for w in r["warnings"])
    assert r["prediction"]["cleavage"] == 18
    with pytest.raises(ValueError, match="hash"):
        analyze_sequence(SEQ + "A", prediction=p)


def test_no_sp_all_sp_and_noncontiguous_labels(tmp_path):
    p = parse_tsignal_csv(write_prediction(tmp_path, SEQ, "I" * len(SEQ)), SEQ)
    assert not p["has_sp"] and p["cleavage"] is None
    r = analyze_sequence(SEQ, prediction=p, cleavage=18)
    assert r["annotations"]["has_sp"]["value"] is True
    assert r["prediction"]["has_sp"] is False
    p = parse_tsignal_csv(write_prediction(tmp_path, SEQ, "S" * len(SEQ)), SEQ)
    assert p["has_sp"] and p["cleavage"] is None
    r = analyze_sequence(SEQ, prediction=p, has_sp=False)
    assert r["annotations"]["has_sp"]["value"] is False
    assert r["annotations"]["type"]["value"] is None
    with pytest.raises(ValueError):
        parse_tsignal_csv(write_prediction(tmp_path, SEQ, "SSOS" + "O" * 22), SEQ)
    with pytest.raises(ValueError):
        parse_tsignal_csv(write_prediction(tmp_path, SEQ, "S" * 18 + "O" * 7), SEQ)


def test_structure_alignment_and_evidence():
    r = analyze_sequence(
        SEQ,
        cleavage=18,
        structure=[
            {
                "position": 19,
                "residue": "D",
                "rsa": 0.3,
                "basis": "model_prediction",
                "source": "test model",
            }
        ],
    )
    m = next(m for m in r["metrics"] if m["id"] == "structure.19.rsa")
    assert m["basis"] == "model_prediction" and m["source"] == "test model"
    for bad in [float("nan"), 1.5, "0.5"]:
        with pytest.raises(ValueError):
            analyze_sequence(
                SEQ,
                structure=[
                    {
                        "position": 1,
                        "residue": "M",
                        "rsa": bad,
                        "basis": "provided",
                        "source": "test",
                    }
                ],
            )
    with pytest.raises(ValueError):
        analyze_sequence(SEQ, structure=[{"position": 19, "residue": "A", "rsa": 0.3}])


def test_aaindex_reference_integrity():
    assert set(REFERENCE["tables"]) == {"GRAR740102", "GRAR740103", "VINM940101"}
    assert all(set(t) == set("ACDEFGHIKLMNPQRSTVWY") for t in REFERENCE["tables"].values())
    assert REFERENCE["tables"]["GRAR740103"]["G"] == 3
    assert REFERENCE["tables"]["VINM940101"]["P"] == 1.049


def test_local_api_and_automatic_prediction(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from signal_peptide_features import server

    monkeypatch.setenv("SP_FEATURES_CONFIG", str(tmp_path / "absent.json"))
    client = TestClient(server.app)
    response = client.post("/api/analyze", json={"sequence": SEQ, "cleavage": 18})
    assert response.status_code == 200
    assert response.json()["annotations"]["cleavage"]["value"] == 18
    assert client.post("/api/analyze", json={"sequence": "AX"}).status_code == 422
    assert (
        client.post(
            "/api/analyze", json={"sequence": SEQ}, headers={"origin": "https://evil.example"}
        ).status_code
        == 403
    )
    prediction = {
        "source": "TSignal",
        "sequence_sha256": hashlib.sha256(SEQ.encode()).hexdigest(),
        "has_sp": True,
        "type": "Sec/SPI",
        "cleavage": 18,
    }
    monkeypatch.setattr(server, "read_config", lambda: {"configured": True})
    monkeypatch.setattr(server, "predict", lambda sequence: prediction)
    response = client.post("/api/analyze", json={"sequence": SEQ})
    assert response.json()["annotations"]["cleavage"]["basis"] == "model_prediction"


def test_native_runner_paths_and_process_cancellation(tmp_path):
    from signal_peptide_features.prediction import predict

    root = tmp_path / "upstream with spaces"
    (root / "sp_data").mkdir(parents=True)
    model = tmp_path / "checkpoint with spaces.pth"
    model.write_bytes(b"synthetic checkpoint, never loaded")
    (root / "main.py").write_text(
        "import sys,csv,pathlib\n"
        "a=sys.argv\n"
        "s=pathlib.Path('sp_data',a[a.index('--test_seqs')+1]).read_text().splitlines()[1][:70]\n"
        "assert pathlib.Path('sp_data',a[a.index('--test_mdl')+1]).is_file()\n"
        "with open(a[a.index('--output_file')+1],'w',newline='') as f:\n"
        " w=csv.writer(f);w.writerow(['seqs','pred_lbls','SP_type_prob','CS_prob'])\n"
        " w.writerow([s,'S'*18+'O'*(len(s)-18),0.8,0.6])\n"
    )
    config = {"root": str(root), "model": str(model), "python": sys.executable}
    result = predict(SEQ, config)
    assert result["cleavage"] == 18
    assert result["checkpoint_sha256"] == hashlib.sha256(model.read_bytes()).hexdigest()
    assert not list((root / "sp_data").iterdir())
    (root / "main.py").write_text("import time\ntime.sleep(30)\n")
    cancel = Event()
    cancel.set()
    start = time.monotonic()
    with pytest.raises(ValueError, match="cancelled"):
        predict(SEQ, config, cancel=cancel)
    assert time.monotonic() - start < 2
    assert not list((root / "sp_data").iterdir())


def test_job_lifecycle_and_cancellation(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from signal_peptide_features import server

    monkeypatch.setenv("SP_FEATURES_CONFIG", str(tmp_path / "absent.json"))
    client = TestClient(server.app)
    job_id = client.post("/api/jobs", json={"sequence": SEQ, "cleavage": 18}).json()["id"]
    for _ in range(100):
        state = client.get(f"/api/jobs/{job_id}").json()
        if state["state"] == "complete":
            break
        time.sleep(0.01)
    assert state["result"]["annotations"]["cleavage"]["value"] == 18
    entered = Event()

    def long_compute(body, cancel):
        entered.set()
        assert cancel.wait(2)
        raise ValueError("Analysis cancelled")

    monkeypatch.setattr(server, "compute", long_compute)
    job_id = client.post("/api/jobs", json={"sequence": SEQ}).json()["id"]
    assert entered.wait(2)
    assert client.delete(f"/api/jobs/{job_id}").status_code == 200
    for _ in range(100):
        state = client.get(f"/api/jobs/{job_id}").json()["state"]
        if state == "cancelled":
            break
        time.sleep(0.01)
    assert state == "cancelled"
    assert client.get("/api/jobs/nonexistent").status_code == 404
