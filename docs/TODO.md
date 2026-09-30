# TODO

Legende: `[ ]` offen · `[x]` erledigt · `[~]` in Arbeit

## Entscheidungen
Getroffen am 2026-09-30 (Details & Begründung in `LESSONS.md`):
- [x] Plattform: Windows **und** macOS (Windows zuerst, macOS danach)
- [x] Sprechertrennung: gewünscht, wenn machbar
- [x] Transkription **nach** dem Meeting (einfacher als live)
- [x] Hardware: GPU optional – muss auch auf reinen CPU-Rechnern laufen (automatische Erkennung)
- [x] Sprache: nur Deutsch
- [x] Ausgabe: Markdown (`.md`)

Später geklärt:
- [x] Oberfläche: Desktop-Fenster mit PySide6 (Qt)
- [x] Modell: `large-v3-turbo` (int8, ~0,8 GB) wird im Paket mitgeliefert, kein Download nötig
- [x] Auslieferung: portable ZIP (kein Installer) – Basis-ZIP (CPU) + separates GPU-Paket (NVIDIA)
- [x] `main` angelegt
- [ ] Code-Signing-Zertifikat (gegen SmartScreen-/Virenscanner-Warnungen) – mit IT klären, später

## Meilenstein 0 – Grundstruktur
- [x] CLAUDE.md, HANDOFF, TODO, LESSONS, RELEASE anlegen
- [x] Release-Workflow (Tag → GitHub-Release)
- [x] Python-Projektgerüst (`pyproject.toml`, `src/transcripter/`, `tests/`)
- [x] CI: Lint + Tests bei Push (Windows, macOS, Linux)
- [x] Projekt-Lizenz: MIT (`LICENSE`)
- [x] Standard-Branch auf GitHub auf `main` umgestellt

## Meilenstein 1 – Aufnahme
- [ ] Mikrofon aufnehmen (WAV)
- [ ] System-Audio aufnehmen (Loopback, für Teams/Zoom)
- [ ] Beides parallel als getrennte Spuren + Mix
- [ ] Sichtbarer Aufnahme-Hinweis

## Meilenstein 2 – Transkription
- [ ] faster-whisper lokal einbinden
- [ ] Modell-Download einmalig / Offline-Betrieb sicherstellen
- [x] Transkript als Markdown mit Zeitstempeln und Sprechern exportieren (`export.py`)
- [ ] Einfache Sprechertrennung über die Spuren: Mikrofon = „Ich/Raum“, System-Audio = „Remote“
- [ ] Echte Sprechertrennung (lokal, z. B. sherpa-onnx) – Sprecher 1, 2, 3 …
- [ ] Automatische Auswahl GPU/CPU und passende Modellgröße

## Meilenstein 3 – Bedienung & Release (Windows)
- [ ] GUI (Start/Stop, Liste der Aufnahmen, Transkript öffnen)
- [ ] PyInstaller-Build (onedir) → portable ZIP im Release-Workflow
- [ ] Modell + Lizenztexte (`LICENSES/`) ins Paket
- [ ] Zweites Asset: GPU-Paket (CUDA-Bibliotheken), jede Datei < 2 GB (GitHub-Limit)
- [~] Speicherort lokal; Warnung, wenn der Ordner von OneDrive o. Ä. synchronisiert wird (Erkennung in `paths.py` fertig, Warnung in GUI fehlt)
- [ ] Erstes Release `v0.1.0`

## Meilenstein 4 – macOS
- [ ] System-Audio auf macOS (ScreenCaptureKit, ab macOS 13, oder virtueller Treiber wie BlackHole)
- [ ] macOS-Build im Release-Workflow
- [ ] Signierung/Notarisierung klären (sonst Gatekeeper-Warnung)
