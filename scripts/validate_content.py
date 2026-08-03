from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_schema(data_path: Path, schema_path: Path) -> None:
    data = read_json(data_path)
    schema = read_json(schema_path)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(data),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        messages = [
            f"{data_path}: {'/'.join(map(str, error.absolute_path))}: {error.message}"
            for error in errors
        ]
        raise ValueError("\n".join(messages))


def referenced_audio_paths(manifest: dict[str, Any]) -> set[str]:
    paths = {manifest["restartCue"]}
    for voice in manifest["voices"]:
        for chapter in voice["chapters"]:
            paths.add(chapter["opening"])
            paths.add(chapter["closing"])
            paths.update(chapter["sutras"].values())
    return paths


def ensure_ascii_apostrophes() -> None:
    checked_suffixes = {".json", ".js", ".py", ".html", ".css", ".md", ".txt"}
    typographic_apostrophe = chr(0x2019)
    ignored_directories = {".editor_backups", ".git", ".venv", "dist", "node_modules"}
    for path in ROOT.rglob("*"):
        if ignored_directories.intersection(path.parts):
            continue
        if path.is_file() and path.suffix in checked_suffixes:
            text = path.read_text(encoding="utf-8")
            if typographic_apostrophe in text:
                raise ValueError(f"Typographic apostrophe found in {path}")


def main() -> None:
    schemas = ROOT / "schemas"
    content = ROOT / "content"
    catalog = read_json(content / "catalog.json")
    chapters = read_json(content / "chapters.json")
    sutras = read_json(content / "sutras.json")
    voices = read_json(content / "voices.json")
    audio_manifest = read_json(content / "audio_manifest.json")

    validate_schema(content / "catalog.json", schemas / "catalog.schema.json")
    validate_schema(content / "chapters.json", schemas / "chapters.schema.json")
    validate_schema(content / "sutras.json", schemas / "sutras.schema.json")
    validate_schema(content / "voices.json", schemas / "voices.schema.json")
    validate_schema(
        content / "audio_manifest.json",
        schemas / "audio-manifest.schema.json",
    )

    chapter_by_id = {chapter["id"]: chapter for chapter in chapters}
    sutra_by_id = {sutra["id"]: sutra for sutra in sutras}
    voice_ids = {voice["id"] for voice in voices}
    if len(chapter_by_id) != len(chapters):
        raise ValueError("Duplicate chapter identifier.")
    if len(sutra_by_id) != len(sutras):
        raise ValueError("Duplicate sutra identifier.")
    if catalog["defaultVoiceId"] not in voice_ids:
        raise ValueError("The default voice does not exist.")

    expected_sutra_ids = set(sutra_by_id)
    listed_sutra_ids: set[str] = set()
    for chapter in chapters:
        for expected_order, identifier in enumerate(chapter["sutraIds"], start=1):
            sutra = sutra_by_id.get(identifier)
            if not sutra:
                raise ValueError(f"Unknown sutra in chapter: {identifier}")
            if sutra["chapterId"] != chapter["id"]:
                raise ValueError(f"Incorrect chapter for {identifier}")
            if sutra["order"] != expected_order:
                raise ValueError(f"Incorrect order for {identifier}")
            if sutra["initialWord"] != sutra["sanskrit"].split()[0]:
                raise ValueError(f"Incorrect initial word for {identifier}")
            listed_sutra_ids.add(identifier)
    if listed_sutra_ids != expected_sutra_ids:
        raise ValueError("The chapter catalog does not cover every sutra exactly once.")

    for locale in catalog["supportedLocales"]:
        locale_root = content / "locales" / locale
        validate_schema(locale_root / "ui.json", schemas / "ui.schema.json")
        for chapter in chapters:
            path = locale_root / f"{chapter['id']}.json"
            validate_schema(path, schemas / "locale-chapter.schema.json")
            localized = read_json(path)
            if localized["locale"] != locale:
                raise ValueError(f"Incorrect locale in {path}")
            if localized["chapterId"] != chapter["id"]:
                raise ValueError(f"Incorrect chapter identifier in {path}")
            localized_ids = [item["sutraId"] for item in localized["sutras"]]
            if localized_ids != chapter["sutraIds"]:
                raise ValueError(f"Incomplete or misordered translation in {path}")
            if not localized["description"]:
                raise ValueError(f"Missing chapter description in {path}")
            for item in localized["sutras"]:
                if item["initialPronunciation"] != item["pronunciation"].split()[0]:
                    raise ValueError(
                        f"Incorrect initial pronunciation for {item['sutraId']} in {path}"
                    )
                if catalog["features"]["explanations"] and not item["explanation"]:
                    raise ValueError(f"Missing explanation for {item['sutraId']} in {path}")

    manifest_voice_ids = {voice["voiceId"] for voice in audio_manifest["voices"]}
    if manifest_voice_ids != voice_ids:
        raise ValueError("The audio manifest and voice catalog do not match.")
    for voice in audio_manifest["voices"]:
        manifest_chapters = {chapter["chapterId"]: chapter for chapter in voice["chapters"]}
        if set(manifest_chapters) != set(chapter_by_id):
            raise ValueError(f"Incomplete chapter audio for voice {voice['voiceId']}")
        for chapter_id, chapter_audio in manifest_chapters.items():
            expected = set(chapter_by_id[chapter_id]["sutraIds"])
            if set(chapter_audio["sutras"]) != expected:
                raise ValueError(
                    f"Incomplete sutra audio for voice {voice['voiceId']} and {chapter_id}"
                )

    referenced = referenced_audio_paths(audio_manifest)
    available = {
        f"audio/{path.name}" for path in (ROOT / "audio").glob("*.mp3")
    }
    missing = referenced - available
    orphaned = available - referenced
    if missing:
        raise ValueError(f"Missing audio files: {sorted(missing)}")
    if orphaned:
        raise ValueError(f"Unreferenced audio files: {sorted(orphaned)}")

    for path in available:
        name = Path(path).name
        if name != "restarting.mp3" and not name.endswith("_vijay.mp3"):
            raise ValueError(f"Audio file does not identify its voice: {path}")

    ensure_ascii_apostrophes()
    print(f"Chapters validated: {len(chapters)}")
    print(f"Sutras validated: {len(sutras)}")
    print(f"Locales validated: {len(catalog['supportedLocales'])}")
    print(f"Audio files validated: {len(available)}")


if __name__ == "__main__":
    main()
