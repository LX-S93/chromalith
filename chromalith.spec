# PyInstaller-Bauplan: erzeugt dist/Chromalith/ mit Chromalith.exe (Oberfläche)
# und Chromalith-CLI.exe (Kommandozeile). Aufruf: pyinstaller --noconfirm chromalith.spec
from PyInstaller.utils.hooks import collect_submodules

datas = [("chromalith/data", "chromalith/data")]
hidden = collect_submodules("OpenGL")
excludes = ["tkinter", "matplotlib", "PySide6.QtWebEngineCore", "PySide6.QtQuick", "PySide6.QtQml",
            "PySide6.Qt3DCore", "PySide6.QtMultimedia", "PySide6.QtPdf"]

gui = Analysis(["run_chromalith.py"], datas=datas, hiddenimports=hidden, excludes=excludes)
cli = Analysis(["run_cli.py"], datas=datas, excludes=excludes + ["PySide6", "OpenGL"])

gui_exe = EXE(PYZ(gui.pure), gui.scripts, [], exclude_binaries=True, name="Chromalith",
              console=False, icon=None)
cli_exe = EXE(PYZ(cli.pure), cli.scripts, [], exclude_binaries=True, name="Chromalith-CLI",
              console=True)
coll = COLLECT(gui_exe, gui.binaries, gui.datas, cli_exe, cli.binaries, cli.datas, name="Chromalith")
