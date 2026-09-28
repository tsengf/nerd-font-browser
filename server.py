#!/usr/bin/env python3
"""Serve the Nerd Fonts catalog and cache preview fonts on demand."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import struct
import tempfile
import threading
import urllib.request
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
CATALOG = json.loads((ROOT / "data/catalog.json").read_text())
METADATA_PATH = ROOT / "data/metadata.json"
FONTS = {font["id"]: font for font in CATALOG["fonts"]}
CACHE = ROOT / "fonts"
LOCKS = {identifier: threading.Lock() for identifier in FONTS}
USER_AGENT = "NerdFontBrowser/1.0"

SERIF_OVERRIDES = {"CodeNewRoman", "Gohu", "IosevkaTermSlab", "Tinos"}


def font_tables(data: bytes) -> dict[str, tuple[int, int]]:
    if len(data) < 12:
        raise ValueError("Font file is too short")
    count = struct.unpack_from(">H", data, 4)[0]
    if len(data) < 12 + count * 16:
        raise ValueError("Font table directory is incomplete")
    tables = {}
    for index in range(count):
        tag, _, offset, length = struct.unpack_from(">4sIII", data, 12 + index * 16)
        if offset + length > len(data):
            raise ValueError("Font table extends beyond the file")
        tables[tag.decode("latin1")] = (offset, length)
    return tables


def measure_font(path: Path, identifier: str) -> dict:
    """Read OpenType metrics without an external Python dependency."""
    data = path.read_bytes()
    tables = font_tables(data)
    for tag, size in (("head", 20), ("hhea", 10), ("maxp", 6)):
        if tag not in tables or tables[tag][1] < size:
            raise ValueError(f"Missing or incomplete {tag} table")
    units_per_em = struct.unpack_from(">H", data, tables["head"][0] + 18)[0]
    if not units_per_em:
        raise ValueError("Invalid units per em")
    ascender, descender, line_gap = struct.unpack_from(">hhh", data, tables["hhea"][0] + 4)
    glyph_count = struct.unpack_from(">H", data, tables["maxp"][0] + 4)[0]
    family_class = 0
    if "OS/2" in tables and tables["OS/2"][1] >= 32:
        family_class = struct.unpack_from(">H", data, tables["OS/2"][0] + 30)[0] >> 8
    return {
        "serif": identifier in SERIF_OVERRIDES or family_class in {1, 2, 3, 4, 5, 7},
        "heightEm": round((ascender - descender + line_gap) / units_per_em, 3),
        "glyphCount": glyph_count,
    }


def metadata() -> dict:
    return json.loads(METADATA_PATH.read_text()) if METADATA_PATH.exists() else {}


def save_metadata(identifier: str, values: dict) -> None:
    with METADATA_LOCK:
        content = metadata()
        content[identifier] = values
        METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", dir=METADATA_PATH.parent, delete=False) as output:
            json.dump(content, output, indent=2)
            output.write("\n")
            temp_name = output.name
        os.replace(temp_name, METADATA_PATH)


METADATA_LOCK = threading.Lock()


def choose_font(archive: zipfile.ZipFile) -> zipfile.ZipInfo:
    candidates = [item for item in archive.infolist() if not item.is_dir()
                  and item.filename.lower().endswith((".ttf", ".otf"))]
    if not candidates:
        raise ValueError("Archive contains no supported font")

    def score(item: zipfile.ZipInfo) -> tuple[int, int, str]:
        name = Path(item.filename).name.lower()
        penalty = 0
        if "mono" not in name:
            penalty += 5
        if not any(part in name for part in ("regular", "normal", "-rg")):
            penalty += 4
        if any(part in name for part in ("bold", "italic", "light", "thin", "medium")):
            penalty += 8
        if "propo" in name:
            penalty += 8
        return penalty, len(item.filename), item.filename

    return min(candidates, key=score)


def ensure_font(identifier: str) -> tuple[Path, dict]:
    if identifier not in FONTS:
        raise KeyError(identifier)
    with LOCKS[identifier]:
        directory = CACHE / identifier
        existing = next((path for suffix in ("ttf", "otf")
                         if (path := directory / f"font.{suffix}").exists()), None)
        if existing:
            values = metadata().get(identifier)
            if values is None:
                values = measure_font(existing, identifier)
                save_metadata(identifier, values)
            return existing, values

        request = urllib.request.Request(FONTS[identifier]["downloadUrl"],
                                         headers={"User-Agent": USER_AGENT})
        with tempfile.NamedTemporaryFile(suffix=".zip") as downloaded:
            with urllib.request.urlopen(request, timeout=90) as response:
                shutil.copyfileobj(response, downloaded)
            downloaded.flush()
            with zipfile.ZipFile(downloaded.name) as archive:
                member = choose_font(archive)
                if member.file_size > 100 * 1024 * 1024:
                    raise ValueError("Font file exceeds the 100 MB limit")
                suffix = Path(member.filename).suffix.lower()
                directory.mkdir(parents=True, exist_ok=True)
                target = directory / f"font{suffix}"
                with archive.open(member) as source, tempfile.NamedTemporaryFile(
                    dir=directory, delete=False
                ) as output:
                    shutil.copyfileobj(source, output)
                    temp_name = output.name
                try:
                    values = measure_font(Path(temp_name), identifier)
                    os.replace(temp_name, target)
                finally:
                    if os.path.exists(temp_name):
                        os.unlink(temp_name)
        save_metadata(identifier, values)
        return target, values


class Handler(BaseHTTPRequestHandler):
    def send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "public, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value: dict, status: int = 200) -> None:
        self.send_bytes(json.dumps(value).encode(), "application/json; charset=utf-8", status)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/catalog":
            self.send_json({"version": CATALOG["version"], "fonts": CATALOG["fonts"],
                            "metadata": metadata()})
            return
        if path.startswith("/api/font/"):
            identifier = path.removeprefix("/api/font/")
            if identifier not in FONTS:
                self.send_json({"error": "Unknown font"}, HTTPStatus.NOT_FOUND)
                return
            try:
                font, _ = ensure_font(identifier)
                content_type = "font/ttf" if font.suffix == ".ttf" else "font/otf"
                self.send_bytes(font.read_bytes(), content_type)
            except (OSError, ValueError, zipfile.BadZipFile) as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_GATEWAY)
            return
        if path in ("/", "/index.html", "/app.js", "/styles.css"):
            file = ROOT / ("index.html" if path == "/" else path.lstrip("/"))
            content_type = {".html": "text/html", ".js": "text/javascript",
                            ".css": "text/css"}[file.suffix]
            self.send_bytes(file.read_bytes(), content_type + "; charset=utf-8")
            return
        self.send_error(HTTPStatus.NOT_FOUND)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Open http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
