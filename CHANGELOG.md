# Änderungen

Versionen nach [SemVer](https://semver.org/lang/de/): MAJOR.MINOR.PATCH.

## 0.24.0 – 2026-11-26

- New: the motif can extend beyond the shape (section "Shape"). The round or rectangular shape becomes smaller than the image and parts of the motif, such as ears, stick out over its edge. "Attached" gives the protruding parts their own base plate and prints without supports; "Floating" leaves air below them and needs supports from the slicer.
- The background is detected automatically (transparent, or the plain colour at the image edge) with an adjustable tolerance; shape size and position can be moved behind the motif.
- Note for floating parts: colours can differ there because the lower filaments of the stack are missing; the preview shows the real result.

<!-- de
- Neu: Das Motiv kann über die Form hinausragen (Abschnitt „Form“). Die runde oder rechteckige Form wird kleiner als das Bild, und Teile des Motivs wie Ohren stehen über den Rand. „Aufliegend“ gibt den überstehenden Teilen eine eigene Grundplatte und druckt ohne Stützen; „Schwebend“ lässt Luft darunter und braucht Stützen aus dem Slicer.
- Der Hintergrund wird automatisch erkannt (transparent oder die einfarbige Fläche am Bildrand), die Toleranz ist einstellbar; Größe und Lage der Form lassen sich hinter dem Motiv verschieben.
- Hinweis zu schwebenden Teilen: Die Farben können dort abweichen, weil die unteren Filamente des Stapels fehlen; die Vorschau zeigt das echte Ergebnis.
-->

## 0.23.0 – 2026-11-26

- Sliders: a changed value is marked with a dot and a coloured bar from its default, the default is shown as a tick on the track, and each value can be reset (↺ or double-click on the slider). Each section gets a "Reset" button for all its changed values.
- Filament stack: every filament shows its layer range and thickness, the layer bar shows the individual layers and layer numbers.
- Live preview: the image updates while you drag a colour change in the layer bar, not only after releasing it.
- Update dialog: release notes are shown as a formatted list and in German when the app runs in German; dialog buttons no longer run past the edge.
- Small windows: the top bar collapses its labels instead of cutting off the mode switch; the stack buttons take less room so the filament list stays visible.

<!-- de
- Schieberegler: Ein geänderter Wert bekommt einen Punkt und einen farbigen Balken ab dem Ausgangswert, der Ausgangswert ist als Strich auf dem Regler zu sehen, und jeder Wert lässt sich zurücksetzen (↺ oder Doppelklick auf den Regler). Jeder Abschnitt hat „Zurücksetzen“ für alle geänderten Werte.
- Filament-Stapel: Jedes Filament zeigt seinen Schichtbereich und die Dicke, der Balken zeigt die einzelnen Schichten mit Nummern.
- Live-Vorschau: Das Bild ändert sich schon während du einen Farbwechsel im Balken ziehst, nicht erst beim Loslassen.
- Update-Dialog: Die Neuerungen erscheinen als saubere Liste und auf Deutsch; die Knöpfe laufen nicht mehr über den Rand.
- Kleine Fenster: Die Kopfzeile klappt Beschriftungen ein, statt den Modus-Schalter abzuschneiden; die Stapel-Knöpfe brauchen weniger Platz.
-->

## 0.22.0 – 2026-11-26

- Reliefs are printable by default: the new default "minimum detail" of 0.4 mm removes single spikes and stubs, widens fine lines (whiskers, outlines) to a printable width instead of deleting them, and in brightness mode rounds thin features into low ridges instead of tall thin walls. Projects saved earlier keep their own setting; set "Mindestdetail / Minimum detail" to 0.4 mm there to get the same result.
- New "Black and white" button in the filament stack: turns any image into a black/grey/white relief in one click.
- Removed the backdrop image from the lithophane light preview again; it was not recognisable.

## 0.21.0 – 2026-11-26

- New app icon.
- 14 more built-in examples on the welcome screen, now sorted into groups: colour reliefs, lithophanes (dog, kitten, hands, couple, best friends), moments (family, hot-air balloons, heart tree) and tech/neon (circuit board, neon city, cyborg, retro computer, motorbike).
- Light preview of lithophanes now has a dark wall as backdrop instead of plain black.

## 0.20.2 – 2026-11-26

- Updating with unsaved changes: instead of refusing, the update dialog now offers "Save and update",
  "Discard and update" or cancel.

## 0.20.1 – 2026-11-26

- The tiger example is now a roaring tiger (also in the README showcase).

## 0.20.0 – 2026-11-26

- **Sphere ornament redesigned for printing.** With "Screw cap on top" the sphere now has an internal thread at
  the top, sized for the light, and a flat floor of the same size at the bottom where the light stands. The cap
  with the hanging loop is a separate second part with a matching external thread and a 45° underside, so
  neither part needs supports. In the STL the sphere stands upside down on its flat threaded side with the cap
  next to it, ready to print.

## 0.19.0 – 2026-11-26

- **Welcome screen with built-in examples.** Seven colour reliefs (tiger, sunset, koi and wave, astronaut, fox,
  lighthouse, hummingbird) open with a matching six-filament stack, two lithophanes (wolf, owl ornament) open in
  the light simulation. All example images were generated for Chromalith and are free to use.
- Lithophane 3D view: more natural exposure, bright images no longer wash out at normal light intensity.
- The automatic update check now runs once at start (it used to run after loading an image).

## 0.18.0 – 2026-11-26

- **Sphere ornaments: opening sized for your light.** Choose a preset (LED tea light standard 38 mm, large 45 mm,
  maxi 58 mm, mini LED / fairy lights 20 mm) or enter the measured diameter. The opening is set 2 mm larger
  (top opening with screw cap, otherwise the bottom opening), and the sphere is enlarged automatically if the
  light would not fit in and out.

## 0.17.0 – 2026-11-26

- **Lithophane ornaments and lampshades: the image is no longer stretched.** On spheres and cylinders the image
  is now placed with its real proportions. New sliders set the **image size on the body**, **rotate** it around
  and move it **up/down**, independently of the size of the body; whatever extends beyond the body is cut off.
  Optionally the image is **repeated all around**. Cylinders can get their own height.
- **Screw cap for sphere ornaments:** an opening at the top with a printed thread and a removable cap (which
  carries the hanging loop), so the light can be inserted and replaced. In the STL the cap sits next to the sphere.
- **A real lamp in the 3D view:** a bulb on a stand behind flat and curved lithophanes, a light inside cylinders
  and spheres, fairy lights or a light panel depending on the chosen light source.
- **Thinner walls:** the default for the thickest (darkest) point is now 2.6 mm instead of 3 mm, and the wall
  beside the image on spheres and cylinders has its own setting (default 2.2 mm) instead of always using the
  maximum. Existing projects keep their values.

## 0.16.0 – 2026-11-26

- **Updates from inside the app.** Chromalith checks for a new release on start and offers to install it;
  no more manual download. Also available under **⋯ → Check for updates …**. The installer is downloaded
  from the project's GitHub releases and verified (size and SHA-256) before it runs; a version can be skipped
  and the automatic check can be switched off in the update dialog.
- **English interface.** The app follows the system language: German on a German system, English otherwise.
  It can be switched under **⋯ → Sprache / Language …**. The installer, the print assistant page, the colour
  change list and the exported file names follow the language too.
- Chromalith is now open source under the MIT licence; README and project description are in English.
- "Buy me a coffee" link in the menu and in the About dialog.
- Spoolman: the TD extra field is recognised with any prefix (e.g. `td`, `td_mm`, `filament_td`).

## 0.15.0 – 2026-11-25

- **Lithophanie: deutlich realistischere Beleuchtung in der 3D-Ansicht.**
  - Die Lampe ist ein echtes Punktlicht im Körper (bei flach und gebogen dahinter): Nah an der Lampe ist es
    heller (Hotspot), zum Rand hin fällt das Licht ab, und schräg getroffene Wände lassen weniger durch.
  - Abschwächung nach Wandstärke und TD getrennt je Farbe: Dicke Stellen werden nicht nur dunkler, sondern
    auch wärmer, wie bei echtem weißem Filament.
  - Streuung im Material: Das Licht verwischt in der Wand etwas, feine Details wirken weicher als das Relief.
  - Glühen um helle Stellen (Bloom), Filmic-Tonemapping wie bei einer Kamera, dunkler Raum und Lichtschein
    auf dem Tisch.
- **Lichtquellen zur Auswahl**: LED-Teelicht, LED-Lampe warmweiß / neutralweiß / kaltweiß, Lichterkette,
  Leuchtrahmen. Teelicht und Lampe geben einen hellen Fleck, Lichterkette und Leuchtrahmen leuchten gleichmäßig.
- Die flache Gegenlicht-Vorschau rechnet mit demselben Material-Modell (Streuung, Farbstich, Tonemapping).

## 0.14.0 – 2026-11-25

- **Neuer Modus „Lithophanie“** (Umschalter oben links: Farbrelief / Lithophanie). Aus dem Bild wird eine
  einfarbige Wand, die an dunklen Stellen dick und an hellen dünn ist. Das Bild erscheint, sobald Licht von
  hinten oder innen kommt.
- **Vier Formen**: flach (Fensterbild, Leuchtrahmen), gebogen (steht von selbst), Zylinder (Lampenschirm) und
  Kugel (Ornament, mit Öse zum Aufhängen und Öffnung unten für LED-Teelicht oder Lichterkette).
- **Simulation mit Licht**: Die Vorschau zeigt das Bild im Gegenlicht, die 3D-Ansicht den Körper zum Drehen.
  Mit „Licht an / Licht aus“ siehst du den Unterschied. Lichtfarbe (Warmweiß, Neutral, Kaltweiß, Kerze) und
  Lichtstärke sind einstellbar, das Filament (Farbe und TD) kommt aus der Bibliothek.
- Einstellbar: dünnste und dickste Wandstärke, Bogen, Bildhöhe auf der Kugel, Öffnung, Negativ. Helligkeit,
  Kontrast, Gamma und Glätten aus dem Abschnitt „Bild“ wirken auch hier.
- **Export** als STL (einfarbig, geschlossen) plus Bild der Gegenlicht-Vorschau. Die Einstellungen werden im
  Projekt gespeichert.

## 0.13.2 – 2026-11-25

- **Filament-Vorschläge treffen jetzt auch kleine, kräftige Farben**: Bei einem kleinen Motiv auf großem
  Hintergrund (z. B. Uhr) hat der Hintergrund bisher alles überstimmt, sodass z. B. Rot ganz fehlte. Jede
  Farbgruppe des Bildes zählt jetzt ausgeglichen. Das gilt auch für „Automatisch verteilen“ im farbtreuen Modus.
- **Gewünschte Anzahl wird eingehalten**: Wer 7 Filamente wählt, bekommt 7 – außer ein weiteres würde das
  Ergebnis verschlechtern.
- **Material wählbar**: Der Vorschlag bleibt standardmäßig bei einem Material (dem häufigsten der Bibliothek,
  meist PLA), statt PLA, PETG und ABS zu mischen. „Alle Materialien“ lässt sich weiterhin wählen.

## 0.13.1 – 2026-11-25

- **Vergleich in der 3D-Ansicht umgebaut**: Links vom Teiler liegt jetzt das flache Originalbild (2D, ohne
  Relief), rechts direkt daneben der Druck als Relief mit Tiefe. So zeigt ein einziges Bild, welchen
  Unterschied die Tiefe macht.

## 0.13.0 – 2026-11-25

- **Vergleichs-Teiler in der 3D-Ansicht**: Knopf „Vergleich“ oben links in der 3D-Ansicht. Links vom Teiler
  steht das Relief in den Farben des Originalbilds, rechts der simulierte Druck. Der Teiler lässt sich mit der
  Maus ziehen, das Modell dabei weiter drehen. Der Schicht-Regler bleibt.
- **Motiv skalieren und verschieben** (Abschnitt „Form“): „Motivgröße“, „Motiv nach rechts“ und „Motiv nach
  unten“ ändern nur das Motiv. Umriss und Größe des Drucks bleiben gleich, z. B. damit bei einer Uhr Platz für
  Ziffern und Rand bleibt. Die freie Fläche bekommt die Randfarbe des Bildes und bleibt flach.

## 0.12.0 – 2026-11-25

- **Schicht-Regler in der 3D-Ansicht**: zeigt den Druck nur bis Schicht X, in den Farben, die er in diesem
  Moment hat. So siehst du, wie das Bild Schicht für Schicht entsteht und was jeder Farbwechsel bewirkt.
- **Rechtsklick auf ein Filament im Stapel**: Ausblenden (bleibt im Stapel, wird aber nicht gedruckt und nicht
  berechnet), Ersetzen durch ein anderes Filament (Schicht bleibt), Bearbeiten, Verschieben, Entfernen.
  Alles lässt sich rückgängig machen; ausgeblendete Filamente werden im Projekt gespeichert.
- **Rechtsklick in der Bibliothek**: Bearbeiten, als vorhanden markieren, Duplizieren, Löschen.
- **Keine Zickzack-Rillen mehr in ebenen Flächen**: Fast einfarbige Hintergründe, die genau an einer
  Schichtgrenze lagen, bekamen bisher Rillen und Flecken von einer Schicht Höhe. Solche Scheinstufen werden
  jetzt entfernt; echte Kanten und Verläufe bleiben. Das gilt auch für STL und 3MF.

## 0.11.0 – 2026-11-25

- **Spoolman-Anbindung**: In der Filament-Bibliothek unter „Spoolman“ (oder im Menü „…“) die Adresse
  eintragen, z. B. `http://192.168.1.20:7912`. Chromalith übernimmt alle Rollen als „vorhandene“ Filamente
  mit Farbe, Material, Hersteller, Preis und Restgewicht. Mehrere Rollen desselben Filaments werden addiert,
  archivierte Rollen zählen nicht.
- Beim Programmstart wird automatisch abgeglichen (abschaltbar). Rollen, die es in Spoolman nicht mehr gibt,
  verlieren das Häkchen „vorhanden“.
- **TD-Wert**: wird aus einem Spoolman-Zusatzfeld `td` am Filament gelesen. Fehlt er, schätzt Chromalith ihn
  vom farblich nächsten Filament und markiert ihn mit „~“, bis du den echten Wert einträgst. Ein in Chromalith
  eingetragener TD bleibt beim Abgleich erhalten.
- **Kosten** rechnen mit dem echten Preis je Filament aus Spoolman. Reicht die Restmenge einer Rolle für den
  Druck nicht, warnt die Verbrauchstabelle.
- Chromalith liest nur aus Spoolman und ändert dort nichts.

## 0.10.0 – 2026-11-25

### Neu
- **Schritt-für-Schritt-Leiste** über den Ansichten: Bild → Größe & Form → Filamente → Vorschau →
  Export. Jeder Schritt zeigt einen kurzen Hinweis und hebt den passenden Bereich hervor; „Weiter“
  führt durch den Ablauf.
- **Vergleichsansicht:** In der Vorschau lässt sich das Original über einen Teiler direkt neben das
  Ergebnis legen (Knopf „Vergleich“, Teiler mit der Maus ziehen).
- **Verbrauch, Gewicht und Kosten** pro Filament in der Farbanalyse: Volumen, Gramm, Meter
  (1,75 mm) und Preis, mit einstellbarem Preis pro kg.
- **Druck-Assistent:** führt beim Drucken durch die Farbwechsel („Jetzt einlegen: … vor Schicht 17“),
  große Anzeige mit Abhaken. Im Vollbild am PC oder als einzelne Datei fürs Handy
  (`…_druckassistent.html`, wird beim Export mitgeschrieben, läuft ohne Internet).

### Verbessert
- Aufgeräumter: „Schichten“, „Bild“ und „Farbinseln“ sind anfangs eingeklappt.
- Alle Regler und Schalter haben jetzt eine Erklärung beim Darüberfahren.

## 0.9.0 – 2026-11-25

### Neu
- **Rückgängig / Wiederholen** für alle Änderungen an Einstellungen, Filament-Stapel und Farbinseln:
  Knöpfe oben in der Leiste sowie Strg+Z und Strg+Y (oder Strg+Umschalt+Z). Ein Zug am Schieberegler
  zählt als ein Schritt.

### Behoben
- Das „…“-Menü zeigte riesige Symbole; jetzt normale Größe, Einträge ohne Zeilenumbruch.

## 0.8.0 – 2026-11-25

### Geändert
- **3MF für Bambu Studio und OrcaSlicer:** Die exportierte `.3mf` ist jetzt wie ein Bambu-Projekt
  aufgebaut (Objekt auf Platte 1, mittig auf 256-mm-Bett, Schichthöhe am Objekt, Farbwechsel mit
  Filamentfarbe im Schicht-Regler). Beim Öffnen „als Projekt laden“ wählen.
- Standard für die erste Schicht ist jetzt **0,20 mm** (passt zu den Bambu-Prozessprofilen),
  danach weiter 0,08 mm. Bestehende Projekte behalten ihre Werte.

## 0.7.0 – 2026-11-25

### Verbessert
- **Deutlich besseres Ergebnis direkt nach dem Laden:** „Automatisch verteilen“ legt die
  Farbwechsel im Helligkeits-Modus jetzt so, dass die simulierte Helligkeit der Bildhelligkeit
  möglichst genau entspricht. Vorher richtete es sich nach Flächenanteilen; große helle Hintergründe
  zogen die Wechsel nach oben und das Bild wurde dunkel und grau. Jetzt: heller, flacher Hintergrund
  und fein abgestufte Details ohne Nacharbeit.
- 3D-Ansicht feiner (600 statt 360 Punkte je Seite) und mit besserem Startblick aufs ganze Modell.

### Neu
- **Farbinseln (Color Pop):** Links unter „Farbinseln“ einen Bereich per Klick ins Original-Bild
  wählen (z. B. Augen, Blüte). Er wird über das übrige Relief angehoben und oben mit einem eigenen
  Filament gedruckt; das ähnlichste Filament wird vorgeschlagen. Einstellbar: Farbtoleranz, Höhe,
  nur zusammenhängende Fläche, Relief behalten, weitere Klickpunkte. Die Inseln stehen mit in
  Farbwechsel-Liste und 3MF und werden im Projekt gespeichert.

## 0.6.0 – 2026-11-25

### Neu
- **3MF-Export mit eingebauten Farbwechseln:** Beim Exportieren entsteht zusätzlich eine `.3mf`.
  Darin stehen die Farbwechsel (M600 mit Filamentfarbe) für PrusaSlicer sowie Bambu Studio /
  OrcaSlicer, die Schichthöhe ist am Objekt hinterlegt. Im Slicer nur noch die erste Schicht
  (Standard 0,16 mm) einstellen, die Wechsel stehen dann schon an der richtigen Stelle.
  Bitte im eigenen Slicer prüfen und Rückmeldung geben, falls ein Wechsel fehlt.
- STL, Farbwechsel-Liste und Vorschaubild werden wie bisher mit exportiert.

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
