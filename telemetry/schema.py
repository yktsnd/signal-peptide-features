"""Keep the exchange schema aligned with the compact runtime allowlist."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
contract = json.loads((root / "contract.json").read_text())
p = root / "event.schema.json"
schema = json.loads(p.read_text())
schema["properties"]["ui"]["const"] = contract["ui_version"]
schema["properties"]["schema"]["const"] = contract["schema_version"]
schema["properties"]["event"]["enum"] = contract["events"]
schema["properties"]["props"]["properties"]["control"]["enum"] = contract["controls"]
for key, values in contract["enums"].items():
    schema["properties"]["props"]["properties"][key] = {"type": "string", "enum": values}
p.write_text(json.dumps(schema, indent=2) + "\n")
