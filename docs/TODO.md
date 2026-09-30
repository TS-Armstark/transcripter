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
- [x] Mikrofon aufnehmen (WAV) – `devices.py`/`recorder.py`, Code fertig, **auf echtem Windows-PC noch ungetestet**
- [x] System-Audio aufnehmen (WASAPI-Loopback) – dito
- [x] Beides parallel als getrennte Mono-Spuren (`mic.wav`, `system.wav`) + `session.json`
- [x] Stille auffüllen, wenn Loopback nichts liefert (Spuren bleiben synchron)
- [x] Sichtbarer Aufnahme-Hinweis (vorerst in der Kommandozeile, GUI folgt)
- [ ] **Test durch User auf Windows**: `transcripter devices` und `transcripter record` (Anleitung im README)
- [ ] Optional: Mix-Spur zum Anhören
- [ ] Geräteauswahl statt nur Standardgeräte

## Meilenstein 2 – Transkription
- [x] faster-whisper lokal einbinden (`transcribe.py`), Deutsch fest, VAD-Filter gegen Stille
- [x] Modell-Suche: `TRANSCRIPTER_MODEL` → mitgeliefertes `models/large-v3-turbo/` → Download (nur Entwicklung)
- [ ] **Test durch User auf Windows**: `transcripter record --transcribe` (lädt beim ersten Mal das Modell, ~1,6 GB)
- [ ] Qualität prüfen: Erkennung Deutsch, Echo-Filter bei Lautsprecher statt Headset
- [x] Transkript als Markdown mit Zeitstempeln und Sprechern exportieren (`export.py`)
- [x] Einfache Sprechertrennung über die Spuren: Mikrofon = „Ich/Raum“, System-Audio = „Remote“
- [x] Echo-Filter: Mikrofon-Segmente, die zeitgleich und textgleich mit der System-Spur sind, werden verworfen
- [ ] Echte Sprechertrennung (lokal, z. B. sherpa-onnx) – Sprecher 1, 2, 3 …
- [x] Automatische Auswahl GPU (float16) / CPU (int8), Fallback auf CPU bei GPU-Fehler

## Meilenstein 3 – Bedienung & Release (Windows)
- [x] GUI (`gui.py`): Start/Stop, rote Aufnahme-Anzeige + Titel, Quellen an/aus, Auto-Transkription, Liste,
      Transkript/Ordner öffnen, Fortschritt, OneDrive-Warnung, Nachfrage beim Schließen während Aufnahme
- [x] PyInstaller-Build (onedir, `packaging/build.py`) → portable ZIP im Release-Workflow + Selbsttest
- [x] Modell + Lizenztexte (`LICENSES/`) ins Paket – Modell wird im Workflow nach int8 konvertiert (gecacht)
- [ ] Geräteauswahl (Dropdown) statt nur Standardgeräte
- [ ] Tray-Icon / kleines „Aufnahme läuft“-Overlay
- [ ] App-Icon
- [ ] Transkript umbenennen/Titel vergeben, Aufnahme löschen
- [ ] Zweites Asset: GPU-Paket (CUDA-Bibliotheken), jede Datei < 2 GB (GitHub-Limit)
- [~] Speicherort lokal; Warnung, wenn der Ordner von OneDrive o. Ä. synchronisiert wird (Erkennung in `paths.py` fertig, Warnung in GUI fehlt)
- [~] Erstes Test-Release `v0.1.0-beta.1` (nur CPU)
- [ ] Rückmeldung User zum Test-Release

## Meilenstein 4 – macOS
- [ ] System-Audio auf macOS (ScreenCaptureKit, ab macOS 13, oder virtueller Treiber wie BlackHole)
- [ ] macOS-Build im Release-Workflow
- [ ] Signierung/Notarisierung klären (sonst Gatekeeper-Warnung)
