from pathlib import Path

from transcripter.paths import default_data_dir, is_cloud_synced, recordings_dir


def test_default_dir_is_app_specific():
    assert default_data_dir().name == "Transcripter"
    assert recordings_dir(Path("/x")) == Path("/x/recordings")


def test_detects_sync_root_from_env(tmp_path):
    root = tmp_path / "Firma"
    assert is_cloud_synced(root / "Aufnahmen", env={"OneDriveCommercial": str(root)})
    assert not is_cloud_synced(tmp_path / "lokal", env={"OneDriveCommercial": str(root)})


def test_detects_cloud_folder_names():
    assert is_cloud_synced(Path("/Users/a/Library/CloudStorage/Box/x"), env={})
    assert is_cloud_synced(Path("C:/Users/a/OneDrive - Firma/x"), env={})
    assert not is_cloud_synced(Path("/home/a/transcripter"), env={})
