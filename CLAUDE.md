# Hinweise für Claude

- Antworten an Alex auf Deutsch.
- Bei jeder Änderung, die Alex bekommen soll: Version nach SemVer gleichzeitig in
  `app/package.json`, `app/src-tauri/tauri.conf.json` und `app/src-tauri/Cargo.toml` erhöhen
  (CI prüft, dass alle drei gleich sind), Eintrag in `CHANGELOG.md` (`## X.Y.Z – Datum`), auf `main` pushen.
  GitHub Actions legt bei einer neuen Versionsnummer automatisch Tag `vX.Y.Z` und Release mit
  Setup-Exe, `Chromalith-windows.zip` und den Notes aus dem CHANGELOG an.
- Keine HueForge-Dateien, -Namen oder -Assets ins Repository.
- Code liegt in `app/` (Vite + TypeScript, Desktop über Tauri). `python/` ist die alte Version (nur Referenz).
- Tests: `cd app && npm test`, Typprüfung + Web-Build: `npm run build`, Rust: `cd app/src-tauri && cargo check`.
- `.chroma`-Projekte müssen kompatibel bleiben (auch die der alten Python-Version).
