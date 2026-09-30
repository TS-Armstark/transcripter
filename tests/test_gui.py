"""Smoke-Test des Fensters (offscreen, Fake-Modell und Fake-Audio). Wird ohne PySide6 übersprungen."""

import json
import os
import time
from types import SimpleNamespace

import numpy as np
import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
QtWidgets = pytest.importorskip("PySide6.QtWidgets", exc_type=ImportError)

from transcripter import gui, transcribe  # noqa: E402


class FakeModel:
    def transcribe(self, audio, **kwargs):
        seg = SimpleNamespace(start=0.0, end=1.0, text=" Hallo Welt.")
        return iter([seg]), SimpleNamespace(duration=1.0)


class FakeSource:
    def __init__(self, label):
        self.label, self.device_name, self.samplerate = label, "Fake", 8000
        self.cb = None

    def start(self, cb):
        self.cb = cb
        cb(np.zeros(800, np.int16))

    def stop(self):
        pass


class FakeDevices:
    def default_mic(self):
        return FakeSource("Ich/Raum")

    def default_system(self):
        raise LookupError("kein Loopback")

    def close(self):
        pass


@pytest.fixture
def app():
    return QtWidgets.QApplication.instance() or QtWidgets.QApplication([])


def _wait(app, cond, timeout=5.0):
    end = time.monotonic() + timeout
    while not cond() and time.monotonic() < end:
        app.processEvents()
        time.sleep(0.02)
    assert cond()


def test_record_then_auto_transcribe(app, tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "load_model", lambda: FakeModel())
    monkeypatch.setattr("transcripter.devices.DeviceManager", FakeDevices)
    monkeypatch.setattr(gui.QMessageBox, "information", lambda *a, **k: None)

    win = gui.MainWindow(data_dir=tmp_path)
    assert win.list.topLevelItemCount() == 0

    win.toggle_recording()
    assert "AUFNAHME" in win.status_label.text()
    assert not win.cb_mic.isEnabled()
    win.toggle_recording()

    _wait(app, lambda: list((tmp_path / "transcripts").glob("*.md")))
    _wait(app, lambda: not win._busy)
    md = next((tmp_path / "transcripts").glob("*.md")).read_text(encoding="utf-8")
    assert "**Ich/Raum:** Hallo Welt." in md
    assert win.list.topLevelItemCount() == 1
    assert win.list.topLevelItem(0).text(2) == "✔"
    meta = json.loads(next((tmp_path / "recordings").glob("*/session.json")).read_text(encoding="utf-8"))
    assert list(meta["tracks"]) == ["mic"]
    win.close()
