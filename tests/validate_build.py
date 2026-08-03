from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT / "dist/sutra_by_heart_embedded.html"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def expected_audio_paths(manifest: dict[str, Any]) -> set[str]:
    paths = {manifest["restartCue"]}
    for voice in manifest["voices"]:
        for chapter in voice["chapters"]:
            paths.add(chapter["opening"])
            paths.add(chapter["closing"])
            paths.update(chapter["sutras"].values())
    return paths


def main() -> None:
    html = HTML_PATH.read_text(encoding="utf-8")
    if re.search(r"<script\s+[^>]*src=", html, flags=re.IGNORECASE):
        raise ValueError("The embedded build contains an external script.")
    if re.search(r"<link\s+[^>]*href=", html, flags=re.IGNORECASE):
        raise ValueError("The embedded build contains an external stylesheet.")

    match = re.search(
        r"window\.SUTRA_BY_HEART_EMBEDDED_AUDIO = (\{.*?\});\n",
        html,
        flags=re.DOTALL,
    )
    if not match:
        raise ValueError("The embedded audio map is missing.")
    audio_map = json.loads(match.group(1))
    expected = expected_audio_paths(read_json(ROOT / "content/audio_manifest.json"))
    if set(audio_map) != expected:
        raise ValueError("The embedded audio map does not match the manifest.")

    for relative_path, data_uri in audio_map.items():
        prefix, encoded = data_uri.split(",", 1)
        if prefix != "data:audio/mpeg;base64":
            raise ValueError(f"Invalid audio data URI: {relative_path}")
        embedded = base64.b64decode(encoded, validate=True)
        source = (ROOT / relative_path).read_bytes()
        if sha256(embedded) != sha256(source):
            raise ValueError(f"Embedded audio mismatch: {relative_path}")

    if html.count("<details class=\"sutra-explanation\">") != 1:
        raise ValueError("The explanation template is missing or duplicated in the code.")
    if "<details class=\"sutra-explanation\" open>" in html:
        raise ValueError("The explanation template is open by default.")

    print(f"Embedded audio files verified: {len(audio_map)}")
    print(f"Embedded HTML size: {HTML_PATH.stat().st_size} bytes")


if __name__ == "__main__":
    main()
