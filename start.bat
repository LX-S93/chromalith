@echo off
rem Startet Chromalith. Beim ersten Start wird eine eigene Python-Umgebung (.venv) angelegt.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Lege Python-Umgebung an ...
    py -3 -m venv .venv 2>nul || python -m venv .venv
    if errorlevel 1 (
        echo.
        echo Python wurde nicht gefunden. Bitte Python 3.10 oder neuer von https://www.python.org installieren
        echo ^(bei der Installation "Add python.exe to PATH" anhaken^) und start.bat erneut ausfuehren.
        pause
        exit /b 1
    )
    ".venv\Scripts\python.exe" -m pip install --upgrade pip
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 ( pause & exit /b 1 )
)
start "" ".venv\Scripts\pythonw.exe" -m chromalith %*
