"""Export von Transkript-Segmenten als Markdown."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Segment:
    start: float  # Sekunden ab Aufnahmebeginn
    end: float
    text: str
    speaker: str | None = None


def format_timestamp(seconds: float) -> str:
    total = int(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def to_markdown(segments: Iterable[Segment], title: str, recorded_at: datetime | None = None) -> str:
    """Baut das Transkript; aufeinanderfolgende Segmente desselben Sprechers werden zusammengefasst."""
    lines = [f"# {title}", ""]
    if recorded_at:
        lines += [f"Aufgenommen: {recorded_at:%d.%m.%Y %H:%M}", ""]

    block_start: float | None = None
    block_speaker: str | None = None
    block_text: list[str] = []

    def flush() -> None:
        if block_start is None:
            return
        who = f" **{block_speaker}:**" if block_speaker else ""
        lines.append(f"**[{format_timestamp(block_start)}]**{who} {' '.join(block_text)}")
        lines.append("")

    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        if block_start is None or seg.speaker != block_speaker:
            flush()
            block_start, block_speaker, block_text = seg.start, seg.speaker, []
        block_text.append(text)
    flush()

    return "\n".join(lines).rstrip() + "\n"
