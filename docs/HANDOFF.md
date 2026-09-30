# Handoff

> Wird am Ende jeder Session überschrieben. Kurz halten.

**Datum:** 2026-09-30
**Stand:** Meilenstein 0 fertig, Meilenstein 1 (Aufnahme Windows) als Code fertig, auf echter Hardware ungetestet.
PR TS-Armstark/transcripter#1 (Gerüst + Aufnahme) offen, CI grün.

## Was in der letzten Session passiert ist
- `main` angelegt, Standard-Branch umgestellt (User), MIT-Lizenz
- Python-Gerüst, CI (Windows/macOS/Linux), Markdown-Export, Speicherort-/Cloud-Prüfung
- Aufnahme: `recorder.py` (Spuren, Stille-Auffüllen, `session.json`), `devices.py` (PyAudioWPatch: Mikrofon + WASAPI-Loopback),
  CLI `transcripter devices` / `transcripter record`

## Nächster Schritt
1. User testet Aufnahme auf Windows (README → „Aufnahme testen“) und meldet Ergebnis
2. Meilenstein 2: faster-whisper je Spur transkribieren → Markdown (Sprecher „Ich/Raum“/„Remote“)

## Blocker / Offene Fragen
- Aufnahme nur mit Fakes getestet (Cloud-Container hat keine Audio-Hardware)
- Tag-Push/Release noch nicht getestet
