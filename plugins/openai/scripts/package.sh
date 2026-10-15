#!/bin/sh
# Package plugin/ plus a generated mcp.json; no network, third-party dependencies, or user config writes.
# Usage: ./scripts/package.sh --mcp-url https://<host>/mcp/openai [--write-local-config]
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

python3 -I "$SCRIPT_DIR/package.py" "$REPO_ROOT" "$@"
