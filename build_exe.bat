@echo off
rem Baut die Windows-Version lokal: dist\Chromalith\Chromalith.exe
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" ( echo Bitte zuerst start.bat einmal ausfuehren. & pause & exit /b 1 )
".venv\Scripts\python.exe" -m pip install pyinstaller
".venv\Scripts\python.exe" -m PyInstaller --noconfirm chromalith.spec
echo.
echo Fertig: dist\Chromalith\Chromalith.exe
pause
