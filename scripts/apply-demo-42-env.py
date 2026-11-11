#!/usr/bin/env python3
"""Sync 42 OAuth credentials from ./.env (or the environment) into deploy/secrets.yaml.

Used by `make demo` (demo-secrets target) so a *local* demo can offer the real
42 login next to demo login. Values are never printed. Behaviour:

- no FORTY_TWO_CLIENT_ID/FORTY_TWO_CLIENT_SECRET anywhere -> change nothing
  (42 login stays off, exactly as before);
- both set -> write them into the otus-backend secret in deploy/secrets.yaml;
- only one set -> fail loudly (the backend would refuse to start anyway).
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEYS = ("FORTY_TWO_CLIENT_ID", "FORTY_TWO_CLIENT_SECRET")
YAML_KEYS = {
    "FORTY_TWO_CLIENT_ID": "forty-two-client-id",
    "FORTY_TWO_CLIENT_SECRET": "forty-two-client-secret",
}


def from_dotenv() -> dict:
    values = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value
    # Real environment wins over the file.
    for key in KEYS:
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values


def main() -> int:
    values = from_dotenv()
    present = {k: v for k, v in values.items() if k in KEYS and v}
    if not present:
        return 0
    if len(present) != len(KEYS):
        missing = next(k for k in KEYS if k not in present)
        print(f"ERROR: {missing} must also be set (in .env) to enable 42 login in the demo.",
              file=sys.stderr)
        return 1
    secrets = ROOT / "deploy" / "secrets.yaml"
    if not secrets.exists():
        print("ERROR: deploy/secrets.yaml does not exist yet; run `make demo` once.",
              file=sys.stderr)
        return 1
    lines = secrets.read_text().splitlines()
    found = set()
    for i, line in enumerate(lines):
        stripped = line.strip()
        for key in KEYS:
            if stripped.startswith(YAML_KEYS[key] + ":"):
                indent = line[: len(line) - len(line.lstrip())]
                lines[i] = f"{indent}{YAML_KEYS[key]}: {json.dumps(present[key])}"
                found.add(key)
    if found != set(KEYS):
        print("ERROR: deploy/secrets.yaml has no forty-two-client-id/secret entries; "
              "recreate it with `make demo-clean && make demo`.", file=sys.stderr)
        return 1
    secrets.write_text("\n".join(lines) + "\n")
    print("42 login enabled for this demo from .env (credentials copied into "
          "deploy/secrets.yaml, never committed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
