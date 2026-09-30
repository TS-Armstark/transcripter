"""Übersicht über vorhandene Aufnahmen und ihre Transkripte (ohne GUI-Abhängigkeit)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class SessionInfo:
    directory: Path
    started_at: datetime
    duration: float
    transcript: Path | None

    @property
    def name(self) -> str:
        return self.directory.name


def list_sessions(recordings: Path, transcripts: Path) -> list[SessionInfo]:
    """Alle Aufnahmen, neueste zuerst. Defekte ``session.json`` werden übersprungen."""
    result = []
    for meta_path in recordings.glob("*/session.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            started = datetime.fromisoformat(meta["started_at"])
        except (OSError, ValueError, KeyError):
            continue
        directory = meta_path.parent
        transcript = transcripts / f"{directory.name}.md"
        result.append(
            SessionInfo(
                directory,
                started,
                float(meta.get("duration") or 0),
                transcript if transcript.exists() else None,
            )
        )
    return sorted(result, key=lambda s: s.started_at, reverse=True)
