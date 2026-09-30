import json
import time
from datetime import datetime

import numpy as np
import pytest
import soundfile as sf

from transcripter.recorder import Recorder, TrackWriter, to_mono_int16


def test_to_mono_averages_channels():
    stereo = np.array([100, 300, -50, -150, 7, 8], dtype=np.int16)
    assert to_mono_int16(stereo.tobytes(), 2).tolist() == [200, -100, 8]
    assert to_mono_int16(stereo.tobytes(), 1).tolist() == stereo.tolist()


def test_writer_pads_silence_when_source_is_quiet(tmp_path):
    now = [0.0]
    writer = TrackWriter(tmp_path / "t.wav", 1000, clock=lambda: now[0], max_gap=0.5, keep_margin=0.1)
    writer.write_block(np.ones(200, np.int16))
    now[0] = 0.4  # kleine Verzögerung: nichts auffüllen
    writer.pad_to_clock()
    assert writer.frames_padded == 0
    now[0] = 2.0  # 1,8 s Rückstand → bis auf 0,1 s Reserve auffüllen
    writer.pad_to_clock()
    assert writer.frames_written == 1900
    writer.close()
    data, rate = sf.read(tmp_path / "t.wav", dtype="int16")
    assert rate == 1000 and len(data) == 1900 and data[:200].tolist() == [1] * 200


class FakeSource:
    def __init__(self, label, samplerate=8000):
        self.label, self.device_name, self.samplerate = label, f"Fake {label}", samplerate
        self.callback = None

    def start(self, callback):
        self.callback = callback

    def stop(self):
        self.callback = None


def test_recorder_writes_one_track_per_source(tmp_path):
    mic, system = FakeSource("Ich/Raum"), FakeSource("Remote", 16000)
    rec = Recorder({"mic": mic, "system": system}, tmp_path)
    session = rec.start(now=datetime(2026, 9, 30, 9, 15, 0))
    assert session.directory.name == "2026-09-30_09-15-00"
    mic.callback(np.full(8000, 5, np.int16))
    system.callback(np.full(16000, 9, np.int16))
    time.sleep(0.3)
    done = rec.stop()

    assert not rec.is_recording
    meta = json.loads(done.meta_path.read_text(encoding="utf-8"))
    assert meta["tracks"]["mic"]["label"] == "Ich/Raum"
    assert meta["tracks"]["system"]["samplerate"] == 16000
    mic_audio, _ = sf.read(done.directory / "mic.wav", dtype="int16")
    assert len(mic_audio) >= 8000 and mic_audio[0] == 5


def test_recorder_rejects_double_start(tmp_path):
    rec = Recorder({"mic": FakeSource("Ich/Raum")}, tmp_path)
    rec.start()
    with pytest.raises(RuntimeError):
        rec.start()
    rec.stop()
