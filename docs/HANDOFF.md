# Handoff

> Wird am Ende jeder Session überschrieben. Kurz halten.

**Datum:** 2026-09-30
**Stand:** Meilenstein 0 + 1 auf `main` (PR TS-Armstark/transcripter#1). Meilenstein 2 (Transkription) als Code fertig,
auf dem Arbeitsbranch. Aufnahme und echte Modell-Läufe noch nicht auf Windows getestet.

## Was in der letzten Session passiert ist
- PR #1 gemergt (Gerüst, CI, Lizenz, Aufnahme)
- `transcribe.py`: faster-whisper je Spur (Deutsch, VAD), GPU/CPU-Auswahl, Modell-Suche, Echo-Filter, Markdown-Export
- CLI: `transcripter transcribe [ORDNER]`, `transcripter record --transcribe`

## Nächster Schritt
1. User testet auf Windows: `transcripter record --transcribe` (README)
2. Meilenstein 3: PySide6-GUI (Start/Stop, rote Aufnahme-Anzeige, Liste, Transkript öffnen, OneDrive-Warnung)
3. Danach PyInstaller-Build + erstes Release v0.1.0

## Blocker / Offene Fragen
- Hugging Face im Cloud-Container gesperrt → keine echten Modell-Tests hier
- Echte Sprechertrennung (Stufe 2, sherpa-onnx) noch offen
