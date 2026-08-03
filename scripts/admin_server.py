from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_ROOT = Path(__file__).resolve().parents[1]
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_BACKUPS = 20


class EditorError(Exception):
    pass


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, value: Any) -> None:
    temporary = path.with_name(f".{path.name}.editor-tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EditorError(f"{label} is required.")
    return value.strip()


def optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise EditorError("Optional text fields must contain text or be empty.")
    normalized = value.strip()
    return normalized or None


class ContentRepository:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.content_root = self.root / "content"
        self.lock = threading.RLock()

    def editor_data(self) -> dict[str, Any]:
        with self.lock:
            return self._editor_data()

    def _editor_data(self) -> dict[str, Any]:
        catalog = read_json(self.content_root / "catalog.json")
        chapters = read_json(self.content_root / "chapters.json")
        core_sutras = read_json(self.content_root / "sutras.json")
        core_by_id = {sutra["id"]: sutra for sutra in core_sutras}
        localized_content: dict[str, list[dict[str, Any]]] = {}

        for locale in catalog["supportedLocales"]:
            locale_chapters = []
            for chapter in chapters:
                localized = read_json(
                    self.content_root
                    / "locales"
                    / locale
                    / f"{chapter['id']}.json"
                )
                localized_sutras = []
                for localized_sutra in localized["sutras"]:
                    core = core_by_id[localized_sutra["sutraId"]]
                    localized_sutras.append(
                        {
                            "id": core["id"],
                            "number": core["number"],
                            "order": core["order"],
                            "sanskrit": core["sanskrit"],
                            "pronunciation": localized_sutra["pronunciation"],
                            "wordMeanings": localized_sutra["wordMeanings"],
                            "meaning": localized_sutra["meaning"],
                            "explanation": localized_sutra["explanation"] or "",
                        }
                    )
                locale_chapters.append(
                    {
                        "id": chapter["id"],
                        "number": chapter["number"],
                        "title": localized["title"],
                        "subtitle": localized["subtitle"],
                        "description": localized["description"] or "",
                        "sutras": localized_sutras,
                    }
                )
            localized_content[locale] = locale_chapters

        return {
            "defaultLocale": catalog["defaultLocale"],
            "sourceLocale": catalog["sourceLocale"],
            "locales": catalog["supportedLocales"],
            "content": localized_content,
        }

    def save_sutra(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise EditorError("The request must contain a JSON object.")

        locale = required_text(payload.get("locale"), "Locale")
        sutra_id = required_text(payload.get("sutraId"), "Sutra identifier")
        sanskrit = required_text(payload.get("sanskrit"), "Sanskrit")
        pronunciation = required_text(
            payload.get("pronunciation"),
            "Pronunciation",
        )
        meaning = required_text(payload.get("meaning"), "Meaning")
        explanation = required_text(payload.get("explanation"), "Explanation")
        word_meanings = self._normalize_word_meanings(payload.get("wordMeanings"))

        with self.lock:
            catalog = read_json(self.content_root / "catalog.json")
            if locale not in catalog["supportedLocales"]:
                raise EditorError(f"Unknown locale: {locale}")

            core_path = self.content_root / "sutras.json"
            core_sutras = read_json(core_path)
            core_sutra = next(
                (item for item in core_sutras if item["id"] == sutra_id),
                None,
            )
            if core_sutra is None:
                raise EditorError(f"Unknown sutra: {sutra_id}")

            locale_path = (
                self.content_root
                / "locales"
                / locale
                / f"{core_sutra['chapterId']}.json"
            )
            localized_chapter = read_json(locale_path)
            localized_sutra = next(
                (
                    item
                    for item in localized_chapter["sutras"]
                    if item["sutraId"] == sutra_id
                ),
                None,
            )
            if localized_sutra is None:
                raise EditorError(
                    f"The localized content is missing sutra {sutra_id}."
                )

            core_sutra["sanskrit"] = sanskrit
            core_sutra["initialWord"] = sanskrit.split()[0]
            localized_sutra["pronunciation"] = pronunciation
            localized_sutra["initialPronunciation"] = pronunciation.split()[0]
            localized_sutra["wordMeanings"] = word_meanings
            localized_sutra["meaning"] = meaning
            localized_sutra["explanation"] = explanation

            backup = self._create_backup([core_path, locale_path])
            try:
                write_json_atomic(core_path, core_sutras)
                write_json_atomic(locale_path, localized_chapter)
                self._build_bundle()
            except Exception as error:
                self._restore_backup(backup)
                self._build_bundle()
                raise EditorError(f"Save failed and was rolled back: {error}") from error

            self._prune_backups()
            return {
                "message": f"Sutra {core_sutra['number']} saved.",
                "data": self.editor_data(),
            }

    def save_chapter(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise EditorError("The request must contain a JSON object.")

        locale = required_text(payload.get("locale"), "Locale")
        chapter_id = required_text(payload.get("chapterId"), "Chapter identifier")
        title = required_text(payload.get("title"), "Title")
        subtitle = required_text(payload.get("subtitle"), "Subtitle")
        description = optional_text(payload.get("description"))

        with self.lock:
            catalog = read_json(self.content_root / "catalog.json")
            if locale not in catalog["supportedLocales"]:
                raise EditorError(f"Unknown locale: {locale}")

            chapter_path = (
                self.content_root
                / "locales"
                / locale
                / f"{chapter_id}.json"
            )
            if not chapter_path.is_file():
                raise EditorError(f"Unknown chapter: {chapter_id}")

            chapter = read_json(chapter_path)
            chapter["title"] = title
            chapter["subtitle"] = subtitle
            chapter["description"] = description

            backup = self._create_backup([chapter_path])
            try:
                write_json_atomic(chapter_path, chapter)
                self._build_bundle()
            except Exception as error:
                self._restore_backup(backup)
                self._build_bundle()
                raise EditorError(f"Save failed and was rolled back: {error}") from error

            self._prune_backups()
            return {
                "message": f"Chapter {chapter['title']} saved.",
                "data": self.editor_data(),
            }

    @staticmethod
    def _normalize_word_meanings(value: Any) -> list[dict[str, str]]:
        if not isinstance(value, list) or not value:
            raise EditorError("At least one word meaning is required.")
        normalized = []
        for index, item in enumerate(value, start=1):
            if not isinstance(item, dict):
                raise EditorError(f"Word meaning {index} is invalid.")
            normalized.append(
                {
                    "term": required_text(item.get("term"), f"Word {index}"),
                    "meaning": required_text(
                        item.get("meaning"),
                        f"Meaning {index}",
                    ),
                }
            )
        return normalized

    def _create_backup(self, paths: list[Path]) -> list[tuple[Path, Path]]:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_root = self.root / ".editor_backups" / stamp
        pairs = []
        for source in paths:
            relative = source.relative_to(self.root)
            destination = backup_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            pairs.append((source, destination))
        return pairs

    @staticmethod
    def _restore_backup(pairs: list[tuple[Path, Path]]) -> None:
        for destination, backup in pairs:
            shutil.copy2(backup, destination)

    def _prune_backups(self) -> None:
        backup_root = self.root / ".editor_backups"
        if not backup_root.is_dir():
            return
        backups = sorted(
            (path for path in backup_root.iterdir() if path.is_dir()),
            reverse=True,
        )
        for old_backup in backups[MAX_BACKUPS:]:
            shutil.rmtree(old_backup)

    def _build_bundle(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(self.root / "scripts/build.py"),
                "--bundle-only",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise EditorError(detail or "Content validation failed.")


class AdminRequestHandler(SimpleHTTPRequestHandler):
    repository: ContentRepository

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/editor-data":
            self._send_json(HTTPStatus.OK, self.repository.editor_data())
            return
        if path in {"/admin", "/admin/"}:
            self.path = "/admin/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path not in {"/api/sutra", "/api/chapter"}:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown endpoint."})
            return

        try:
            payload = self._read_json_body()
            if path == "/api/sutra":
                result = self.repository.save_sutra(payload)
            else:
                result = self.repository.save_chapter(payload)
            self._send_json(HTTPStatus.OK, result)
        except EditorError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"Unexpected server error: {error}"},
            )

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _read_json_body(self) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise EditorError("Invalid request length.") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise EditorError("The request body is empty or too large.")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise EditorError("The request body is not valid JSON.") from error

    def _send_json(self, status: HTTPStatus, value: Any) -> None:
        encoded = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)


def create_server(root: Path, host: str, port: int) -> ThreadingHTTPServer:
    repository = ContentRepository(root)
    class BoundAdminRequestHandler(AdminRequestHandler):
        pass

    BoundAdminRequestHandler.repository = repository
    handler = partial(BoundAdminRequestHandler, directory=str(repository.root))
    return ThreadingHTTPServer((host, port), handler)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the local Sutra by Heart content editor.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    server = create_server(arguments.root, arguments.host, arguments.port)
    actual_port = server.server_address[1]
    url = f"http://{arguments.host}:{actual_port}/admin/"
    print(f"Sutra by Heart editor: {url}")
    print("Press Ctrl+C to stop the server.")
    if not arguments.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping the editor.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
