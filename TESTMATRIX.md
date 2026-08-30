# Testmatrix — mod_pinnwand (Phasen 0–7)

Manuell auf der Testinstanz (`devmoodle.ca2b.de` o.ä.) durchzugehen, bevor
diese Version im echten Kurs eingesetzt wird. Pro Zeile: Rolle × Bildschirm.

## 1. Lehrkraft, großer Monitor (≥ 900px Breite)

- [ ] Aktivität öffnen → landet direkt auf der Pinnwand (nicht Klassenansicht)
- [ ] Kopfzeile: Titel + aktuelle Ansicht sichtbar, alle 4 Nav-Buttons klickbar
- [ ] Board-Leiste: neues Board anlegen, umschalten, Foto auf Board 2 ziehen
  bleibt dort (nicht zurück auf Board 1 nach Verschieben/Drehen/Skalieren!)
- [ ] Hand-Werkzeug + Zoom-Slider sichtbar, sofern `boardpannable` aktiviert
- [ ] Roter Faden: eigenen Faden anlegen, Fotos hinzufügen, per Drag
  umsortieren, Präsentation starten (Pfeiltasten/Klick navigieren), verlassen
- [ ] Post-Stream: nach einer Schüler-Einreichung erscheint eine Karte
  (ggf. 15s warten), auf Board ziehen legt Kopie an, Original bleibt bei
  der/dem Lernenden erhalten
- [ ] Klassenansicht: Löschen/Pinnwand-Checkbox direkt neben Thumbnail

## 2. Lehrkraft, kleiner Monitor (< 900px, z. B. Tablet quer/hoch)

- [ ] Aktivität öffnen → landet direkt in der Klassenansicht
- [ ] Kopfzeile bleibt in einer Zeile (Titel/Untertitel ggf. ausgeblendet
  unter 560px, aber KEIN Umbruch der Buttons)
- [ ] Overlay-Steuerung (Löschen/Pin) direkt im Thumbnail sichtbar

## 3. Lernenden-Rolle, Smartphone (Hochformat)

- [ ] Foto aufnehmen: Kamera-Live-Vorschau ODER Datei-Upload-Fallback (kein
  HTTPS) funktioniert
- [ ] Perspektive/Zuschnitt: Rahmen bleibt exakt auf dem Bild, auch nach
  Bildschirmdrehung
- [ ] Wortfeld: Preset wählen, Text eingeben, Schriftart wechseln, Auto-Fit
  greift bei langem Text, speichern funktioniert
- [ ] Rückseite verknüpfen (Lightbox → Rückseiten-Button), auf der Pinnwand
  per Doppelklick umblättern
- [ ] Eigenen Faden anlegen (nur falls `studentthreads` aktiviert) bzw.
  Faden-Button fehlt, wenn deaktiviert
- [ ] „Hinzufügen"-Button in der Kopfzeile bleibt erreichbar, auch mitten im
  Aufnahme-Assistenten

## 4. Allgemein / Cross-Cutting

- [ ] Kurs-Backup + Restore (mit und ohne Nutzerdaten) - Aktivität kommt
  ohne Fehlermeldung durch, Fotos/Fäden nach Restore mit Nutzerdaten vorhanden
- [ ] `.github/workflows/release.yml` läuft nach Push durch, `pinnwand.zip`
  unter `/releases/latest` aktuell
- [ ] Frisch installierte Instanz: `db/upgrade.php` läuft von Version 0
  komplett durch (alle Savepoints), keine doppelten Feld-Anlage-Fehler

## Bekannte, bewusst nicht behobene Einschränkungen (siehe IMPLEMENTATION_PLAN.md)

Diese NICHT als Bugs melden, sondern als bekannte Scoping-Entscheidungen:

- Persönliche Hintergrundbilder werden beim Restore ohne Nutzer-ID-Remapping
  wiederhergestellt (Phase 0)
- `sourcephotoid`/`backphotoid` werden beim Restore nicht umgemappt (Phase 4/6)
- Post-Stream ist ein 15-Sekunden-Poll, kein Echtzeit-Push (Phase 4)
- Textobjekte im Wortfeld sind nicht einzeln drehbar, Auto-Fit ist einzeilig
  (Phase 6)
- Doppelklick auf eine Karte mit Rückseite blättert um UND öffnet kurz die
  Galerie (Phase 6)
- Präsentationen über mehrere Boards hinweg können bei stark abweichenden
  Layouts "springen" (Phase 3)
