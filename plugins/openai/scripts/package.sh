#!/bin/sh
# Package only plugin/; no network, third-party dependencies, or user config writes.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

python3 "$SCRIPT_DIR/package.py" "$REPO_ROOT"
