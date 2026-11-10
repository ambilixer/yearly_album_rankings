"""The ranking app. Run it from the repo folder:

    python tools/rank.py            # current year
    python tools/rank.py 2026

It opens http://localhost:8777 in your browser. Drop in a new RYM export, rank and tag,
add any missing cover art, save, then publish (git commit + push). Covers you add are
saved to site/art/<rym_id>.jpg right away and go up with the next publish. Your in-progress work is kept in
data/.draft-<year>.json, so closing the tab doesn't lose anything.
"""
from __future__ import annotations

import json
import mimetypes
import re
import subprocess
import sys
import threading
import traceback
import urllib.request
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402
import rankcore  # noqa: E402
from rym import ART, ART_EXTS, DATA, ROOT, export_paths  # noqa: E402

PORT = 8777
APP = Path(__file__).resolve().parent / "rank_app"
SITE = ROOT / "site"


def draft_path(year: int) -> Path:
    return DATA / f".draft-{year}.json"


MAX_IMAGE = 15 * 1024 * 1024
UA = "Mozilla/5.0 (yearly-album-rankings ranking app)"
OG_IMAGE = re.compile(r"""<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>""", re.I)


def image_ext(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,text/html;q=0.9,*/*;q=0.5"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read(MAX_IMAGE + 1)
    if len(data) > MAX_IMAGE:
        raise ValueError("That file is over 15 MB.")
    return data


def fetch_image(url: str) -> bytes:
    """Download an image from a link. A web page link (Bandcamp, SoundCloud, Spotify...)
    works too: the page's preview image (og:image), which is the cover on those sites."""
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError("Paste a link starting with http:// or https://.")
    try:
        data = download(url)
        if image_ext(data):
            return data
        page = data.decode("utf-8", errors="replace")
        tag = OG_IMAGE.search(page)
        m = tag and re.search(r"""content=["']([^"']+)["']""", tag.group(0), re.I)
        if not m:
            raise ValueError("No image at that link, and the page doesn't name a cover image. Try right-clicking the cover and copying the image instead.")
        data = download(urljoin(url, m.group(1).replace("&amp;", "&")))
    except OSError as e:  # URLError, HTTPError, timeouts
        raise ValueError(f"Couldn't download that link ({e}).") from e
    if not image_ext(data):
        raise ValueError("That link isn't a JPEG, PNG or WebP image.")
    return data


def save_art(rid: int, data: bytes) -> None:
    ext = image_ext(data)
    if not ext:
        raise ValueError("That isn't a JPEG, PNG or WebP image.")
    if len(data) > MAX_IMAGE:
        raise ValueError("That image is over 15 MB.")
    delete_art(rid)
    ART.mkdir(parents=True, exist_ok=True)
    (ART / f"{rid}{ext}").write_bytes(data)


def delete_art(rid: int) -> None:
    for ext in ART_EXTS:
        (ART / f"{rid}{ext}").unlink(missing_ok=True)


def run(cmd: list[str]) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


class Handler(BaseHTTPRequestHandler):
    year = date.today().year

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass

    def send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj, code: int = 200) -> None:
        self.send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def static(self, base: Path, rel: str) -> None:
        path = (base / (rel or "index.html")).resolve()
        if base.resolve() not in path.parents and path != base.resolve() or not path.is_file():
            return self.send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send(200, path.read_bytes(), ctype)

    def do_GET(self):
        url = urlparse(self.path)
        p = unquote(url.path)
        try:
            if p == "/api/state":
                d = draft_path(self.year)
                draft = json.loads(d.read_text(encoding="utf-8")) if d.exists() else None
                if draft:
                    draft = rankcore.refresh_draft(self.year, draft)
                return self.json({"year": self.year, "exports": [x for x, _ in export_paths()], "draft": draft})
            if p == "/api/fetch-image":  # so the page can resize an image from another site
                url = (parse_qs(url.query).get("url") or [""])[0].strip()
                try:
                    data = fetch_image(url)
                except ValueError as e:
                    return self.json({"error": str(e)}, 400)
                return self.send(200, data, {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}[image_ext(data)])
            if p.startswith("/site/"):
                return self.static(SITE, p[len("/site/"):])
            return self.static(APP, p.lstrip("/"))
        except Exception as e:
            traceback.print_exc()
            return self.json({"error": str(e)}, 500)

    def do_POST(self):
        p = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        try:
            if p == "/api/import":
                name = unquote(self.headers.get("X-Filename", "export.csv"))
                d = rankcore.save_export(name, raw)
                draft = rankcore.propose(self.year, d)
                return self.json(draft)
            if p == "/api/art":  # body: the image bytes (already resized by the page)
                rid = int(self.headers.get("X-Rym-Id", ""))
                save_art(rid, raw)
                return self.json(rankcore.art_lookup()(rid))
            body = json.loads(raw or b"{}")
            if p == "/api/art-delete":
                delete_art(int(body["id"]))
                return self.json(rankcore.art_lookup()(int(body["id"])))
            if p == "/api/start":  # start from an export already in the repo
                return self.json(rankcore.propose(self.year, body.get("exportDate")))
            if p == "/api/draft":
                draft_path(self.year).write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
                return self.json({"ok": True})
            if p == "/api/discard":
                draft_path(self.year).unlink(missing_ok=True)
                return self.json({"ok": True})
            if p == "/api/save":
                res = rankcore.save(self.year, body["date"], body["ranked"], body.get("queue", []))
                build.main([str(self.year)])  # refresh the local dashboard preview
                draft_path(self.year).unlink(missing_ok=True)
                return self.json({"ok": True, **res})
            if p == "/api/publish":
                log = []
                for cmd in (["git", "add", "-A", "data", "site/art"] if ART.is_dir() else ["git", "add", "data"],
                            ["git", "commit", "-m", f"Ranking update {body.get('date', '')}".strip()],
                            ["git", "pull", "--rebase", "origin", "main"],
                            ["git", "push"]):
                    code, out = run(cmd)
                    log.append(f"$ {' '.join(cmd)}\n{out}")
                    if code and not (cmd[1] == "commit" and "nothing to commit" in out):
                        return self.json({"ok": False, "log": "\n\n".join(log)})
                return self.json({"ok": True, "log": "\n\n".join(log)})
            return self.json({"error": "unknown endpoint"}, 404)
        except ValueError as e:
            return self.json({"error": str(e)}, 400)
        except Exception as e:
            traceback.print_exc()
            return self.json({"error": f"{type(e).__name__}: {e}"}, 500)


def main() -> None:
    years = [a for a in sys.argv[1:] if a.isdigit()]
    if years:
        Handler.year = int(years[0])
    try:
        build.main([str(Handler.year)])  # so the preview has data
    except SystemExit as e:
        print(f"(dashboard preview not built: {e})")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}/"
    print(f"Ranking app for {Handler.year} running at {url}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
