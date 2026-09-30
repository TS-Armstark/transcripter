"""Programmfenster (PySide6): Aufnahme starten/stoppen, Aufnahmen verwalten, Transkripte öffnen."""

from __future__ import annotations

import logging
import queue
import sys
import threading
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QFont
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

from transcripter import __version__
from transcripter.export import format_timestamp
from transcripter.paths import default_data_dir, is_cloud_synced, recordings_dir, transcripts_dir
from transcripter.sessions import SessionInfo, list_sessions

log = logging.getLogger(__name__)

STYLE_IDLE = "color: #555; font-size: 20px;"
STYLE_REC = (
    "color: white; background: #c62828; font-size: 20px; font-weight: bold; padding: 8px; border-radius: 6px;"
)
STYLE_WARN = "background: #fff3cd; color: #664d03; padding: 6px; border-radius: 4px;"


class TranscribeWorker(QObject):
    """Transkribiert Aufnahmen nacheinander in einem Hintergrund-Thread; das Modell wird nur einmal geladen.

    Bewusst ein Daemon-Thread statt QThread: Beim Schließen während einer Transkription darf der Prozess
    einfach enden (die Aufnahme ist gespeichert, das Transkript kann später nachgeholt werden).
    Die Signale landen per Queued Connection im GUI-Thread.
    """

    status = Signal(str)
    progress = Signal(int)
    finished = Signal(str, str)  # Sitzungsname, Transkript-Pfad
    failed = Signal(str, str)  # Sitzungsname, Fehlermeldung

    def __init__(self, out_dir: Path) -> None:
        super().__init__()
        self.out_dir = out_dir
        self._model = None
        self._jobs: queue.Queue[str] = queue.Queue()
        threading.Thread(target=self._loop, name="transcribe", daemon=True).start()

    def submit(self, session_dir: str) -> None:
        self._jobs.put(session_dir)

    def _loop(self) -> None:
        while True:
            self.run(self._jobs.get())

    def run(self, session_dir: str) -> None:
        from transcripter.transcribe import load_model, pick_device, transcribe_session

        name = Path(session_dir).name
        try:
            if self._model is None:
                where = "Grafikkarte" if pick_device().device == "cuda" else "CPU"
                self.status.emit(f"Lade Sprachmodell ({where}) …")
                self._model = load_model()

            def on_progress(track: str, share: float) -> None:
                label = "Mikrofon" if track == "mic" else "System-Audio" if track == "system" else track
                self.status.emit(f"Transkribiere {name} – {label}")
                self.progress.emit(int(share * 100))

            out = transcribe_session(Path(session_dir), self.out_dir, self._model, on_progress)
            self.finished.emit(name, str(out))
        except Exception as exc:
            log.exception("Transkription fehlgeschlagen")
            self.failed.emit(name, str(exc))


class MainWindow(QMainWindow):
    def __init__(self, data_dir: Path | None = None) -> None:
        super().__init__()
        self.data_dir = data_dir or default_data_dir()
        self.recordings = recordings_dir(self.data_dir)
        self.transcripts = transcripts_dir(self.data_dir)
        self.recordings.mkdir(parents=True, exist_ok=True)
        self.transcripts.mkdir(parents=True, exist_ok=True)

        self.recorder = None
        self._devices = None
        self._queue: list[str] = []
        self._busy = False
        self._current: str | None = None

        self.setWindowTitle(f"Transcripter {__version__}")
        self.resize(640, 520)
        self._build_ui()
        self._start_worker()
        self.refresh_sessions()

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)

    # ---------- UI ----------
    def _build_ui(self) -> None:
        root = QWidget()
        layout = QVBoxLayout(root)

        if is_cloud_synced(self.data_dir):
            warn = QLabel(
                f"⚠ Der Speicherort {self.data_dir} wird vermutlich mit der Cloud synchronisiert "
                "(z. B. OneDrive). Aufnahmen würden den Rechner verlassen!"
            )
            warn.setWordWrap(True)
            warn.setStyleSheet(STYLE_WARN)
            layout.addWidget(warn)

        self.status_label = QLabel("Bereit")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet(STYLE_IDLE)
        layout.addWidget(self.status_label)

        sources = QHBoxLayout()
        self.cb_mic = QCheckBox("Mikrofon (Ich/Raum)")
        self.cb_mic.setChecked(True)
        self.cb_system = QCheckBox("System-Audio (Teams, Zoom …)")
        self.cb_system.setChecked(True)
        sources.addWidget(self.cb_mic)
        sources.addWidget(self.cb_system)
        layout.addLayout(sources)

        self.cb_auto = QCheckBox("Nach dem Stoppen automatisch transkribieren")
        self.cb_auto.setChecked(True)
        layout.addWidget(self.cb_auto)

        self.btn_record = QPushButton("● Aufnahme starten")
        font = QFont()
        font.setPointSize(14)
        font.setBold(True)
        self.btn_record.setFont(font)
        self.btn_record.setMinimumHeight(56)
        self.btn_record.clicked.connect(self.toggle_recording)
        layout.addWidget(self.btn_record)

        hint = QLabel("Hinweis: Aufnahmen nur mit Einverständnis aller Teilnehmer.")
        hint.setStyleSheet("color: #777;")
        layout.addWidget(hint)

        self.list = QTreeWidget()
        self.list.setHeaderLabels(["Aufnahme", "Dauer", "Transkript"])
        self.list.setRootIsDecorated(False)
        self.list.header().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.list.itemDoubleClicked.connect(lambda *_: self.open_transcript())
        self.list.itemSelectionChanged.connect(self._update_buttons)
        layout.addWidget(self.list, stretch=1)

        buttons = QHBoxLayout()
        self.btn_open = QPushButton("Transkript öffnen")
        self.btn_open.clicked.connect(self.open_transcript)
        self.btn_transcribe = QPushButton("Transkribieren")
        self.btn_transcribe.clicked.connect(self.transcribe_selected)
        self.btn_folder = QPushButton("Ordner öffnen")
        self.btn_folder.clicked.connect(self.open_folder)
        for b in (self.btn_open, self.btn_transcribe, self.btn_folder):
            buttons.addWidget(b)
        layout.addLayout(buttons)

        self.progress = QProgressBar()
        self.progress.setVisible(False)
        self.work_label = QLabel("")
        layout.addWidget(self.work_label)
        layout.addWidget(self.progress)

        self.setCentralWidget(root)
        self._update_buttons()

    def _start_worker(self) -> None:
        self.worker = TranscribeWorker(self.transcripts)
        self.worker.status.connect(self.work_label.setText)
        self.worker.progress.connect(self.progress.setValue)
        self.worker.finished.connect(self._on_transcribed)
        self.worker.failed.connect(self._on_failed)

    # ---------- Aufnahmen ----------
    def refresh_sessions(self) -> None:
        selected = self._selected()
        self.list.clear()
        for info in list_sessions(self.recordings, self.transcripts):
            state = "✔" if info.transcript else ("läuft …" if str(info.directory) in self._pending() else "–")
            item = QTreeWidgetItem(
                [f"{info.started_at:%d.%m.%Y %H:%M}", format_timestamp(info.duration), state]
            )
            item.setData(0, Qt.ItemDataRole.UserRole, info)
            self.list.addTopLevelItem(item)
            if selected and info.directory == selected.directory:
                item.setSelected(True)
        self._update_buttons()

    def _selected(self) -> SessionInfo | None:
        items = self.list.selectedItems()
        return items[0].data(0, Qt.ItemDataRole.UserRole) if items else None

    def _pending(self) -> list[str]:
        return list(self._queue) + ([self._current] if self._busy else [])

    def _update_buttons(self) -> None:
        info = self._selected()
        self.btn_open.setEnabled(bool(info and info.transcript))
        self.btn_transcribe.setEnabled(bool(info) and str(info.directory) not in self._pending())

    def open_transcript(self) -> None:
        info = self._selected()
        if info and info.transcript:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(info.transcript)))

    def open_folder(self) -> None:
        info = self._selected()
        target = info.directory if info else self.data_dir
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(target)))

    # ---------- Aufnahme ----------
    def toggle_recording(self) -> None:
        if self.recorder and self.recorder.is_recording:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self) -> None:
        from transcripter.devices import DeviceManager
        from transcripter.recorder import Recorder

        if not (self.cb_mic.isChecked() or self.cb_system.isChecked()):
            QMessageBox.warning(self, "Transcripter", "Bitte mindestens eine Quelle auswählen.")
            return
        try:
            self._devices = DeviceManager()
            sources = {}
            if self.cb_mic.isChecked():
                sources["mic"] = self._devices.default_mic()
            if self.cb_system.isChecked():
                try:
                    sources["system"] = self._devices.default_system()
                except (LookupError, OSError) as exc:
                    if not sources:
                        raise
                    QMessageBox.information(
                        self, "Transcripter", f"System-Audio nicht verfügbar – nur Mikrofon.\n({exc})"
                    )
            self.recorder = Recorder(sources, self.recordings)
            self.recorder.start()
        except Exception as exc:
            log.exception("Aufnahme konnte nicht starten")
            self._close_devices()
            self.recorder = None
            QMessageBox.critical(self, "Transcripter", f"Aufnahme konnte nicht gestartet werden:\n{exc}")
            return

        self.cb_mic.setEnabled(False)
        self.cb_system.setEnabled(False)
        self.btn_record.setText("■ Aufnahme beenden")
        self.status_label.setStyleSheet(STYLE_REC)
        self._tick()
        self._timer.start(500)

    def stop_recording(self) -> None:
        self._timer.stop()
        session = self.recorder.stop()
        self.recorder = None
        self._close_devices()

        self.cb_mic.setEnabled(True)
        self.cb_system.setEnabled(True)
        self.btn_record.setText("● Aufnahme starten")
        self.status_label.setStyleSheet(STYLE_IDLE)
        self.status_label.setText(f"Gespeichert ({format_timestamp(session.duration)})")
        self.setWindowTitle(f"Transcripter {__version__}")

        if self.cb_auto.isChecked():
            self.enqueue(str(session.directory))
        self.refresh_sessions()

    def _close_devices(self) -> None:
        if self._devices:
            self._devices.close()
            self._devices = None

    def _tick(self) -> None:
        elapsed = format_timestamp(self.recorder.elapsed() if self.recorder else 0)
        self.status_label.setText(f"● AUFNAHME LÄUFT  {elapsed}")
        self.setWindowTitle(f"● Aufnahme {elapsed} – Transcripter")

    # ---------- Transkription ----------
    def transcribe_selected(self) -> None:
        info = self._selected()
        if info:
            self.enqueue(str(info.directory))

    def enqueue(self, session_dir: str) -> None:
        if session_dir in self._pending():
            return
        self._queue.append(session_dir)
        self._next()

    def _next(self) -> None:
        if self._busy or not self._queue:
            return
        self._busy = True
        self._current = self._queue.pop(0)
        self.progress.setValue(0)
        self.progress.setVisible(True)
        self.worker.submit(self._current)
        self.refresh_sessions()

    def _on_transcribed(self, name: str, path: str) -> None:
        self._busy = False
        self.work_label.setText(f"Fertig: {Path(path).name}")
        self.progress.setVisible(False)
        self.refresh_sessions()
        self._next()

    def _on_failed(self, name: str, message: str) -> None:
        self._busy = False
        self.progress.setVisible(False)
        self.work_label.setText(f"Fehler bei {name}")
        QMessageBox.critical(self, "Transcripter", f"Transkription von {name} fehlgeschlagen:\n{message}")
        self.refresh_sessions()
        self._next()

    # ---------- Schließen ----------
    def closeEvent(self, event) -> None:
        if self.recorder and self.recorder.is_recording:
            answer = QMessageBox.question(
                self, "Transcripter", "Die Aufnahme läuft noch. Beenden und speichern?"
            )
            if answer != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
            self.cb_auto.setChecked(False)
            self.stop_recording()
        if self._busy or self._queue:
            answer = QMessageBox.question(
                self,
                "Transcripter",
                "Es wird noch transkribiert. Trotzdem schließen? (Kann später nachgeholt werden)",
            )
            if answer != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
        event.accept()


def run() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    app.setApplicationName("Transcripter")
    window = MainWindow()
    window.show()
    return app.exec()
