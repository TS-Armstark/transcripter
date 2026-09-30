# Handoff

> Wird am Ende jeder Session überschrieben. Kurz halten.

**Datum:** 2026-09-30
**Stand:**
- Desktop: Test-Release v0.1.0-beta.1 (Windows, CPU). **Auf dem Firmenrechner des Users blockiert** (Endpoint-Schutz der Firma).
- Neu: **Browser-Version** (`web/`) als Alternative – Aufnahme + lokale Transkription im Browser, GitHub Pages.

## Was in der letzten Session passiert ist
- Browser-Version gebaut: `web/src` (app.js, worker.js, lib.js), Build `web/build.mjs`, Tests (Node + Chromium-E2E)
- Workflow `pages.yml`: Whisper small mitliefern, E2E mit deutscher espeak-Sprachprobe, Deploy auf Pages

## Nächster Schritt
1. ~~Pages aktivieren~~ erledigt – online: https://ts-armstark.github.io/transcripter/ (Repo ist öffentlich)
2. User testet https://ts-armstark.github.io/transcripter/ auf dem Firmenrechner (Edge/Chrome)
3. Parallel: IT-Freigabe der .exe (Mail an IT – Empfänger vom User erfragen)

## Blocker / Offene Fragen
- Unklar, ob Firmen-Browser Bildschirmfreigabe mit Systemaudio und den Modell-Download (Pages/Hugging Face) erlaubt
- Modell „Genau“ (large-v3-turbo) kommt von Hugging Face und braucht WebGPU
