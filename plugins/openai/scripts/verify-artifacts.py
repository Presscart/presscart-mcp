"""Compare a built ZIP and (by default) the CLI-installed cache with plugin/.

Build first with --write-local-config so plugin/mcp.json holds the same rendered
MCP configuration as the ZIP. Usage:
  python3 scripts/verify-artifacts.py --mcp-url https://<host>/mcp/openai [--skip-installed]
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
import zipfile

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--mcp-url", required=True, help="The URL the ZIP was built with")
parser.add_argument("--skip-installed", action="store_true", help="Verify only the ZIP before installation")
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
package = repo / "plugin"
manifest = json.loads((package / "plugin.json").read_text())
name, version = manifest["name"], manifest["version"]
archive = repo / f"dist/{urlsplit(args.mcp_url).hostname}/{name}-{version}.zip"
expected = {path.relative_to(package).as_posix(): path.read_bytes()
            for path in package.rglob("*") if path.is_file() and path.name != ".DS_Store"}
assert len(expected) == 7, "Expected seven package files including plugin/mcp.json (brand assets pending)"
assert ".codex-plugin/plugin.json" not in expected, "Redundant compatibility overlay"
config = json.loads(expected["mcp.json"])
assert config["mcpServers"]["presscart"]["url"] == args.mcp_url, "plugin/mcp.json was built for a different URL"
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None, "ZIP CRC failure"
    assert sorted(bundle.namelist()) == sorted(expected), "Unexpected ZIP entries"
    for relative, value in expected.items():
        assert bundle.read(relative) == value, f"ZIP differs: {relative}"
print(f"ZIP matches all {len(expected)} package files byte for byte; CRC check passed.")
if not args.skip_installed:
    cache_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    cache = cache_home / f"plugins/cache/personal/{name}/{version}"
    installed = {path.relative_to(cache).as_posix(): path.read_bytes()
                 for path in cache.rglob("*") if path.is_file()}
    assert installed == expected, "Installed cache differs from package"
    print(f"Installed CLI cache matches all {len(expected)} package files byte for byte.")
print("ZIP SHA256:", hashlib.sha256(archive.read_bytes()).hexdigest())
