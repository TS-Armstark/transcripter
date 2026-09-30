import json
from pathlib import Path
from types import SimpleNamespace

from transcripter.export import Segment
from transcripter.transcribe import (
    MODEL_NAME,
    latest_session,
    merge_tracks,
    pick_device,
    remove_echo,
    resolve_model,
    transcribe_session,
)


def test_pick_device():
    assert pick_device(1).device == "cuda"
    cpu = pick_device(0)
    assert (cpu.device, cpu.compute_type) == ("cpu", "int8")


def test_resolve_model_prefers_env_then_bundled(tmp_path):
    assert resolve_model(env={"TRANSCRIPTER_MODEL": "/m"}, base=tmp_path) == ("/m", True)
    assert resolve_model(env={}, base=tmp_path) == (MODEL_NAME, False)
    bundled = tmp_path / "models" / MODEL_NAME
    bundled.mkdir(parents=True)
    (bundled / "model.bin").touch()
    assert resolve_model(env={}, base=tmp_path) == (str(bundled), True)


def test_remove_echo_drops_only_overlapping_similar_text():
    system = [Segment(10, 14, "Können Sie mich hören?", "Remote")]
    mic = [
        Segment(10.3, 14.2, "können sie mich hören", "Ich/Raum"),  # Echo
        Segment(11, 13, "Ja, laut und deutlich.", "Ich/Raum"),  # echte Antwort, zeitgleich
        Segment(30, 32, "Können Sie mich hören?", "Ich/Raum"),  # gleicher Text, andere Zeit
    ]
    kept = [s.text for s in remove_echo(mic, system)]
    assert kept == ["Ja, laut und deutlich.", "Können Sie mich hören?"]


def test_merge_sorts_by_time():
    merged = merge_tracks({"mic": [Segment(5, 6, "b", "Ich/Raum")], "system": [Segment(1, 2, "a", "Remote")]})
    assert [s.text for s in merged] == ["a", "b"]


class FakeModel:
    def __init__(self, texts: dict[str, list[tuple[float, float, str]]]):
        self.texts = texts
        self.calls = []

    def transcribe(self, audio, **kwargs):
        self.calls.append((Path(audio).name, kwargs))
        segs = [SimpleNamespace(start=a, end=b, text=t) for a, b, t in self.texts[Path(audio).name]]
        return iter(segs), SimpleNamespace(duration=10.0)


def test_transcribe_session_writes_markdown(tmp_path):
    session = tmp_path / "rec" / "2026-09-30_09-15-00"
    session.mkdir(parents=True)
    for name in ("mic.wav", "system.wav"):
        (session / name).touch()
    (session / "session.json").write_text(
        json.dumps(
            {
                "started_at": "2026-09-30T09:15:00",
                "tracks": {
                    "mic": {"file": "mic.wav", "label": "Ich/Raum"},
                    "system": {"file": "system.wav", "label": "Remote"},
                },
            }
        ),
        encoding="utf-8",
    )
    model = FakeModel({"mic.wav": [(4, 6, " Guten Morgen!")], "system.wav": [(0, 3, " Hallo, alle da?")]})
    progress = []

    out = transcribe_session(session, tmp_path / "out", model, lambda k, p: progress.append((k, p)))

    md = out.read_text(encoding="utf-8")
    assert out.name == "2026-09-30_09-15-00.md"
    assert md.index("**Remote:** Hallo, alle da?") < md.index("**Ich/Raum:** Guten Morgen!")
    assert all(kw["language"] == "de" and kw["vad_filter"] for _, kw in model.calls)
    assert ("mic", 1.0) in progress and ("system", 1.0) in progress
    assert latest_session(tmp_path / "rec") == session
