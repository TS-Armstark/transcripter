"""Einstiegspunkt: ``python -m transcripter`` bzw. ``transcripter``.

Vorerst Kommandozeile zum Testen der Aufnahme; die GUI folgt in Meilenstein 3.
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
        return _transcribe(session.directory)
    return 0


def _transcribe(session_dir) -> int:
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
    return 0


def _cmd_transcribe(args: argparse.Namespace) -> int:
    from pathlib import Path

    from transcripter.transcribe import latest_session

    session_dir = Path(args.session) if args.session else latest_session(recordings_dir())
    if not session_dir or not (session_dir / "session.json").exists():
        print("Keine Aufnahme gefunden.", file=sys.stderr)
        return 2
    return _transcribe(session_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="transcripter", description="Meetings lokal aufnehmen")
    parser.add_argument("--version", action="version", version=f"Transcripter {__version__}")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("devices", help="Audio-Eingänge auflisten").set_defaults(func=_cmd_devices)

    rec = sub.add_parser("record", help="Aufnahme starten (Mikrofon + System-Audio)")
    rec.add_argument("--no-mic", action="store_true", help="Mikrofon nicht aufnehmen")
    rec.add_argument("--no-system", action="store_true", help="System-Audio nicht aufnehmen")
    rec.add_argument("--transcribe", action="store_true", help="Nach dem Stoppen direkt transkribieren")
    rec.set_defaults(func=_cmd_record)

    tr = sub.add_parser("transcribe", help="Aufnahme transkribieren (Standard: die neueste)")
    tr.add_argument("session", nargs="?", help="Ordner der Aufnahme")
    tr.set_defaults(func=_cmd_transcribe)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
