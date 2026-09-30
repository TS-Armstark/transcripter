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

## Hinweis zur Aufzeichnung
Aufnahmen von Gesprächen nur mit Einverständnis aller Beteiligten.
