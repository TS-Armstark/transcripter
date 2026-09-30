from datetime import datetime

from transcripter.export import Segment, format_timestamp, to_markdown


def test_format_timestamp():
    assert format_timestamp(0) == "00:00:00"
    assert format_timestamp(3725.9) == "01:02:05"


def test_merges_same_speaker_and_skips_empty():
    segs = [
        Segment(0, 2, "Hallo zusammen.", "Ich/Raum"),
        Segment(2, 4, "  Los geht's. ", "Ich/Raum"),
        Segment(4, 5, "   ", "Remote"),
        Segment(5, 8, "Guten Morgen.", "Remote"),
    ]
    md = to_markdown(segs, "Test", datetime(2026, 9, 30, 9, 15))
    assert md.startswith("# Test\n\nAufgenommen: 30.09.2026 09:15\n")
    assert "**[00:00:00]** **Ich/Raum:** Hallo zusammen. Los geht's." in md
    assert "**[00:00:05]** **Remote:** Guten Morgen." in md
    assert md.endswith("\n") and not md.endswith("\n\n")


def test_without_speaker():
    md = to_markdown([Segment(61, 62, "Nur Text.")], "T")
    assert "**[00:01:01]** Nur Text." in md
