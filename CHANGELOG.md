# Änderungen

Versionen nach [SemVer](https://semver.org/lang/de/): MAJOR.MINOR.PATCH.

## 0.2.0 – 2026-11-24

Erste veröffentlichte Version.

**Bild → Relief**
- Bild öffnen (PNG, JPG, WebP, TIFF …) oder ins Fenster ziehen
- Höhe aus Helligkeit (hell = hoch / dunkel = hoch, großer Umkehr-Knopf) oder **farbtreu** nach Filamentfarben
- Einstellungen per Schieberegler mit Eingabefeld: Größe, Rasterweite, Schichthöhen, Min/Max-Höhe, Helligkeit, Kontrast, Gamma, Glätten, Mindestdetail
- **Form:** rund oder eckig, Mittelloch (z. B. Uhrwerk), erhöhter Rand, Uhr-Ziffern 1–12

**Filamente und Farbwechsel**
- Filament-Bibliothek mit TD-Werten, Import vorhandener Bibliotheken/Sets (.json/.fss)
- Filament-Stapel mit Startschichten, ziehbare Wechsel-Linien in der Schichtleiste
- „Automatisch verteilen“ (im farbtreuen Modus mit Optimierung auf die Bildfarben)
- „Nach Helligkeit sortieren“ mit Warnhinweis bei falscher Reihenfolge

**Vorschau und Analyse**
- Farbvorschau in voller Auflösung, 3D-Ansicht mit Überhöhung
- Reiter „Farbanalyse“: Hauptfarben des Bildes, ähnlichste Filamente, Flächenanteil je Filament

**Export**
- STL (wasserdicht, auch rund/mit Loch), Farbwechsel-Liste (TXT/JSON), Vorschaubild
- Projekte (.chroma) mit eingebettetem Bild; Original- und Vorschaubild wieder exportierbar

**Windows**
- Eigenständige `Chromalith.exe` (ohne Python), dazu `Chromalith-CLI.exe`
