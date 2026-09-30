# Transcripter

Zeichnet Meetings auf – vor Ort (Mikrofon) und online (System-Audio von Teams, Zoom & Co.) –
und transkribiert sie **lokal auf dem eigenen Rechner**. Keine Cloud, keine externen Dienste.

> Status: in Entwicklung. Siehe `docs/TODO.md`.

## Entwicklung
```bash
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"        # Tests/Lint
pip install -e ".[app,dev]"    # zusätzlich Laufzeit (GUI, Whisper, Audio)
ruff check . && ruff format --check . && pytest
```

## Aufnehmen & transkribieren testen (Windows, vorläufig per Kommandozeile)
```powershell
pip install -e ".[app]"
transcripter devices          # zeigt Mikrofone und System-Audio (Loopback)
transcripter record           # nimmt Mikrofon + System-Audio auf, Enter beendet
transcripter record --no-system   # nur Mikrofon (Meeting vor Ort)
transcripter record --transcribe  # direkt danach transkribieren
transcripter transcribe           # neueste Aufnahme transkribieren
```
Beim ersten Transkribieren lädt die Entwicklerversion das Sprachmodell einmalig (~1,6 GB) herunter.
Die spätere portable Version bringt es mit. Transkripte landen in `%LOCALAPPDATA%\Transcripter\transcripts\`.
Aufnahmen landen in `%LOCALAPPDATA%\Transcripter\recordings\<Datum_Uhrzeit>\`
(`mic.wav`, `system.wav`, `session.json`).

## Hinweis zur Aufzeichnung
Aufnahmen von Gesprächen nur mit Einverständnis aller Beteiligten.
