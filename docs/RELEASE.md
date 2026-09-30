# Release-Prozess

Releases werden von der GitHub Action `.github/workflows/release.yml` erstellt,
sobald ein Tag `vX.Y.Z` gepusht wird. Claude kann das selbst auslösen.

## Ablauf
1. Alle Änderungen sind auf `main` gemergt, CI grün.
2. Version festlegen (SemVer): `MAJOR.MINOR.PATCH`
   - PATCH = Bugfix, MINOR = neue Funktion, MAJOR = inkompatible Änderung
3. Version im Code/`pyproject.toml` anheben (sobald vorhanden) und committen.
4. Tag auf `main` setzen und pushen:
   ```bash
   git checkout main && git pull
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```
5. Die Action erstellt das Release mit automatisch generierten Release-Notes
   (aus PR-Titeln/Commits) und hängt Build-Artefakte an (sobald der Build-Schritt existiert).
6. Prüfen: Release auf GitHub vorhanden, Asset herunterladbar.
7. `docs/HANDOFF.md` und `docs/TODO.md` aktualisieren.

## Alternativ: manuell auslösen
Die Action hat auch `workflow_dispatch` mit Eingabe `tag` – kann über GitHub-UI
(Actions → Release → Run workflow) gestartet werden.

## Pre-Releases
Tags mit Bindestrich (z. B. `v0.1.0-beta.1`) werden als Pre-Release markiert.
