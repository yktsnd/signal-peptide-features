"""Assign non-content identifiers to every authored interactive control."""

import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
contract = json.loads((root / "telemetry/contract.json").read_text())
controls = []
for name in ["App", "Workspace", "SequenceViewer", "Guide", "UsageSettings"]:
    path = root / f"frontend/src/{name}.tsx"
    source = path.read_text()
    index = 0

    def replace(match, component=name):
        global index
        index += 1
        token = f"{component.lower()}-{match.group(1)}-{index:03}"
        controls.append({"id": token, "component": component, "element": match.group(1)})
        return match.group(0) + f' data-ux="{token}"'

    found = re.findall(r'data-ux="([a-z0-9-]+)"', source)
    if found:
        controls.extend(
            {"id": token, "component": name, "element": token.split("-")[1]}
            for token in found
        )
    else:
        source = re.sub(r"<(button|a|input|select|textarea|summary)(?=[\s>])", replace, source)
        path.write_text(source)
contract["controls"] = [control["id"] for control in controls]
(root / "telemetry/contract.json").write_text(json.dumps(contract, indent=2) + "\n")
(root / "telemetry/controls.json").write_text(json.dumps(controls, indent=2) + "\n")
(root / "frontend/public/ux-contract.json").write_text(json.dumps(contract, indent=2) + "\n")
print(f"{len(controls)} controls registered.")
