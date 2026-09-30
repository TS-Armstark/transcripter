"""Aufnahme: jede Quelle (Mikrofon, System-Audio) landet als eigene Mono-WAV-Spur in einem Sitzungsordner."""

from __future__ import annotations

import json
import queue
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Protocol

import numpy as np
import soundfile as sf

BlockCallback = Callable[[np.ndarray], None]

SESSION_FORMAT = "%Y-%m-%d_%H-%M-%S"


class AudioSource(Protocol):
    """Liefert int16-Mono-Blöcke an einen Callback (aus einem Audio-Thread)."""

    label: str  # z. B. „Ich/Raum“ oder „Remote“ – wird später als Sprecher genutzt
    device_name: str
    samplerate: int

    def start(self, callback: BlockCallback) -> None: ...

    def stop(self) -> None: ...


def to_mono_int16(data: bytes | np.ndarray, channels: int) -> np.ndarray:
    """Interleaved int16 → Mono int16 (Mittelwert der Kanäle)."""
    samples = np.frombuffer(data, dtype=np.int16) if isinstance(data, bytes) else np.asarray(data, np.int16)
    if channels <= 1:
        return samples.copy()
    usable = len(samples) - len(samples) % channels
    frames = samples[:usable].reshape(-1, channels).astype(np.int32)
    return frames.mean(axis=1).round().astype(np.int16)


class TrackWriter:
    """Schreibt Blöcke threadsicher in eine WAV-Datei.

    Füllt Lücken mit Stille auf: WASAPI-Loopback liefert *keine* Daten, solange nichts abgespielt wird.
    Ohne Auffüllen wäre die System-Spur kürzer als die Mikrofon-Spur und die Zeitstempel liefen auseinander.
    """

    def __init__(
        self,
        path: Path,
        samplerate: int,
        clock: Callable[[], float] = time.monotonic,
        max_gap: float = 0.5,
        keep_margin: float = 0.1,
    ) -> None:
        self.path = path
        self.samplerate = samplerate
        self._clock = clock
        self._max_gap = int(max_gap * samplerate)
        self._keep_margin = int(keep_margin * samplerate)
        self._file = sf.SoundFile(path, "w", samplerate=samplerate, channels=1, subtype="PCM_16")
        self._queue: queue.Queue[np.ndarray] = queue.Queue()
        self._t0 = clock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.frames_written = 0
        self.frames_padded = 0

    # --- aus dem Audio-Thread ---
    def push(self, block: np.ndarray) -> None:
        self._queue.put(block)

    # --- Verarbeitung ---
    def write_block(self, block: np.ndarray) -> None:
        self._file.write(block)
        self.frames_written += len(block)

    def pad_to_clock(self) -> None:
        expected = int((self._clock() - self._t0) * self.samplerate)
        lag = expected - self.frames_written
        if lag > self._max_gap:
            silence = np.zeros(lag - self._keep_margin, dtype=np.int16)
            self.write_block(silence)
            self.frames_padded += len(silence)

    def _run(self) -> None:
        while not (self._stop.is_set() and self._queue.empty()):
            try:
                self.write_block(self._queue.get(timeout=0.1))
            except queue.Empty:
                if not self._stop.is_set():
                    self.pad_to_clock()

    def start(self) -> None:
        self._t0 = self._clock()
        self._thread = threading.Thread(target=self._run, name=f"writer-{self.path.stem}", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join()
        self._file.close()

    @property
    def duration(self) -> float:
        return self.frames_written / self.samplerate


@dataclass
class Session:
    directory: Path
    started_at: datetime
    tracks: dict[str, dict] = field(default_factory=dict)
    duration: float = 0.0

    @property
    def meta_path(self) -> Path:
        return self.directory / "session.json"

    def save(self) -> None:
        meta = {
            "started_at": self.started_at.isoformat(timespec="seconds"),
            "duration": round(self.duration, 2),
            "tracks": self.tracks,
        }
        self.meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


class Recorder:
    """Startet/stoppt mehrere Quellen gleichzeitig; eine Spur pro Quelle."""

    def __init__(self, sources: dict[str, AudioSource], recordings_dir: Path) -> None:
        if not sources:
            raise ValueError("Mindestens eine Audioquelle nötig")
        self.sources = sources
        self.recordings_dir = recordings_dir
        self.session: Session | None = None
        self._writers: dict[str, TrackWriter] = {}
        self._t_start = 0.0

    @property
    def is_recording(self) -> bool:
        return self.session is not None

    def elapsed(self) -> float:
        return time.monotonic() - self._t_start if self.is_recording else 0.0

    def start(self, now: datetime | None = None) -> Session:
        if self.session:
            raise RuntimeError("Aufnahme läuft bereits")
        started_at = now or datetime.now()
        directory = self.recordings_dir / started_at.strftime(SESSION_FORMAT)
        directory.mkdir(parents=True, exist_ok=False)
        session = Session(directory, started_at)

        try:
            for key, source in self.sources.items():
                writer = TrackWriter(directory / f"{key}.wav", source.samplerate)
                self._writers[key] = writer
                writer.start()
                source.start(writer.push)
                session.tracks[key] = {
                    "file": writer.path.name,
                    "label": source.label,
                    "device": source.device_name,
                    "samplerate": source.samplerate,
                }
        except Exception:
            self._shutdown()
            self._writers = {}
            raise

        self._t_start = time.monotonic()
        self.session = session
        session.save()
        return session

    def stop(self) -> Session:
        if not self.session:
            raise RuntimeError("Keine Aufnahme aktiv")
        session = self.session
        self._shutdown()
        for key, info in session.tracks.items():
            writer = self._writers[key]
            info["duration"] = round(writer.duration, 2)
            info["padded_seconds"] = round(writer.frames_padded / writer.samplerate, 2)
        session.duration = max((w.duration for w in self._writers.values()), default=0.0)
        session.save()
        self._writers = {}
        self.session = None
        return session

    def _shutdown(self) -> None:
        for source in self.sources.values():
            try:
                source.stop()
            except Exception:  # Stoppen soll nie die Datei-Sicherung verhindern
                pass
        for writer in self._writers.values():
            writer.close()
