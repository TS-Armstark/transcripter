"""Lokale Transkription der Aufnahme-Spuren mit faster-whisper (Whisper, offline)."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Protocol

from transcripter.export import Segment, to_markdown

MODEL_NAME = "large-v3-turbo"
MODEL_ENV = "TRANSCRIPTER_MODEL"
LANGUAGE = "de"

# (Spur-Schlüssel, Anteil 0..1) → z. B. für einen Fortschrittsbalken
ProgressCallback = Callable[[str, float], None]


class WhisperLike(Protocol):
    def transcribe(self, audio: str, **kwargs: Any) -> tuple[Iterable[Any], Any]: ...


@dataclass(frozen=True)
class DeviceChoice:
    device: str
    compute_type: str


def pick_device(cuda_devices: int | None = None) -> DeviceChoice:
    """GPU (NVIDIA/CUDA) wenn vorhanden, sonst CPU mit int8 – läuft auf jedem Rechner."""
    if cuda_devices is None:
        try:
            import ctranslate2

            cuda_devices = ctranslate2.get_cuda_device_count()
        except Exception:  # CUDA-Bibliotheken fehlen (Basis-Paket) → CPU
            cuda_devices = 0
    if cuda_devices > 0:
        return DeviceChoice("cuda", "float16")
    return DeviceChoice("cpu", "int8")


def app_dir() -> Path:
    """Ordner der portablen App (PyInstaller) bzw. Projektwurzel im Entwicklungsmodus."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parents[2]


def resolve_model(env: dict[str, str] | None = None, base: Path | None = None) -> tuple[str, bool]:
    """Liefert (Modellpfad oder -name, nur_lokal).

    Reihenfolge: Umgebungsvariable → mitgeliefertes ``models/<name>`` → Modellname (lädt einmalig
    von Hugging Face herunter; nur für die Entwicklung gedacht).
    """
    env = os.environ if env is None else env
    if env.get(MODEL_ENV):
        return env[MODEL_ENV], True
    bundled = (base or app_dir()) / "models" / MODEL_NAME
    if (bundled / "model.bin").exists():
        return str(bundled), True
    return MODEL_NAME, False


def load_model() -> WhisperLike:
    from faster_whisper import WhisperModel

    model, local_only = resolve_model()
    choice = pick_device()
    try:
        return WhisperModel(
            model, device=choice.device, compute_type=choice.compute_type, local_files_only=local_only
        )
    except Exception:
        if choice.device == "cpu":
            raise
        # GPU gemeldet, aber Treiber/Bibliotheken passen nicht → sicher auf CPU zurückfallen
        return WhisperModel(model, device="cpu", compute_type="int8", local_files_only=local_only)


def transcribe_track(
    model: WhisperLike, path: Path, speaker: str, on_progress: Callable[[float], None] | None = None
) -> list[Segment]:
    raw_segments, info = model.transcribe(
        str(path),
        language=LANGUAGE,
        vad_filter=True,  # überspringt Stille – wichtig für die oft stille System-Spur
        beam_size=5,
    )
    duration = getattr(info, "duration", 0) or 0
    result = []
    for seg in raw_segments:
        result.append(Segment(seg.start, seg.end, seg.text, speaker))
        if on_progress and duration:
            on_progress(min(seg.end / duration, 1.0))
    if on_progress:
        on_progress(1.0)
    return result


def _overlaps(a: Segment, b: Segment) -> bool:
    return a.start < b.end and b.start < a.end


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def remove_echo(mic: list[Segment], system: list[Segment], threshold: float = 0.6) -> list[Segment]:
    """Entfernt Mikrofon-Segmente, die nur das Echo der Lautsprecher sind.

    Ohne Headset nimmt das Mikrofon die Remote-Teilnehmer mit auf; der Text stünde dann doppelt im Transkript.
    """
    return [
        m for m in mic if not any(_overlaps(m, s) and _similar(m.text, s.text) >= threshold for s in system)
    ]


def merge_tracks(tracks: dict[str, list[Segment]]) -> list[Segment]:
    mic = tracks.get("mic", [])
    if "system" in tracks:
        mic = remove_echo(mic, tracks["system"])
    others = [seg for key, segs in tracks.items() if key != "mic" for seg in segs]
    return sorted([*mic, *others], key=lambda s: (s.start, s.end))


def transcribe_session(
    session_dir: Path,
    out_dir: Path,
    model: WhisperLike | None = None,
    on_progress: ProgressCallback | None = None,
) -> Path:
    """Transkribiert alle Spuren einer Sitzung und schreibt ``<out_dir>/<sitzung>.md``."""
    meta = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    model = model or load_model()

    tracks: dict[str, list[Segment]] = {}
    for key, info in meta["tracks"].items():
        path = session_dir / info["file"]
        if not path.exists():
            continue
        progress = (lambda p, k=key: on_progress(k, p)) if on_progress else None
        tracks[key] = transcribe_track(model, path, info.get("label") or key, progress)

    started = datetime.fromisoformat(meta["started_at"])
    markdown = to_markdown(merge_tracks(tracks), f"Meeting {started:%d.%m.%Y %H:%M}", started)

    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{session_dir.name}.md"
    target.write_text(markdown, encoding="utf-8")
    return target


def latest_session(recordings: Path) -> Path | None:
    sessions = sorted(p for p in recordings.glob("*/session.json"))
    return sessions[-1].parent if sessions else None
