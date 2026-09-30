# TODO

Legende: `[ ]` offen · `[x]` erledigt · `[~]` in Arbeit

## Entscheidungen (vor dem Coden klären)
- [ ] Zielplattform: nur Windows? Auch macOS/Linux?
- [ ] Oberfläche: einfache Desktop-GUI (Tray-Icon + Fenster) oder erst CLI?
- [ ] Sprachen: nur Deutsch oder auch Englisch/automatisch erkennen?
- [ ] Sprechertrennung (wer hat was gesagt) nötig? → mehr Rechenaufwand
- [ ] Live-Transkription während des Meetings oder erst danach?
- [ ] Hardware: GPU vorhanden (NVIDIA) oder nur CPU? → Modellgröße
- [ ] Ausgabeformate: TXT, Markdown, DOCX, SRT?

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
- [ ] Transkript mit Zeitstempeln exportieren
- [ ] Optional: Sprechertrennung

## Meilenstein 3 – Bedienung & Release
- [ ] GUI (Start/Stop, Liste der Aufnahmen, Transkript öffnen)
- [ ] PyInstaller-Build in Release-Workflow integrieren
- [ ] Erstes Release `v0.1.0`
