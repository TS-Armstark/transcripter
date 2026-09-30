# CLAUDE.md – Transcripter

Einstiegspunkt für Claude. Diese Datei hält nur das Nötigste und verweist auf die Detaildokumente.
**Zu Beginn jeder Session lesen:** `docs/HANDOFF.md` → `docs/TODO.md` → `docs/LESSONS.md`.

## Projekt in einem Satz
Desktop-Programm, das Meetings (vor Ort per Mikrofon **und** online per System-Audio, z. B. Teams/Zoom)
aufzeichnet und per **Speech-to-Text lokal** transkribiert – ohne externe Dienste/Cloud-APIs.

## Leitplanken (nicht verhandelbar ohne Rückfrage)
- **Offline first:** Keine Audio- oder Textdaten verlassen den Rechner. Keine Cloud-STT-APIs.
  Modelle werden einmalig heruntergeladen bzw. mitgeliefert und lokal ausgeführt.
- **Datenschutz:** Aufnahmen und Transkripte gehören **nie** ins Repo (siehe `.gitignore`).
  Keine firmeninternen Infos, Namen, Meeting-Inhalte oder Zugangsdaten committen – im Zweifel nachfragen.
- **Einwilligung:** Das Programm soll sichtbar anzeigen, dass aufgezeichnet wird (rechtlich relevant, DSGVO/§201 StGB).

## Wo steht was?
| Datei | Inhalt |
|---|---|
| `docs/HANDOFF.md` | Aktueller Stand, letzte Session, nächster Schritt – **immer am Session-Ende aktualisieren** |
| `docs/TODO.md` | Backlog / offene Aufgaben & offene Entscheidungen |
| `docs/LESSONS.md` | Learnings, Stolpersteine, getroffene Entscheidungen mit Begründung |
| `docs/RELEASE.md` | Wie ein Release gebaut und auf GitHub veröffentlicht wird |
| `README.md` | Nutzersicht: Was ist das, wie installiere/benutze ich es |

## Arbeitsweise für Claude
- Fragen des Users zuerst beantworten/klären, **nicht** direkt in die Umsetzung springen.
- Arbeitsbranch laut Session-Vorgabe; nie ungefragt auf `main` pushen.
- Nach jeder relevanten Erkenntnis → Eintrag in `docs/LESSONS.md`.
- Erledigtes in `docs/TODO.md` abhaken, Neues ergänzen.
- Am Ende jeder Session `docs/HANDOFF.md` überschreiben (Stand, offene Punkte, nächster Schritt).
- Releases nach `docs/RELEASE.md` (Tag `vX.Y.Z` pushen → GitHub Action erstellt Release).

## Tech-Stack (Entscheidungen siehe TODO.md / LESSONS.md)
- Sprache: Python 3.11+
- STT: `faster-whisper` (Whisper lokal, CPU/GPU) – Modell `large-v3-turbo` (int8), wird mitgeliefert
- GUI: PySide6
- Plattformen: Windows (zuerst), macOS; nur Deutsch; Ausgabe Markdown
- Transkription nach dem Meeting (nicht live); GPU optional, CPU-Fallback
- Audio: Mikrofon + System-Loopback (Windows: WASAPI-Loopback, macOS: ScreenCaptureKit), getrennte Spuren
- Sprechertrennung: Stufe 1 über die Spuren, Stufe 2 lokale Diarization (sherpa-onnx)
- Packaging: PyInstaller (onedir) → portable ZIP als Release-Asset (Basis/CPU + GPU-Paket)
- **Browser-Version** (`web/`, für Rechner, auf denen die .exe gesperrt ist): statische Seite auf GitHub Pages,
  transformers.js im Web-Worker, Aufnahme per getUserMedia/getDisplayMedia, Ablage in IndexedDB.
  Tests: `cd web && npm test` (Logik) und `npm run build && node test/e2e.mjs` (Chromium)
