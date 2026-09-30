# Handoff

> Wird am Ende jeder Session überschrieben. Kurz halten.

**Datum:** 2026-09-30
**Stand:** Aufnahme, Transkription, Programmfenster und Release-Build fertig. Erstes Test-Release `v0.1.0-beta.1`
(Windows, nur CPU) in Arbeit. Auf echter Windows-Hardware noch nichts getestet.

## Was in der letzten Session passiert ist
- PR #1 (Gerüst, Aufnahme) gemergt; PR #2: Transkription, GPU-Check (cuBLAS/cuDNN), GUI, Release-Build
- GUI (`gui.py`) mit Smoke-Test (offscreen, Fakes)
- `release.yml`: Modell konvertieren (int8, Cache) → PyInstaller → Selbsttest → ZIP → Release

## Nächster Schritt
1. Release-Workflow grün bekommen, Test-Release veröffentlichen
2. User testet: Aufnahme (Mikrofon + Teams/Zoom), Transkript-Qualität, Echo, Dauer auf CPU
3. Danach: GPU-Paket, Geräteauswahl, echte Sprechertrennung (sherpa-onnx), macOS

## Blocker / Offene Fragen
- Hugging Face im Cloud-Container gesperrt → Modell nur in GitHub Actions / beim User
- Unsignierte .exe → SmartScreen-Warnung (Code-Signing mit IT klären)
