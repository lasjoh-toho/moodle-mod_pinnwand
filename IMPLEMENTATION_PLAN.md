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

## Phase 3 — Roter Faden + impress.js-Präsentation

Betrifft: neue DB-Tabelle `pinnwand_threads` (+ Zwischentabelle
Thread↔Objekt/Leerrahmen), neuer Endpunkt in `classes/external.php`,
neues JS-Modul, `impress.js` als Vendor-Library einbinden

- [ ] Datenmodell: Faden (Besitzer, Farbe) + geordnete Liste aus
  Foto-Referenzen **und** Leer-Rahmen (Gruppen-/Detail-Hervorhebung)
- [ ] Button mit rotem-Faden-Icon zum Anlegen eines Fadens
- [ ] Seitenpanel (ähnlich Post-Stream, selber Bereich rechts) zum Anzeigen
  und per Drag umsortieren der Faden-Karten
- [ ] Berechtigung: Lehrkraft erlaubt Lernenden in den Settings eigene Fäden
  (eigene Farbe pro Nutzer*in)
- [ ] Präsentationsmodus: verbundene Objekte werden anhand ihrer
  Board-Position/-Größe in eine `impress.js`-Sequenz überführt und abspielbar
  gemacht (nur auf großen Monitoren sinnvoll — Zugriff dort anbieten)

---

## Phase 4 — Post-Stream (Einreichungs-Warteschlange)

Betrifft: neues JS-UI-Modul (rechter Rand), CSS-Animationen, ggf. Polling/
Subscription auf neue Einreichungen

- [ ] Neue Einreichungen erscheinen als Karten am rechten Rand, Bewegung
  von unten nach oben
- [ ] Sticky-Stack-Verhalten am oberen Rand: ältere Karten stapeln sich,
  bleiben als schmale Titelzeile sichtbar, bis sie ganz herausgeschoben
  werden; **zwei** Karten am unteren Rand immer vollständig sichtbar
- [ ] Karten-Breite per Drag änderbar
- [ ] Schmaler Filter oben im Stream
- [ ] Drag einer Karte auf das Board = Pin-Aktion (verbindet mit Phase 2)

---

## Phase 5 — Klassenansicht: Layout-Feinschliff

Betrifft: `js/app.js` (Klassenansicht), `styles.css`
*(Bugfix aus Phase 0 ist hier bereits enthalten/vorausgesetzt)*

- [ ] Löschen-Button + Pinnwand-Checkbox pro Bild direkt neben dem Thumbnail;
  auf kleinen Bildschirmen **im** Thumbnail platziert (Overlay)

---

## Phase 6 — Hinzufügen/Bearbeiten: Editor-Erweiterungen

Betrifft: `js/app.js` (Editor-Pipeline), `classes/external.php` (neue
Felder/Endpunkte), `db/install.xml` + `upgrade.php`

- [ ] Bildgröße im Editor: immer vollständig sichtbar, in einer Richtung
  100 % Füllung (Fix bestehender Lightbox-Messlogik auf Editor übertragen)
- [ ] Zuschneide-Rahmen exakt auf Bildkoordinaten gemappt (Koordinaten-Fix)
- [ ] Editor-Schritte als Buttons: Pfeil rechts = weiter, Haken = speichern
  (bestehende Schritt-Navigation umbauen)
- [ ] **Textrahmen ("Wortfeld")**: Rahmen mit/ohne Hintergrund, Presets
  (Schwarz/Weiß+Schatten "virtueller Zettel", Schwarz/Farbe, Weiß/Schwarz),
  Farbwähler mit Palette, einbindbare Fonts, mehrere Text-Objekte in einem
  Rahmen anordenbar, Auto-Fit der Textgröße (Logik analog
  [pretextjs fit-text-to-container](https://pretextjs.dev/fit-text-to-container)
  in eigener JS-Umsetzung, keine externe Abhängigkeit nötig)
- [ ] **Rückseiten-Beschriftung**: Doppelklick zum Umblättern, Festlegen
  welche Seite oben liegt (z-order-Feld pro Foto)
- [ ] Bild-Import per URL: bereits vorhanden — an neue Editor-Pipeline
  anpassen, CORS-Hinweis/Quellenangabe beibehalten

---

## Phase 7 — Galerie: Politur

Betrifft: `js/app.js` (Lightbox), `styles.css`

- [ ] Zurück-Navigation per Klick auf schwarzen Hintergrund (nicht bei
  aktiven Annotationen/Rahmen um das Bild, nicht in Button-Safezones)
- [ ] Annotationen/Striche exakt gemappt (Koordinaten-Audit, ggf. gleicher
  Fix wie Phase 6 Zuschneide-Rahmen)
- [ ] Doppelklick auf Farbfeld → Farbe neu definieren, **nur für aktuelles
  Bild** gültig

---

## Phase 8 — Test & Rollout

- [ ] `version.php` hochzählen, `db/upgrade.php`-Schritte für alle neuen
  Felder/Tabellen ergänzen
- [ ] Manuelle Testmatrix: großer Monitor/Lehrkraft, kleiner Monitor/
  Lehrkraft, Lernender-Rolle, Mobilgerät (eine Zeile Buttons prüfen)
- [ ] `README.md`: Änderungsprotokoll fortschreiben (bestehendes Format
  "Überarbeitung" beibehalten)

---

## Offene Rückfragen (vor Umsetzung klären)

- Post-Stream und Roter-Faden-Panel teilen sich laut Vorgabe denselben
  Bereich rechts — sollen sie als Tabs/Umschalter im selben Slot koexistieren?
- Mehrfach-Boards: pro Aktivität global oder pro Nutzer*in getrennt?
- Impress.js-Präsentation: nur Lehrkraft startbar, oder auch Lernenden mit
  Faden-Recht?
