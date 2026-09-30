# Handoff

> Wird am Ende jeder Session überschrieben. Kurz halten.

**Datum:** 2026-09-30
**Stand:** Test-Release **v0.1.0-beta.1** veröffentlicht (Windows, nur CPU, Modell enthalten, ZIP ~776 MB):
https://github.com/TS-Armstark/transcripter/releases/tag/v0.1.0-beta.1
Enthält Aufnahme (Mikrofon + System-Audio), Transkription (large-v3-turbo int8), Programmfenster.

## Was in der letzten Session passiert ist
- PRs #1–#3 gemergt: Gerüst, Aufnahme, Transkription, GUI, Release-Build
- Release per `workflow_dispatch` (Tag-Push aus der Cloud-Session nicht möglich, siehe LESSONS)

## Nächster Schritt
1. **Rückmeldung User** zum Test-Release: Startet die .exe? Aufnahme Mikrofon/Teams ok? Transkript-Qualität,
   Echo-Filter, Dauer auf CPU? Bei Fehlern `%LOCALAPPDATA%\Transcripter\transcripter.log` anfordern.
2. Danach nach Priorität des Users: GPU-Paket, Geräteauswahl, echte Sprechertrennung (sherpa-onnx), macOS

## Blocker / Offene Fragen
- Auf echter Windows-Hardware mit Mikrofon noch ungetestet (nur CI-Selbsttest ohne Audio-Geräte)
- Unsignierte .exe → SmartScreen-Warnung (Code-Signing mit IT klären)
