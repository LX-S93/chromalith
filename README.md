# Chromalith

Chromalith macht aus einem Bild ein flaches Relief, das mit wenigen Filamentfarben
schichtweise gedruckt wird. Weil dünne Filamentschichten durchscheinen, entstehen
beim Drucken Farbverläufe und Schattierungen. Chromalith berechnet die Höhen, zeigt
eine Vorschau der Farbmischung und erzeugt STL-Datei und Farbwechsel-Plan.

Eigenständige Entwicklung. Ab Version 0.3 als Desktop-App (Tauri) mit Web-Oberfläche
in TypeScript; derselbe Code läuft auch im Browser.

## Windows-Programm

Download unter **Releases** (bei jeder neuen Version automatisch gebaut):

- `Chromalith-<Version>-Setup.exe` – Installation mit Startmenü-Eintrag (ohne Admin-Rechte),
- `Chromalith-windows.zip` – eine einzelne `Chromalith.exe` zum direkt Starten.

Braucht die Microsoft-WebView2-Laufzeit, die bei Windows 10/11 dabei ist.

## Arbeitsablauf

1. **Bild öffnen** (Strg+O oder Bild ins Fenster ziehen).
2. Links **Größe und Schichten** einstellen. Die Schichthöhen müssen später im Slicer
   genauso eingestellt sein (Standard: erste Schicht 0,16 mm, danach 0,08 mm).
3. Rechts den **Filament-Stapel** zusammenstellen (unten = zuerst gedruckt).
   „Hinzufügen …“ öffnet die Bibliothek, „Automatisch verteilen“ legt die Wechsel so,
   dass jedes Filament etwa gleich viel Bildfläche prägt. Danach die Startschichten
   von Hand feinjustieren und die Vorschau beobachten.
4. **Exportieren** oben rechts (Strg+E) schreibt:
   - `name.stl` – das Modell,
   - `name_farbwechsel.txt` – bei welcher Schicht/Höhe welches Filament kommt,
   - `name_farbwechsel.json` – dasselbe maschinenlesbar,
   - `name_vorschau.png` – die simulierte Ansicht.
5. Im Slicer die STL laden, Schichthöhen übernehmen und an den genannten Schichten
   einen Farbwechsel (Pause / M600) einfügen.

Projekte werden als `.chroma` gespeichert (Bild, Einstellungen und Stapel in einer Datei).

## Form: rund, Loch, Rand, Uhr-Ziffern

Unter **Form** lässt sich das Modell rund machen, ein Mittelloch (z. B. 8 mm für ein
Uhrwerk) und ein erhöhter Rand setzen sowie Uhr-Ziffern 1–12 aufsetzen. Rand und Ziffern
stehen über dem Bild und werden deshalb in der obersten Farbe gedruckt.

## Beispiele

In `python/examples/` liegen zwei eigene Testmotive; die fertigen `.chroma`-Projekte lassen
sich in der neuen Version direkt öffnen.

## Filamente und TD

Jedes Filament hat eine Farbe und eine **TD** (Transmissions-Distanz, in mm): die Dicke,
ab der es praktisch kein Licht mehr durchlässt. Kleine TD = deckt schnell (z. B. Schwarz),
große TD = scheint lange durch (z. B. Weiß, Gelb).

- Mitgeliefert ist eine kleine Startbibliothek mit **groben Schätzwerten**.
  Für gute Ergebnisse die TD der eigenen Filamente eintragen.
- **⋯ → Filament-Bibliothek → Importieren** liest eigene Chromalith-Dateien
  sowie Bibliotheks- und Set-Dateien im verbreiteten JSON-Schema
  (`Brand / Name / Type / Color / Transmissivity`, auch `.fss`).
- Die persönliche Bibliothek speichert das Programm selbst. Die Bibliothek der alten
  Python-Version wird beim ersten Start automatisch übernommen.

Farbmodell der Vorschau: Die Schichten werden von unten nach oben übereinandergelegt;
eine Lage der Dicke *t* deckt zu `1 − exp(−ln(20)·t/TD)` (bei *t* = TD also 95 %).
Das ist eine Näherung – echte Drucke weichen je nach Licht und Filament ab.

## Für Entwickler

Voraussetzungen: Node.js 22, für die Desktop-App zusätzlich Rust (rustup).

```
cd app
npm install
npm run dev          # Oberfläche im Browser: http://localhost:1420
npm test             # Tests des Rechenkerns (vitest)
npm run build        # statische Web-Version nach app/dist/
npx tauri dev        # Desktop-App im Entwicklungsmodus
npx tauri build      # Windows-Installer + Exe
```

Aufbau:

- `app/src/core/` – Rechenkern ohne Oberfläche (TypeScript, keine Abhängigkeiten):
  `heightmap.ts` (Bild → Höhen, Form/Uhr), `mesh.ts` (wasserdichtes Netz, STL),
  `filaments.ts` (Bibliothek, Import), `plan.ts` (Farbwechsel, Simulation),
  `colormatch.ts` (farbtreuer Modus), `analysis.ts`, `project.ts` (`.chroma`)
- `app/src/worker.ts` – rechnet im Hintergrund, die Oberfläche bleibt flüssig
- `app/src/ui/`, `app/src/main.ts` – Oberfläche, `app/src/platform.ts` – Dateien (Desktop/Browser)
- `app/src-tauri/` – Desktop-Hülle (Rust/Tauri)
- `python/` – bisherige Python/Qt-Version (bis 0.2.0), nur noch als Referenz

## Auf der eigenen Webseite

`npm run build` erzeugt in `app/dist/` eine statische Seite (HTML, JS, CSS) ohne Server-Teil.
Den Ordner auf den Webspace kopieren und verlinken oder per `<iframe>` einbinden. Dateien
werden dort als Download gespeichert, die Bibliothek im Browser des Besuchers.

## Geplant

- 3MF-Export mit eingebetteten Farbwechseln (Bambu Studio / Orca / PrusaSlicer)
- Gegenlicht-Vorschau (Lithophane)
- Farbbereiche gezielt einfärben („Color Pop“ / geteilte Modelle)
- Automatische Filament-Vorschläge aus der Bibliothek
- Formen/Masken für den Umriss, Hängeöse
