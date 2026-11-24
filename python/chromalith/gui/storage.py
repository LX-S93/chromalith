"""Ablage der persönlichen Filament-Bibliothek im Benutzerprofil."""

from pathlib import Path

from PySide6.QtCore import QStandardPaths

from ..core.filaments import FilamentLibrary, builtin_library


def data_dir() -> Path:
    p = Path(QStandardPaths.writableLocation(QStandardPaths.AppDataLocation))
    p.mkdir(parents=True, exist_ok=True)
    return p


def library_path() -> Path:
    return data_dir() / "filament_bibliothek.json"


def load_user_library() -> FilamentLibrary:
    path = library_path()
    if path.exists():
        try:
            return FilamentLibrary.load(path)
        except Exception:
            path.rename(path.with_suffix(".defekt.json"))
    lib = builtin_library()
    lib.save(path)
    return lib


def save_user_library(lib: FilamentLibrary) -> None:
    lib.save(library_path())
