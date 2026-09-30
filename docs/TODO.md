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

Noch offen:
- [ ] Oberfläche: einfache Desktop-GUI (Start/Stop-Fenster) oder erst Kommandozeile?
- [ ] Modell-Bereitstellung in der Firma: einmaliger Download beim ersten Start, im Installer mitliefern (~1,5 GB) oder von einem Netzlaufwerk?
- [ ] Soll `main` als Standard-Branch angelegt werden?

## Meilenstein 0 – Grundstruktur
- [x] CLAUDE.md, HANDOFF, TODO, LESSONS, RELEASE anlegen
- [x] Release-Workflow (Tag → GitHub-Release)
- [ ] Python-Projektgerüst (`pyproject.toml`, `src/transcripter/`, `tests/`)
- [ ] CI: Lint + Tests bei Push

## Meilenstein 1 – Aufnahme
- [ ] Mikrofon aufnehmen (WAV)
- [ ] System-Audio aufnehmen (Loopback, für Teams/Zoom)
- [ ] Beides parallel als getrennte Spuren + Mix
- [ ] Sichtbarer Aufnahme-Hinweis

## Meilenstein 2 – Transkription
- [ ] faster-whisper lokal einbinden
- [ ] Modell-Download einmalig / Offline-Betrieb sicherstellen
- [ ] Transkript als Markdown mit Zeitstempeln und Sprechern exportieren
- [ ] Einfache Sprechertrennung über die Spuren: Mikrofon = „Ich/Raum“, System-Audio = „Remote“
- [ ] Echte Sprechertrennung (lokal, z. B. sherpa-onnx) – Sprecher 1, 2, 3 …
- [ ] Automatische Auswahl GPU/CPU und passende Modellgröße

## Meilenstein 3 – Bedienung & Release (Windows)
- [ ] GUI (Start/Stop, Liste der Aufnahmen, Transkript öffnen)
- [ ] PyInstaller-Build in Release-Workflow integrieren
- [ ] Erstes Release `v0.1.0`

## Meilenstein 4 – macOS
- [ ] System-Audio auf macOS (ScreenCaptureKit, ab macOS 13, oder virtueller Treiber wie BlackHole)
- [ ] macOS-Build im Release-Workflow
- [ ] Signierung/Notarisierung klären (sonst Gatekeeper-Warnung)
