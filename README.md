# Transcripter

Zeichnet Meetings auf – vor Ort (Mikrofon) und online (System-Audio von Teams, Zoom & Co.) –
und transkribiert sie **lokal auf dem eigenen Rechner**. Keine Cloud, keine externen Dienste.

> Status: Testphase. Siehe `docs/TODO.md`.

## Nutzung
**Ohne Installation (Browser):** https://ts-armstark.github.io/transcripter/ in Edge oder Chrome öffnen.
Die Spracherkennung läuft lokal im Browser; Aufnahmen und Transkripte bleiben im Browser-Speicher dieses Rechners.
Für den Teams/Zoom-Ton beim Start „Bildschirm“ wählen und „Systemaudio teilen“ anhaken.

**Desktop-Programm (Windows):** neueste Version unter **Releases** herunterladen (`Transcripter-…-windows.zip`), entpacken, `Transcripter.exe` starten.
Details in `packaging/LIESMICH.txt` (liegt auch der ZIP bei).

## Entwicklung
```bash
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"        # Tests/Lint
pip install -e ".[app,dev]"    # zusätzlich Laufzeit (GUI, Whisper, Audio)
ruff check . && ruff format --check . && pytest
```

## Kommandozeile (Entwicklung/Fehlersuche, Windows)
```powershell
pip install -e ".[app]"
transcripter                  # Programmfenster
transcripter selftest         # Modell prüfen
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
