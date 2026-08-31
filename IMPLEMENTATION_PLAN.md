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
