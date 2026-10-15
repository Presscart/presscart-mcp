#!/usr/bin/env python3
"""Build the deterministic Presscart distribution ZIP using the standard library.

The remote MCP server URL is a build input, never stored in plugin/. Pass the
directory endpoint with --mcp-url (https://<host>/mcp/openai). The ZIP contains
plugin/ plus mcp.json rendered from mcp.template.json, and is written with a
build record to <dist>/<host>/ so builds for different endpoints never collide.
"""
import argparse
import hashlib
import ipaddress
import json
import os
import stat
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

NAME, VERSION = "presscart-placement-advisor", "0.2.0"
URL_TOKEN = "{{PRESSCART_MCP_URL}}"
DIRECTORY_PATH = "/mcp/openai"
LOCAL_MCP_CONFIG = "mcp.json"
FORBIDDEN_MCP_KEYS = {"headers", "clientId", "clientSecret", "env", "command", "args", "cwd"}


def fail(message):
    raise SystemExit(message)


def validate_mcp_url(value):
    """Accept only a canonical public https://<host>/mcp/openai URL."""
    if value != value.strip() or any(ch.isspace() or ch in '"\\<>' for ch in value):
        fail("--mcp-url must not contain whitespace, quotes, or backslashes.")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as error:
        fail(f"--mcp-url is not a valid URL: {error}")
    host = parts.hostname or ""
    if parts.scheme != "https":
        fail("--mcp-url must use https.")
    if parts.username is not None or parts.password is not None:
        fail("--mcp-url must not embed credentials.")
    if port is not None:
        fail("--mcp-url must use the default HTTPS port.")
    if parts.query or parts.fragment or "?" in value or "#" in value:
        fail("--mcp-url must not have a query or fragment.")
    if parts.netloc != host:
        fail("--mcp-url host must be lowercase with no port or credentials.")
    try:
        ipaddress.ip_address(host.strip("[]"))
        fail("--mcp-url must use a public DNS hostname, not an IP address.")
    except ValueError:
        pass
    labels = host.split(".")
    if len(labels) < 2 or not all(labels) or host == "localhost" or labels[-1] in {"localhost", "local", "internal"}:
        fail("--mcp-url must use a public DNS hostname.")
    if parts.path != DIRECTORY_PATH:
        fail(f"--mcp-url path must be exactly {DIRECTORY_PATH}, the read-only directory endpoint.")
    return value, host


def check_mcp_config(config, url):
    def keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                yield key
                yield from keys(child)
        elif isinstance(value, list):
            for child in value:
                yield from keys(child)

    servers = config.get("mcpServers")
    if not isinstance(servers, dict) or len(servers) != 1:
        fail("mcp.template.json must declare exactly one MCP server.")
    (server,) = servers.values()
    if server.get("type") != "streamable-http" or server.get("url") != url:
        fail("mcp.template.json server must be streamable-http with the URL placeholder.")
    if server.get("extensions", {}).get("com.openai", {}).get("auth", {}).get("type") != "oauth":
        fail("mcp.template.json server must declare OAuth.")
    forbidden = FORBIDDEN_MCP_KEYS.intersection(keys(config))
    if forbidden:
        fail(f"mcp.template.json must not declare {', '.join(sorted(forbidden))}.")


def render_mcp_config(repo, url):
    template = (repo / "mcp.template.json").read_text(encoding="utf-8")
    if template.count(URL_TOKEN) != 1:
        fail(f"mcp.template.json must contain {URL_TOKEN} exactly once.")
    rendered = template.replace(URL_TOKEN, url)
    check_mcp_config(json.loads(rendered), url)
    return rendered.encode("utf-8")


def collect_files(plugin):
    files = []
    for path in sorted(plugin.rglob("*")):
        relative = path.relative_to(plugin)
        if any(part in {".DS_Store", "__MACOSX"} or part.startswith("._") for part in relative.parts):
            continue
        if path.is_symlink():
            fail(f"Refusing to package a symlink: plugin/{relative}")
        if relative.as_posix() == LOCAL_MCP_CONFIG:
            # A local install copy; the packaged config is always rendered from the template.
            continue
        if path.is_file():
            files.append((relative.as_posix(), path.read_bytes()))
    return files


def write_exclusive(target, data):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, suffix=target.suffix, delete=False) as file:
            temporary = Path(file.name)
            file.write(data)
        # Exclusive creation keeps existing evidence safe from accidental overwrite.
        os.link(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("repo", type=Path, help="plugins/openai directory")
    parser.add_argument("--mcp-url", required=True, help="Directory MCP endpoint, https://<host>/mcp/openai")
    parser.add_argument("--dist", type=Path, help="Output root (default: <repo>/dist)")
    parser.add_argument("--write-local-config", action="store_true",
                        help="Also write plugin/mcp.json (gitignored) so a local marketplace install matches the ZIP")
    args = parser.parse_args()

    url, host = validate_mcp_url(args.mcp_url)
    repo = args.repo.resolve()
    plugin = repo / "plugin"
    if plugin.is_symlink() or not plugin.is_dir():
        fail("Expected a real plugin/ directory.")
    manifest_path = plugin / "plugin.json"
    if manifest_path.is_symlink():
        fail("Refusing to package a symlink: plugin/plugin.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    name, version = manifest.get("name"), manifest.get("version")
    if (name, version) != (NAME, VERSION):
        fail(f"Expected {NAME} version {VERSION}.")

    mcp_config = render_mcp_config(repo, url)
    files = sorted(collect_files(plugin) + [(LOCAL_MCP_CONFIG, mcp_config)])

    dist = (args.dist or repo / "dist").resolve()
    out = dist / host
    if dist.is_symlink() or out.is_symlink():
        fail("Refusing to write through a dist/ symlink.")
    archive = out / f"{name}-{version}.zip"
    record = out / f"{name}-{version}.build.json"
    if archive.exists() or archive.is_symlink() or record.exists():
        fail(f"Refusing to overwrite existing archive: {archive}")

    with tempfile.SpooledTemporaryFile() as buffer:
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for relative, data in files:
                # Fixed timestamps, ordering, and modes keep repeated builds identical.
                entry = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = (stat.S_IFREG | 0o644) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                output.writestr(entry, data, compresslevel=9)
        buffer.seek(0)
        data = buffer.read()

    out.mkdir(parents=True, exist_ok=True)
    write_exclusive(archive, data)
    info = {
        "name": name,
        "version": version,
        "mcp_url": url,
        "files": [relative for relative, _ in files],
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    write_exclusive(record, (json.dumps(info, indent=2) + "\n").encode("utf-8"))
    if args.write_local_config:
        (plugin / LOCAL_MCP_CONFIG).write_bytes(mcp_config)

    shown = archive.relative_to(repo) if archive.is_relative_to(repo) else archive
    print(f"Built {shown} ({len(files)} files) for MCP server {url}")
    print(f"SHA256 {info['sha256']}")


if __name__ == "__main__":
    main()
