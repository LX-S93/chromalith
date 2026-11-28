# Änderungen

Versionen nach [SemVer](https://semver.org/lang/de/): MAJOR.MINOR.PATCH.

## 0.28.0 – 2026-11-28

- New: measure the TD of your own filaments (menu "⋯ → Measure TD …", also in the filament library and in "Edit filament").
- Step wedge to print: "Save step wedge …" writes a small strip as STL and 3MF, by default 10 steps from one first layer upwards (0.20 to 0.92 mm with 0.20 / 0.08 mm layers). First layer, layer height, layers per step and number of steps are adjustable; with a slicer template the 3MF already contains the layer heights and 100% infill.
- Backlit photo: load a photo of the wedge on a bright surface and drag two markers to the thinnest and the thickest step. Chromalith measures the brightness of every step and derives the TD from how fast it falls with thickness. Lamp brightness and exposure do not matter; overexposed steps and steps that no light passes through are left out, and a chart shows the readings and the fitted curve.
- By hand: choose the first step that no light shines through.
- The measured value is written to the filament in the library and to the same filament in the current stack and lithophane.

<!-- de
- Neu: Den TD der eigenen Filamente messen (Menü „⋯ → TD messen …“, außerdem in der Filament-Bibliothek und unter „Filament bearbeiten“).
- Stufentreppe zum Drucken: „Treppe speichern …“ schreibt einen kleinen Streifen als STL und 3MF, standardmäßig 10 Stufen ab einer ersten Schicht (0,20 bis 0,92 mm bei 0,20 / 0,08 mm Schichten). Erste Schicht, Schichthöhe, Schichten je Stufe und Anzahl der Stufen sind einstellbar; mit einer Slicer-Vorlage stehen Schichthöhen und 100 % Füllung schon in der 3MF.
- Foto im Gegenlicht: Ein Foto der Treppe auf einer hellen Fläche laden und zwei Marken auf die dünnste und die dickste Stufe ziehen. Chromalith misst die Helligkeit jeder Stufe und leitet den TD daraus ab, wie schnell sie mit der Dicke abfällt. Helligkeit der Lampe und Belichtung spielen keine Rolle; überbelichtete Stufen und Stufen, durch die kein Licht mehr kommt, werden weggelassen, und ein Diagramm zeigt Messwerte und angepasste Kurve.
- Von Hand: die erste Stufe wählen, durch die kein Licht mehr scheint.
- Der gemessene Wert wird beim Filament in der Bibliothek eingetragen und beim selben Filament im aktuellen Stapel und in der Lithophanie.
-->

## 0.27.0 – 2026-11-28

- 3MF export for Bambu Studio / OrcaSlicer with AMS: the file is now a complete project. The slicer opens it with your printer and process, the colours of the stack on the filament slots, the first layer and layer height, 100% infill and a filament change at every colour change, so the AMS swaps on its own and nothing has to be typed in from the colour change list.
- For this Chromalith needs a project saved once in your own slicer as a template (menu "⋯ → Slicer and AMS …"; the dialog explains the steps). Printer, process and the material of each slot come from this template and are remembered for all projects.
- Correction: the 3MF files of earlier versions arrived in current Bambu Studio and OrcaSlicer versions without colour changes. These slicers take changes only from a complete project and ignore the kind of entry that was written. Without a template the export now says so plainly instead of promising changes.
- AMS slots: every filament in the stack shows its slot. Filaments are assigned in the order they are printed; a filament used twice shares one slot. If the stack needs more different filaments than the AMS has slots, a warning appears in the stack and in the export dialog, and the file then contains no filament changes.
- "Suggest filaments" starts with the number of AMS slots and does not go beyond it.
- Without an AMS: "Pause, change by hand" writes a pause before each change.
- PrusaSlicer can be chosen as target: plain 3MF with the colour changes (M600) on the layer slider.
- The flush volumes in the project are an estimate based on the colours (more when changing to a lighter colour); the slicer can recalculate them.

<!-- de
- 3MF-Export für Bambu Studio / OrcaSlicer mit AMS: Die Datei ist jetzt ein vollständiges Projekt. Der Slicer öffnet sie mit deinem Drucker und Prozess, den Farben des Stapels auf den Filament-Plätzen, erster Schicht und Schichthöhe, 100 % Füllung und einem Filamentwechsel an jedem Farbwechsel. Das AMS wechselt von selbst, und aus der Farbwechsel-Liste muss nichts mehr abgetippt werden.
- Dafür braucht Chromalith einmal ein in deinem Slicer gespeichertes Projekt als Vorlage (Menü „⋯ → Slicer und AMS …“; der Dialog erklärt die Schritte). Drucker, Prozess und das Material der Plätze kommen aus dieser Vorlage und werden für alle Projekte gemerkt.
- Richtigstellung: Die 3MF-Dateien früherer Versionen kamen in aktuellen Versionen von Bambu Studio und OrcaSlicer ohne Farbwechsel an. Diese Slicer übernehmen Wechsel nur aus einem vollständigen Projekt und übergehen die Art von Eintrag, die bisher geschrieben wurde. Ohne Vorlage sagt der Export das jetzt klar, statt Wechsel zu versprechen.
- AMS-Plätze: Jedes Filament im Stapel zeigt seinen Platz. Die Filamente werden in der Reihenfolge vergeben, in der sie gedruckt werden; ein Filament, das zweimal vorkommt, belegt nur einen Platz. Braucht der Stapel mehr verschiedene Filamente, als das AMS Plätze hat, erscheint eine Warnung im Stapel und im Export-Dialog, und die Datei enthält dann keine Filamentwechsel.
- „Filamente vorschlagen“ beginnt mit der Zahl der AMS-Plätze und geht nicht darüber hinaus.
- Ohne AMS: „Pause, Wechsel von Hand“ schreibt vor jedem Wechsel eine Pause.
- PrusaSlicer ist als Ziel wählbar: einfache 3MF mit den Farbwechseln (M600) im Schicht-Regler.
- Die Spülmengen im Projekt sind eine Schätzung aus den Farben (mehr beim Wechsel zu einer helleren Farbe); im Slicer lassen sie sich neu berechnen.
-->

## 0.26.0 – 2026-11-26

- True-colour mode keeps details: colours the stack cannot produce used to land on the same layer, so features that differ mainly in brightness disappeared (for example the sun in the "Sunset" example). Such colours are now placed by their lightness, and the brightest and darkest tones of the image are compressed into the range of the stack instead of being cut off. Colours the stack matches well stay as they were.
- New slider "Detail fidelity" (section "Image", true-colour mode only). 0 gives the previous behaviour.
- Lithophane mode shows only settings that have an effect there: "Shape", "Layers", "Colour islands", the frame and "Height from" are hidden (they had been visible by mistake since 0.23). Motif size and position from the colour relief no longer affect lithophanes, and the step bar has its own labels and hints.
- Colour relief: the brightness method and "Linearise sRGB" are shown only in the brightness modes, where they are used.
- "Suggest filaments" no longer lists a filament whose change would lie above the top layer.

<!-- de
- Der farbtreue Modus behält Details: Farben, die der Stapel nicht hergibt, landeten bisher auf derselben Schicht. Was sich vor allem in der Helligkeit unterscheidet, verschwand dadurch (zum Beispiel die Sonne im Beispiel „Sonnenuntergang“). Solche Farben werden jetzt nach ihrer Helligkeit einsortiert, und die hellsten und dunkelsten Töne des Bildes werden in den Bereich des Stapels gestaucht statt abgeschnitten. Farben, die der Stapel gut trifft, bleiben wie bisher.
- Neuer Regler „Detailtreue“ (Abschnitt „Bild“, nur im farbtreuen Modus). 0 entspricht dem bisherigen Verhalten.
- Die Lithophanie zeigt nur noch Einstellungen, die dort wirken: „Form“, „Schichten“, „Farbinseln“, der Rahmen und „Höhe aus“ sind ausgeblendet (sie waren seit 0.23 versehentlich sichtbar). Motivgröße und Motivlage aus dem Farbrelief wirken nicht mehr auf Lithophanien, und die Schritt-Leiste hat eigene Beschriftungen und Hinweise.
- Farbrelief: Die Helligkeits-Methode und „sRGB linearisieren“ erscheinen nur in den Helligkeits-Modi, in denen sie benutzt werden.
- „Filamente vorschlagen“ führt kein Filament mehr auf, dessen Wechsel über der obersten Schicht läge.
-->

## 0.25.0 – 2026-11-26

- Fine details are kept: the smoothing introduced in 0.22 blurred thin branches, antlers and outlines. "Minimum detail" now only removes what a nozzle cannot print (thin raised needles and ridges) and leaves narrow grooves alone, so fine dark lines stay crisp.
- Calmer reliefs: "Suggest filaments" has a new "Layout" choice. "Automatic" prefers a stack sorted from dark at the bottom to light on top, so the height follows the image brightness and dark details become grooves instead of tall thin walls. It keeps the free order when a sorted stack would match the colours clearly worse. "Best colours: free order" is the previous behaviour.
- The built-in colour examples were recomputed with the automatic layout (11 of 16 are now sorted dark to light; their colours are slightly more muted in places).
- True-colour mode: stray one-point seams at the border between two areas are removed without smoothing the rest of the image.
- "Distribute automatically" in the brightness modes now also takes the image colours into account, not only the brightness.
- 3D view: starts at the true height of the print (1×) instead of 2× exaggeration; the chosen value is remembered, a double-click on the slider returns to 1×.

<!-- de
- Feine Details bleiben erhalten: Die Glättung aus 0.22 hat dünne Äste, Geweihe und Konturen verwischt. „Mindestdetail“ entfernt jetzt nur noch, was eine Düse nicht drucken kann (dünne Spitzen und Grate), und lässt schmale Rillen stehen. Feine dunkle Linien bleiben dadurch scharf.
- Ruhigere Reliefs: „Filamente vorschlagen“ hat die neue Auswahl „Aufbau“. „Automatisch“ bevorzugt einen Stapel von dunkel unten nach hell oben. Die Höhe folgt dann der Bildhelligkeit, und dunkle Details werden zu Rillen statt zu hohen, dünnen Wänden. Wenn ein sortierter Stapel die Farben deutlich schlechter träfe, bleibt es bei der freien Reihenfolge. „Beste Farben: freie Reihenfolge“ ist das bisherige Verhalten.
- Die mitgelieferten Farbbeispiele sind mit dem automatischen Aufbau neu berechnet (11 von 16 liegen jetzt von dunkel nach hell; ihre Farben sind stellenweise etwas gedeckter).
- Farbtreuer Modus: Einzelne Fehlpunkte an der Grenze zwischen zwei Flächen werden entfernt, ohne den Rest des Bildes zu glätten.
- „Automatisch verteilen“ berücksichtigt in den Helligkeits-Modi jetzt auch die Bildfarben, nicht nur die Helligkeit.
- 3D-Ansicht: zeigt zu Beginn die echte Höhe des Drucks (1×) statt doppelt überhöht; der gewählte Wert wird gemerkt, ein Doppelklick auf den Regler stellt 1× wieder ein.
-->

## 0.24.1 – 2026-11-26

- Removed two built-in lithophane examples ("Hands" and "Best friends").

<!-- de
- Zwei mitgelieferte Lithophanie-Beispiele entfernt („Hände“ und „Beste Freunde“).
-->

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
