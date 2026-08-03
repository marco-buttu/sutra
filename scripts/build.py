from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def javascript_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    ).replace("</", "<\\/")


def load_application_data() -> dict[str, Any]:
    catalog = read_json(ROOT / "content/catalog.json")
    locales: dict[str, Any] = {}
    for locale in catalog["supportedLocales"]:
        locale_root = ROOT / "content/locales" / locale
        locales[locale] = {
            "ui": read_json(locale_root / "ui.json"),
            "chapters": [
                read_json(locale_root / f"{chapter['id']}.json")
                for chapter in read_json(ROOT / "content/chapters.json")
            ],
        }
    return {
        "catalog": catalog,
        "chapters": read_json(ROOT / "content/chapters.json"),
        "sutras": read_json(ROOT / "content/sutras.json"),
        "voices": read_json(ROOT / "content/voices.json"),
        "audioManifest": read_json(ROOT / "content/audio_manifest.json"),
        "locales": locales,
    }


def audio_paths(manifest: dict[str, Any]) -> list[str]:
    paths = {manifest["restartCue"]}
    for voice in manifest["voices"]:
        for chapter in voice["chapters"]:
            paths.add(chapter["opening"])
            paths.add(chapter["closing"])
            paths.update(chapter["sutras"].values())
    return sorted(paths)


def build_audio_map(manifest: dict[str, Any]) -> dict[str, str]:
    result = {}
    for relative_path in audio_paths(manifest):
        encoded = base64.b64encode((ROOT / relative_path).read_bytes()).decode("ascii")
        result[relative_path] = f"data:audio/mpeg;base64,{encoded}"
    return result


def validate() -> None:
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/validate_content.py")],
        check=True,
    )


def write_bundle(data: dict[str, Any]) -> str:
    bundle = f"window.SUTRA_BY_HEART_DATA = {javascript_json(data)};\n"
    output = ROOT / "data/content.bundle.js"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(bundle, encoding="utf-8")
    return bundle


def write_embedded_html(data: dict[str, Any], bundle: str) -> Path:
    css = (ROOT / "css/sutra-by-heart.css").read_text(encoding="utf-8")
    application = (ROOT / "js/sutra-by-heart.js").read_text(encoding="utf-8")
    embedded_audio = javascript_json(build_audio_map(data["audioManifest"]))
    html = f"""<!DOCTYPE html>
<html lang="{data['catalog']['defaultLocale']}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#153446">
  <title>Sutra by Heart</title>
  <style>
{css}
  </style>
</head>
<body>
  <div id="app"></div>

  <script>
{bundle}  </script>
  <script>
window.SUTRA_BY_HEART_EMBEDDED_AUDIO = {embedded_audio};
  </script>
  <script>
{application}
  </script>
</body>
</html>
"""
    output = ROOT / "dist/sutra_by_heart_embedded.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    return output


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Sutra by Heart assets.")
    parser.add_argument(
        "--bundle-only",
        action="store_true",
        help="Regenerate the data bundle without rebuilding the embedded HTML.",
    )
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    validate()
    data = load_application_data()
    bundle = write_bundle(data)
    print(ROOT / "data/content.bundle.js")
    if not arguments.bundle_only:
        embedded = write_embedded_html(data, bundle)
        print(embedded)


if __name__ == "__main__":
    main()
