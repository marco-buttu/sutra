from __future__ import annotations

import json
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.admin_server import ContentRepository, EditorError, create_server


class AdminEditorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name) / "desktop"
        self.project.mkdir()
        for directory in ("admin", "content", "data", "schemas", "scripts"):
            shutil.copytree(ROOT / directory, self.project / directory)
        (self.project / "audio").symlink_to(ROOT / "audio", target_is_directory=True)
        self.repository = ContentRepository(self.project)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_editor_data_contains_every_sutra(self) -> None:
        data = self.repository.editor_data()
        self.assertEqual(data["locales"], ["it"])
        self.assertEqual(len(data["content"]["it"]), 2)
        self.assertEqual(
            sum(len(chapter["sutras"]) for chapter in data["content"]["it"]),
            106,
        )

    def test_save_sutra_updates_json_and_bundle(self) -> None:
        data = self.repository.editor_data()
        sutra = data["content"]["it"][0]["sutras"][0]
        updated_meaning = f"{sutra['meaning']} Updated in the editor test."
        result = self.repository.save_sutra(
            {
                "locale": "it",
                "sutraId": sutra["id"],
                "sanskrit": sutra["sanskrit"],
                "pronunciation": sutra["pronunciation"],
                "wordMeanings": sutra["wordMeanings"],
                "meaning": updated_meaning,
                "explanation": sutra["explanation"],
            }
        )

        saved = result["data"]["content"]["it"][0]["sutras"][0]
        self.assertEqual(saved["meaning"], updated_meaning)
        self.assertIn(
            updated_meaning,
            (self.project / "data/content.bundle.js").read_text(encoding="utf-8"),
        )
        self.assertTrue(any((self.project / ".editor_backups").iterdir()))
        source = (self.project / "content/locales/it/chapter_1.json").read_text(
            encoding="utf-8"
        )
        self.assertIn('\n  "sutras": [\n', source)

    def test_invalid_word_meaning_is_rejected(self) -> None:
        sutra = self.repository.editor_data()["content"]["it"][0]["sutras"][0]
        with self.assertRaises(EditorError):
            self.repository.save_sutra(
                {
                    "locale": "it",
                    "sutraId": sutra["id"],
                    "sanskrit": sutra["sanskrit"],
                    "pronunciation": sutra["pronunciation"],
                    "wordMeanings": [],
                    "meaning": sutra["meaning"],
                    "explanation": sutra["explanation"],
                }
            )

    def test_failed_build_restores_source_files(self) -> None:
        sutra = self.repository.editor_data()["content"]["it"][0]["sutras"][0]
        localized_path = self.project / "content/locales/it/chapter_1.json"
        original = localized_path.read_bytes()
        with patch.object(
            self.repository,
            "_build_bundle",
            side_effect=[EditorError("Simulated validation failure."), None],
        ):
            with self.assertRaises(EditorError):
                self.repository.save_sutra(
                    {
                        "locale": "it",
                        "sutraId": sutra["id"],
                        "sanskrit": sutra["sanskrit"],
                        "pronunciation": sutra["pronunciation"],
                        "wordMeanings": sutra["wordMeanings"],
                        "meaning": f"{sutra['meaning']} Invalid update.",
                        "explanation": sutra["explanation"],
                    }
                )
        self.assertEqual(localized_path.read_bytes(), original)

    def test_save_chapter_updates_localized_content(self) -> None:
        chapter = self.repository.editor_data()["content"]["it"][0]
        updated_description = f"{chapter['description']} Updated in the editor test."
        result = self.repository.save_chapter(
            {
                "locale": "it",
                "chapterId": chapter["id"],
                "title": chapter["title"],
                "subtitle": chapter["subtitle"],
                "description": updated_description,
            }
        )
        self.assertEqual(
            result["data"]["content"]["it"][0]["description"],
            updated_description,
        )

    def test_http_server_exposes_admin_and_api(self) -> None:
        server = create_server(self.project, "127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            with urlopen(f"{base_url}/admin/", timeout=5) as response:
                html = response.read().decode("utf-8")
            self.assertIn("Content Editor", html)

            with urlopen(f"{base_url}/api/editor-data", timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
            self.assertEqual(data["defaultLocale"], "it")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
