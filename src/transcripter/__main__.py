"""Einstiegspunkt: ``python -m transcripter`` bzw. ``transcripter``.

Vorerst Kommandozeile zum Testen der Aufnahme; die GUI folgt in Meilenstein 3.
"""

from __future__ import annotations

import argparse
import sys
import threading

from transcripter import __version__
from transcripter.export import format_timestamp
from transcripter.paths import is_cloud_synced, recordings_dir


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
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="transcripter", description="Meetings lokal aufnehmen")
    parser.add_argument("--version", action="version", version=f"Transcripter {__version__}")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("devices", help="Audio-Eingänge auflisten").set_defaults(func=_cmd_devices)

    rec = sub.add_parser("record", help="Aufnahme starten (Mikrofon + System-Audio)")
    rec.add_argument("--no-mic", action="store_true", help="Mikrofon nicht aufnehmen")
    rec.add_argument("--no-system", action="store_true", help="System-Audio nicht aufnehmen")
    rec.set_defaults(func=_cmd_record)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
