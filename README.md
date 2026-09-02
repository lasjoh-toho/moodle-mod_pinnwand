# mod_pinnwand – Moodle-Aktivitätsplugin

Mobiltaugliche Aktivität: Foto aufnehmen (Kamera oder Datei) → Trapez/Perspektive
entzerren → zuschneiden → Farbe nachbearbeiten → optionales Zeichenraster
(quadratisch oder feste Anzahl Unterteilungen, wird mit dem Bild gespeichert) →
Ergebnis auf einer frei anordenbaren Leinwand (Galerie mit Klick-Vergrößerung).
Optionale Einwilligungs-Checkbox pro Foto ("Verwendung auf Schulwebseite"),
konfigurierbares Maximum an Bildern pro Lernender/m.

## Installation

1. Diesen Ordner als `pinnwand` nach `<moodle>/mod/` kopieren
   (Ergebnis: `<moodle>/mod/pinnwand/version.php` etc.).
2. Als Admin einloggen → Website-Administration → Benachrichtigungen,
   Installation bestätigen (legt die Tabellen `pinnwand`, `pinnwand_photos`,
   `pinnwand_threads` und `pinnwand_thread_items` an).
3. Aktivität "Pinnwand" ist danach in jedem Kurs hinzufügbar.

## Technische Hinweise

- **Layout**: `view.php` unterscheidet zwei Fälle - im Kurs-Bearbeiten-Modus
  ein normaler Moodle-View (`incourse`, mit Zugriff auf die
  Aktivitätseinstellungen), sonst direkt die eigenständige Vollbild-App
  (`embedded`, `styles.css` + `js/app.js`), damit die Bedienung auf dem
  Smartphone nicht durch Navigation/Blöcke gestört wird.
- **Kein Build-Schritt**: `js/app.js` ist bewusst als einfaches, direkt
  eingebundenes Skript geschrieben (kein AMD/RequireJS), das über Moodles
  Standard-AJAX-Endpunkt (`lib/ajax/service.php`) mit den in
  `classes/external.php` definierten Web-Services kommuniziert.
- **Perspektivkorrektur**: projektive Entzerrung (Heckbert-Methode, Abbildung
  Einheitsquadrat → Viereck, pixelweise mit bilinearer Interpolation). Läuft
  vollständig im Browser über `<canvas>`.
- **Speicherung**: Bilder werden serverseitig aus dem vom Client gerenderten
  Canvas (inkl. Zuschnitt, Farbkorrektur und eingebranntem Raster) als JPEG
  über die Moodle File API gespeichert (`mod_pinnwand`/`photo`).
- **Vendor-Bibliothek**: `js/vendor/impress.js` (MIT-lizenziert, unverändert
  von github.com/impress/impress.js übernommen, siehe `thirdpartylibs.xml`)
  für den Präsentationsmodus des Roten Fadens - wird nur bei Bedarf per
  `<script>`-Tag nachgeladen, nicht bei jedem Seitenaufruf.
- **Rechte**: `mod/pinnwand:submit` (Fotos aufnehmen, Faden-Stationen
  hinzufügen), `mod/pinnwand:view`, `mod/pinnwand:viewall` (Lehrkraft-
  Übersicht `manage.php`, Post-Stream, Fotos anderer auf eigenes Board
  übernehmen), `mod/pinnwand:manage`.

## Änderungen in dieser Version

- Fix: verschachtelte Flex-Container hatten kein `min-height:0`, wodurch der
  untere Bildbereich/die Aktionsleiste vom `overflow:hidden` der App
  abgeschnitten werden konnte.
- Raster ist jetzt **kein** fest eingebranntes Merkmal mehr, sondern bleibt
  Metadaten (`gridtype`/`gridvalue`) am Foto. Angezeigt wird es als reines
  CSS-Overlay (in Lightbox und Anordnungs-Leinwand), global ein-/ausschaltbar
  über den "Raster"-Knopf oben rechts. Das gespeicherte Originalbild ist immer
  rasterfrei.
- Neuer Schritt "Angaben" vor dem Speichern: optionale Quellenangaben
  (Autor*in, Jahr, Epoche, Ort, Autor*in der Vorlage) sowie die
  Einwilligungs-Checkbox. Werden in `manage.php` bei der Lehrkraft-Ansicht
  mit angezeigt.
- **DB-Upgrade nötig**: neue Spalten in `pinnwand_photos`. Nach dem
  Einspielen des aktualisierten Plugin-Ordners einmal die
  Admin-Benachrichtigungen (`/admin/index.php`) aufrufen, damit `upgrade.php`
  läuft.

### Weitere Überarbeitung

- Fix: untere Ecken-Greifer bei Entzerren/Zuschneiden wurden vom
  `overflow:hidden` der Bildbühne bzw. dem SVG-Overlay abgeschnitten
  (`overflow: visible` gesetzt, zusätzlicher Rand reserviert).
- Bei Aufnahme und Entzerren gibt es jetzt nur noch eine Leiste oben (die
  App-Kopfzeile) statt zusätzlicher Fortschrittsanzeige; der Hinweistext
  liegt als zentrierte Blase im Bildrahmen statt in einer eigenen Zeile -
  dadurch deutlich mehr Platz fürs Bild.
- Raster ist jetzt **nur noch im Galerie-/Lightbox-Modus** sichtbar (nicht
  mehr auf der Anordnungs-Leinwand).
- Galeriemodus (Lightbox) bietet jetzt mehr Platz sowie Zoom (Mausrad,
  Pinch-Geste, Doppeltipp, +/− Knöpfe) mit Verschieben bei Vergrößerung.
- Neu: eine zusätzliche, exakt auf das Foto gemappte Zeichen-/Schreib-Ebene
  (transparentes PNG, eigene Datei je Foto über die File API). Bearbeitbar
  im Galeriemodus ("Zeichnen"-Knopf, Stift/Radierer/Löschen), zur Anzeige
  aber - anders als das Raster - auch auf der Anordnungs-Leinwand sichtbar.
- Beim Feld "Autor*in" gibt es jetzt eine "ich"-Checkbox, die automatisch
  den eigenen Namen einträgt.

### Dritte Überarbeitung

- Deutlich kompakteres mobiles Layout: keine feste Kopfzeile mehr
  (Überschrift/Zähler/"Raster"-Wort weg) - stattdessen nur ein kleiner
  schwebender ×-Knopf oben links außerhalb der Startseite. Die
  Startseite selbst zeigt nur noch eine schmale Zählzeile.
- Ecken-Greifer bei Entzerren/Zuschneiden haben jetzt eine große
  unsichtbare Trefferfläche (r=26) mit nur einem kleinen sichtbaren Punkt
  (r=5) - leichter zu treffen, verdeckt aber weniger vom Bild.
- Der eigene "Raster"-Schritt in der Aufnahme-Pipeline ist komplett
  entfallen. Das Raster (Typ + Wert) wird jetzt ausschließlich in der
  Galerieansicht (Lightbox) pro Foto festgelegt, über einen Knopf, der ein
  kleines Panel mit Kein/Quadratisch/Fest + Schieberegler öffnet
  (`mod_pinnwand_update_grid`-Endpoint). Dadurch stören Raster-Optionen
  nirgendwo sonst mehr.
- Anordnungs-Leinwand: konfigurierbarer Hintergrund (Farbwähler oder eines
  der eigenen Fotos als Bild), Standard dunkelgrau (#2b2d33), über einen
  Zahnrad-Knopf unten rechts. Pro Nutzer*in/Aktivität gespeichert
  (`mod_pinnwand_save_background`-Endpoint, User-Preference-basiert).

## Zeichenwerkzeug (Ink)

Das Zeichenwerkzeug ist jetzt nach dem Vorbild eures `moodle-mod_bento`-
Ink-Tools (`present.ts`) gebaut: Striche werden **vektoriell** gespeichert
(normalisierte Punkte 0..1, Farbe, Breite relativ zur Canvas-Höhe,
Radierer-Flag) statt als gerastertes PNG. Vorteile wie im Original:

- Verlustfreie Neudarstellung bei jeder Anzeigegröße (Galerie-Zoom,
  Anordnungs-Leinwand, verschiedene Geräte) - keine Auflösungs-Kompromisse.
- Radierer + Doppelklick auf einen Strich löscht ihn komplett (statt nur
  Pixel wegzuradieren), genau wie im Original (`findStrokeAt`/`Co`).
- 6 Farben, 4 Strichstärken, "Löschen" für die ganze Ebene.
- Anders als das Raster auch auf der Anordnungs-Leinwand sichtbar (nicht
  editierbar dort, aber live aus denselben Strichdaten gerendert).

Nicht übernommen (bewusst außen vor gelassen, um den Umfang zu begrenzen):
die verschiebbaren Text-Chips/Labels (`dragTerms`, Hand-Werkzeug,
"Begriffe speichern") sowie der separate Text-Modus - Schreiben per Hand
geht über den Stift. Bei Bedarf portiere ich das noch nach.

### Vierte Überarbeitung

- Neues Feld "Titel" bei den Quellenangaben (`sourcetitle`).
- Anordnungs-Leinwand: Knopf "Daten anzeigen" blendet pro Foto eine
  Bildunterschrift ein (Hochgeladen-Datum, Titel, Jahr, Ort).
- Neue **Klassenansicht** (in der App selbst, nicht nur `manage.php`):
  erreichbar über einen Knopf auf der Startseite für alle mit
  "Alle Einreichungen ansehen"-Recht. Zeigt alle Fotos gruppiert und
  untereinander pro Lernender/m. Löschen fremder Fotos ist dort nur mit
  dem stärkeren `manage`-Recht möglich (typischerweise editierende
  Lehrkraft/Managerin) - alle anderen können weiterhin nur ihre eigenen
  Fotos löschen (`mod_pinnwand_delete_photo` prüft das serverseitig).
- **Getrennte Admin-Obergrenzen** (`settings.php`, Website-Administration →
  Plugins → Aktivitäten → Pinnwand): eine Obergrenze für Lernende
  (wirkt zusätzlich zur Aktivitätseinstellung, kleinerer Wert gewinnt) und
  eine eigenständige Obergrenze für Lehrkräfte (unabhängig von der
  Lernenden-Einstellung; Lehrkräfte haben jetzt ebenfalls `submit`-Recht,
  um selbst Beispielfotos aufnehmen zu können).
- Hintergrund der Anordnungs-Leinwand kann jetzt zusätzlich als **externe
  Bild-URL** gesetzt werden (neben Farbe und eigenem Foto).

### Fünfte Überarbeitung

- Neues DB-Feld `gridcolor`: Rasterfarbe ist jetzt frei wählbar (Farbwähler
  im Rasterpanel der Galerie), Standard `#ff3c3c`.
- Neue Backend-Funktion `update_source`: Quellenangaben (Titel, Autor*in,
  Jahr, Epoche, Ort, Autor*in der Vorlage) lassen sich nachträglich
  bearbeiten - für eigene Fotos immer, für fremde Fotos nur mit
  `manage`-Recht. Direkt editierbar sowohl über den neuen "Daten"-Knopf in
  der Galerie (Lightbox) als auch inline in der Klassenansicht.
- Klassenansicht: **Sortieroptionen** (Lernender/gruppiert, Entstehungsjahr,
  Datum Upload) über Segment-Buttons oben.
- Die "Daten anzeigen"-Bildunterschrift auf der Anordnungs-Leinwand zeigt
  jetzt Titel/Autor*in/Jahr/Epoche/Ort statt eines Upload-Datums.
- Hintergrund der Anordnungs-Leinwand: zusätzlich **Bild-Upload** möglich
  (eigene Datei, nicht nur eines der eigenen Fotos oder eine URL).
- **Zeichenwerkzeuge** jetzt als senkrechte Dock-Leiste am linken Rand,
  ein-/ausgeblendet über einen dedizierten Stylus-Knopf unten links (statt
  eines Textbuttons oben).
- Galerie hat jetzt drei gleichrangige Konfigurations-Knöpfe oben:
  **Raster**, **Daten** - dazu den Stylus-Knopf für **Zeichnen** unten
  links.
- Die "ich"-Kurzwahl beim Autor*in-Feld ist ab 600px Bildschirmbreite
  deutlich auffälliger gestaltet (Pille statt kleiner Checkbox).
- **Anordnungs-Leinwand ausblendbar**: Lehrkräfte können sie über die
  Klassenansicht instanzweit für alle deaktivieren (hat Vorrang); jede
  Person kann sie zusätzlich nur für sich selbst ausblenden
  (`set_canvas_enabled`/`set_own_canvas_hidden`-Endpunkte, neues DB-Feld
  `canvasenabled` auf der Aktivität).

### Sechste Überarbeitung (Korrektur + neue Funktionen)

**Korrektur eines Missverständnisses:** Die instanzweite/persönliche
Ausblende-Funktion aus der letzten Runde (komplette Pinnwand aus-/
einblenden) war falsch verstanden und wurde **komplett entfernt**
(`canvasenabled`-Feld, `set_canvas_enabled`/`set_own_canvas_hidden`-
Endpunkte). Das leere `canvasenabled`-Datenbankfeld bleibt aus einer
frühen Migration ungenutzt zurück (unschädlich, aber ohne Funktion).

Stattdessen jetzt korrekt umgesetzt:

- **Einzelne Fotos** lassen sich von der Pinnwand aus-/einblenden (neues
  Feld `hiddenfromboard` pro Foto, Endpunkt `set_photo_hidden`) - per
  Pin-Symbol auf den Home-Thumbnails (Lernende, eigene Fotos) und in der
  Klassenansicht (Lehrkraft, beliebige Fotos).
- **Neue Aktivitätseinstellungen** (eigener Abschnitt "Pinnwand" in den
  Aktivitätseinstellungen): "Neue Bilder werden auf der Pinnwand gezeigt"
  (Standardsichtbarkeit neuer Fotos), "Lernende können senden/entfernen",
  "Lehrkräfte können senden/entfernen" - steuern, wer den Pin-Schalter
  benutzen darf.
- Raster/Daten/Stylus in der Galerie schließen sich jetzt gegenseitig
  (immer nur ein Konfigurationswerkzeug offen).
- **Text-Werkzeug** im Stylus: dritter Element-Typ neben Stift/Radierer,
  platziert editierbaren Text direkt auf dem Foto (als eigenes
  Vektorelement, kein gerastertes Bild).
- Werkzeug-Icons (Stift/Radierer/Text/Löschen) statt Textlabels, Farbwahl
  hat jetzt durchgehend einen sichtbaren Rand (Schwarz war auf dunklem
  Grund unsichtbar).
- Pinnwand: Textleiste unten durch vier schwebende runde Icon-Buttons vor
  der Leinwand ersetzt (Menü/Zurück oben links, Zahnrad/Optionen oben
  rechts, Label/Daten unten links, +/Neues Foto unten rechts).
- Home-Button "Fertig – zur Anordnung" heißt jetzt "Pinnwand".

### Siebte Überarbeitung

- **Bugfix**: hochgeladene Hintergrundbilder wurden nie angezeigt
  (`applyBackground()` kannte den Typ "upload" nicht). Behoben.
- Hintergrund der Pinnwand hat jetzt eine **eigene Ebene** (`.ic-canvas-bg`),
  getrennt von den Foto-Pins, damit ein CSS-Filter (Helligkeit/Sättigung,
  zwei neue Regler im Hintergrund-Panel) nur den Hintergrund abdunkelt/
  entsättigt, nicht die Fotos selbst - die Pins bleiben so immer klar
  erkennbar.
- Pinnwand: kein separater X-Button mehr (der Menü-Knopf übernimmt das),
  alle vier Icon-Buttons (Menü/Zahnrad/Label/+) jetzt in einer Reihe statt
  vier Ecken.
- Startseite: "Foto aufnehmen"/"Pinnwand"/"Klassenansicht" jetzt in einer
  Zeile statt gestapelt.
- Galerie: Raster- und Daten-Knopf sind jetzt Icons (Raster-Symbol,
  Info-i), übereinander am linken Rand statt Textbuttons oben.
- Klassenansicht: neue Checkbox "Lernende/r ist Autor*in" (füllt das
  Autor*in-Feld automatisch mit dem Namen der/des Lernenden) sowie das
  bisher fehlende Feld "Autor*in der Vorlage".
- Stift-/Text-Werkzeug und die Größen-Punkte im Zeichenwerkzeug übernehmen
  jetzt sichtbar die gerade gewählte Farbe.

### Zurückgestellt (noch nicht umgesetzt)

Aus Aufwandsgründen bewusst noch offen - gerne als nächsten Schritt:

- "Neu"-Button mit Auswahl Aufnehmen/Upload/URL, dabei Bildbearbeitung
  (Entzerren/Zuschneiden/Farbe) standardmäßig nur bei Kamera-Aufnahme,
  bei Upload/URL optional überspringbar.
- Dieselben Werkzeuge (Raster/Zeichnen) wie in der Galerie auch auf der
  Pinnwand nutzbar, plus ein neues "Text mit Hintergrund"-Werkzeug
  (Label-Icon).
- Gruppieren/Verknüpfen von Fotos auf der Pinnwand.

### Achte Überarbeitung

- Klassenansicht: jetzt genau **zwei Zeilen** pro Foto statt drei - Titel
  und Autor*in in einer Zeile mit gleicher Höhe, Jahr und Ort deutlich
  schmaler als Epoche/Autor*in der Vorlage in der zweiten Zeile.
- Thumbnails in der Klassenansicht sind ab 900px Bildschirmbreite größer
  (110×110 statt 64×64px).
- Hauptmenü auf der Startseite: Icons statt Textlabels (Kamera/Pin/Gruppe).
- Beim Hinzufügen eines Fotos gibt es jetzt einen dritten Weg neben
  Aufnehmen/Hochladen: **eine Bild-URL eingeben** - das Bild wird geladen
  und durchläuft dieselbe Bearbeitungs-Pipeline wie ein aufgenommenes
  Foto. Hinweis: Bilder von Servern ohne passende CORS-Freigabe
  (`Access-Control-Allow-Origin`) lassen sich zwar anzeigen, aber beim
  Weiterverarbeiten (Zuschneiden/Speichern) blockiert der Browser den
  Zugriff auf die Pixel-Daten ("tainted canvas") - das betrifft z. B. die
  meisten Google-Bildersuche-Ergebnisse, funktioniert aber z. B. bei
  Wikimedia Commons.

### Neunte Überarbeitung

- Klassenansicht: **zwei zusätzliche 3-Zustands-Filter** ("Eigene":
  eigene/andere/aus, "Pinnwand": auf Pinnwand/nicht auf Pinnwand/aus),
  unabhängig von der Sortierung. Sortier-Buttons kehren bei erneutem Klick
  die Reihenfolge um (↑/↓-Anzeige). Pinnwand-Sichtbarkeit jetzt als
  Checkbox statt Icon-Button. Epoche schmaler, Ort breiter.
- Zuschneide-Schritt: neue Werkzeuge **"Ganzes Bild verwenden"** (überspringt
  den Zuschnitt) und **"90° drehen"**.
- Farbauswahl/Größen-Punkte im Zeichenwerkzeug haben jetzt durchgehend
  einen Rand, damit Schwarz auf dunklem Grund sichtbar bleibt.
- Pinnwand-Hintergrund: die gewählte Farbe scheint jetzt immer als Basis
  durch (auch bei Bild-Hintergrund), falls das Bild transparent ist oder
  den Bereich nicht ganz ausfüllt.
- **Freies Rotieren der Pins** auf der Pinnwand über einen neuen
  Dreh-Griff oberhalb jedes Fotos.
- Neuer Schalter **"Overlay in der Pinnwand anzeigen"** (Pin-Icon) in der
  Zeichenwerkzeugleiste der Galerie - steuert pro Foto, ob die eigene
  Zeichen-/Schreib-Ebene zusätzlich zur Galerie auch auf der Pinnwand
  sichtbar ist (neues Feld `annotationonboard`).

### Zehnte Überarbeitung (Bugfixes + weitere Punkte)

- **Zwei kritische Bugfixes**: Beim Wechsel zum nächsten/vorherigen Foto in
  der Galerie sowie beim Schließen der Galerie (X-Button) wurde eine gerade
  gezeichnete Anmerkung bisher verworfen statt gespeichert
  (`exitDrawing(false)` statt `exitDrawing(true)`, bzw. der Schließen-Button
  rief `exitDrawing()` überhaupt nicht auf). Das erklärt vermutlich
  vollständig, warum Zeichnungen weder gespeichert wurden noch auf der
  Pinnwand erschienen - beides jetzt behoben.
- Lightbox-Bildgröße: robuste JS-Messung der verfügbaren Fläche statt fixer
  vw/vh-Werte, damit das Bild je nach Seitenverhältnis Breite oder Höhe
  wirklich zu 100% ausnutzt, ohne das Raster-Overlay zu verschieben.
- Home-Bildschirm: Zählzeile entfernt, feste Icon-Zeile (Zurück zum Kurs,
  Hinzufügen, Meine Bilder, Pinnwand, ggf. Klassenansicht).
- Neuer Scheren-Knopf in der Galerie: schickt ein bereits gespeichertes Foto
  zurück in die Bearbeitungs-Pipeline (Entzerren/Zuschneiden/Farbe) und
  überschreibt es anschließend, statt ein neues Foto anzulegen
  (`mod_pinnwand_update_photo`-Endpunkt - war teils schon vorbereitet).
- Klassenansicht: Sortierung und beide Filter sowie der Zurück-Knopf sind
  jetzt in einer einzigen, fixen Werkzeugleiste über der Liste
  zusammengefasst - mit den Icons Figur (Lernender), Kalender
  (Entstehungsjahr), Upload-Pfeil (Datum Upload), Pinsel (Eigene) und Pin
  (Pinnwand). Auf schmalen Bildschirmen nur Icons, ab 700px zusätzlich
  Textlabel.

### Weiterhin zurückgestellt

- Galerie-Dateneingabe im gleichen kompakten Stil wie die Klassenansicht.
- Gruppieren/Verknüpfen von Fotos auf der Pinnwand (über den Roten Faden
  hinaus).

### Elfte Überarbeitung — Pinnwand-Redesign (Phasen 0–7)

Umfangreichste Überarbeitung bisher, siehe `IMPLEMENTATION_PLAN.md` für alle
Details und Scoping-Entscheidungen. In Kurzform:

- **Lizenz** ergänzt (nicht frei für kommerzielle Nutzung), Umbenennung
  "Bildaufnahme" → "Pinnwand" abgeschlossen, Backup/Restore-Grundgerüst
  nachgerüstet (fehlte bisher komplett trotz `FEATURE_BACKUP_MOODLE2`).
- **App-Shell**: persistente Kopfzeile (Titel/Ansicht mittig, 4
  Navigations-Buttons rechts, Zurück/Vollbild links), responsive
  Einstiegslogik (Bearbeiten-Modus → Moodle-View, sonst App-Vollbild).
- **Pinnwand-Canvas**: optionales Hand-Werkzeug + Zoom-Slider, Handles nur
  bei Hover/Klick, Pin/Unpin-Icon pro Foto, Zeichnen direkt auf dem Board,
  Mehrfach-Boards pro Person.
- **Roter Faden**: geordnete Foto-/Rahmen-Sequenz pro Person (Lehrkraft
  immer, Lernende optional), Drag-Reorder-Panel, `impress.js`-Präsentation.
- **Post-Stream**: gestapelte Karten mit neuen Einreichungen anderer
  Lernender für die Lehrkraft, per Drag als Kopie aufs eigene Board.
- **Klassenansicht**: Löschen/Pinnwand-Checkbox direkt neben dem Thumbnail
  gruppiert.
- **Editor**: Bild füllt immer eine Richtung zu 100 % (auch kleine Bilder),
  Zuschneide-/Perspektiv-Rahmen bleibt bei Größenänderungen exakt am Bild,
  Pfeil/Haken-Buttons statt Textlabels, neues Wortfeld-Werkzeug
  (Textrahmen mit Presets/Palette/Schriftarten/Auto-Fit), Rückseiten-
  Beschriftung (Doppelklick zum Umblättern).
- **Galerie**: Zeichenebene bleibt bei Fenster-Resize während des Zeichnens
  exakt am Bild (war zuvor nicht der Fall), Farbfelder per Doppelklick neu
  definierbar (nur für das aktuelle Foto).
- Nebenbei gefundene Regressions-Bugfixes: `boardid` fehlte in mehreren
  Speicher-/Aktualisierungs-Aufrufen und wurde dadurch stillschweigend auf
  0 zurückgesetzt.

### Zwölfte Überarbeitung — Feedback aus erstem Test

- **Bugfix**: Neu gespeicherte Fotos erschienen teils erst nach einem
  Reload in "Meine Bilder" - Ursache war lokal unvollständig
  zusammengebautes Foto-Objekt nach dem Speichern (fehlende neuere Felder
  wie `boardid`/`backphotoid`/`showingback`). Alle vier Speicherpfade
  (Kamera-Pipeline, Wortfeld, Post-Stream-Übernahme, Foto-Neubearbeitung)
  laden jetzt nach dem Speichern den vollständigen Datensatz neu
  (`refreshPhotos()`) statt ihn lokal nachzubauen.
- **Bugfix Zuschnitt-Schritt**: Werkzeug-/Aktionsleiste wurden bisher erst
  *nach* der Bildgrößen-Messung ins DOM gehängt, wodurch die Messung von
  zu viel verfügbarem Platz ausging und das Bild im zweiten Schritt
  (Zuschnitt) nicht mehr vollständig ins Bild passte. Jetzt korrekte
  Reihenfolge.
- Home ("Meine Bilder"): deutlich sichtbarer +-Button unten rechts.
- Klassenansicht: "Ich bin Autor"-Checkbox ohne Textlabel.
- Pinnwand: Einstellungen-Zahnrad auf sehr kleinen Smartphones ausgeblendet
  (erst ab Tablet-Breite, 600px, sichtbar); Panel selbst begrenzt auf großen
  Bildschirmen nicht mehr die volle Breite, schließt bei Klick außerhalb,
  neue Einstellung "Weicher Rand" (Vignette), Hintergrundbild jetzt auch
  aus den Uploads der Klasse wählbar (mit Berechtigungsprüfung).
- Hinzufügen-Assistent: Kamera-Berechtigung wird erst beim Klick auf den
  Kamera-Button angefragt (nicht mehr automatisch beim Öffnen des
  Auswahl-Bildschirms); neuer Auswahl-Bildschirm mit breiten, untereinander
  angeordneten Buttons (Kamera/Hochladen/URL/Textrahmen); durchgängig
  kleiner Abbrechen-Button (✕) statt breitem "Zurück"-Text - Speichern
  läuft ausschließlich über den Haken-Button am letzten Schritt.
- Zieh-Handles (Ecken/Zuschnitt): Trefferfläche auf ca. 2 cm Durchmesser
  vergrößert, sichtbarer Punkt bleibt klein, damit der Finger die Ecke
  nicht verdeckt.
- Galerie: Schließen-Button deutlich sichtbarer gestaltet (war zuvor ein
  fast unsichtbarer "Ghost"-Button); neuer Fokus-Modus blendet Nav-Leiste,
  Bildunterschrift und linkes Werkzeug-Dock aus, sobald ein Raster
  angezeigt wird, das Zeichenwerkzeug aktiv ist oder ein Panel (Raster/
  Daten/Rückseite) offen ist - nur der Schließen-Button bleibt immer
  sichtbar, der Bildbereich wird dadurch maximal groß.

### Dreizehnte Überarbeitung — Post-Stream als Warteraum, Roter Faden auf dem Board

- **Architekturänderung**: Fotos landen beim Pinnen nicht mehr direkt auf
  der Leinwand, sondern zunächst im Post-Stream (neues Feld `boardplaced`)
  - von dort per Drag oder PIN-Icon auf das Board übernehmen. Der
  Post-Stream ist jetzt für alle da (vorher nur Lehrkraft): eigener
  Warteraum für noch nicht platzierte Fotos, für die Lehrkraft zusätzlich
  weiterhin fremde Einreichungen.
- **Bugfix**: Pin/Unpin lud den Post-Stream nicht neu, wodurch frisch
  gepinnte Fotos teils erst nach Reload sichtbar wurden.
- **Bugfix**: Kopieren eines fremden Post-Stream-Fotos übernahm
  versehentlich dessen Rückseiten-Verknüpfung (zeigte auf ein fremdes,
  nicht zugängliches Foto).
- **Roter Faden auf dem Board**: rote Umrandung für enthaltene Fotos,
  sichtbare Leerrahmen, Verbindungslinie zwischen aufeinanderfolgenden
  Stationen, Präsentations-Start-Button jetzt oberhalb der Liste.
- Bestandsfotos bleiben nach dem Update unverändert sichtbar
  (Migrationslogik markiert sie als bereits platziert).

### Vierzehnte Überarbeitung — Rahmen verschiebbar, Präsentations-Zoom-Fix, Layer-Panel

- Rote Rahmen jetzt direkt auf dem Board verschieb- und skalierbar.
- **Bugfix Präsentation**: Kamera-Zoom war unabhängig von der Fenstergröße
  berechnet und wirkte dadurch "verkehrt herum" - jetzt korrekt als
  Verhältnis Fenstergröße zu Rahmengröße (Rahmen bleibt vollständig
  sichtbar und füllt den Bildschirm in einer Richtung ganz aus, wie in der
  offiziellen impress.js-Demo).
- Präsentation zeigt jetzt den ganzen Board-Inhalt (Hintergrund + alle
  platzierten Fotos) durchgehend; nur Fotos, die den aktuellen Rahmen vom
  Z-Level her überlappend verdecken würden, werden ausgeblendet.
- Neues Schichtung-Panel (Z-Reihenfolge der Fotos, per Drag umsortierbar).
- Neue Einstellungen `studentpoststream`/`studentlayers` (wer darf was).
- Seitenleisten-Buttons (Faden/Post-Stream/Layer) jetzt unten rechts statt
  in der unteren Fab-Leiste.

### Fünfzehnte Überarbeitung — impress.js-Root-Bugfix, Wortfeld-Texteingabe-Bugfix

- **Kern-Bugfix impress.js**: `#pinnwand-impress` hatte eigenes CSS
  (`inset: 0`), das mit den von impress.js selbst gesetzten Inline-Styles
  (`top:50%;left:50%`) kollidierte und die Präsentations-Wurzel auf ein
  Viertel der Fläche zusammenquetschte - Ursache für "funktioniert nicht",
  "verkehrt herum" und "zu schwach gezoomt" zugleich. Behoben.
- Sidebar-Buttons (Faden/Post-Stream/Layer) jetzt nebeneinander statt
  untereinander, über den Panels statt dahinter.
- Roter Faden rendert jetzt live neu, wenn ein enthaltenes Foto oder ein
  Leerrahmen verschoben/skaliert wird.
- **Kern-Bugfix Wortfeld-Texteingabe**: Anklicken eines Textobjekts löste
  bisher einen vollen Re-Render aus, der den gerade gesetzten Fokus sofort
  wieder zerstörte - Texteingabe war dadurch praktisch unmöglich. Behoben.
- Hauptrahmen des Wortfelds jetzt per Eck-Handle skalierbar, Textobjekte
  zusätzlich per eigenem Handle in der Schriftgröße skalierbar.

### Sechzehnte Überarbeitung — Wortfeld als SVG, impress.js entfernt, Klassenansicht-Bugfix

- **Wortfeld ist jetzt SVG statt PNG**: bleibt editierbarer Text (scharf bei
  jeder Größe, kleinere Datei); Bearbeiten öffnet dadurch wieder den
  Wortfeld-Editor statt des Bild-Editors.
- **Kern-Bugfix Klassenansicht**: `querySelector('span')` traf ungewollt
  das Icon-Span statt das Label-Span - Ursache für "Icons fehlen, Name
  erscheint zweimal". Behoben.
- **Präsentation ohne impress.js neu gebaut** (eigene, direkt nachprüfbare
  CSS-Transform-Kamera) - Hintergrund bleibt jetzt bildschirmfüllend,
  Klick auf ein Foto/Textrahmen direkt in der Präsentation hängt es an den
  Faden an.
- Faden-Panel: neue Liste aller Board-Objekte mit Zuschalt-Checkbox + Filter.
- Große Bildschirme starten jetzt für alle Rollen im Pinnwand-Modus.
- Sidebar-Buttons nebeneinander statt untereinander.

### Siebzehnte Überarbeitung — Faden-Kurve, Hintergrund-Bewegung, Wortfeld-UX, Assistent-Umbau

- **Bugfix Faden-Linie**: fehlendes `viewBox` am SVG führte dazu, dass die
  Linie nur in einem Teilbereich (links, senkrecht) sichtbar war - jetzt
  fest auf die Canvas-Größe fixiert; zusätzlich als sanfte Kurve statt
  gerader Strecke gerendert.
- Leerrahmen jetzt drehbar, in der Präsentation unsichtbar (dienen nur als
  Zoom-Ziel, z. B. um auf Hintergrund-Details hinzuweisen).
- Neue Checkbox "Hintergrund bewegt sich beim Zoom mit" im Faden-Panel.
- **Wortfeld-Editor**: erstes Textobjekt füllt jetzt den ganzen Rahmen,
  bricht automatisch um, passt die Schriftgröße live an und wird beim
  Öffnen sofort fokussiert (Cursor direkt sichtbar).
- **Hinzufügen-Assistent umgebaut**: Zuschnitt-Handles im zweiten Schritt
  entfallen (Eckpunkte im ersten Schritt erledigen Zuschnitt +
  Perspektivkorrektur bereits gemeinsam) - zweiter Schritt zeigt nur noch
  Drehen/Spiegeln-Buttons. "Weiter"/"Speichern" ist jetzt ein schwebender
  Button unten rechts im Bild, außer im Schritt mit den Eckpunkt-Handles.

### Achtzehnte Überarbeitung — Präsentations-Kamera, Faden-Politur, Wortfeld-Formatierung

- Bugfix: "Bild hinzufügen" öffnete durch das `capture`-Attribut ebenfalls
  die Kamera statt der Fotomediathek.
- Lehrkraft-Faden ist jetzt immer echtes Rot statt einer zufälligen
  Palettenfarbe.
- Faden-Objektliste vereinfacht (kein Filter/Titel mehr), Hintergrund-
  Checkbox davor verschoben.
- Faden-Linie als durchgehende, an den Bild-Wegpunkten abgerundete
  Catmull-Rom-Kurve.
- Präsentations-Kamera: Zoom-in-Effekt beim Start, "Sprung"-Übergang
  zwischen weit entfernten Stationen (Höhe/Dauer wachsen mit der
  Entfernung).
- Assistent-Navigation umgebaut: kreisrunde Zurück-/Weiter-Pfeile bei
  30 %/60 % am unteren Bildrand statt Aktionsleiste.
- **Wortfeld-Editor**: Rich-Text-Formatierung (Fett/Kursiv/Unterstrichen/
  Durchgestrichen/Aufzählung), Zeilenabstand- und Laufweite-Regler,
  Schriftarten werden jetzt direkt als Base64-Daten-URI ins SVG
  eingebettet (bleiben dadurch auch beim Anzeigen als Bild erhalten).

### Neunzehnte Überarbeitung — Rahmen-Schichtung, echte Flugbahn-Animation, Faden-Stil

- Bugfix: Rahmen-Resize-Handle hatte keine eigene Geometrie im CSS und war
  dadurch faktisch unsichtbar/unklickbar.
- Rahmen jetzt auch in der Schichtung (Layer-Panel) verschiebbar, gemeinsam
  mit Fotos in einer Liste.
- Rahmenfarbe/-dicke und Verbindungslinie folgen jetzt dem Faden statt
  hartcodierter Werte.
- **Kamera-Animation komplett neu**: eine einzige durchgehende Animation
  statt zweier verketteter Übergänge mit spürbarer Pause - schwungvoller
  Start, sanfte Landung, Bogenhöhe wächst mit der Entfernung (kurze Wege =
  elastisches Gleiten, weite Wege = echter parabelartiger Sprung).
- Kamera dreht sich mit, wenn die aktuelle Station ein gedrehter Rahmen ist.
- Neuer Stationstyp "Überblick einfügen" - Halte-/Pausenpunkt, der zur
  ganzen Board-Übersicht fliegt.
- Farbwähler + Dicke-Regler für den Faden unten im Panel; Start-Button in
  Fadenfarbe.
- Bugfix: `bgmoves`/`linewidth` gingen beim Hinzufügen neuer Faden-
  Stationen versehentlich verloren.

### Zwanzigste Überarbeitung — Hintergrund-Koordinatensystem-Fix, Faden-Linie als Canvas2D, Objekt-Auswahl

- **Kern-Fix**: Hintergrund war viewport-relativ positioniert statt fest
  auf die 1000x1400-Koordinatenfläche - dadurch erschien er in Pinnwand
  und Präsentation in unterschiedlichem Maßstab, Rahmen zeigten dadurch
  nicht mehr auf dieselbe Bildstelle. Jetzt fest 1000x1400, echter Teil
  desselben Koordinatensystems wie Fotos/Rahmen.
- Faden-Linie von SVG auf Canvas2D umgestellt (unmissverständliche
  Pixel-Dimensionen, keine viewBox-Mehrdeutigkeit mehr möglich).
- Leerrahmen jetzt auch im Schichtung-Tab sichtbar/verschiebbar.
- Neue geräteübergreifende Objekt-Auswahl: Klick auf eine Zeile im
  Schichtung- oder Faden-Panel hebt das Objekt auf dem Board und in allen
  offenen Leisten hervor.
- Fadenfarbe/-dicke speichert jetzt zusätzlich bei "input" als Absicherung
  gegen unzuverlässiges "change" bei `input[type=color]`.
- Kürzere Beschriftungen ("Hintergrund relativ", "+ Rahmen", "+ Überblick").

### Einundzwanzigste Überarbeitung — Hintergrund-Regression behoben, Occlusion-Bugfix, Rahmen umbenennbar

- **Regression aus der vorigen Überarbeitung behoben**: das Hintergrundbild
  war auf breiten Bildschirmen links abgeschnitten. Neue Struktur: äußere
  bildschirmfüllende Tapete + inneres, fest 1000x1400 großes Bild-Element -
  beides gleichzeitig.
- **Bugfix Präsentation**: Rahmen blendeten beim Zoomen fälschlich Fotos
  dahinter aus (fehlende Z-Eigenschaft) - Rahmen blenden jetzt nie mehr
  etwas aus.
- Weicher Rand entfernt.
- Bugfix Farbwähler: native Farbfelder füllten ihre Box nicht vollständig
  aus (nur ein schmaler Streifen sichtbar) - behoben.
- Settings-Panel jetzt über der Button-Reihe zentriert.
- Auswahl-Hervorhebung jetzt auch in der Objekt-Liste.
- Rahmen direkt in der Schichtung-/Faden-Liste umbenennbar.

### Zweiundzwanzigste Überarbeitung — Hintergrund-Anpassung, Präsentations-Politur, Stylus

- Neue Abschneiden/Füllen-Wahl für den Hintergrund (ersetzt den "weichen
  Rand" vollständig).
- Größere Farbwähler-Buttons.
- Post-Stream öffnet sich automatisch, wenn es Einreichungen gibt.
- Letzter Slide + "Weiter" fliegt zur Übersicht und verlässt die
  Präsentation danach automatisch.
- Doppelklick im Layer-/Faden-Modus öffnet die Präsentation direkt an der
  jeweiligen Station; einfacher Klick markiert.
- Neue Instanzeinstellung für die Transparenz der Seitenleisten.
- **Neues Stylus-Werkzeug**: Freihand-Anmerkungen direkt auf dem
  Hintergrund, exakt auf dessen Koordinatensystem gemappt, eigener Button
  unten links mit Farbe/Radierer/Dicke.

### Dreiundzwanzigste Überarbeitung — echte Ursache des Hintergrund-Bugs gefunden

- **Kern-Bug endlich gefunden**: die Hintergrund-Tapete lag als Kind der
  gezoomten Board-Ebene und wurde bei jedem Zoom ≠ 1 (Normalfall)
  mitskaliert - dadurch füllte sie nur einen Teil des Fensters. Jetzt eine
  eigenständige, unskalierte Ebene außerhalb der Zoom-Transformation.
- **Bugfix gefunden**: neu aus dem Post-Stream platzierte Fotos landeten
  bei der "Mitte"-Berechnung teils hinter der Post-Stream-Leiste selbst
  (unklickbar, bis sie geschlossen wurde) - behoben.

### Vierundzwanzigste Überarbeitung — Board-Auto-Einpassung, Stylus über Objekten

- **Tatsächliche Ursache endlich gefunden**: der Board-Zoom startete immer
  bei 1 (kein "an den Bildschirm anpassen") - die hochformatige
  1000x1400-Fläche wirkte dadurch auf breiteren Bildschirmen wie eine
  schmale Insel oben links. Board wird jetzt beim ersten Anzeigen
  automatisch eingepasst und zentriert.
- Stylus-Linien können jetzt über Fotos/Objekte hinweg gemalt werden und
  bleiben dabei sichtbar (hohe Z-Ebene).
- Stylus-Anmerkungen werden jetzt auch in der Präsentation angezeigt.

### Fünfundzwanzigste Überarbeitung — Board auf Querformat, Abschneiden/Füllen steuert Einpassung

- **Board-Koordinatenfläche auf Querformat umgestellt** (1400x1000 statt
  1000x1400 hochkant) - passt zu den meisten tatsächlichen
  Präsentationsbildern/Bildschirmen.
- Die Abschneiden/Füllen-Einstellung des Hintergrunds steuert jetzt auch,
  wie das Board selbst eingepasst wird.
- Gestrichelte Randlinie für noch nicht im Faden enthaltene Objekte in der
  Präsentation entfernt.

### Sechsundzwanzigste Überarbeitung — Hinzufügen-Modal, Text-Umbruch-Bugfix, WordArt

- **Kern-Bugfix**: `display:flex` auf dem primären Textobjekt unterdrückte
  durch das CSS-Flexbox-`min-width:auto`-Verhalten sowohl automatischen
  als auch manuellen Zeilenumbruch komplett - behoben.
- **"Hinzufügen" ist jetzt ein Modal** statt eines seitenweiten Bildschirms.
- **Neu: WordArt** - sechs Stil-Presets (Normal/Umriss/3D/Glow/Chrome/
  Feuer) als reines CSS, mit Live-Vorschau direkt am Button.
- Werkzeuge in drei responsive Blöcke reorganisiert (Vorlagen/Schriften/
  Form-Rand-Schatten-Kontur), Anordnung folgt dem Seitenverhältnis des
  Zettels.
- Bewusst noch nicht umgesetzt: Audio/Video als Board-Objekte (siehe
  Scoping-Hinweis zu Phase 22 im IMPLEMENTATION_PLAN).

### Siebenundzwanzigste Überarbeitung — Plus-Button-Bugfix, Zoom + schmale Scrollbalken

- **Kern-Bugfix**: das Hinzufügen-Modal hing außerhalb des Bereichs, in
  dem die App ihre CSS-Variablen definiert - dadurch praktisch unsichtbar/
  unbedienbar. Behoben.
- Zoom-Buttons (+/-) und Mausrad-Zoom für die Pinnwand ergänzt, jetzt
  immer verfügbar (nicht mehr nur bei aktivierter Verschiebbarkeit).
- Schmale Scrollbalken app-weit.

### Achtundzwanzigste Überarbeitung — Galerie-Feinschliff, Pin-Symbolik, Board-Titel, Board-Klonen

- **Kern-Bugfix**: der Raster-Button verschwand nach dem Setzen eines
  Rasters dauerhaft mit - jetzt zusätzlicher, immer erreichbarer
  Raster-Button oben links.
- Pin- und Löschen-Button weiter in die Ecken; gepinnte Fotos werden
  visuell leicht angehoben (Pin-Metapher).
- Einheitliches Thumbtack-Symbol überall (auch als Pinnwand-Icon in der
  Hauptmenüleiste).
- Bugfix: Kamera-Eintrag in der Hauptmenüleiste öffnet jetzt konsistent
  das Hinzufügen-Modal.
- **Board-Titel/-Umschalter in die Kopfzeile verschmolzen**, per Klick
  bearbeitbar; Standardtitel ist jetzt der Aktivitätsname statt "Board 1".
- **Neu: Board klonen** - eigene Kopie der Pinnwand (für Lehrkraft immer,
  für Lernende per neuer Einstellung).

### Neunundzwanzigste Überarbeitung — Backup/Restore vervollständigt, Zoom-Lupe, universelles Verschieben

- **Backup/Restore vervollständigt**: fehlende Instanzeinstellungen und
  die beiden neueren Tabellen (Stylus-Anmerkungen, Board-Titel) sind jetzt
  vollständig eingebunden.
- Zoom-Button-Gruppe durch eine Lupe mit Mini-Popup ersetzt (Regler +
  Plus/Minus, die auch über den Regler-Bereich hinaus wirken).
- Verschieben auf leerer Fläche jetzt immer möglich, nicht mehr an eine
  Einstellung/ein Werkzeug gebunden.
- Pinch-Zoom für Touch-Geräte ergänzt (Pinnwand + Präsentation).
- Zoomen/Verschieben jetzt auch während der Präsentation möglich - der
  nächste Schritt setzt von der angepassten Ansicht aus normal fort.

### Dreißigste Überarbeitung — Mehrfachauswahl per Auswahlbox

- **Neu: Auswahlbox** - langes Drücken auf leerer Fläche spannt eine Box
  auf, alle Objekte darin werden ausgewählt.
- Strg+Klick fügt einzelne Objekte hinzu/entfernt sie.
- Ausgewählte Objekte lassen sich gemeinsam verschieben.
- Plus-Button an der Auswahl-Umrandung aktiviert einen Hinzufügen/
  Entfernen-Modus (danach angetippte Objekte werden hinzugefügt/entfernt).
- Nur auf der Pinnwand/im Layersystem, nicht in der Präsentation.

### Einunddreißigste Überarbeitung — Plus-Button überarbeitet

- Plus-Button startet keine weitere Auswahlbox mehr, sondern einen
  Hinzufügen/Entfernen-Modus: angetippte Objekte werden zur Auswahl
  hinzugefügt bzw. entfernt.
- Zweistufiges Beenden: erster Klick auf leere Fläche verlässt nur den
  Modus, ein weiterer löst die Auswahl auf.

### Zweiunddreißigste Überarbeitung — Gruppen-Verschieben, Layer-/Faden-Mehrfachauswahl, Filterleiste

- Klick in die Auswahlbox (ohne Objekt zu treffen) sowie ein neuer
  Mittelpunkt-Griff verschieben jetzt die ganze Gruppe.
- Box-Icon und Add-to-Selection-Icon im Zoom-Popup ergänzt.
- Mehrfachauswahl jetzt auch im Layer- und Faden-Panel: Hervorhebung,
  Strg+Klick, gemeinsames Verschieben als Block (interne Reihenfolge
  bleibt erhalten).
- **Neu: Filterleiste** - blendet Fotos aus, die in keinem der Felder
  Titel/Jahr/Epoche/Autor der Vorlage/Autor mit dem Muster übereinstimmen.

### Dreiunddreißigste Überarbeitung — Klonen-Bugfix, Zoom-Menü konsolidiert, Pin-Neugestaltung

- **Kern-Bugfix**: "Board klonen" hatte keinen Schutz vor Doppelklick -
  ein zweiter Klick duplizierte alle Fotos ein zweites Mal (Ursache der
  gemeldeten Verdopplung). Bereits entstandene Duplikate müssen manuell
  gelöscht werden.
- Filterleiste jetzt Teil des Zoom-Popups statt eines eigenen Buttons; Box-
  Symbol wählt sofort alle sichtbaren Objekte; Plus wurde zum Kreis;
  neuer Ausschnitt-Button (Auge) springt auf die aktuelle Auswahl.
- Pin-Neugestaltung in "Meine Bilder" und der Klassenansicht: Pin schwebt/
  sitzt neben dem Bild, wenn nicht befestigt, rückt beim Befestigen an die
  Bildmitte/-oberkante, während sich das Bild ihm entgegenhebt. Checkbox
  in der Klassenansicht entfernt, kurze Pin/Unpin-Tooltips ergänzt.
- Nebenbei gefunden: der Pin-Button war ab 900px Bildschirmbreite
  komplett unsichtbar - behoben.

### Vierunddreißigste Überarbeitung — Mehrfach-Board-Platzierung: Server- und Client-Fundament

- **Architekturumbau gegen Objekt-Duplizierung**: Objekte existieren jetzt
  nur noch einmal in der Datenbank, auch wenn sie über mehrere Boards
  (z.B. nach dem Klonen) hinweg erscheinen - "Meine Bilder" zeigt sie
  dadurch strukturell nur noch einmal.
- Geklonte Boards zeigen ihre zusätzlichen Objekte jetzt tatsächlich an
  (verschiebbar, mit blauem Entfernen-Pin).
- **Neu: Papierkorb-Seitenleiste** - gelöschte Objekte landen jetzt
  reversibel dort statt sofort endgültig gelöscht zu werden.
- Seitenleisten-Reihenfolge: Post-Stream, Faden, Layer, Papierkorb.

### Sechsunddreißigste Überarbeitung — Rahmen-Bugfix, Kopfzeilen-Dropdown, Rot/Gelb-Pin

- **Kern-Bugfix**: der prompt()-Dialog beim Rahmen-Erstellen konnte in
  eingebetteten Kontexten die komplette Erstellung verhindern - behoben,
  Rahmen werden jetzt sofort ohne Titelabfrage angelegt.
- Rahmen ohne Titel zeigen jetzt eine reine Zahl statt "leerer Rahmen".
- Kopfzeilen-Titel: Doppelklick zum Umbenennen, Klick öffnet Board-
  Dropdown mit Augen-Symbol zum Ausblenden.
- Rot/Gelb-Kennzeichnung für Objekte auf mehreren Boards beim Löschen.
- Noch offen: echter Wechsel zu fremden Boards im Dropdown.

## Bekannte Grenzen dieser Version

- Keine Bewertungsfunktion (bewusst weggelassen, da nicht gefordert).
- Die Leinwand hat pro Board eine feste Größe (1400×1000px, Querformat); ein
  Export als Bild/PDF ist nicht enthalten und wäre ein guter nächster
  Ausbauschritt. Die Größe passt sich nicht dynamisch an das jeweils
  gewählte Hintergrundbild an (siehe Scoping-Hinweis zu Phase 21 im
  IMPLEMENTATION_PLAN).
- Kamera-Zugriff per `getUserMedia` benötigt HTTPS; auf `http://`-Testinstanzen
  greift automatisch der Datei-Upload-Fallback.
- Der Stylus liegt in einer hohen Z-Ebene über den Fotos (Striche bleiben
  dadurch auch über Objekten sichtbar) - beim aktiven Zeichnen sind Fotos
  darunter währenddessen nicht per Klick bedienbar.
- Persönliche Hintergrundbilder werden beim Kurs-Restore ohne Nutzer-ID-
  Remapping wiederhergestellt (funktioniert nur korrekt, wenn Nutzer-IDs
  zwischen Quelle und Ziel gleich bleiben) - siehe `backup/moodle2/*`.
- `sourcephotoid` (Post-Stream-Herkunft) und `backphotoid` (Rückseite)
  werden beim Restore ebenfalls nicht umgemappt - rein informationelle
  Felder ohne Auswirkung auf Anzeige oder Berechtigungen.
- Post-Stream ist ein 15-Sekunden-Poll, kein Echtzeit-Push.
- Textobjekte im Wortfeld sind verschiebbar, aber nicht einzeln drehbar.
  "Laufweite" wirkt auf den ganzen Textblock, nicht auf einzeln
  ausgewählte Wörter. Position/Größe weiterer (nicht-primärer)
  Textobjekte im exportierten SVG werden aus dem Textinhalt geschätzt,
  nicht live aus dem Editor-DOM gemessen.
- Die eingebundene Google-Font wird beim Speichern direkt ins SVG
  eingebettet (Netzwerkzugriff auf fonts.googleapis.com/fonts.gstatic.com
  nötig) - schlägt dieser fehl, greift automatisch eine Systemschrift.
- Eine Faden-Präsentation über mehrere Boards hinweg übernimmt deren
  Koordinaten unverändert, was bei stark abweichenden Board-Layouts zu
  großen Sprüngen führen kann.
- Ausführliche manuelle Testmatrix vor Produktiveinsatz: siehe
  `TESTMATRIX.md` (insbesondere Berechtigungen, Backup/Restore,
  Privacy-API-Vollständigkeit wurden noch nicht gegen eine echte
  Moodle-Instanz durchgespielt).
