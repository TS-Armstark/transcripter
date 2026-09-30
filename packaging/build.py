"""Baut die portable App: ``python packaging/build.py [--model PFAD]``.

Ergebnis: ``dist/Transcripter/`` (Transcripter.exe, _internal/, models/, LICENSES/, LIESMICH.txt).
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "Transcripter"
MODEL_NAME = "large-v3-turbo"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, help="Ordner mit dem CTranslate2-Modell (model.bin …)")
    args = parser.parse_args()

    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--windowed",
            "--name",
            "Transcripter",
            "--distpath",
            str(ROOT / "dist"),
            "--workpath",
            str(ROOT / "build"),
            "--specpath",
            str(ROOT / "build"),
            "--collect-all",
            "faster_whisper",
            "--collect-all",
            "ctranslate2",
            "--collect-all",
            "onnxruntime",
            "--collect-all",
            "av",
            "--collect-all",
            "soundfile",
            "--collect-all",
            "pyaudiowpatch",
            "--exclude-module",
            "tkinter",
            str(ROOT / "packaging" / "entry.py"),
        ],
        check=True,
    )

    if args.model:
        target = DIST / "models" / MODEL_NAME
        shutil.copytree(args.model, target, dirs_exist_ok=True)

    licenses = DIST / "LICENSES"
    licenses.mkdir(exist_ok=True)
    shutil.copy(ROOT / "LICENSE", licenses / "Transcripter-LICENSE.txt")
    shutil.copy(ROOT / "packaging" / "THIRD_PARTY.txt", licenses / "THIRD_PARTY.txt")
    shutil.copy(ROOT / "packaging" / "LIESMICH.txt", DIST / "LIESMICH.txt")
    print(f"Fertig: {DIST}")


if __name__ == "__main__":
    main()
