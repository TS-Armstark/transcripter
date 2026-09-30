# Release-Prozess

Releases werden von der GitHub Action `.github/workflows/release.yml` erstellt,
sobald ein Tag `vX.Y.Z` gepusht wird. Claude kann das selbst auslösen.

## Ablauf
1. Alle Änderungen sind auf `main` gemergt, CI grün.
2. Version festlegen (SemVer): `MAJOR.MINOR.PATCH`
   - PATCH = Bugfix, MINOR = neue Funktion, MAJOR = inkompatible Änderung
3. Version in `src/transcripter/__init__.py` anheben (PEP 440, z. B. `0.1.0b1` für Tag `v0.1.0-beta.1`) und committen.
4. Tag auf `main` setzen und pushen:
   ```bash
   git checkout main && git pull
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```
5. Die Action `release.yml` macht:
   - **model**: Whisper `large-v3-turbo` von Hugging Face laden und nach CTranslate2 int8 konvertieren
     (wird per Cache wiederverwendet)
   - **build-windows**: PyInstaller-Build (`packaging/build.py --model model`), Selbsttest der `.exe`
     (`Transcripter.exe selftest`), ZIP `Transcripter-<tag>-windows.zip`
   - **release**: GitHub-Release mit `packaging/RELEASE_BODY.md` + automatischen Notes, ZIP als Asset
6. Prüfen: Release auf GitHub vorhanden, Asset herunterladbar.
7. `docs/HANDOFF.md` und `docs/TODO.md` aktualisieren.

## Alternativ: manuell auslösen
Die Action hat auch `workflow_dispatch` (Actions → Release → Run workflow):
- ohne `tag`: nur bauen + testen, ZIP als Workflow-Artefakt (7 Tage) – gut zum Ausprobieren
- mit bestehendem `tag`: zusätzlich veröffentlichen

## Lokal bauen (Windows)
```powershell
pip install ".[app]" pyinstaller
python packaging/build.py --model <Ordner mit model.bin>
dist\Transcripter\Transcripter.exe
```

## Pre-Releases
Tags mit Bindestrich (z. B. `v0.1.0-beta.1`) werden als Pre-Release markiert.
