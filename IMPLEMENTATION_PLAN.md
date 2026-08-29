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

## Phase 0 — Housekeeping & Rebranding
*Kein neues Feature, aber Voraussetzung für alles Weitere.*

- [ ] `LICENSE`-Datei mit obigem Lizenztext anlegen
- [ ] Umbenennung "Bildaufnahme" → "Pinnwand" durchgängig:
  `lang/de/pinnwand.php`, `lang/en/pinnwand.php`, `mod_form.php`, `README.md`
- [ ] **Bugfix Klassenansicht**: doppelte Filter-Begriffe in den Filterbuttons
  beheben + fehlende Icons ergänzen (`js/app.js`, Klassenansicht-Toolbar)

---

## Phase 1 — App-Shell, responsives Start-Verhalten, Layout/Buttons

Betrifft: `view.php` (Einstiegslogik), `js/app.js` (Shell/Router), `styles.css`

- [ ] **Einstiegslogik** in `view.php`/`app.js`:
  - Bearbeiten-Modus aktiv (`isediting`) → Moodle-spezifischer View mit
    Zugriff auf Einstellungen (bestehendes `settingsurl` nutzen)
  - Bearbeiten-Modus aus → direkt App im Vollbild, ohne Einstellmöglichkeiten
  - Innerhalb der App (nur für Lehrkraft-Rolle): großer Monitor →
    Pinnwand-Ansicht als Startbildschirm; kleiner Monitor → Klassenübersicht
    als Startbildschirm (Breakpoint definieren, z. B. `matchMedia`)
- [ ] **Kopfzeile**: zentrierte Überschrift (Pinnwand-Name) + Name der
  aktuellen Oberfläche (z. B. "Meine Bilder"), beide nur ab definierter
  Mindestbreite sichtbar
- [ ] **Obere Buttons**: rechts Board/Meine Bilder/Hinzufügen/Klassenübersicht,
  links Zurück-zum-Kurs + Vollbild — muss auf Mobilgeräten in **einer Zeile**
  bleiben (Icon-only unterhalb Breakpoint)
- [ ] **Untere Buttons**: alle ansichtsspezifischen Aktionen unten mittig,
  runde Buttons mit transparentem/geblurrtem Hintergrund — Ausnahme:
  Overlay-Werkzeuge "Raster", "Daten", "Annotations" bleiben separat
  positioniert (bestehende linke Dock-Leiste in der Galerie)

---

## Phase 2 — Pinnwand-Canvas: Pan/Zoom, Handles, Mehrfach-Boards

Betrifft: `js/app.js` (Canvas-Logik), `mod_form.php`/`settings.php`
(neue Option), `db/install.xml` + `db/upgrade.php` (Board-Entität)

- [ ] Einstellung "Pinnwand verschiebbar/zoombar" (pro Aktivität)
- [ ] Wenn aktiviert: Hand-Button (Pan-Modus) + Zoom-Slider im UI
- [ ] Bild-Handles nur bei Hover/Click einblenden (nicht dauerhaft)
- [ ] Pin/Unpin-Icon (SVG aus Vorgabe übernehmen) pro Foto auf dem Board
- [ ] Annotationswerkzeuge (Stift/Radierer/Text) direkt auf dem Canvas
  nutzbar, nicht nur pro Einzelfoto in der Galerie
- [ ] **Mehrfach-Boards**: neue Tabelle/Feld für Board-Zuordnung; "Board voll"
  → neues Board anlegen; Umschalter zwischen Boards im UI

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
