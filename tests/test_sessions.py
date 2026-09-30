import json

from transcripter.sessions import list_sessions


def _session(root, name, started, duration=0):
    d = root / name
    d.mkdir(parents=True)
    (d / "session.json").write_text(
        json.dumps({"started_at": started, "duration": duration}), encoding="utf-8"
    )
    return d


def test_lists_newest_first_with_transcript_state(tmp_path):
    rec, tr = tmp_path / "rec", tmp_path / "tr"
    _session(rec, "2026-09-29_10-00-00", "2026-09-29T10:00:00", 60)
    _session(rec, "2026-09-30_09-15-00", "2026-09-30T09:15:00", 125.5)
    (rec / "kaputt").mkdir()
    (rec / "kaputt" / "session.json").write_text("{", encoding="utf-8")
    tr.mkdir()
    (tr / "2026-09-29_10-00-00.md").write_text("# x", encoding="utf-8")

    sessions = list_sessions(rec, tr)

    assert [s.name for s in sessions] == ["2026-09-30_09-15-00", "2026-09-29_10-00-00"]
    assert sessions[0].transcript is None and sessions[0].duration == 125.5
    assert sessions[1].transcript == tr / "2026-09-29_10-00-00.md"


def test_missing_folder_is_empty(tmp_path):
    assert list_sessions(tmp_path / "nix", tmp_path / "tr") == []
