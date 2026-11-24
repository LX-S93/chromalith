# Chromalith

Chromalith macht aus einem Bild ein flaches Relief, das mit wenigen Filamentfarben
schichtweise gedruckt wird. Weil dünne Filamentschichten durchscheinen, entstehen
beim Drucken Farbverläufe und Schattierungen. Chromalith berechnet die Höhen, zeigt
eine Vorschau der Farbmischung und erzeugt STL-Datei und Farbwechsel-Plan.

Eigenständige Entwicklung (Python, Qt), Version 0.1 (MVP).

## Windows-Programm (ohne Python)

Bei jedem Push baut GitHub Actions automatisch die Windows-Version.
Download: Repository → **Actions** → letzter Lauf „Build“ → Artefakt **Chromalith-windows**
(bzw. bei Versions-Tags `v…` unter **Releases**). ZIP entpacken, `Chromalith.exe` starten.
Im selben Ordner liegt `Chromalith-CLI.exe` für die Kommandozeile.

Selbst bauen: `start.bat` einmal ausführen, dann `build_exe.bat` → `dist\Chromalith\`.

## Starten mit Python (für Entwicklung)

1. Python 3.10 oder neuer installieren: <https://www.python.org/downloads/>
   (bei der Installation **„Add python.exe to PATH“** anhaken).
2. `start.bat` doppelklicken. Beim ersten Start wird eine eigene Umgebung (`.venv`)
   angelegt und die Pakete werden geladen (dauert einmalig 1–2 Minuten).

Optional eine eigenständige `.exe` bauen: `build_exe.bat` ausführen, Ergebnis liegt in
`dist\Chromalith\Chromalith.exe`.

## Arbeitsablauf

1. **Bild öffnen** (Strg+O oder Bild ins Fenster ziehen).
2. Links **Größe und Schichten** einstellen. Die Schichthöhen müssen später im Slicer
   genauso eingestellt sein (Standard: erste Schicht 0,16 mm, danach 0,08 mm).
3. Rechts den **Filament-Stapel** zusammenstellen (unten = zuerst gedruckt).
   „Hinzufügen …“ öffnet die Bibliothek, „Automatisch verteilen“ legt die Wechsel so,
   dass jedes Filament etwa gleich viel Bildfläche prägt. Danach die Startschichten
   von Hand feinjustieren und die Vorschau beobachten.
4. **Datei → Exportieren** (Strg+E) schreibt:
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

`python examples/make_motifs.py` erzeugt zwei eigene Testmotive, `python examples/build_examples.py`
baut daraus fertige Projekte mit STL, Farbwechsel-Liste und Vorschau in `examples/projekte/`.

## Filamente und TD

Jedes Filament hat eine Farbe und eine **TD** (Transmissions-Distanz, in mm): die Dicke,
ab der es praktisch kein Licht mehr durchlässt. Kleine TD = deckt schnell (z. B. Schwarz),
große TD = scheint lange durch (z. B. Weiß, Gelb).

- Mitgeliefert ist eine kleine Startbibliothek mit **groben Schätzwerten**.
  Für gute Ergebnisse die TD der eigenen Filamente eintragen.
- **Filamente → Bibliothek verwalten → Importieren** liest eigene Chromalith-Dateien
  sowie Bibliotheks- und Set-Dateien im verbreiteten JSON-Schema
  (`Brand / Name / Type / Color / Transmissivity`, auch `.fss`).
- Die persönliche Bibliothek liegt unter `%APPDATA%\Chromalith\filament_bibliothek.json`.

Farbmodell der Vorschau: Die Schichten werden von unten nach oben übereinandergelegt;
eine Lage der Dicke *t* deckt zu `1 − exp(−ln(20)·t/TD)` (bei *t* = TD also 95 %).
Das ist eine Näherung – echte Drucke weichen je nach Licht und Filament ab.

## Kommandozeile

```
python -m chromalith.cli bild.png --width 120 --filaments set.json -o ausgabe\modell
python -m chromalith.cli projekt.chroma -o ausgabe\modell
```

## Für Entwickler

```
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt pytest
python -m pytest
```

Aufbau:

- `chromalith/core/` – Rechenkern ohne Oberfläche: `heightmap.py` (Bild → Höhen),
  `mesh.py` (wasserdichtes Netz, STL), `filaments.py` (Bibliothek, Import),
  `colorplan.py` (Farbwechsel, Simulation), `project.py`, `export.py`
- `chromalith/gui/` – Qt-Oberfläche inkl. OpenGL-3D-Vorschau
- `tests/` – Tests für Kern und Oberfläche

## Aufbau für eine spätere Web-Version

`chromalith/core/` hängt nur von NumPy und Pillow ab, nicht von Qt. Damit kann derselbe
Rechenkern später auch im Browser (Pyodide) oder hinter einer kleinen Web-API laufen.

## Geplant (nach dem MVP)

- 3MF-Export mit eingebetteten Farbwechseln (Bambu Studio / Orca / PrusaSlicer)
- Gegenlicht-Vorschau (Lithophane)
- Farbbereiche gezielt einfärben („Color Pop“ / geteilte Modelle)
- Automatische Filament-Vorschläge aus der Bibliothek
- Formen/Masken für den Umriss, Hängeöse
