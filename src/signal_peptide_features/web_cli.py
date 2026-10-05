"""GUI and annotation configuration commands, isolated from the legacy CLI."""

import argparse
import json
from pathlib import Path

from .prediction import config_path


def main(argv):
    parser = argparse.ArgumentParser(prog="sp-features " + argv[0])
    if argv[0] == "gui":
        parser.add_argument("--port", type=int, default=8765)
        args = parser.parse_args(argv[1:])
        try:
            import uvicorn
        except ImportError:
            parser.error('Install GUI dependencies: pip install "signal-peptide-features[gui]"')
        uvicorn.run("signal_peptide_features.server:app", host="127.0.0.1", port=args.port)
    else:
        parser.add_argument("--root", required=True)
        parser.add_argument("--model", required=True)
        parser.add_argument("--python", required=True)
        args = parser.parse_args(argv[1:])
        root, model, python = (Path(x).resolve() for x in (args.root, args.model, args.python))
        if not (root / "main.py").is_file() or not model.is_file() or not python.is_file():
            parser.error("Source main.py, checkpoint and Python executable must exist")
        config = config_path()
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(
            json.dumps({"root": str(root), "model": str(model), "python": str(python)}, indent=2)
        )
        config.chmod(0o600)
        print("TSignal configuration saved. Inference uses the upstream legacy environment.")
    return 0
