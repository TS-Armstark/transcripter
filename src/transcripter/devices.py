"""Audio-Geräte über PyAudioWPatch (Windows: Mikrofon + WASAPI-Loopback für System-Audio)."""

from __future__ import annotations

from typing import Any

from transcripter.recorder import BlockCallback, to_mono_int16

LABEL_MIC = "Ich/Raum"
LABEL_SYSTEM = "Remote"


def _pyaudio() -> Any:
    try:
        import pyaudiowpatch as pyaudio
    except ImportError as exc:  # pragma: no cover – nur ohne [app]-Extra
        raise RuntimeError("PyAudioWPatch fehlt – bitte `pip install -e .[app]` (nur Windows)") from exc
    return pyaudio


class PyAudioSource:
    """Eine Eingabe (Mikrofon oder Loopback) als AudioSource."""

    def __init__(self, pa: Any, device: dict, label: str) -> None:
        self._pa = pa
        self._device = device
        self.label = label
        self.device_name = device["name"]
        self.samplerate = int(device["defaultSampleRate"])
        self.channels = max(1, int(device["maxInputChannels"]))
        self._stream = None

    def start(self, callback: BlockCallback) -> None:
        pyaudio = _pyaudio()
        channels = self.channels

        def _on_audio(in_data, frame_count, time_info, status):
            callback(to_mono_int16(in_data, channels))
            return (None, pyaudio.paContinue)

        self._stream = self._pa.open(
            format=pyaudio.paInt16,
            channels=channels,
            rate=self.samplerate,
            input=True,
            input_device_index=self._device["index"],
            frames_per_buffer=1024,
            stream_callback=_on_audio,
        )
        self._stream.start_stream()

    def stop(self) -> None:
        if self._stream is not None:
            self._stream.stop_stream()
            self._stream.close()
            self._stream = None


class DeviceManager:
    """Hält die PyAudio-Instanz und findet Standardgeräte."""

    def __init__(self) -> None:
        self._pyaudio = _pyaudio()
        self.pa = self._pyaudio.PyAudio()

    def close(self) -> None:
        self.pa.terminate()

    def __enter__(self) -> DeviceManager:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def default_mic(self) -> PyAudioSource:
        device = self.pa.get_default_wasapi_device(d_in=True)
        return PyAudioSource(self.pa, device, LABEL_MIC)

    def default_system(self) -> PyAudioSource:
        """Loopback des Standard-Ausgabegeräts (was aus Lautsprecher/Headset kommt)."""
        device = self.pa.get_default_wasapi_loopback()
        return PyAudioSource(self.pa, device, LABEL_SYSTEM)

    def list_inputs(self) -> list[dict]:
        wasapi = self.pa.get_host_api_info_by_type(self._pyaudio.paWASAPI)["index"]
        return [
            d
            for d in (self.pa.get_device_info_by_index(i) for i in range(self.pa.get_device_count()))
            if d["hostApi"] == wasapi and d["maxInputChannels"] > 0
        ]
