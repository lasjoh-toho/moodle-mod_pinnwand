# mod_pinnwand — Implementation Plan (Redesign "Pinnwand")

> **Lizenzhinweis:** Dieses Plugin ist **nicht frei für kommerzielle Nutzung**.
> Kommerzieller Einsatz erfordert die vorherige **schriftliche Genehmigung**
> des Repository-Inhabers (`lasjoh-toho`). Siehe `LICENSE` (Phase 0).

Grundlage: bestehende Codebasis (aktuell "Bildaufnahme"/`mod_pinnwand`, Foto-
Aufnahme + Anordnungs-Leinwand + Klassenansicht) wird zur **Pinnwand**
weiterentwickelt. Dieser Plan ist in unabhängig auslieferbare Phasen
gegliedert, jede mit Bezug auf die betroffenen Dateien. Reihenfolge = Priorität
(Abhängigkeiten zuerst). Status wird bei Umsetzung aktualisiert.

Status-Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` erledigt

> **Status: Alle Phasen (0–8) umgesetzt und gepusht.** Nächster sinnvoller
> Schritt ist kein Code mehr, sondern das manuelle Durchspielen von
> `TESTMATRIX.md` auf einer echten Testinstanz. Neue Feature-Wünsche bitte
> als neue Phase am Ende dieses Dokuments anhängen statt bestehende
> Abschnitte umzuschreiben.

---

## Phase 0 — Housekeeping & Rebranding ✅
*Kein neues Feature, aber Voraussetzung für alles Weitere.*

- [x] `LICENSE`-Datei mit obigem Lizenztext anlegen
- [x] Umbenennung "Bildaufnahme" → "Pinnwand" durchgängig:
  `lang/de/pinnwand.php`, `README.md` (Modulname war bereits "Pinnwand")
- [x] **Bugfix Klassenansicht**: Tooltip (`title`) der Sortier-/Filterbuttons
  folgte nicht dem aktuell sichtbaren Label und zeigte beim Hovern einen
  veralteten, abweichenden Begriff — jetzt immer synchron. Icons für alle
  Filter/Sortier-Buttons waren tatsächlich bereits vorhanden (`person`,
  `calendar`, `upload`, `brush`, `pin`).
- [x] **Backup/Restore-Grundgerüst ergänzt** (`backup/moodle2/*`) — fehlte
  komplett, obwohl `lib.php` `FEATURE_BACKUP_MOODLE2` meldet; ohne diese
  Dateien wäre die Kurssicherung für diese Aktivität fehlgeschlagen bzw.
  stillschweigend übersprungen worden. Bekannte Einschränkung: Hintergrundbild
  -Dateien (`filearea='background'`, itemid = Nutzer-ID) werden ohne
  ID-Remapping wiederhergestellt — funktioniert nur korrekt, wenn Nutzer-IDs
  zwischen Quelle und Ziel gleich bleiben.
- [x] **Download-Infrastruktur**: `.github/workflows/release.yml` baut bei
  jedem Push auf `main` automatisch `pinnwand.zip` und veröffentlicht es unter
  dem stabilen Release-Tag `latest`; `docs/index.html` bietet eine Download-
  Seite mit direktem Link auf `.../releases/latest/download/pinnwand.zip`
  (GitHub Pages muss einmalig manuell aktiviert werden, siehe Hinweis unten).

---

## Phase 1 — App-Shell, responsives Start-Verhalten, Layout/Buttons ✅

Betrifft: `view.php` (Einstiegslogik), `js/app.js` (Shell/Router), `styles.css`

- [x] **Einstiegslogik** in `view.php`:
  - Bearbeiten-Modus aktiv → normaler Moodle-View (`pagelayout='incourse'`)
    mit Intro, Link zur Aktivität (`?app=1`) und Link zu den Einstellungen
  - Bearbeiten-Modus aus (oder `?app=1`) → direkt App im eigenen
    Vollbild-Layout (`pagelayout='embedded'`), `settingsurl` nur im
    Bearbeiten-Modus an die App übergeben
  - Responsiver Start für Lehrkräfte (großer Monitor → Pinnwand,
    kleiner → Klassenübersicht) war bereits vorhanden und blieb unverändert
- [x] **Kopfzeile** (`renderTopBar()` in `js/app.js`): Pinnwand-Name +
  aktuelle Oberfläche mittig, ab 560px sichtbar (`.ic-topbar-center`)
- [x] **Obere Buttons**: links Kurs-zurück + Vollbild-Toggle
  (Fullscreen-API), rechts Pinnwand/Meine Bilder/Hinzufügen/Klassenübersicht
  (letzteres nur mit `canmoderate`) — als feste Icon-Reihe, passt auch mobil
  in eine Zeile (`flex-wrap: nowrap`)
- [x] **Untere Buttons**: bestehende `.ic-fab`-Reihe (Board-Einstellungen/
  Daten-Toggle/Foto hinzufügen) jetzt mit `backdrop-filter: blur(10px)` -
  Overlay-Werkzeuge der Galerie (linke Dock-Leiste: Raster/Daten/
  Zeichenwerkzeuge) bewusst unverändert gelassen, wie gefordert

**Scoping-Hinweis:** Der Hinzufügen-Assistent (Aufnahme → Perspektive →
Zuschnitt → Farbe → Quelle) behält vorerst seine bisherige interne
Schritt-Navigation; seine Neugestaltung (Pfeil/Haken-Buttons, Textrahmen
usw.) ist explizit Teil von Phase 6.

---

## Phase 2 — Pinnwand-Canvas: Pan/Zoom, Handles, Mehrfach-Boards ✅

Betrifft: `js/app.js` (Canvas-Logik), `mod_form.php`, `db/install.xml` +
`db/upgrade.php`, `classes/external.php`, `backup/moodle2/*`

- [x] Einstellung "Pinnwand verschiebbar/zoombar" (`boardpannable`, neues
  Feld auf `pinnwand`)
- [x] Hand-Button (`icon('hand')`) + Zoom-Slider (50–200%), nur sichtbar
  wenn `boardpannable` aktiv; Transform auf neuem `.ic-canvas-panzoom`-Layer
  (umschließt Hintergrund + Canvas gemeinsam); `makeMovable`/`makeResizable`
  rechnen den aktuellen Zoomfaktor heraus, damit Ziehen bei Zoom ≠ 100%
  weiterhin 1:1 dem Zeiger folgt
- [x] Bild-Handles (Resize/Rotate) + Pin-Button jetzt per CSS `opacity`
  standardmäßig unsichtbar, erscheinen bei `:hover` (Maus) oder nach Klick/
  Antippen (`.show-handles`-Klasse, für Touch ohne Hover)
- [x] Pin/Unpin-Icon aus der Vorgabe 1:1 als `thumbtack`-Icon übernommen;
  Klick entfernt das Foto direkt von der Pinnwand (`hiddenfromboard=true`)
- [x] **Annotieren direkt auf der Pinnwand** - pragmatisch gelöst: ein
  "Zeichnen"-Fab aktiviert einen Modus, in dem Antippen eines Fotos direkt
  den bestehenden Zeichen-Editor öffnet (`openLightbox(index, startDrawing=true)`),
  statt eines separaten, komplett neuen Zeichen-Engines direkt im
  Canvas-Item. Grund: Die bestehende Stift/Radierer/Text-Logik ist eng an
  die Lightbox gekoppelt (~250 Zeilen); ein 1:1-Nachbau auf dem Board hätte
  das Risiko von Inkonsistenzen (zwei parallele Implementierungen) klar
  überwogen. Funktional ist das Ergebnis für die Person ein einziger Tipp
  von der Pinnwand aus direkt ins Zeichnen - der Wechsel in die Lightbox
  selbst ist kaum wahrnehmbar.
- [x] **Mehrfach-Boards** - schlanker gelöst als ursprünglich skizziert: statt
  einer separaten `pinnwand_boards`-Tabelle nur ein neues Feld `boardid` auf
  `pinnwand_photos` (Default 0). Boards entstehen implizit, sobald ein Foto
  auf sie verweist; die Board-Leiste (‹ Board X von Y ›, "+") schaltet
  clientseitig um. Ab `BOARD_CAPACITY = 30` sichtbaren Fotos erscheint ein
  Hinweis, ein neues Board anzulegen (kein automatischer Zwang). Spart eine
  komplette Zusatztabelle samt eigener Backup/Restore-Logik, deckt die
  eigentliche Anforderung (voll → weiteres Board anlegen/umschalten) aber
  vollständig ab.

---

## Phase 3 — Roter Faden + impress.js-Präsentation ✅

Betrifft: neue DB-Tabellen `pinnwand_threads`/`pinnwand_thread_items`,
neue Endpunkte in `classes/external.php`, `js/vendor/impress.js` (MIT,
vendored + `thirdpartylibs.xml`), `js/app.js` (Panel + Präsentation)

- [x] Datenmodell: ein Faden pro Person (Lehrkraft immer, Lernende nur mit
  `studentthreads`-Einstellung), geordnete Items vom Typ `photo` (verweist
  auf ein eigenes Foto) oder `frame` (Leerrahmen mit eigenen Koordinaten +
  Beschriftung)
- [x] Button mit rotem-Faden-Icon (`icon('thread')`, geschwungene Linie mit
  zwei Knoten) in der Fab-Leiste der Pinnwand
- [x] Seitenpanel rechts (`renderThreadPanel`) mit den Stationen des eigenen
  Fadens, per HTML5-Drag-and-Drop umsortierbar (`reorder_thread_items`);
  zusätzlich schreibgeschützte Ansicht des Lehrkraft-Fadens für Lernende
- [x] Berechtigung `studentthreads` (Instanzeinstellung) steuert, ob
  Lernende einen eigenen Faden anlegen dürfen; Farbe wird serverseitig
  deterministisch aus einer 6er-Palette anhand der Nutzer-ID vergeben
- [x] Präsentationsmodus: `openPresentation()` baut aus den Faden-Items eine
  `impress.js`-Sequenz (Position/Skalierung aus den Board- bzw.
  Rahmen-Koordinaten), Navigation per ‹/›-Button; gesperrt unter 900px
  Breite (Hinweis statt Start)

**Scoping-Hinweise:**
- Leerrahmen-Größe/-Position ist aktuell fix (240×180 an Position 40/40) und
  die Beschriftung kommt über einen einfachen `prompt()` - kein eigener
  Formulardialog. Nachträgliches Verschieben/Skalieren eines Rahmens auf dem
  Board ist noch nicht möglich (nur Löschen + neu anlegen).
- Eine Präsentation kann Stationen von verschiedenen Boards enthalten;
  deren Koordinaten werden unverändert übernommen, was bei stark
  abweichenden Board-Layouts zu großen "Sprüngen" führen kann - für den
  Regelfall (ein Board) funktioniert es unmittelbar korrekt.

---

## Phase 4 — Post-Stream (Einreichungs-Warteschlange) ✅

Betrifft: `classes/external.php` (neue Endpunkte + `sourcephotoid`-Feld),
`js/app.js` (neues Panel), `styles.css`

- [x] Neue Einreichungen anderer Lernender erscheinen als Karten am rechten
  Rand der Lehrkraft-Pinnwand (`get_stream_photos`, gepollt alle 15s
  solange das Panel offen ist - echtes Server-Push wäre eine
  WebSocket/Long-Poll-Infrastruktur, die den Rahmen hier sprengen würde)
- [x] Sticky-Stack: die zwei neuesten Karten immer vollständig sichtbar
  (90px), ältere kollabieren zu einer 26px-Titelzeile, gestapelt mit
  `z-index` absteigend nach Alter (älteste unten im Stapel-Level)
- [x] Panel-Breite per Drag am linken Rand änderbar (`state.streamWidth`)
- [x] Schmaler Filter oben im Panel (Freitext auf Name + Titel)
- [x] Karte auf das Board ziehen (natives HTML5-Drag-and-Drop) legt eine
  **Kopie** des fremden Fotos auf dem eigenen Board der Lehrkraft an
  (`adopt_photo_to_board` - Datei + Metadaten werden dupliziert, das
  Original bleibt beim einreichenden Lernenden unverändert); Tippen auf
  eine Karte fügt sie ersatzweise mittig im sichtbaren Bereich ein
  (Touch-Fallback, da natives Drag-and-Drop dort nicht zuverlässig
  funktioniert)
- [x] Faden-Panel und Post-Stream teilen sich den rechten Rand und
  schließen sich gegenseitig (beantwortet die offene Rückfrage aus Phase 3)

**Scoping-Hinweise:**
- "Streaming" ist ein 15-Sekunden-Poll, kein Echtzeit-Push - für den
  Klassenraum-Einsatz ausreichend reaktionsschnell, aber kein echtes Live-
  Update.
- Gestapelte Positionen werden analytisch aus fixen Konstanten berechnet
  (90px/26px/6px Abstand), nicht aus tatsächlich gemessenen DOM-Höhen -
  bei geänderter Kartenhöhe (z. B. via CSS) müssen die JS-Konstanten
  mitgepflegt werden.

---

## Phase 5 — Klassenansicht: Layout-Feinschliff ✅

Betrifft: `js/app.js` (Klassenansicht), `styles.css`
*(Bugfix aus Phase 0 ist hier bereits enthalten/vorausgesetzt)*

- [x] Löschen-Button + Pinnwand-Checkbox pro Bild direkt neben dem Thumbnail
  (neues `.ic-thumb-cluster`) statt wie zuvor am Zeilenende bzw. in den
  Metadaten verstreut; auf kleinen Bildschirmen weiterhin **im** Thumbnail
  als Overlay (unverändert, war bereits korrekt)

**Nebenbei gefundener Bugfix (Regression aus Phase 2):** `persistLayout()`
übergab `boardid` nicht an `update_layout` - dadurch wurde beim Verschieben/
Skalieren/Rotieren eines Fotos dessen Board-Zuordnung serverseitig
stillschweigend auf 0 zurückgesetzt. Behoben.

---

## Phase 6 — Hinzufügen/Bearbeiten: Editor-Erweiterungen ✅

Betrifft: `js/app.js` (Editor-Pipeline), `classes/external.php` (neue
Felder/Endpunkte), `db/install.xml` + `upgrade.php`

- [x] Bildgröße im Editor: Obergrenze bei Originalgröße entfernt
  (`fitImageToStage`) - Bild füllt jetzt immer eine Richtung zu 100 %,
  auch bei kleinen Bildern (Hochskalieren)
- [x] **Bugfix** Zuschneide-/Perspektiv-Rahmen: Eckpunkte wurden bei
  geänderter Canvas-Größe zwischen zwei Renders (Fenster-Resize, Rotation)
  nicht umgerechnet und drifteten vom Bild weg - jetzt proportional
  angepasst (`cornersCanvasW/H`, `cropRectCanvasW/H`)
- [x] Editor-Schritte als Buttons: "Weiter" (Pfeil) und "Speichern" (Haken)
  als Icons in Perspektive-, Zuschnitt-, Farbe- und Quelle-Schritt
- [x] **Textrahmen ("Wortfeld")**: neuer Schritt `textframe` - 4
  Hintergrund-Presets (kein Hintergrund, virtueller Zettel mit Schatten,
  Schwarz auf Farbe, Weiß auf Schwarz), Farbpalette + eigene Farbe,
  mehrere frei verschiebbare Textobjekte, 4 Schriftarten (inkl. einer
  über Google Fonts eingebundenen Handschrift), eigene Auto-Fit-Umsetzung
  (Canvas-`measureText`, schrittweises Verkleinern). Wird beim Speichern
  zu einem PNG gerendert und läuft über die bestehende Foto-Pipeline -
  Ziehen/Größe/Rotation/Annotieren/Faden funktionieren dadurch ohne jede
  Sonderbehandlung mit.
- [x] **Rückseiten-Beschriftung**: neue Felder `backphotoid`/`showingback`,
  Verknüpfung über einen neuen Dock-Button in der Lightbox (Foto-Auswahl
  aus den eigenen Bildern), Doppelklick auf der Pinnwand blättert um; die
  verknüpfte Rückseite erscheint nicht mehr als eigene Karte
- [x] Bild-Import per URL: bereits vorhanden, funktioniert unverändert mit
  der bestehenden Pipeline - keine Anpassung nötig

**Nebenbei gefundene/behobene Inkonsistenz:** `boardid` fehlte auch beim
Neuanlegen eines Fotos (`save_photo`) - landete immer auf Board 0 statt dem
gerade aktiven Board. Ergänzt (Client + `save_photo`-Endpunkt).

**Scoping-Hinweise:**
- Textobjekte im Wortfeld sind verschiebbar, aber (anders als Fotos) nicht
  einzeln drehbar.
- Auto-Fit ist einzeilig (kein automatischer Zeilenumbruch) - für die
  kurzen Beschriftungen, die ein Wortfeld typischerweise trägt, ausreichend.
- `backphotoid`/`sourcephotoid` werden beim Restore nicht auf neue IDs
  umgemappt (bleiben roh erhalten) - rein informationelle Felder ohne
  Auswirkung auf Anzeige/Berechtigungen, siehe bereits dokumentierte
  Einschränkung bei `sourcephotoid` (Phase 4).
- Ein Doppelklick auf eine Karte mit Rückseite blättert um **und** öffnet
  zusätzlich kurz die Galerie-Ansicht (da ein Doppelklick technisch aus
  zwei Einzelklicks besteht, die jeweils auch den normalen Klick-Handler
  auslösen) - kosmetisch, aber nicht weiter vertieft.

---

## Phase 7 — Galerie: Politur ✅

Betrifft: `js/app.js` (Lightbox), `styles.css`

- [x] **Audit** Zurück-Navigation per Klick auf schwarzen Hintergrund: bereits
  korrekt implementiert (`viewport`-Klick nur wenn `ev.target === viewport`,
  Zoom ≤ 1, nicht während des Zeichnens; Buttons/Dock liegen als Geschwister
  außerhalb von `viewport`, Grid-Overlay hat `pointer-events: none`) - kein
  Code-Änderungsbedarf, an dieser Stelle nur geprüft/bestätigt
- [x] **Bugfix** Annotationen/Striche: die Zeichenebene (`inkCanvas`) wurde
  bei einem Fenster-Resize **während des aktiven Zeichnens** nicht neu
  skaliert - ihre CSS-Anzeigegröße folgte dem Bild (per `inset:0`), die
  interne Pixelauflösung blieb aber auf dem alten Stand hängen, wodurch
  Striche gegenüber dem Bild verzerrt/verschoben wirkten. Jetzt wird bei
  Resize neu skaliert und neu gezeichnet (Cleanup beim Verlassen des
  Zeichenmodus ergänzt, analog zum bestehenden `_icUpHandler`-Muster)
- [x] Doppelklick auf ein Farbfeld öffnet einen nativen Farbwähler zur
  Neudefinition - wirkt über eine pro Zeichensitzung kopierte Palette
  (`sessionColors`) **nur für das aktuell bearbeitete Foto**; beim nächsten
  Öffnen (anderes Foto oder erneutes Bearbeiten) gilt wieder die
  Standardpalette

---

## Phase 8 — Test & Rollout ✅

- [x] `version.php` hochgezählt, `db/upgrade.php`-Schritte für alle neuen
  Felder/Tabellen ergänzt (lückenlose Savepoint-Kette geprüft)
- [x] Manuelle Testmatrix als eigenes Dokument `TESTMATRIX.md` angelegt
  (Rolle × Bildschirmgröße, plus Cross-Cutting-Checks wie Backup/Restore
  und Release-Workflow) - Durchführung auf der echten Testinstanz steht
  noch aus
- [x] `README.md`: Änderungsprotokoll fortgeschrieben ("Elfte
  Überarbeitung"), "Bekannte Grenzen" aktualisiert (u. a. veralteten
  Hinweis zur Rotation entfernt, neue Scoping-Punkte aus Phasen 2–7
  ergänzt)

---

## Offene Rückfragen — inzwischen durch Umsetzung beantwortet

- **Post-Stream/Faden-Panel im selben Bereich?** Ja - beide teilen sich den
  rechten Rand und schließen sich gegenseitig beim Öffnen (kein Tab-UI,
  einfacher Toggle). Siehe Phase 4.
- **Mehrfach-Boards global oder pro Nutzer*in?** Pro Nutzer*in - jede Person
  hat ihre eigenen Boards (`boardid` ist an `pinnwand_photos.userid`
  gekoppelt, nicht instanzweit geteilt). Siehe Phase 2.
- **Präsentation nur Lehrkraft oder auch berechtigte Lernende?** Wer einen
  eigenen Faden anlegen darf (`studentthreads`), darf ihn auch präsentieren -
  dieselbe Berechtigung deckt beides ab. Siehe Phase 3.

---

## Phase 9 — Post-Stream als Warteraum + Roter Faden auf dem Board ✅

Zweiter Feedback-Durchgang. Betrifft: neues Feld `boardplaced`,
`get_stream_photos`/`update_layout`/`adopt_photo_to_board`/
`set_photo_hidden` (alle in `classes/external.php`), `js/app.js`.

- [x] **Architekturänderung**: Fotos erscheinen nicht mehr automatisch auf
  der Leinwand, sobald sie gepinnt werden - neues Feld `boardplaced`
  unterscheidet "gepinnt, aber noch im Post-Stream" von "aktiv auf dem
  Board platziert". Erst ein Drag oder Tippen auf das PIN-Icon einer
  Post-Stream-Karte platziert das Foto wirklich (setzt reale Koordinaten).
  Entfernen vom Board setzt `boardplaced` zurück, damit erneutes Anpinnen
  wieder über den Post-Stream läuft.
- [x] **Post-Stream jetzt für alle** (vorher nur Lehrkraft): zeigt die
  eigenen, noch nicht platzierten Fotos als persönlichen Warteraum; für
  die Lehrkraft zusätzlich weiterhin fremde Einreichungen. Eigene Fotos
  werden per `update_layout` direkt übernommen (keine Kopie), fremde
  weiterhin per `adopt_photo_to_board` kopiert.
- [x] PIN-Icon pro Post-Stream-Karte legt das Foto mittig auf die sichtbare
  Pinnwand; Tippen auf die Karte selbst öffnet bei eigenen Fotos die große
  Lightbox-Ansicht (fremde Einreichungen haben keine eigene Lightbox,
  dort wirkt Tippen wie das PIN-Icon).
- [x] **Bugfix**: Pin/Unpin-Aktionen (Home, Board, Klassenansicht) luden
  den Post-Stream bisher nicht neu - dadurch erschienen frisch gepinnte
  Fotos teils erst nach manuellem Reload. Jetzt wird nach jeder
  Sichtbarkeits-Änderung `loadStreamPhotos()` mit aufgerufen.
- [x] **Nebenbei gefundener Bugfix**: beim Kopieren eines fremden
  Post-Stream-Fotos (`adopt_photo_to_board`) wurde versehentlich auch
  dessen Rückseiten-Verknüpfung mitkopiert - hätte auf ein fremdes, nicht
  zugängliches Foto gezeigt. Kopie startet jetzt ohne Rückseite.
- [x] **Roter Faden auf dem Board**: Fotos im (geöffneten) Faden-Panel
  bekommen einen roten Rahmen direkt auf der Leinwand; gesetzte Leerrahmen
  werden als gestrichelte Rechtecke angezeigt; eine Linie verbindet jeweils
  zwei aufeinanderfolgende Stationen (nur innerhalb desselben Boards);
  "Als Präsentation abspielen" steht jetzt oberhalb der Liste statt darunter.

**Migrationshinweis:** Bestandsfotos werden beim Upgrade auf `boardplaced=1`
gesetzt, damit sich das Aussehen bereits existierender Boards durch dieses
Update nicht rückwirkend ändert - nur künftig neu eingereichte/erneut
gepinnte Fotos durchlaufen den neuen Post-Stream-Warteraum.

**Scoping-Hinweis:** Leerrahmen auf dem Board sind (wie schon in Phase 3
vermerkt) weiterhin nicht direkt verschiebbar/skalierbar - nur über das
Faden-Panel neu anlegbar. Die Verbindungslinie überspringt Segmente
zwischen Stationen auf unterschiedlichen Boards (kein Board-übergreifendes
Zeichnen).

---

## Phase 10 — Rahmen verschiebbar, Präsentations-Zoom-Fix, Layer-Panel, Seitenleisten-Ecke ✅

Dritter Feedback-Durchgang. Betrifft: `js/app.js` (Präsentation komplett
neu, Rahmen-Interaktion, Layer-Panel), `classes/external.php` (neuer
Endpunkt `update_thread_frame`), neue Instanzeinstellungen
`studentpoststream`/`studentlayers`.

- [x] **Rote Rahmen jetzt verschieb- und skalierbar** direkt auf dem Board
  (eigener Resize, unabhängig in Breite/Höhe, da Rahmen nicht wie Fotos
  seitenverhältnis-gebunden sind); neuer Endpunkt `update_thread_frame`
  persistiert Position/Größe.
- [x] **Präsentations-Zoom korrigiert**: `data-width`/`data-height` des
  impress.js-Root werden auf die aktuelle Fenstergröße gesetzt, damit
  impress' eingebauter "windowScale"-Faktor genau 1 ergibt - die eigene
  `data-scale`-Berechnung (`min(Fensterbreite/Rahmenbreite,
  Fensterhöhe/Rahmenhöhe)`) wirkt dadurch direkt als Kamera-Zoom, ohne
  verwirrende zusätzliche Umrechnung. Vorher wurde eine von der
  Fenstergröße unabhängige, letztlich willkürliche Formel (`Breite/400`)
  verwendet - das war die Ursache der "verkehrt herum" wirkenden Kamera.
- [x] **Präsentation zeigt jetzt den ganzen Board-Inhalt**: Hintergrund und
  alle platzierten Fotos (nicht nur die Faden-Stationen) bleiben während
  der gesamten Präsentation sichtbar; nur Fotos, die den aktuell aktiven
  Rahmen vom Z-Level her überlappend verdecken würden, werden ausgeblendet
  (`impress:stepenter`-Event + eigene Overlap-Prüfung per
  `getBoundingClientRect`).
- [x] **Neues Schichtung-Panel** (Layer): zeigt platzierte Fotos des
  aktuellen Boards nach Z-Reihenfolge, per Drag umsortierbar.
- [x] **Berechtigungs-Einstellungen** `studentpoststream` (Standard: an)
  und `studentlayers` (Standard: aus) - Lehrkraft steuert in den
  Aktivitätseinstellungen, wer den Post-Stream bzw. das Schichtung-Panel
  nutzen darf; serverseitig in `get_stream_photos` durchgesetzt.
- [x] Seitenleisten-Buttons (Roter Faden/Post-Stream/Layer) aus der unteren
  Fab-Leiste in eine eigene Ecke unten rechts verschoben.

**Scoping-Hinweis:** Die reale Bildhöhe für den Präsentations-Zoom wird aus
`img.naturalWidth/naturalHeight` gelesen, falls das Bild bereits geladen
ist (auf der gerade zuvor gezeigten Pinnwand fast immer der Fall) - sonst
eine grobe 4:3-Näherung. Ein vollständig asynchrones Vorladen aller Bilder
vor Präsentationsstart wurde aus Aufwandsgründen nicht umgesetzt.

---

## Phase 11 — impress.js-Root-Bug, Faden-Live-Update, Wortfeld-Editor-Bugfix ✅

Vierter Feedback-Durchgang. Betrifft: `styles.css` (impress.js-Root-CSS),
`js/app.js` (Faden-Re-Render, Wortfeld-Editor komplett überarbeitet).

- [x] **Sidebar-Buttons**: nebeneinander statt untereinander, z-index über
  den Panels (30 statt 16), damit sie beim geöffneten Panel weiter
  klickbar bleiben.
- [x] **Kern-Bugfix impress.js**: `#pinnwand-impress` hatte ein eigenes
  CSS-Regel (`inset: 0` → setzt auch `right:0;bottom:0`), das mit den von
  impress.js selbst per Inline-Style gesetzten `top:50%;left:50%`
  kollidierte. Ein Element mit gleichzeitig `top:50%` UND `bottom:0`
  (bzw. `left:50%` UND `right:0`) bekommt seine Box-Größe aus dieser
  Spanne vorgegeben - dadurch wurde die impress-Wurzel auf ein Viertel
  der Fläche in der unteren rechten Bildschirmecke zusammengequetscht,
  was die gesamte Präsentation unbrauchbar/falsch positioniert erscheinen
  ließ ("funktioniert nicht", "verkehrt herum", "zu schwach gezoomt" waren
  alles Symptome dieser einen Ursache). Fix: kein eigenes position/inset
  mehr auf `#pinnwand-impress` - impress.js verwaltet das komplett selbst.
- [x] **Faden-Live-Update**: Verschieben/Skalieren eines Fotos oder
  Leerrahmens auf dem Board löst jetzt (nur wenn das Faden-Panel offen
  ist) sofort ein Re-Render aus, damit rote Rahmen und Verbindungslinie
  live mitwandern statt erst nach einem anderen auslösenden Ereignis.
- [x] **Wortfeld-Editor - Kern-Bugfix Texteingabe**: der `focus`-Handler
  eines Textobjekts löste bisher ein volles `render()` aus, das das
  gerade fokussierte `contenteditable`-Element sofort zerstörte und neu
  aufbaute - der Fokus (und damit jede Eingabemöglichkeit) ging dadurch
  im selben Moment wieder verloren, in dem man hineinklickte. Jetzt wird
  bei Auswahl nur die Markierung + das Steuerelemente-Panel isoliert
  aktualisiert, nie der ganze Editor.
- [x] **Hauptrahmen jetzt skalierbar** (Eck-Handle), Textobjekte zusätzlich
  per eigenem kleinen Eck-Handle in der Schriftgröße skalierbar (nicht nur
  über den Schieberegler) - Textobjekt-Koordinaten sind normalisiert
  (0..1), passen sich beim Skalieren des Hauptrahmens automatisch an.

**Scoping-Hinweis:** "Hauptrahmen bewegt sich auf der Pinnwand, andere
Rahmen sind daran gebunden" ist architektonisch bereits durch das
Flach-Rendern zu einem PNG beim Speichern gelöst (das gesamte Wortfeld
wird EIN Foto und bewegt sich dadurch zwangsläufig als eine Einheit) -
ein vollständig strukturiertes, weiterhin live editierbares Textobjekt
direkt auf dem Board (statt eines flachen Bildes) wäre ein deutlich
größerer Umbau und wurde nicht umgesetzt.

---

## Phase 12 — Wortfeld als SVG, Klassenansicht-Bugfix, Faden-Erweiterungen ✅

Fünfter Feedback-Durchgang. Betrifft: `classes/external.php` (SVG-Unterstützung,
`wordfielddata`), `js/app.js` (Wortfeld-SVG, Bearbeiten-Weiche, Faden-
Objektliste, Auto-Pinnwand-Modus), `db/install.xml` + `upgrade.php`.

- [x] **Wortfeld ist jetzt SVG statt PNG**: bleibt dadurch editierbarer Text
  (scharf bei jeder Größe, deutlich kleinere Datei) statt zu einem Raster
  gerastert zu werden. `save_photo`/`update_photo` akzeptieren jetzt zusätzlich
  `image/svg+xml`-Data-URLs.
- [x] **Bearbeiten öffnet bei Wortfeldern den Wortfeld-Editor** statt des
  Bild-Editors: neues Feld `wordfielddata` speichert die strukturierten
  Daten (Preset, Maße, Texte als JSON) zusätzlich zur SVG-Datei; der
  Bearbeiten-Button in der Lightbox prüft darauf und öffnet entsprechend
  entweder den Wortfeld- oder den Bild-Editor.
- [x] **Kern-Bugfix Klassenansicht-Sortierbuttons** (der eigentliche, echte
  Grund für "Icons fehlen, Name zweimal"): `b.querySelector('span')` traf
  mangels Eingrenzung den ERSTEN Span im Button (das Icon-Span), nicht das
  Label-Span - `refresh()` überschrieb dadurch das Icon mit Text, während
  das ursprüngliche Label-Span unverändert stehen blieb. Auf
  `.ic-btn-label` als eindeutigen Selektor umgestellt.
- [x] **Präsentation komplett neu** ohne impress.js: eigene, direkt
  nachprüfbare CSS-Transform-Kamera (translate+scale, klassisches
  Contain-Fitting) - nachdem mehrere Versuche an impress.js-internen
  Eigenheiten scheiterten, die ohne echten Browser nicht zuverlässig
  nachvollziehbar waren. Hintergrund ist jetzt eine eigenständige, NICHT
  mitgezoomte Ebene (bleibt bildschirmfüllend, wie auf der echten
  Pinnwand). Klick auf ein noch nicht enthaltenes Foto/Textrahmen direkt
  in der Präsentation hängt es ans Ende des Fadens an. Vendor-Datei
  `js/vendor/impress.js` und `thirdpartylibs.xml` entfernt.
- [x] **Faden-Panel**: neue Liste "Alle Objekte auf der Pinnwand" mit
  Zuschalt-Checkbox pro Foto + Filter (Alle/Mit Faden/Ohne Faden) -
  zusätzlich zur bestehenden Reihenfolge-Liste.
- [x] **Faden lebt live nach**: Verschieben/Skalieren eines Fotos oder
  Leerrahmens löst (nur bei geöffnetem Faden-Panel) sofort ein Re-Render
  aus.
- [x] **Rote Rahmen verschieb-/skalierbar** direkt auf dem Board.
- [x] **Große Bildschirme starten jetzt für ALLE Rollen** direkt im
  Pinnwand-Modus (vorher nur für die Lehrkraft).
- [x] Sidebar-Buttons (Faden/Post-Stream/Layer) nebeneinander statt
  untereinander, über den Panels statt dahinter.

**Scoping-Hinweis:** Die eingebundene Google-Font ("Handschrift"-Option)
wird im Editor korrekt live angezeigt, erscheint aber im exportierten SVG
möglicherweise nicht (SVG als `<img>`-Quelle lädt keine extern
referenzierten Web-Fonts nach - eine Browser-Sicherheitsbeschränkung).
Einbetten der Font-Daten direkt ins SVG wäre möglich, wurde aber aus
Aufwandsgründen nicht umgesetzt.

---

## Phase 13 — Faden-Kurve+Sichtbarkeit, Hintergrund-Bewegung, Wortfeld-UX, Assistent-Handles ✅

Sechster Feedback-Durchgang. Betrifft: `classes/external.php` (neue Felder
`framerot`/`bgmoves`, neuer Endpunkt `set_thread_bgmoves`), `js/app.js`
(Faden-Kurve, Rahmen-Rotation, Wortfeld-Primärtext, Assistent-Umbau),
`db/install.xml` + `upgrade.php`.

- [x] **Bugfix Faden-Linie**: fehlendes `viewBox`/`width`/`height`-Attribut
  am SVG führte dazu, dass der Koordinatenraum vom Browser nicht
  zuverlässig auf die 1000×1400-Canvasgröße abgebildet wurde - die Linie
  erschien nur in einem Teilbereich (links, senkrecht). Jetzt fest auf die
  tatsächliche Canvas-Größe fixiert.
- [x] Faden-Linie als sanfte Kurve (quadratische Bezier, abwechselnde
  Wölbungsrichtung) statt gerader Strecke - berührt dabei weiterhin exakt
  die Mittelpunkte der verbundenen Stationen.
- [x] Leerrahmen jetzt auch drehbar (neues Feld `framerot`, Rotations-
  Handle analog zu Fotos).
- [x] Leerrahmen in der Präsentation unsichtbar (dienen nur als Zoom-Ziel,
  z. B. um auf Details des Hintergrunds hinzuweisen).
- [x] Checkbox "Hintergrund bewegt sich beim Zoom mit" im Faden-Panel
  (neues Feld `bgmoves` je Faden, neuer Endpunkt `set_thread_bgmoves`) -
  Standard: Hintergrund bleibt bildschirmfüllend fest stehen.
- [x] **Wortfeld-Editor**: erstes Textobjekt ("primär") füllt jetzt den
  ganzen Rahmen, bricht automatisch um und passt seine Schriftgröße live
  per 2D-Auto-Fit (Binärsuche) an; wird beim Öffnen des Editors sofort
  fokussiert (Cursor sichtbar, kein Extra-Klick nötig). Export nutzt dafür
  `<foreignObject>` im SVG (da SVG-`<text>` nicht automatisch umbricht).
  Weitere Textobjekte bleiben wie bisher frei positionierbar/einzeilig.
- [x] **Hinzufügen-Assistent umgebaut**: die Zuschnitt-Handles im zweiten
  Schritt sind komplett entfallen - die vier Eckpunkte im Perspektive-
  Schritt übernehmen Zuschnitt UND Perspektivkorrektur bereits gemeinsam
  (das Ergebnis ist exakt auf das gewählte Viereck zugeschnitten). Der
  vormalige Zuschnitt-Schritt zeigt jetzt nur noch Drehen-/Spiegeln-
  Buttons, keine Handles mehr.
- [x] "Weiter"/"Speichern"-Pfeil ist jetzt ein schwebender Button unten
  rechts im Bild (in Zuschnitt- und Farbe-Schritt) statt in einer
  separaten Aktionsleiste - nur im Perspektive-Schritt (mit Handles)
  bleibt er unten mittig in der Aktionsleiste, um die Eckpunkte nicht zu
  verdecken.

**Scoping-Hinweis:** Der Quelle-Schritt (letzter Schritt, kleine
Bildvorschau + Formular) behält den Speichern-Button in der Aktionsleiste -
dort gibt es kein großformatiges Bild, auf dem eine schwebende Ecken-
Platzierung sinnvoll wäre.

---

## Phase 14 — Präsentations-Kamera, Faden-Politur, Assistent-Navigation ✅ (Teil 1)

Siebter Feedback-Durchgang (Teil 1 - Wortfeld-Formatierungswerkzeuge folgen
in Teil 2). Betrifft: `classes/external.php` (Faden-Farbe), `js/app.js`
(Präsentations-Kamera, Faden-Kurve, Objekt-Liste, Assistent-Navigation).

- [x] **Bugfix**: "Bild hinzufügen" (Datei-Upload) öffnete durch das
  `capture`-Attribut am Datei-Input ebenfalls die Kamera statt der
  Fotomediathek des Geräts - Attribut entfernt.
- [x] Lehrkraft-Faden ("Hauptfaden") ist jetzt immer echtes Rot (`#e0231f`)
  statt einer zufälligen Palettenfarbe je nach Nutzer-ID; Lernenden-Fäden
  behalten die unterscheidbare Paletten-Zuweisung.
- [x] Faden-Objektliste im Panel vereinfacht: kein Filter, kein separater
  Titel mehr - zeigt direkt nur die noch nicht im Faden enthaltenen
  ("nicht in Präsentation") Objekte zum Zuschalten.
- [x] Checkbox "Hintergrund bewegt sich beim Zoom mit" jetzt direkt über
  dieser Objekt-Liste statt beim Präsentations-Button.
- [x] **Faden-Linie**: durchgehende, an den Wegpunkten (Bildern)
  abgerundete Catmull-Rom-Kurve statt unabhängiger Einzelsegmente mit
  Knick an den Übergängen.
- [x] **Präsentations-Kamera überarbeitet**: startet mit einem Zoom aus
  einer Übersicht in die erste Station hinein (statt sofort scharf
  gestellt zu erscheinen); Übergänge zwischen Stationen machen ab einer
  Mindestentfernung einen kurzen "Sprung" (kurzzeitig herauszoomen für
  Überblick, dann zur Zielstation heranzoomen) - Höhe und Dauer des
  Sprungs wachsen mit der zurückgelegten Entfernung.
- [x] Rahmen bleiben in der Präsentation vollständig unsichtbar (bereits in
  Phase 13 umgesetzt, hier verifiziert) - kleinerer Rahmen = stärkerer
  Zoom ist durch die Fitting-Formel bereits inhärent korrekt.
- [x] **Assistent-Navigation umgebaut**: Perspektive-, Zuschnitt- und
  Farbe-Schritt haben jetzt kreisrunde Zurück-/Weiter-Pfeile, fest
  positioniert bei 30 %/60 % der Bildbreite am unteren Rand, statt einer
  breiten Aktionsleiste bzw. eines reinen Abbrechen-Buttons - "Zurück"
  führt zum jeweils vorherigen Schritt (nicht mehr kompletter Abbruch).

**Teil 2 (siehe unten, Phase 14 Fortsetzung):** Wortfeld-Editor-
Formatierungswerkzeuge und Schriftarten-Einbettung - erledigt.

---

## Phase 14 (Fortsetzung) — Wortfeld-Formatierungswerkzeuge + Font-Einbettung ✅

- [x] **Rich-Text-Umstellung**: Textobjekte speichern jetzt `innerHTML`
  (`t.html`) statt reinem `textContent` - Formatierung bleibt beim
  Zwischenspeichern erhalten. Abwärtskompatibel: ältere Wortfelder mit nur
  `t.text` werden weiterhin korrekt angezeigt und exportiert.
- [x] Formatierungswerkzeuge: Fett/Kursiv/Unterstrichen/Durchgestrichen/
  Aufzählung (per `document.execCommand`, mit `mousedown`+`preventDefault`
  gegen Fokusverlust), wirken auf die aktuelle Textauswahl im jeweils
  aktiven Textobjekt.
- [x] Zeilenabstand- und Laufweite-Regler pro Textobjekt.
- [x] Werkzeuge in einem Grid angeordnet: zwei (Zeilenabstand/Laufweite)
  bzw. fünf Spalten (Formatierungs-Icons) ab 480px Breite, sonst
  untereinander.
- [x] **Export**: alle Textobjekte (nicht nur das primäre) laufen jetzt
  über `foreignObject` mit echtem HTML-Markup statt SVG-`<text>` - so
  werden Formatierung, Zeilenabstand und Laufweite auch im gespeicherten
  SVG korrekt wiedergegeben.
- [x] **Schriftarten-Einbettung**: die eingebundene Google-Font
  ("Handschrift") wird beim Speichern asynchron als Base64-Daten-URI in
  einen `<style>`-Block direkt im SVG eingebettet (`embedFontsInSVG`) -
  bleibt dadurch auch beim Anzeigen als `<img>`-Quelle erhalten. Bei
  Netzwerkfehlern wird unverändert mit Systemschrift-Rückfall gespeichert,
  statt das Speichern zu blockieren.

**Scoping-Hinweis:** "Laufweite für einzelne Worte" wurde als Regler pro
gesamtem Textobjekt umgesetzt (wirkt auf den ganzen Textblock), nicht als
Auswahl-basierte Formatierung einzelner Wörter - eine echte Wort-für-Wort-
Auswahl hätte eine deutlich komplexere Selektions-UI erfordert. Die
Positionierung/Größe weiterer (nicht-primärer) Textobjekte im exportierten
SVG wird aus dem Textinhalt geschätzt, nicht live aus dem DOM gemessen.

---

## Phase 15 — Rahmen-Schichtung, echte Flugbahn-Animation, Faden-Stil ✅

Achter Feedback-Durchgang. Betrifft: `classes/external.php` (neue Felder
`framez`/`linewidth`, neuer Endpunkt `set_thread_style`, itemtype
`overview`), `js/app.js` (Kamera-Animation komplett neu, Layer-Panel,
Faden-Stil-UI), `db/install.xml` + `upgrade.php`.

- [x] **Bugfix Rahmen-Resize-Handle**: hatte nie eigene Position/Größe im
  CSS (nur eine Opacity-Regel ohne Geometrie) - dadurch faktisch
  unsichtbar/nicht klickbar. Jetzt mit echter Geometrie unten rechts,
  sichtbar bei Hover.
- [x] **Rahmen in der Schichtung**: neues Feld `framez` - das
  Schichtung-Panel zeigt jetzt Fotos UND Rahmen gemeinsam in einer per
  Drag sortierbaren Liste; Rahmen-Z-Index auf dem Board kommt jetzt aus
  `framez` statt einem festen CSS-Wert.
- [x] Rahmenfarbe/-dicke folgen jetzt dem Faden (`thread.color`/
  `thread.linewidth`) statt hartcodiertem Rot/3px - ebenso die
  Verbindungslinie.
- [x] **Kamera-Animation komplett neu**: eine einzige durchgehende
  `requestAnimationFrame`-Schleife ersetzt die vorherigen zwei per
  `setTimeout` verketteten CSS-Transitions (die die spürbare Pause "oben"
  verursachten). Zeitverlauf folgt einer Ease-in-out-Kurve (schwungvoller
  Start, sanfte Landung), die Bogenhöhe (Zoom-Dip) folgt `sin(t·π)` und
  ist bei kurzen Wegen nahe 0 ("elastisches Gleiten"), bei weiten Wegen
  deutlich ausgeprägt (echter parabelartiger Bogen). Gilt auch für den
  Start-Zoom-in-Effekt (dieselbe Funktion, kein Sonderfall mehr).
- [x] **Kamera-Rotation**: ist die aktuelle Station ein gedrehter Rahmen,
  dreht sich die Kamera beim Anfliegen mit (kürzester Drehweg).
- [x] **"Überblick einfügen"**: neuer Stationstyp `overview` - fügt einen
  Halte-/Pausenpunkt in den Faden ein, der beim Abspielen zur ganzen
  Board-Übersicht fliegt und dort verweilt, statt zu einem einzelnen
  Foto/Rahmen zu zoomen.
- [x] **Faden-Stil**: Farbwähler + Dicke-Regler unten im Faden-Panel
  (unterhalb der Objekt-Liste) - wirkt auf Verbindungslinie und
  Rahmen-Umrandung; Anwendung erst bei "change" (nicht während des
  Ziehens im Farbwähler), um denselben Fokus-Zerstörungs-Fehler wie beim
  Wortfeld-Editor zu vermeiden.
- [x] Start-Präsentation-Button hat jetzt die Fadenfarbe statt der festen
  Akzentfarbe.
- [x] **Nebenbei gefundener Bugfix**: `bgmoves`/`linewidth` gingen bei
  jedem `add_thread_item`-Aufruf (Foto/Rahmen/Überblick hinzufügen)
  verloren, da der lokale Faden dabei komplett neu (ohne diese Felder)
  aufgebaut wurde - neue Hilfsfunktion `replaceOwnThread()` behält sie bei.

---

## Phase 16 — Koordinatensystem-Fix Hintergrund, Faden-Linie als Canvas2D, geräteübergreifende Auswahl ✅

Neunter Feedback-Durchgang. Betrifft: `styles.css` (Hintergrund-
Koordinatensystem), `js/app.js` (Faden-Linie, Präsentations-Hintergrund,
Objekt-Auswahl).

- [x] **Kern-Fix Hintergrund-Maßstab**: `.ic-canvas-bg` war bisher
  viewport-relativ positioniert (`inset:0` + `min-width/height:1000/1400`),
  wodurch das Hintergrundbild je nach Bildschirmgröße in einem ANDEREN
  Maßstab erschien als die feste 1000x1400-Koordinatenfläche von Fotos
  und Rahmen - dadurch zeigten Rahmen in der Präsentation nicht mehr auf
  dieselbe Stelle im Bild wie beim Einrichten auf der Pinnwand. Jetzt fest
  auf 1000x1400 - echter Teil desselben Koordinatensystems, wird über
  dieselbe Zoom/Pan-Transformation mitbewegt. Der Präsentations-
  Hintergrund (bei aktivierter "Hintergrund relativ"-Checkbox) war schon
  vorher 1000x1400 - beide sind jetzt konsistent.
- [x] Präsentations-Hintergrund (Standardfall, "Hintergrund relativ" AUS):
  Maße werden jetzt explizit per JS aus der Fenstergröße gesetzt statt
  über eine CSS-Vererbungskette, die zu klein/mehrdeutig auflösen konnte.
- [x] **Faden-Linie von SVG auf Canvas2D umgestellt**: nachdem das
  SVG-viewBox-Problem trotz vorherigem Fix weiter auftrat, wurde die
  ganze Technik gewechselt - ein `<canvas>`-Element hat unmissverständliche
  Pixel-Dimensionen (width/height als echte Element-Eigenschaften), ohne
  jede Möglichkeit einer CSS-vs-Attribut-Mehrdeutigkeit wie bei SVG.
- [x] Leerrahmen sind jetzt auch sichtbar und verschiebbar, wenn das
  Schichtung-Tab (Layer) aktiv ist, nicht nur das Faden-Tab.
- [x] **Geräteübergreifende Objekt-Auswahl**: Klick auf eine Zeile im
  Schichtung- oder Faden-Panel markiert das Objekt (rote Umrandung +
  Glow) direkt auf dem Board UND in allen offenen Seitenleisten - hilft,
  ein bestimmtes (ggf. von anderen Objekten verdecktes) Foto/Rahmen
  gezielt wiederzufinden.
- [x] Farbwähler/Dicke-Regler für den Faden speichern jetzt zusätzlich
  bei "input" (mit kurzem Debounce), falls "change" auf manchen
  Browsern/Geräten für `input[type=color]` nicht zuverlässig feuert.
- [x] Kürzere Beschriftungen: "Hintergrund relativ" statt "Hintergrund
  bewegt sich beim Zoom mit", "+ Rahmen" statt "Leerrahmen zum Faden
  hinzufügen", "+ Überblick" statt "Überblick einfügen".

---

## Phase 17 — Hintergrund-Regression behoben, Präsentations-Occlusion-Bugfix, Rahmen umbenennbar ✅

Zehnter Feedback-Durchgang. Betrifft: `js/app.js` (Hintergrund-Struktur,
Occlusion-Bugfix, Auswahl-Hervorhebung, Rahmen-Umbenennung), `styles.css`
(Farbwähler-Rendering, Settings-Panel-Position), `classes/external.php`
(neuer Endpunkt `set_frame_label`).

- [x] **Regression aus Phase 16 behoben**: die Änderung auf feste
  1000x1400-Größe hatte das Hintergrundbild auf Bildschirmen, die breiter
  als 1000px sind, buchstäblich links "abgeschnitten" (die restliche
  Fläche blieb leer). Neue Struktur: äußeres Element bleibt
  bildschirmfüllende Tapete (reine Farbe), ein neues inneres
  `.ic-canvas-bg-image`-Element (fest 1000x1400) trägt das eigentliche
  Bild - dadurch gleichzeitig bildschirmfüllend UND exakt auf die
  Board-Koordinaten gemappt.
- [x] **Bugfix Präsentations-Occlusion**: Rahmen-Stationen hatten keine
  `z`-Eigenschaft, wodurch beim Zoomen auf einen Rahmen fälschlich alle
  Fotos mit z>0 dahinter ausgeblendet wurden. Occlusion wird jetzt nur
  noch angewendet, wenn die aktive Station tatsächlich ein Foto ist -
  Rahmen (und "Überblick") blenden nie mehr etwas aus.
- [x] Weicher Rand (Vignette) komplett entfernt.
- [x] **Bugfix Farbwähler**: `input[type=color]` ohne `appearance:none` und
  Styling der internen Swatch-Pseudo-Elemente füllte die Box nicht
  vollständig (nur ein schmaler Streifen sichtbar) - behoben für Faden-
  Farbe und Hintergrund-Farbe.
- [x] Settings-Panel (Hintergrund-Einstellungen) jetzt horizontal über der
  Button-Reihe zentriert statt kantenbündig/rechts verankert.
- [x] Auswahl-Hervorhebung jetzt auch in der "nicht in Präsentation"-Liste
  (vorher nur Schichtung + Faden-Reihenfolge-Liste).
- [x] **Rahmen umbenennbar**: neuer leichtgewichtiger Endpunkt
  `set_frame_label` - Beschriftung direkt in der Schichtung- und
  Faden-Reihenfolge-Liste per Klick bearbeitbar (contenteditable).

---

## Phase 18 — Hintergrund-Abschneiden/Füllen, Präsentations-Politur, Sidebar-Transparenz, Stylus ✅

Elfter Feedback-Durchgang. Betrifft: `classes/external.php` (fit-Parameter,
neue Tabelle+Endpunkte für Stylus), `js/app.js` (Präsentations-Navigation,
Stylus-Zeichenebene), `mod_form.php`/`view.php` (sidebaropacity),
`db/install.xml`+`upgrade.php`.

- [x] **Abschneiden/Füllen-Wahl für den Hintergrund**: neuer `fit`-
  Parameter (`cover`=abschneiden/`contain`=füllen) mit Radio-Buttons im
  Settings-Panel - ersetzt den entfernten "weichen Rand" vollständig
  (auch serverseitig bereinigt).
- [x] Größere Farbwähler-Buttons (32→44px).
- [x] Post-Stream-Panel öffnet sich beim ersten Laden automatisch, wenn es
  Einreichungen gibt.
- [x] Letzter Slide + "Weiter": Kamera fliegt zur Board-Übersicht und
  verlässt die Präsentation danach automatisch.
- [x] Doppelklick im Layer-/Faden-Modus öffnet die Präsentation direkt an
  der jeweiligen Station (statt der Galerie) - für Fotos und Rahmen;
  einfacher Klick markiert stattdessen (`openPresentation` unterstützt
  jetzt einen optionalen Start-Index für diese Direkt-Vorschau).
- [x] **Sidebar-Transparenz konfigurierbar**: neue Instanzeinstellung
  `sidebaropacity` (Standard 92%), über eine CSS-Variable an alle
  Seitenleisten-Panels durchgereicht.
- [x] **Stylus-Werkzeug**: eigener Button unten links (aus der unteren
  Fab-Reihe herausgelöst), direkt mit den Annotationswerkzeugen verknüpft
  (Farbpalette, Radierer, Dicke). Zeichnet auf einer eigenen, exakt
  1000x1400 großen Ebene - dasselbe Koordinatensystem wie der Hintergrund,
  bleibt dadurch bei jedem Zoom/jeder Bildschirmgröße exakt an der
  richtigen Stelle. Striche werden vektoriell gespeichert (neue Tabelle
  `pinnwand_board_ink`, ein Datensatz je Person+Board) und wiederverwenden
  dieselbe Bereinigungslogik wie Foto-Annotationen (`clean_strokes()`,
  aus `save_annotation` extrahiert).

**Noch offen:** Der gemeldete Bug "aus dem Post-Stream angepinnte Objekte
erst nach Reload bewegbar" konnte trotz gründlicher Code-Durchsicht nicht
reproduziert/lokalisiert werden - der bestehende Code (`placeStreamPhoto`,
`refreshPhotos`) sieht korrekt aus. Braucht genauere Reproduktionsschritte.

---

## Phase 19 — Echter Hintergrund-Bug gefunden (Zoom-Verschachtelung), Post-Stream-Platzierungs-Bug ✅

Zwölfter Feedback-Durchgang. Betrifft: `js/app.js`, `styles.css`.

- [x] **Kern-Bug endlich gefunden**: die Hintergrund-"Tapete" (`.ic-canvas-bg`)
  lag als Kind der gezoomten `.ic-canvas-panzoom`-Ebene. Da diese Ebene
  bei jedem Zoom ≠ 1 (dem Normalfall - die Pinnwand passt selten exakt
  in den sichtbaren Bereich) eine `scale()`-Transformation bekommt, wurde
  die Tapete MIT skaliert und füllte dadurch nur einen Teil des Fensters
  ("klebte an einer zu kleinen Fläche"). Fix: neue eigenständige
  `.ic-canvas-wallpaper`-Ebene AUSSERHALB der gezoomten Ebene (füllt immer
  den kompletten sichtbaren Bereich, unabhängig vom Zoom) - nur das
  koordinatengebundene 1000x1400-Bild-Element bleibt innerhalb der
  Zoom-Ebene (soll ja mitgezoomt werden, das ist gewollt).
- [x] **Bugfix Post-Stream-Platzierung gefunden**: die "Mitte" für neu
  platzierte Fotos (PIN-Icon/Kartenklick) wurde über die volle
  Wrap-Breite berechnet, ohne die vom Post-Stream selbst rechts belegte
  Fläche abzuziehen - das Foto landete dadurch teils unsichtbar/
  unklickbar HINTER der eigenen Seitenleiste und ließ sich erst nach
  deren Schließen (praktisch: nach Reload) bewegen. Jetzt bezieht sich
  "Mitte" auf den vom Post-Stream freien Bereich.

---

## Phase 20 — Board-Auto-Einpassung, Stylus über Objekten sichtbar ✅

Dreizehnter Feedback-Durchgang. Betrifft: `js/app.js`, `styles.css`.

- [x] **Tatsächliche Ursache des Hintergrund-Problems gefunden**: der
  Board-Zoom startete immer bei 1 (unskaliert, kein "an den Bildschirm
  anpassen"). Die 1000x1400-Koordinatenfläche (Hochformat) wirkte dadurch
  auf den meisten (breiteren als hohen) Bildschirmen wie eine schmale,
  hochkantige Insel oben links, während der Rest des Fensters leer blieb -
  und mit ihr das darin liegende Hintergrundbild. Fix: das Board wird beim
  ersten Anzeigen automatisch auf den sichtbaren Bereich eingepasst und
  zentriert (nur einmal je Board - spätere manuelle Zoom-/Pan-Anpassungen
  bleiben danach erhalten).
- [x] Stylus-Zeichenebene bekommt jetzt eine hohe Z-Ebene - Striche können
  über Fotos/Objekte hinweg gemalt werden und bleiben dabei sichtbar,
  statt darunter zu verschwinden.
- [x] Stylus-Anmerkungen werden jetzt auch in der Präsentation angezeigt
  (vorher fehlten sie dort komplett) - über den Fotos, nicht von der
  Occlusion-Logik betroffen.

---

## Phase 21 — Board auf Querformat umgestellt, Abschneiden/Füllen steuert Board-Einpassung ✅

Vierzehnter Feedback-Durchgang. Betrifft: `js/app.js`, `styles.css`.

- [x] **Board-Koordinatenfläche auf Querformat umgestellt** (1400x1000 statt
  1000x1400 hochkant) - zentrale Konstanten `BOARD_W`/`BOARD_H` statt
  verstreuter Zahlenwerte. Die meisten Präsentationsflächen/Bildschirme
  sind breiter als hoch; das hochformatige Board wirkte auf ihnen wie eine
  zu schmale Fläche mit Rand oben/unten.
- [x] Die "Abschneiden/Füllen"-Einstellung des Hintergrunds steuert jetzt
  zusätzlich, wie das Board selbst beim ersten Anzeigen eingepasst wird:
  "Füllen" (contain) zeigt das ganze Board (ggf. mit Rand), "Abschneiden"
  (cover) füllt den Bildschirm komplett aus.
- [x] Gestrichelte Randlinie für noch nicht im Faden enthaltene Objekte in
  der Präsentation entfernt.

**Scoping-Hinweis:** Eine vollständig DYNAMISCHE Board-Größe passend zum
jeweils gewählten Hintergrundbild (statt eines festen Querformats) wurde
nicht umgesetzt - das würde bei jedem Bildwechsel alle bereits platzierten
Fotos/Rahmen-Koordinaten ungültig machen bzw. neu umrechnen müssen, was
für ein bereits in Nutzung befindliches Board zu riskant/aufwendig wäre.
Das neue Querformat (1400x1000) ist als deutlich universellerer Standard
gedacht, der zu den meisten tatsächlichen Präsentationsbildern passt.

---

## Phase 22 — Hinzufügen-Modal, Text-Umbruch-Bugfix, WordArt-Grundlage, Block-Reorganisation ✅ (teilweise)

Fünfzehnter Feedback-Durchgang. Betrifft: `js/app.js`, `styles.css`, neue
Strings.

- [x] **Kern-Bugfix Textumbruch**: `display:flex` auf dem primären
  Textobjekt löste das bekannte CSS-Flexbox-`min-width:auto`-Verhalten
  aus (ein Text-Inhalt als anonymes Flex-Item verweigert das Schrumpfen
  unter seine intrinsische Breite) - dadurch funktionierte weder
  automatischer noch manueller Zeilenumbruch. Umgestellt auf
  `display:table-cell; vertical-align:middle` - zentriert genauso, ohne
  diesen Effekt.
- [x] **"Hinzufügen" ist jetzt ein Modal** (`openAddModal()`) statt eines
  seitenweiten Bildschirms - nach demselben Muster wie die Einstellungen.
  Die vormalige `renderCaptureChoice`-Funktion wurde entfernt (komplett
  ins Modal überführt); mehrere Folge-Bugs an den "Zurück ins Leere"-
  Stellen der Kamera-Ansicht behoben (kein Rückfall-Schritt mehr
  vorhanden, jetzt direkt zu "Meine Bilder").
- [x] **WordArt-Grundgerüst**: neuer Modal-Eintrag "WordArt" öffnet den
  Wortfeld-Editor im WordArt-Modus. Sechs CSS-basierte Stil-Presets
  (Normal/Umriss/3D/Glow/Chrome/Feuer), inspiriert von der als Referenz
  bereitgestellten Vorlage - als reines CSS umgesetzt (Mehrfach-
  text-shadow für 3D, -webkit-text-stroke für Kontur, drop-shadow für
  Glow, background-clip:text für Verlaufsfüllungen), dadurch sowohl live
  im Editor als auch im foreignObject-SVG-Export funktionsfähig, ohne
  SVG-Pfad-Extraktion einer Schriftart. Jeder Stil-Button zeigt sich
  selbst in seinem Stil (Live-Vorschau ohne separates Tab-System). Neues
  Schriftstärke-Feld ergänzt.
- [x] **Werkzeuge in drei Blöcke reorganisiert**: "Vorlagen" (Zettel-
  Vorlagen, direkt als Beispiel sichtbar), "Schriften" (Schriftart,
  Größe, Stärke, Zeilenabstand, Laufweite), "Form / Rand / Schatten /
  Kontur" (Formatierung, WordArt-Stile, Farbpalette). Anordnung folgt dem
  Seitenverhältnis des Zettels selbst (nicht der Bildschirmgröße):
  hochkant untereinander, quer nebeneinander (mit Fallback auf
  untereinander bei sehr schmalen Bildschirmen).

**Bewusst nicht umgesetzt (siehe Rückmeldung im Chat):**
- Audio hinzufügen (URL/Upload) und Video-Stream einbetten (gängige
  Provider) - beide würden einen komplett neuen Objekttyp quer durchs
  gesamte Datenmodell erfordern (Board-Darstellung, Präsentation,
  Schichtung, Speicherung) und wurden als eigenständiges, später zu
  planendes Feature-Paket zurückgestellt statt überstürzt unvollständig
  umgesetzt zu werden.
- Die volle WordArt-Tiefe aus der Referenzvorlage (Presets in Tabs mit
  echten Bild-Vorschauen, umfangreiche kategorisierte Web-Font-Bibliothek
  mit On-Demand-Nachladen) - stattdessen eine schlankere, aber
  vollständig funktionsfähige Variante mit sechs kuratierten Stilen und
  der bestehenden (kleineren) Schriftauswahl.

---

## Phase 23 — Plus-Button-Bugfix, Zoom-Buttons + Mausrad, schmale Scrollbalken ✅

Sechzehnter Feedback-Durchgang. Betrifft: `js/app.js`, `styles.css`.

- [x] **Kern-Bugfix Plus-Button**: das neue "Hinzufügen"-Modal (Phase 22)
  wurde an `document.body` angehängt - AUSSERHALB von `#pinnwand-app`, wo
  sämtliche CSS-Variablen (Farben, Akzentfarbe usw.) definiert sind.
  Dadurch blieb das Modal praktisch unsichtbar/unbedienbar (ein Klick
  irgendwo darauf traf de facto nur die dunkle Overlay-Fläche und schloss
  es sofort wieder). Jetzt wie das bestehende Settings-Panel innerhalb der
  App-Wurzel eingehängt (`root.appendChild` statt `document.body.appendChild`).
- [x] **Zoom-Buttons (+/-) und Mausrad-Zoom** für die Pinnwand ergänzt -
  jetzt unabhängig von der "Pinnwand verschiebbar"-Instanzeinstellung
  immer verfügbar (das Hand-Werkzeug zum Ziehen bleibt weiterhin davon
  abhängig). Zoomt zentriert auf den Mauszeiger (bzw. bei den Buttons auf
  die Board-Mitte) - der anvisierte Punkt bleibt beim Zoomen an derselben
  Bildschirmstelle stehen.
- [x] Schmale Scrollbalken app-weit (Firefox: `scrollbar-width:thin`;
  Chrome/Safari: `::-webkit-scrollbar`).
