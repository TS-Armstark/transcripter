"""Speicherorte für Aufnahmen/Transkripte und Erkennung von Cloud-synchronisierten Ordnern."""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "Transcripter"

# Ordnernamen, die typischerweise von Cloud-Clients synchronisiert werden
_CLOUD_MARKERS = ("onedrive", "dropbox", "google drive", "icloud", "mobile documents", "cloudstorage")
_ONEDRIVE_ENV_VARS = ("OneDrive", "OneDriveCommercial", "OneDriveConsumer")


def default_data_dir() -> Path:
    """Lokaler, nicht synchronisierter Datenordner.

    Bewusst nicht „Dokumente“, da dieser Ordner in Firmen oft auf OneDrive umgeleitet ist.
    """
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / APP_NAME


def recordings_dir(data_dir: Path | None = None) -> Path:
    return (data_dir or default_data_dir()) / "recordings"


def transcripts_dir(data_dir: Path | None = None) -> Path:
    return (data_dir or default_data_dir()) / "transcripts"


def is_cloud_synced(path: Path, env: dict[str, str] | None = None) -> bool:
    """True, wenn ``path`` vermutlich in einem Cloud-synchronisierten Ordner liegt."""
    env = os.environ if env is None else env
    resolved = Path(os.path.abspath(path))

    for var in _ONEDRIVE_ENV_VARS:
        root = env.get(var)
        if root and _is_relative_to(resolved, Path(os.path.abspath(root))):
            return True

    return any(marker in part.lower() for part in resolved.parts for marker in _CLOUD_MARKERS)


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True
