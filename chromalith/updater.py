"""Update-Funktion: prüft eine Versions-Datei (latest.json), lädt das neue ZIP,
prüft die Prüfsumme und tauscht die Programmdateien beim nächsten Neustart aus.

Format von latest.json:
    {"version": "0.2.0", "url": "https://…/Chromalith-windows.zip",
     "sha256": "…", "notes": "Was ist neu …"}
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from . import __version__

# Öffentliche Ablage nur für die fertigen Programmdateien (der Quellcode bleibt privat).
DEFAULT_MANIFEST_URL = "https://github.com/LX-S93/chromalith-releases/releases/latest/download/latest.json"
USER_AGENT = f"Chromalith/{__version__}"


def parse_version(v: str) -> tuple:
    parts = []
    for p in v.strip().lstrip("vV").split("."):
        num = "".join(ch for ch in p if ch.isdigit())
        parts.append(int(num) if num else 0)
    return tuple(parts + [0] * (3 - len(parts)))


def is_newer(remote: str, local: str = __version__) -> bool:
    return parse_version(remote) > parse_version(local)


@dataclass
class UpdateInfo:
    version: str
    url: str
    sha256: str
    notes: str = ""


def _get(url: str, timeout: float = 10.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def check_for_update(manifest_url: str = DEFAULT_MANIFEST_URL) -> Optional[UpdateInfo]:
    """Gibt UpdateInfo zurück, wenn eine neuere Version verfügbar ist, sonst None."""
    data = json.loads(_get(manifest_url).decode("utf-8"))
    info = UpdateInfo(str(data["version"]), str(data["url"]), str(data["sha256"]).lower(),
                      str(data.get("notes", "")))
    return info if is_newer(info.version) else None


def download(info: UpdateInfo, progress: Callable[[int, int], None] | None = None) -> Path:
    """Lädt das ZIP herunter und prüft die SHA-256-Prüfsumme."""
    target = Path(tempfile.mkdtemp(prefix="chromalith_update_")) / "update.zip"
    req = urllib.request.Request(info.url, headers={"User-Agent": USER_AGENT})
    h = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=30) as r, open(target, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if progress:
                progress(done, total)
    if h.hexdigest() != info.sha256:
        target.unlink(missing_ok=True)
        raise ValueError("Prüfsumme stimmt nicht – Download beschädigt oder manipuliert.")
    return target


def extract(zip_path: Path) -> Path:
    out = zip_path.parent / "neu"
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():                      # keine Pfade außerhalb des Ziels
            p = (out / name).resolve()
            if not str(p).startswith(str(out.resolve())):
                raise ValueError(f"Ungültiger Pfad im Update: {name}")
        z.extractall(out)
    # Falls das ZIP einen Unterordner enthält, diesen verwenden
    entries = list(out.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return out


def install_dir() -> Path:
    return Path(sys.executable).resolve().parent


def can_self_update() -> bool:
    return bool(getattr(sys, "frozen", False)) and os.name == "nt"


def write_swap_script(new_dir: Path, app_dir: Path, exe_name: str, pid: int) -> Path:
    """Batch-Skript: wartet bis Chromalith beendet ist, kopiert die neuen Dateien
    über die alten und startet das Programm neu."""
    script = new_dir.parent / "chromalith_update.bat"
    script.write_text(
        "@echo off\r\n"
        "chcp 65001 >nul\r\n"
        ":warten\r\n"
        f'tasklist /FI "PID eq {pid}" | find "{pid}" >nul && (timeout /t 1 /nobreak >nul & goto warten)\r\n'
        f'robocopy "{new_dir}" "{app_dir}" /E /R:5 /W:1 /NFL /NDL /NJH /NJS >nul\r\n'
        f'start "" "{app_dir / exe_name}"\r\n'
        f'rmdir /S /Q "{new_dir.parent}" 2>nul\r\n',
        encoding="utf-8")
    return script


def apply_and_restart(new_dir: Path) -> None:
    """Startet den Austausch und beendet sich danach (nur in der Windows-Exe)."""
    if not can_self_update():
        raise RuntimeError("Selbst-Update funktioniert nur in der installierten Windows-Version.")
    app = install_dir()
    script = write_swap_script(new_dir, app, Path(sys.executable).name, os.getpid())
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(["cmd", "/c", str(script)], creationflags=flags, close_fds=True)
