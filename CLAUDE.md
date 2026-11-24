# Hinweise für Claude

- Antworten an Alex auf Deutsch.
- Bei jeder Änderung, die Alex bekommen soll: Version in `chromalith/__init__.py` und `pyproject.toml`
  nach SemVer erhöhen, Eintrag in `CHANGELOG.md` (`## X.Y.Z – Datum`), auf `main` pushen.
  GitHub Actions legt bei einer neuen Versionsnummer automatisch Tag `vX.Y.Z` und Release mit
  `Chromalith-windows.zip` und den Notes aus dem CHANGELOG an.
- Keine HueForge-Dateien, -Namen oder -Assets ins Repository.
- Tests: `python -m pytest` (GUI-Tests brauchen eine Anzeige oder `QT_QPA_PLATFORM=offscreen`).
