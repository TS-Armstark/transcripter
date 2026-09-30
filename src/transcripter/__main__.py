"""Einstiegspunkt: ``python -m transcripter`` bzw. ``transcripter``.

Ohne Befehl öffnet sich das Programmfenster; die Befehle sind für Tests und Fehlersuche.
"""

from __future__ import annotations

import argparse
import sys
import threading

from transcripter import __version__
from transcripter.export import format_timestamp
from transcripter.paths import is_cloud_synced, recordings_dir, transcripts_dir


def _cmd_devices(_: argparse.Namespace) -> int:
    from transcripter.devices import DeviceManager

    with DeviceManager() as dm:
        for d in dm.list_inputs():
            kind = "System (Loopback)" if d.get("isLoopbackDevice") else "Mikrofon"
            print(f"[{d['index']:>3}] {kind:<18} {d['name']}")
    return 0


def _cmd_record(args: argparse.Namespace) -> int:
    from transcripter.devices import DeviceManager
    from transcripter.recorder import Recorder

    target = recordings_dir()
    if is_cloud_synced(target):
        print(f"WARNUNG: {target} wird vermutlich in die Cloud synchronisiert!", file=sys.stderr)

    with DeviceManager() as dm:
        sources = {}
        if not args.no_mic:
            sources["mic"] = dm.default_mic()
        if not args.no_system:
            try:
                sources["system"] = dm.default_system()
            except (LookupError, OSError) as exc:
                print(f"Hinweis: System-Audio nicht verfügbar ({exc}) – nur Mikrofon.", file=sys.stderr)
        if not sources:
            print("Keine Audioquelle ausgewählt.", file=sys.stderr)
            return 2

        recorder = Recorder(sources, target)
        session = recorder.start()
        for key, src in sources.items():
            print(f"  {key}: {src.device_name} ({src.samplerate} Hz)")

        stop = threading.Event()
        threading.Thread(target=lambda: (input(), stop.set()), daemon=True).start()
        try:
            while not stop.wait(1.0):
                print(
                    f"\r● AUFNAHME LÄUFT  {format_timestamp(recorder.elapsed())}  – Enter zum Beenden", end=""
                )
        except KeyboardInterrupt:
            pass
        session = recorder.stop()

    print(f"\nGespeichert: {session.directory} ({format_timestamp(session.duration)})")
    if args.transcribe:
        return _transcribe(session.directory, args.open)
    return 0


def _transcribe(session_dir, open_result: bool = False) -> int:
    from transcripter.transcribe import load_model, pick_device, transcribe_session

    target = transcripts_dir()
    if is_cloud_synced(target):
        print(f"WARNUNG: {target} wird vermutlich in die Cloud synchronisiert!", file=sys.stderr)
    choice = pick_device()
    print(f"Lade Sprachmodell ({'Grafikkarte' if choice.device == 'cuda' else 'CPU'}) …")
    model = load_model()

    def progress(track: str, share: float) -> None:
        print(f"\rTranskribiere {track}: {share:5.0%}", end="" if share < 1 else "\n")

    out = transcribe_session(session_dir, target, model, progress)
    print(f"Transkript: {out}")
    if open_result:
        _open_file(out)
    return 0


def _open_file(path) -> None:
    import os
    import subprocess

    if sys.platform == "win32":
        os.startfile(path)  # öffnet im Standardprogramm für .md
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)


def _cmd_selftest(_: argparse.Namespace) -> int:
    """Prüft, ob Modell, VAD und Audio-Dekodierung im Paket funktionieren (ohne Mikrofon).

    Fängt alle Fehler selbst ab: In der Fenster-Version würde PyInstaller sonst einen Fehlerdialog zeigen
    (blockiert z. B. den CI-Lauf). Ergebnis steht im Log und im Exit-Code.
    """
    import logging
    import tempfile
    from pathlib import Path

    import numpy as np
    import soundfile as sf

    from transcripter.transcribe import LANGUAGE, load_model, pick_device, resolve_model

    log = logging.getLogger("selftest")
    try:
        for line in (
            f"Transcripter {__version__}",
            f"Modell: {resolve_model()[0]}",
            f"Gerät: {pick_device()}",
        ):
            print(line)
            log.info(line)
        model = load_model()
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "test.wav"
            t = np.arange(16000 * 2) / 16000
            sf.write(wav, (0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), 16000)
            segments, info = model.transcribe(str(wav), language=LANGUAGE, vad_filter=True)
            list(segments)
            segments, _ = model.transcribe(np.zeros(16000, np.float32), language=LANGUAGE, vad_filter=False)
            list(segments)
    except Exception:
        log.exception("Selbsttest fehlgeschlagen")
        print("Selbsttest FEHLGESCHLAGEN – Details im Log", file=sys.stderr)
        return 1
    msg = f"Selbsttest OK (Audio-Dauer {info.duration:.1f} s)"
    print(msg)
    log.info(msg)
    return 0


def _cmd_transcribe(args: argparse.Namespace) -> int:
    from pathlib import Path

    from transcripter.transcribe import latest_session

    session_dir = Path(args.session) if args.session else latest_session(recordings_dir())
    if not session_dir or not (session_dir / "session.json").exists():
        print("Keine Aufnahme gefunden.", file=sys.stderr)
        return 2
    return _transcribe(session_dir, args.open)


def _cmd_gui(_: argparse.Namespace) -> int:
    from transcripter.gui import run

    return run()


def _setup_logging() -> None:
    import logging

    from transcripter.paths import default_data_dir

    log_dir = default_data_dir()
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = logging.FileHandler(log_dir / "transcripter.log", encoding="utf-8")
    except OSError:
        handler = logging.StreamHandler()
    logging.basicConfig(
        level=logging.INFO, handlers=[handler], format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="transcripter", description="Meetings lokal aufnehmen")
    parser.add_argument("--version", action="version", version=f"Transcripter {__version__}")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("devices", help="Audio-Eingänge auflisten").set_defaults(func=_cmd_devices)

    rec = sub.add_parser("record", help="Aufnahme starten (Mikrofon + System-Audio)")
    rec.add_argument("--no-mic", action="store_true", help="Mikrofon nicht aufnehmen")
    rec.add_argument("--no-system", action="store_true", help="System-Audio nicht aufnehmen")
    rec.add_argument("--transcribe", action="store_true", help="Nach dem Stoppen direkt transkribieren")
    rec.add_argument("--open", action="store_true", help="Transkript danach öffnen")
    rec.set_defaults(func=_cmd_record)

    tr = sub.add_parser("transcribe", help="Aufnahme transkribieren (Standard: die neueste)")
    tr.add_argument("session", nargs="?", help="Ordner der Aufnahme")
    tr.add_argument("--open", action="store_true", help="Transkript danach öffnen")
    tr.set_defaults(func=_cmd_transcribe)

    sub.add_parser("gui", help="Programmfenster öffnen (Standard)").set_defaults(func=_cmd_gui)
    sub.add_parser("selftest", help="Modell und Paket prüfen (ohne Aufnahme)").set_defaults(
        func=_cmd_selftest
    )

    _setup_logging()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # z. B. „●“ in Konsolen ohne UTF-8
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        return _cmd_gui(args)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
