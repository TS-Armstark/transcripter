# Lessons Learned

Format: **Datum – Thema**: Erkenntnis → Konsequenz. Neueste oben.

## Entscheidungen
- **2026-09-30 – Oberfläche & Auslieferung (User)**: PySide6-Fenster (LGPL, plattformübergreifend, Tray möglich).
  Portable ZIP statt Installer (keine Admin-Rechte). Modell `large-v3-turbo` int8 mitliefern (MIT-Lizenz,
  läuft auf CPU und GPU). GPU-Bibliotheken als separates Asset, weil ZIP sonst an das 2-GB-Limit pro
  Release-Asset stößt. Lizenztexte aller Modelle/Bibliotheken müssen mitgeliefert werden.
  Risiko: Ein unsigniertes PyInstaller-Programm löst SmartScreen- bzw. Virenscanner-Warnungen aus.
  Risiko: Wird die ZIP in einen OneDrive-Ordner entpackt, würden die Aufnahmen in die Cloud synchronisiert.
- **2026-09-30 – Produktentscheidungen (User)**: Windows + macOS, Sprechertrennung gewünscht, Transkription nach
  dem Meeting, nur Deutsch, Ausgabe `.md`, muss auch ohne GPU laufen.
  → Windows zuerst (Loopback-Aufnahme über WASAPI ist dort einfach); macOS ist schwieriger (System-Audio nur über
  ScreenCaptureKit oder virtuellen Treiber) und kommt als eigener Meilenstein.
  → Die Sprechertrennung kommt in zwei Stufen: Stufe 1 trennt kostenlos über die zwei Spuren (Mikrofon/Remote),
  Stufe 2 ist echte Diarization. Für Stufe 2 bevorzugt sherpa-onnx, weil pyannote einen Hugging-Face-Token und die
  Zustimmung zu Modell-Bedingungen braucht.
  → Auf reinen CPU-Rechnern ein kleineres Modell verwenden (z. B. `large-v3-turbo` int8 oder `small`).
  Die Transkription dauert dort ungefähr so lange wie das Meeting.
- **2026-09-30 – Offline-STT**: Anforderung „ohne externe Dienste“ → Whisper lokal (`faster-whisper`)
  statt Cloud-APIs. Modelle nicht ins Repo (zu groß), sondern Download beim ersten Start bzw. im Installer.
- **2026-09-30 – Releases**: Der GitHub-MCP-Zugang hat kein „Release erstellen“. Deshalb Releases per
  GitHub Action, ausgelöst durch einen gepushten Tag `vX.Y.Z` (Claude kann Tags per git pushen).

## Learnings
- **2026-09-30 – Fenster-Build (`--windowed`)**: Hier gibt es kein stdout/stderr. `print` tut dann nichts, aber
  unbehandelte Fehler öffnen einen PyInstaller-Dialog, der z. B. die CI blockiert. → `selftest` fängt alles ab und
  meldet über Exit-Code und Log (`%LOCALAPPDATA%\Transcripter\transcripter.log`). Kommandozeilen-Befehle wie
  `record` (braucht `input()`) sind nur für die Entwicklung gedacht.
- **2026-09-30 – Transkriptions-Thread**: Ein Daemon-`threading.Thread` statt `QThread`, damit das Fenster auch während
  einer laufenden Transkription geschlossen werden kann. Ein laufender QThread würde beim Beenden abstürzen.
  Signale aus dem Thread erreichen die GUI per Queued Connection.
- **2026-09-30 – Qt im Cloud-Container**: PySide6 braucht `libEGL`/`libGL` (`apt-get install libegl1 libgl1
  libxkbcommon0 libfontconfig1 libdbus-1-3`), danach geht `QT_QPA_PLATFORM=offscreen`. In der CI läuft der GUI-Test
  nur auf Windows und macOS; unter Linux wird er übersprungen.
- **2026-09-30 – `workflow_dispatch`**: Das geht nur mit Workflows, die auf dem Default-Branch liegen. Einen neuen
  Release-Workflow vor dem Merge also nur per Tag testen.
- **2026-09-30 – Modellgröße**: Das fertige faster-whisper-Modell `large-v3-turbo` liegt auf der Platte in fp16
  (~1,6 GB). Die ~0,8 GB gelten erst nach einer int8-Konvertierung (`ct2-transformers-converter
  --quantization int8`). → Das im Release-Build machen. Prüfen, ob die GPU mit dem int8-Modell gut läuft
  (ggf. `int8_float16`).
- **2026-09-30 – Kein Hugging Face im Cloud-Container**: Hugging Face ist aus dem Container gesperrt, PyPI geht.
  Echte Modell-Läufe sind nur beim User möglich; hier werden nur Schnittstelle und Logik (Fake-Modell) getestet.
- **2026-09-30 – Echo ohne Headset**: Über Lautsprecher landet die Remote-Stimme auch auf der Mikrofon-Spur.
  → `remove_echo()` verwirft Mikrofon-Segmente, die sich zeitlich überlappen und textlich ähnlich sind
  (Schwellwert 0,6). Die Schwelle an echten Aufnahmen prüfen.
- **2026-09-30 – WASAPI-Loopback liefert bei Stille keine Daten**: Solange nichts abgespielt wird, kommen keine
  Callbacks. Ohne Gegenmaßnahme wäre `system.wav` kürzer als `mic.wav` und die Zeitstempel liefen auseinander.
  → `TrackWriter.pad_to_clock()` füllt ab 0,5 s Rückstand gegenüber der Uhr mit Stille auf. Auf echter Hardware
  prüfen, ob die Spuren nach 30+ Minuten noch synchron sind.
- **2026-09-30 – Eine Audio-Bibliothek**: Mikrofon und Loopback laufen beide über PyAudioWPatch (WASAPI), statt
  zusätzlich sounddevice zu nutzen. So gibt es keine zwei PortAudio-Kopien im Prozess.
- **2026-09-30 – Tests mit `tmp_path`**: Der pytest-`tmp_path` enthält den Namen der Testfunktion. Enthält dieser
  Name ein Wort wie „onedrive“, schlägt die Pfad-Erkennung darauf an. → Testnamen ohne solche Wörter wählen.
- **2026-09-30 – Abhängigkeiten**: Schwere Laufzeit-Pakete (PySide6, faster-whisper) liegen im Extra `[app]`. CI und
  Unit-Tests brauchen nur `[dev]`, damit sie schnell bleiben.
- **2026-09-30 – Repo ist öffentlich**: Umso strenger gilt: keine internen Infos, Aufnahmen oder Testaudios
  mit echten Stimmen committen.
