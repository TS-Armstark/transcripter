# TODO

Legende: `[ ]` offen · `[x]` erledigt · `[~]` in Arbeit

## Entscheidungen
Getroffen am 2026-09-30 (Details & Begründung in `LESSONS.md`):
- [x] Plattform: Windows **und** macOS (Windows zuerst, macOS danach)
- [x] Sprechertrennung: gewünscht, wenn machbar
- [x] Transkription **nach** dem Meeting (einfacher als live)
- [x] Hardware: GPU optional – muss auch auf reinen CPU-Rechnern laufen (automatische Erkennung)
- [x] Sprache: nur Deutsch
- [x] Ausgabe: Markdown (`.md`)

Später geklärt:
- [x] Oberfläche: Desktop-Fenster mit PySide6 (Qt)
- [x] Modell: `large-v3-turbo` (int8, ~0,8 GB) wird im Paket mitgeliefert, kein Download nötig
- [x] Auslieferung: portable ZIP (kein Installer) – Basis-ZIP (CPU) + separates GPU-Paket (NVIDIA)
- [x] `main` angelegt
- [ ] Code-Signing-Zertifikat (gegen SmartScreen-/Virenscanner-Warnungen) – mit IT klären, später

## Meilenstein 0 – Grundstruktur
- [x] CLAUDE.md, HANDOFF, TODO, LESSONS, RELEASE anlegen
- [x] Release-Workflow (Tag → GitHub-Release)
- [x] Python-Projektgerüst (`pyproject.toml`, `src/transcripter/`, `tests/`)
- [x] CI: Lint + Tests bei Push (Windows, macOS, Linux)
- [x] Projekt-Lizenz: MIT (`LICENSE`)
- [x] Standard-Branch auf GitHub auf `main` umgestellt

## Meilenstein 1 – Aufnahme
- [x] Mikrofon aufnehmen (WAV) – `devices.py`/`recorder.py`, Code fertig, **auf echtem Windows-PC noch ungetestet**
- [x] System-Audio aufnehmen (WASAPI-Loopback) – dito
- [x] Beides parallel als getrennte Mono-Spuren (`mic.wav`, `system.wav`) + `session.json`
- [x] Stille auffüllen, wenn Loopback nichts liefert (Spuren bleiben synchron)
- [x] Sichtbarer Aufnahme-Hinweis (vorerst in der Kommandozeile, GUI folgt)
- [ ] **Test durch User auf Windows**: `transcripter devices` und `transcripter record` (Anleitung im README)
- [ ] Optional: Mix-Spur zum Anhören
- [ ] Geräteauswahl statt nur Standardgeräte

## Meilenstein 2 – Transkription
- [x] faster-whisper lokal einbinden (`transcribe.py`), Deutsch fest, VAD-Filter gegen Stille
- [x] Modell-Suche: `TRANSCRIPTER_MODEL` → mitgeliefertes `models/large-v3-turbo/` → Download (nur Entwicklung)
- [ ] **Test durch User auf Windows**: `transcripter record --transcribe` (lädt beim ersten Mal das Modell, ~1,6 GB)
- [ ] Qualität prüfen: Erkennung Deutsch, Echo-Filter bei Lautsprecher statt Headset
- [x] Transkript als Markdown mit Zeitstempeln und Sprechern exportieren (`export.py`)
- [x] Einfache Sprechertrennung über die Spuren: Mikrofon = „Ich/Raum“, System-Audio = „Remote“
- [x] Echo-Filter: Mikrofon-Segmente, die zeitgleich und textgleich mit der System-Spur sind, werden verworfen
- [ ] Echte Sprechertrennung (lokal, z. B. sherpa-onnx) – Sprecher 1, 2, 3 …
- [x] Automatische Auswahl GPU (float16) / CPU (int8), Fallback auf CPU bei GPU-Fehler

## Meilenstein 3 – Bedienung & Release (Windows)
- [x] GUI (`gui.py`): Start/Stop, rote Aufnahme-Anzeige + Titel, Quellen an/aus, Auto-Transkription, Liste,
      Transkript/Ordner öffnen, Fortschritt, OneDrive-Warnung, Nachfrage beim Schließen während Aufnahme
- [x] PyInstaller-Build (onedir, `packaging/build.py`) → portable ZIP im Release-Workflow + Selbsttest
- [x] Modell + Lizenztexte (`LICENSES/`) ins Paket – Modell wird im Workflow nach int8 konvertiert (gecacht)
- [ ] Geräteauswahl (Dropdown) statt nur Standardgeräte
- [ ] Tray-Icon / kleines „Aufnahme läuft“-Overlay
- [ ] App-Icon
- [ ] Transkript umbenennen/Titel vergeben, Aufnahme löschen
- [ ] Zweites Asset: GPU-Paket (CUDA-Bibliotheken), jede Datei < 2 GB (GitHub-Limit)
- [~] Speicherort lokal; Warnung, wenn der Ordner von OneDrive o. Ä. synchronisiert wird (Erkennung in `paths.py` fertig, Warnung in GUI fehlt)
- [x] Erstes Test-Release `v0.1.0-beta.1` (nur CPU) – veröffentlicht 30.09.2026
- [ ] Rückmeldung User zum Test-Release

## Meilenstein 4 – macOS
- [ ] System-Audio auf macOS (ScreenCaptureKit, ab macOS 13, oder virtueller Treiber wie BlackHole)
- [ ] macOS-Build im Release-Workflow
- [ ] Signierung/Notarisierung klären (sonst Gatekeeper-Warnung)

## Browser-Version (`web/`) – für Rechner, auf denen die .exe per Richtlinie gesperrt ist
- [x] Aufnahme Mikrofon + geteilter System-/Tab-Ton (getDisplayMedia), Ablage in IndexedDB
- [x] Transkription im Web-Worker (transformers.js 3.8.1): Whisper small (q8, WASM, mitgeliefert) / large-v3-turbo (WebGPU, von HF)
- [x] Energie-basierte Spracherkennung (statt VAD), Halluzinations-Filter, Echo-Filter, Markdown-Export
- [x] Audiodatei hochladen und transkribieren
- [x] GitHub-Pages-Workflow mit E2E-Test (Chromium, espeak-Sprachprobe)
- [x] Modernes Dashboard-Design: Seitenleiste, Kennzahl-Kacheln, Pegelanzeige, Fortschrittsring, Status-Chips,
      Transkript als Gesprächsverlauf, responsiv (Handy)
- [x] Sprechererkennung im Browser: WavLM-Stimmabdrücke (Xenova/wavlm-base-plus-sv, q8) je Satz + Clustering
      (automatisch oder feste Anzahl), Namen per Klick umbenennen, Farben je Sprecher
- [x] Zwei echte Seiten statt Sprung-Navigation: „Aufnehmen“ (Dashboard + letzte 3) und „Transkripte“
      (alle, mit Suche, Liste links / Ansicht rechts, Aktionen Neu transkribieren, Audio, Löschen)
- [x] UI entschlackt (keine Kennzahl-Kacheln/Ring, schmale Fortschrittsleiste), Speicherort prominent
- [x] Speicherordner (File System Access API): .md im Ordner, Aufnahmen unter „Audio/“, Sync nach Ordnerwahl
- [x] Titel je Aufnahme (Liste, Dateiname, Markdown-Überschrift, nachträglich änderbar), Suche über Titel/Text/Datum
- [x] Personenzahl frei eingebbar (verteilt auf Spuren: Remote automatisch, Mikrofon = Rest)
- [x] Dialog „Neu transkribieren“: Modell, Sprechererkennung, Personenzahl vor dem Start wählen
- [x] Speicherordner ist Pflicht: ohne Ordner keine Aufnahme und kein Upload
- [x] Export nach PDF (jsPDF 4.2.1, mitgeliefert) und Word (.docx, selbst erzeugt) in den Speicherordner
- [ ] Rückmeldung User: Trefferquote der Sprechererkennung in echten Meetings (ggf. Schwelle 0.86 anpassen)
- [ ] Sprechererkennung auch in der Desktop-Version (gleicher Ansatz, z. B. sherpa-onnx oder WavLM via onnxruntime)
- [x] GitHub Pages aktiviert, Repo öffentlich (30.09.2026) – https://ts-armstark.github.io/transcripter/
- [ ] Test durch User auf Firmenrechner (Edge/Chrome): Bildschirmfreigabe mit Systemaudio erlaubt? Modell-Download ok?
- [ ] Parallel: IT-Freigabe der .exe anstoßen
