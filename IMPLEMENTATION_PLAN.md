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
