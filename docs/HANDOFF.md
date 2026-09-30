# Handoff

> Wird am Ende jeder Session überschrieben. Kurz halten.

**Datum:** 2026-09-30
**Stand:** Alle Grundentscheidungen getroffen, `main` angelegt, Python-Gerüst + CI auf dem Arbeitsbranch.

## Was in der letzten Session passiert ist
- Entscheidungen: PySide6-GUI, `large-v3-turbo` im Paket, portable ZIP (Basis + GPU-Paket)
- `main` angelegt (Stand: nur Doku)
- Python-Gerüst: `paths.py` (lokaler Datenordner, Erkennung von Cloud-Sync-Ordnern), `export.py` (Markdown-Export)
- Tests (6, grün) und CI-Workflow `ci.yml` (ruff + pytest auf Windows/macOS/Linux)

## Nächster Schritt
Gerüst per Pull Request nach `main` bringen, dann Meilenstein 1: Aufnahme unter Windows
(Mikrofon + WASAPI-Loopback, getrennte Spuren).

## Blocker / Offene Fragen
- Standard-Branch auf GitHub steht noch auf dem Claude-Branch → muss der User auf `main` umstellen
- Projekt-Lizenz nicht festgelegt (Repo ist öffentlich)
- Tag-Push/Release noch nicht getestet
