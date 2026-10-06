#!/usr/bin/env python3
"""Build the deterministic Presscart distribution ZIP using the standard library."""
import json
import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path

repo = Path(sys.argv[1])
plugin = repo / "plugin"
if plugin.is_symlink() or not plugin.is_dir():
    raise SystemExit("Expected a real plugin/ directory.")

manifest_path = plugin / "plugin.json"
if manifest_path.is_symlink():
    raise SystemExit("Refusing to package a symlink: plugin/plugin.json")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
name, version = manifest.get("name"), manifest.get("version")
if (name, version) != ("presscart-placement-advisor", "0.1.1"):
    raise SystemExit("Expected presscart-placement-advisor version 0.1.1.")

files = []
for path in sorted(plugin.rglob("*")):
    relative = path.relative_to(plugin)
    if any(part in {".DS_Store", "__MACOSX"} or part.startswith("._")
           for part in relative.parts):
        continue
    if path.is_symlink():
        raise SystemExit(f"Refusing to package a symlink: plugin/{relative}")
    if path.is_file():
        files.append((path, relative.as_posix()))

dist = repo / "dist"
if dist.is_symlink():
    raise SystemExit("Refusing to write through a dist/ symlink.")
dist.mkdir(exist_ok=True)
archive = dist / f"{name}-{version}.zip"
if archive.exists() or archive.is_symlink():
    raise SystemExit(f"Refusing to overwrite existing archive: {archive}")
temporary = None
try:
    with tempfile.NamedTemporaryFile(dir=dist, suffix=".zip", delete=False) as file:
        temporary = Path(file.name)
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9) as output:
        for path, relative in files:
            # Fixed timestamps, ordering, and modes keep repeated builds identical.
            entry = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(entry, path.read_bytes(), compresslevel=9)
    # Exclusive creation keeps existing evidence safe from accidental overwrite.
    os.link(temporary, archive)
finally:
    if temporary is not None:
        temporary.unlink(missing_ok=True)

print(f"Built {archive.relative_to(repo)} ({len(files)} files)")
