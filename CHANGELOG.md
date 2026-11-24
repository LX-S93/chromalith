# Änderungen

Versionen nach [SemVer](https://semver.org/lang/de/): MAJOR.MINOR.PATCH.

## 0.5.0 – 2026-11-25

### Neu
- **Filamente vorschlagen:** Chromalith sucht aus deiner ganzen Bibliothek das Filament-Set,
  mit dem die Farben des Bildes am besten getroffen werden: welche Filamente, in welcher
  Reihenfolge und ab welcher Schicht. Zu finden rechts unter dem Stapel und in der Farbanalyse.
  - Anzahl wählbar (2–10); bringt ein weiteres Filament nichts, werden weniger vorgeschlagen.
  - Auf Wunsch nur aus Filamenten, die als „Vorhanden“ markiert sind.
  - Vorher/Nachher-Vorschau nebeneinander mit mittlerer Farbabweichung, Übernehmen mit einem Klick.

### Verbessert
- Import ist robuster: Einträge mit kurzen (#abc) oder ungültigen Farbangaben werden korrigiert bzw. übersprungen.

## 0.4.0 – 2026-11-24

### Neu
- Knopf **Filamente** oben in der Leiste öffnet direkt die Filament-Bibliothek.
- Bequemer Import vorhandener Filament-Bibliotheken mit Farbe und TD:
  - **Importieren** sucht auf dem Rechner automatisch nach vorhandenen Bibliotheks-Ordnern
    (Dokumente, Desktop, Downloads, Programme) und übernimmt mit einem Klick alle Bibliotheken
    und Sets daraus, auch aus Unterordnern.
  - Alternativ einen Ordner oder mehrere Dateien (.json, .fss) wählen oder einfach in die Bibliothek ziehen.
  - Doppelte Filamente werden automatisch übersprungen, danach gibt es eine kurze Zusammenfassung.
  - Beim ersten Start wird eine gefundene Bibliothek zur Übernahme angeboten.

## 0.3.0 – 2026-11-24

Komplett neue, moderne Oberfläche. Die Bedienung ist gleich geblieben, alle Funktionen sind dabei.

### Neu
- Dunkles, aufgeräumtes Design: Einstellungen links, Ansichten in der Mitte, Filament-Stapel rechts.
- Höhen-Modus direkt oben umschaltbar (Auto / Hell hoch / Dunkel hoch / Farbtreu) und „Umkehren“-Knopf.
  Im Auto-Modus steht dabei, welcher Modus gerade gilt.
- Schichtbalken neben dem Stapel: Farbwechsel lassen sich mit der Maus nach oben/unten ziehen.
- Berechnung läuft im Hintergrund, die Oberfläche bleibt beim Schieben der Regler flüssig.
- 3D-Ansicht mit Höhen-Überhöhung (1–6×), Vorschau mit Zoom um den Mauszeiger und Positionsanzeige in mm.
- Farbanalyse übersichtlicher mit Balken; Filamente unter 1 % Sichtbarkeit werden markiert.
- Windows-Installer (`Chromalith-0.3.0-Setup.exe`, ohne Admin-Rechte) und weiterhin eine
  einzelne `Chromalith.exe` im ZIP. Kein Python mehr nötig, Programm deutlich kleiner.
- Derselbe Code läuft auch im Browser (Grundlage für die eigene Webseite).

### Geändert
- Technik: Desktop-App mit Tauri, Oberfläche und Rechenkern in TypeScript.
  Die bisherige Python-Version liegt unter `python/` als Referenz.
- Die Filament-Bibliothek speichert die App selbst. Die Bibliothek der alten Version wird beim ersten
  Start automatisch übernommen.
- `.chroma`-Projekte der alten Version lassen sich unverändert öffnen.
- Die Kommandozeilen-Version (`Chromalith-CLI.exe`) gibt es vorerst nur noch in der alten Python-Version.

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
