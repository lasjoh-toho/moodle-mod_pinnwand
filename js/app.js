/* mod_pinnwand – eigenständige mobiltaugliche App (kein AMD, kein Build-Schritt) */
(function () {
  'use strict';

  var cfg = window.pinnwandConfig || {};
  var S = cfg.strings || {};
  var root = document.getElementById('pinnwand-app');

  // Undo/Redo: pragmatisch auf Positions-/Größen-/Rotationsänderungen von
  // Fotos und Rahmen begrenzt (die häufigsten versehentlichen Änderungen) -
  // kein vollständiges Undo für jede denkbare Aktion. Command-Pattern: jeder
  // Eintrag kennt seine eigene undo()/redo()-Funktion.
  var undoStack = [], redoStack = [];
  var undoBtnEl = null, redoBtnEl = null;
  function syncUndoRedoButtons() {
    if (undoBtnEl) { undoBtnEl.classList.toggle('disabled', !undoStack.length); }
    if (redoBtnEl) { redoBtnEl.classList.toggle('disabled', !redoStack.length); }
  }
  function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > 50) { undoStack.shift(); }
    redoStack = [];
    syncUndoRedoButtons();
  }
  function performUndo() {
    var entry = undoStack.pop();
    if (!entry) { return; }
    entry.undo();
    redoStack.push(entry);
    syncUndoRedoButtons();
    render();
  }
  function performRedo() {
    var entry = redoStack.pop();
    if (!entry) { return; }
    entry.redo();
    undoStack.push(entry);
    syncUndoRedoButtons();
    render();
  }
  document.addEventListener('keydown', function (ev) {
    if (!(ev.ctrlKey || ev.metaKey)) { return; }
    if (ev.key === 'z' || ev.key === 'Z') { ev.preventDefault(); performUndo(); }
    else if (ev.key === 'y' || ev.key === 'Y') { ev.preventDefault(); performRedo(); }
  });

  if (!root) { return; }

  // Deckkraft der Seitenleisten (Faden/Post-Stream/Schichtung) - konfigurierbar
  // in den Aktivitätseinstellungen, per CSS-Variable an die Panels durchgereicht.
  var sidebarOpacity = (typeof cfg.sidebaropacity === 'number') ? cfg.sidebaropacity : 92;
  document.documentElement.style.setProperty('--ic-sidebar-opacity', Math.max(0, Math.min(100, sidebarOpacity)) / 100);

  // ------------------------------------------------------------------
  // Ajax-Hilfsfunktion (spricht direkt mit Moodles lib/ajax/service.php,
  // ohne RequireJS/AMD core/ajax – dadurch ist app.js ein simples
  // statisches Script ohne Build-Schritt).
  // ------------------------------------------------------------------
  function callAjax(methodname, args) {
    var url = cfg.wwwroot + '/lib/ajax/service.php?info=' + encodeURIComponent(methodname) +
      '&sesskey=' + encodeURIComponent(cfg.sesskey);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ index: 0, methodname: methodname, args: args }])
    }).then(function (r) { return r.json(); }).then(function (res) {
      var entry = res[0];
      if (entry.error) {
        throw new Error(entry.exception ? entry.exception.message : 'AJAX-Fehler');
      }
      return entry.data;
    });
  }

  // ------------------------------------------------------------------
  // Globaler Zustand
  // ------------------------------------------------------------------
  var state = {
    step: 'home',
    activeShapeId: null,  // gerade ausgewählte Form im Zettel-/WordArt-Editor (tf.shapes)
    sourceCanvas: null,   // rohes Foto nach Aufnahme
    corners: null,        // 4 Ecken für Entzerrung (in Bildschirm-Koordinaten der Vorschau)
    workCanvas: null,     // Zwischenergebnis nach Entzerrung
    cropRect: null,
    finalCanvas: null,    // Ergebnis vor dem Raster (wird unverändert/ohne Raster gespeichert)
    gridType: 'none',
    gridValue: 40,
    gridVisible: true,    // globales Ein-/Ausschalten des Raster-Overlays (Anzeige, nicht Speicherung)
    background: { type: 'color', color: '#2b2d33', url: null, brightness: 100, saturation: 100 },
    candelete: false,      // darf fremde Fotos löschen (Lehrkraft-Bereinigungsmodus)
    canmoderate: false,    // darf Klassenansicht sehen
    studentcansend: true,  // Aktivitätseinstellung: Lernende dürfen eigene Fotos zur Pinnwand senden/entfernen
    teachercansend: true,  // Aktivitätseinstellung: Lehrkräfte dürfen beliebige Fotos zur Pinnwand senden/entfernen
    showData: false,       // Anordnung: Metadaten unter jedem Foto ein-/ausblenden
    editingPhotoId: null,  // falls gesetzt: die Pipeline überschreibt dieses bestehende Foto statt ein neues anzulegen
    sourceInfo: null,
    photos: [],           // vom Server geladene / neu gespeicherte Fotos
    maxpictures: cfg.maxpictures || 0,
    stream: null,
    lightboxIndex: null,
    boardZoom: 1,          // Pinnwand: aktueller Zoomfaktor (nur wenn boardpannable)
    boardPanX: 0, boardPanY: 0, // Pinnwand: aktueller Versatz (Pan)
    boardPanMode: false,   // Pinnwand: Hand-Werkzeug aktiv
    boardDrawMode: false,  // Pinnwand: Annotationswerkzeug direkt auf dem Canvas aktiv
    boards: [],            // Liste der Boards {id, name} - id 0 = implizites erstes Board
    currentBoard: 0,       // aktuell angezeigtes Board (id)
    threads: [],           // vom Server geladene Rote Fäden (eigener + ggf. der Lehrkraft)
    canusethreads: false,  // darf eigenen Faden anlegen/bearbeiten
    threadPanelOpen: false, // Faden-Seitenpanel ein-/ausgeblendet
    streamPhotos: [],      // Post-Stream: eigene unplatzierte Fotos + (Lehrkraft) fremde Einreichungen
    streamPanelOpen: false,
    streamFilter: '',
    sidebarWidth: 260, // gemeinsame, verstellbare Breite für Post-Stream/Faden/Layer/Trashbin
    canusepoststream: true, // darf den Post-Stream nutzen (Instanzeinstellung)
    canuselayers: false,    // darf das Schichtung-Panel nutzen (Instanzeinstellung)
    layerPanelOpen: false,
    selectedItemKey: null, // z.B. 'photo:123' oder 'frame:456' - für Hervorhebung in allen Leisten + auf dem Board
    boardInkStrokes: [],   // Stylus: eigene Striche direkt auf dem Hintergrund des aktuellen Boards
    boardInkBoard: null,   // zu welchem Board boardInkStrokes gerade gehört (löst Neuladen bei Board-Wechsel aus)
    boardDrawColor: null,  // wird beim ersten Öffnen des Stylus-Panels auf INK_COLORS[0] gesetzt
    boardDrawWidth: 0.01,
    boardDrawErase: false,
    boardInkHidden: false, // eigene Stylus-Anmerkungen ausgeblendet (rein visuell, nicht gelöscht)
    threadObjectFilter: 'all',
    boardNames: {}, // boardid -> eigener Titel (Standard: Aktivitätsname [+ Nummer], siehe boardDisplayName)
    multiSelect: [], // Mehrfachauswahl per Auswahlbox/Strg+Klick, z.B. ['photo:12','frame:3']
    multiSelectAddMode: false, // nach Klick auf den Plus-Button: normale Klicks schalten die Auswahl um, bis auf leere Fläche geklickt wird
    boardFilter: '', // Filterleiste: blendet Fotos aus, die in keinem Feld (Titel/Jahr/Epoche/Autor der Vorlage/Autor) übereinstimmen
    extraPlacements: [], // zusätzliche Objekt-Platzierungen des aktuellen Boards (z.B. nach Klonen) - siehe loadExtraPlacements
    extraPlacementsBoard: null, // zu welchem Board extraPlacements gerade gehört (löst Neuladen bei Board-Wechsel aus)
    trashPanelOpen: false,
    boardHideMedia: false, // Lupenmenü: alle Medien (Fotos ohne Wortfeld-Daten) ausblenden, nur Texte/Wortfelder zeigen
    trashItems: []
  };

  // ------------------------------------------------------------------
  // Kleine DOM-Helfer
  // ------------------------------------------------------------------
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) { return; }
      if (k === 'class') { e.className = attrs[k]; }
      else if (k === 'html') { e.innerHTML = attrs[k]; }
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
        e.addEventListener(k.slice(2), attrs[k]);
      } else { e.setAttribute(k, attrs[k]); }
    });
    (children || []).forEach(function (c) {
      if (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    });
    return e;
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
  }

  function countLabel() {
    if (state.maxpictures > 0) {
      return S.photocount.replace('{count}', state.photos.length).replace('{max}', state.maxpictures);
    }
    return S.photocount_unlimited.replace('{count}', state.photos.length);
  }

  // ==================================================================
  // Layout-Grundgerüst: Kopfzeile + Body (wird bei jedem Render neu
  // aufgebaut – die App ist klein genug, dass ein einfacher
  // "re-render everything"-Ansatz performant genug ist).
  // ==================================================================
  function render() {
    stopStream();
    root.innerHTML = '';
    var body = el('div', { class: 'ic-body' });
    root.appendChild(body);

    // Einheitliche, persistente Kopfzeile auf jedem Bildschirm: links Zurück-
    // zum-Kurs + Vollbild, mittig Pinnwand-Name + Name der aktuellen
    // Oberfläche (Titel/Untertitel nur ab einer Mindestbreite sichtbar,
    // s. CSS), rechts die vier Haupt-Oberflächen als Navigations-Buttons.
    // Bewusst in einer Zeile gehalten (auch mobil) - siehe .ic-topbar CSS.
    root.appendChild(renderTopBar());

    switch (state.step) {
      case 'home': renderHome(body); break;
      case 'capture': renderCapture(body); break;
      case 'perspective': renderPerspective(body); break;
      case 'crop': renderCrop(body); break;
      case 'color': renderColor(body); break;
      case 'source': renderSource(body); break;
      case 'textframe': renderTextFrame(body); break;
      case 'arrange': renderArrange(body); break;
      case 'moderate': renderModerate(body); break;
    }
  }

  // Ansichtsnamen für die Untertitel-Anzeige mittig in der Kopfzeile -
  // sowohl die vier Hauptansichten als auch die Einzelschritte des
  // Hinzufügen-Assistenten (dessen eigene Neugestaltung folgt in Phase 6).
  var VIEW_LABELS = {
    home: S.mygallery, arrange: S.pinboard, moderate: S.moderate_mode,
    capture: S.step_capture, perspective: S.step_perspective, crop: S.step_crop,
    color: S.step_color, source: S.step_source, textframe: S.textframe_title
  };
  // Diese Schritte gehören zum Hinzufügen-Assistenten - der "Hinzufügen"-
  // Navigationsbutton gilt hier ebenfalls als aktiv.
  var ADD_WIZARD_STEPS = { capture: 1, perspective: 1, crop: 1, color: 1, source: 1, textframe: 1 };

  function goToView(step) {
    return function () {
      if (state.step === step) { return; }
      if (ADD_WIZARD_STEPS[state.step] && !ADD_WIZARD_STEPS[step]) { resetCaptureState(); }
      // Beim Verlassen der Klassenübersicht: eigene Fotos und Post-Stream
      // frisch nachladen, damit während der Klassenansicht vorgenommene
      // Pin-Änderungen (z.B. ein von der Lehrkraft neu angepinntes Foto)
      // sofort in der eigenen Pinnwand/Seitenleiste ankommen, statt erst
      // beim nächsten Zufallsauslöser.
      var leavingModerate = state.step === 'moderate';
      state.step = step;
      render();
      if (leavingModerate) {
        refreshPhotos();
        loadStreamPhotos();
      }
    };
  }

  function toggleFullscreen(btn) {
    var el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  }

  function renderTopBar() {
    var bar = el('div', { class: 'ic-topbar' });

    var left = el('div', { class: 'ic-topbar-left' });
    left.appendChild(el('a', {
      class: 'ic-icon-btn', title: S.back_course, 'aria-label': S.back_course, href: cfg.courseurl || '#'
    }, [icon('courseback')]));
    var fsActive = !!document.fullscreenElement;
    var fsBtn = el('button', {
      class: 'ic-icon-btn', title: fsActive ? S.exitfullscreen : S.fullscreen,
      'aria-label': fsActive ? S.exitfullscreen : S.fullscreen
    }, [icon('fullscreen')]);
    fsBtn.addEventListener('click', toggleFullscreen);
    left.appendChild(fsBtn);
    bar.appendChild(left);

    var center = el('div', { class: 'ic-topbar-center' });
    if (state.step === 'arrange') {
      center.appendChild(renderBoardTitleBar());
    } else {
      center.appendChild(el('span', { class: 'ic-topbar-title' }, [root.dataset.title || '']));
      center.appendChild(el('span', { class: 'ic-topbar-sub' }, [VIEW_LABELS[state.step] || '']));
    }
    bar.appendChild(center);

    var right = el('div', { class: 'ic-topbar-right' });
    var navItems = [
      ['arrange', 'thumbtack', S.pinboard],
      ['home', 'person', S.mygallery]
    ];
    if (state.canmoderate) { navItems.push(['moderate', 'group', S.moderate_mode]); }
    navItems.forEach(function (item) {
      var isActive = state.step === item[0];
      var b = el('button', {
        class: 'ic-icon-btn' + (item[0] === 'arrange' ? ' ic-nav-pin' : '') + (isActive ? ' active' : ''),
        title: item[2], 'aria-label': item[2]
      }, [icon(item[1])]);
      b.addEventListener('click', goToView(item[0]));
      right.appendChild(b);
    });
    var addNavBtn = el('button', {
      class: 'ic-icon-btn' + (ADD_WIZARD_STEPS[state.step] ? ' active' : ''), title: S.addphoto, 'aria-label': S.addphoto
    }, [icon('camera')]);
    addNavBtn.addEventListener('click', function () { openAddModal(); });
    right.appendChild(addNavBtn);
    bar.appendChild(right);

    return bar;
  }

  function stepsBar(activeIdx) {
    var labels = [S.step_capture, S.step_perspective, S.step_crop, S.step_color, S.step_source];
    var bar = el('div', { class: 'ic-steps' });
    labels.forEach(function (l, i) {
      bar.appendChild(el('span', { class: i <= activeIdx ? 'done' : '' }));
    });
    return bar;
  }

  // ==================================================================
  // HOME: Galerie der eigenen Fotos + Start-Buttons
  // ==================================================================
  // Modal für Objekte auf 3+ Boards (Heimat + 2 oder mehr zusätzliche
  // Platzierungen) - eine einfache Rot/Blau-Pin-Unterscheidung reicht hier
  // nicht mehr aus, da unklar wäre, von welchem der mehreren Boards
  // entfernt werden soll.
  function openMultiBoardDeleteModal(p, idx) {
    var overlay = el('div', { class: 'ic-modal-overlay' });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) { overlay.remove(); } });
    var panel = el('div', { class: 'ic-add-modal' });
    panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.objectusage_title]));
    var list = el('div', {});
    panel.appendChild(list);
    callAjax('mod_pinnwand_get_object_usage', { cmid: cfg.cmid, photoid: p.id }).then(function (res) {
      (res.usages || []).forEach(function (u) {
        var row = el('div', { class: 'ic-thread-item' });
        row.appendChild(el('span', { class: 'ic-thread-item-label' }, [boardDisplayName(u.boardid)]));
        var rmBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [icon('trash')]);
        rmBtn.addEventListener('click', function () {
          var call = u.kind === 'home'
            ? callAjax('mod_pinnwand_delete_photo', { cmid: cfg.cmid, photoid: u.id })
            : callAjax('mod_pinnwand_set_placement_status', { cmid: cfg.cmid, placementid: u.id, status: 'trash' });
          call.then(function () {
            row.remove();
            if (u.kind === 'home') {
              overlay.remove();
              state.photos.splice(idx, 1);
              render();
            }
          });
        });
        row.appendChild(rmBtn);
        list.appendChild(row);
      });
    });
    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon ic-modal-close', title: S.cancel }, ['\u2715']);
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  function renderHome(body) {
    var wrap = el('div', { class: 'ic-home' });
    var maxreached = state.maxpictures > 0 && state.photos.length >= state.maxpictures;

    if (maxreached) {
      wrap.appendChild(el('p', { class: 'ic-hint' }, [S.maxreached]));
    }

    var list = el('div', { class: 'ic-home-list' });
    state.photos.forEach(function (p, idx) {
      var row = el('div', { class: 'ic-home-row' + rowStateClass(p) });
      var thumb = el('div', { class: 'ic-thumb' + (p.otherboardcount > 0 ? ' ic-thumb-pinned' : '') });
      var imgWrap = el('div', { class: 'ic-thumb-img-wrap' });
      var img = el('img', { src: p.url, alt: '' });
      img.addEventListener('click', function () { openLightbox(idx); });
      imgWrap.appendChild(img);
      thumb.appendChild(imgWrap);
      if (state.studentcansend) {
        var sendBtn = el('button', {
          class: 'ic-send' + (p.hiddenfromboard ? '' : ' active'),
          title: p.hiddenfromboard ? S.pintooltip : S.unpintooltip
        }, [icon('send')]);
        sendBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var newHidden = !p.hiddenfromboard;
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: p.id, hidden: newHidden }).then(function () {
            p.hiddenfromboard = newHidden;
            loadStreamPhotos();
            render();
          });
        });
        thumb.appendChild(sendBtn);
      }
      // Pin: platziert/entfernt das Objekt auf dem eigenen Board (nicht
      // dem Master-Board) - nur sichtbar, wenn ein solches überhaupt
      // existiert. Der aktive Zustand ergibt sich aus otherboardcount > 0,
      // da das eigene Board die einzig mögliche Zusatz-Platzierung ist,
      // solange nur ein eigenes Board existiert.
      if (state.studentcansend && boardList().length > 1) {
        var pin = el('button', {
          class: 'ic-pin' + (p.otherboardcount > 0 ? ' active' : ''),
          title: p.otherboardcount > 0 ? S.unpintooltip : S.pintooltip
        }, [icon('thumbtack')]);
        pin.addEventListener('click', function (ev) {
          ev.stopPropagation();
          callAjax('mod_pinnwand_toggle_own_board_placement', { cmid: cfg.cmid, photoid: p.id }).then(function (res) {
            p.otherboardcount = Math.max(0, (p.otherboardcount || 0) + (res.placed ? 1 : -1));
            render();
          });
        });
        thumb.appendChild(pin);
      }
      var multiClass = p.otherboardcount >= 2 ? ' ic-del-multi' : p.otherboardcount === 1 ? ' ic-del-shared' : '';
      var del = el('button', {
        class: 'ic-del' + multiClass,
        title: p.otherboardcount > 0 ? S.deletephoto_multi_hint : null
      }, [icon('trash')]);
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (p.otherboardcount >= 2) { openMultiBoardDeleteModal(p, idx); return; }
        if (confirm(p.otherboardcount === 1 ? S.confirmdelete_shared : S.confirmdelete)) {
          callAjax('mod_pinnwand_delete_photo', { cmid: cfg.cmid, photoid: p.id }).then(function () {
            state.photos.splice(idx, 1);
            render();
          });
        }
      });
      thumb.appendChild(del);
      row.appendChild(thumb);

      // Datenfelder direkt neben dem Bild (wie in der Klassenansicht) -
      // auf schmalen Bildschirmen standardmäßig ausgeblendet und per
      // Info-Button von rechts einblendbar (siehe CSS), da neben dem
      // Thumbnail sonst zu wenig Platz bliebe.
      function persistSource() {
        callAjax('mod_pinnwand_update_source', {
          cmid: cfg.cmid, photoid: p.id,
          sourcetitle: p.sourcetitle, sourceauthor: p.sourceauthor, sourceyear: p.sourceyear,
          sourceepoch: p.sourceepoch, sourceplace: p.sourceplace, sourceorigauthor: p.sourceorigauthor
        }).catch(function () { /* bleibt lokal sichtbar, Speichern fehlgeschlagen */ });
      }
      function editField(key, labelKey, sizeMod) {
        var input = el('input', {
          type: 'text', value: p[key] || '', placeholder: S[labelKey],
          class: 'ic-moderate-input' + (sizeMod === 'narrow' ? ' ic-moderate-input-narrow' : '') +
            (sizeMod === 'wide' ? ' ic-moderate-input-wide' : '')
        });
        input.addEventListener('change', function () { p[key] = input.value; persistSource(); });
        return input;
      }
      var fields = el('div', { class: 'ic-home-fields' });
      var fieldsRow1 = el('div', { class: 'ic-moderate-fields' });
      var titleWrap = el('div', { class: 'ic-field-inline', style: 'flex:1 1 140px' });
      titleWrap.appendChild(editField('sourcetitle', 'sourcetitle'));
      fieldsRow1.appendChild(titleWrap);
      var authorInput = editField('sourceauthor', 'sourceauthor');
      var authorWrap = el('div', { class: 'ic-field-inline', style: 'flex:1 1 160px' });
      authorWrap.appendChild(authorInput);
      authorInput.disabled = !!(p.sourceauthor && p.sourceauthor === cfg.currentuserfullname);
      var meLabel = el('label', { class: 'ic-me-check', title: S.student_is_author });
      var meCheck = el('input', { type: 'checkbox', 'aria-label': S.student_is_author });
      meCheck.checked = !!(p.sourceauthor && p.sourceauthor === cfg.currentuserfullname);
      meCheck.addEventListener('change', function () {
        if (meCheck.checked) {
          authorInput.value = cfg.currentuserfullname;
          p.sourceauthor = cfg.currentuserfullname;
          authorInput.disabled = true;
        } else {
          authorInput.disabled = false;
        }
        persistSource();
      });
      meLabel.appendChild(meCheck);
      authorWrap.appendChild(meLabel);
      fieldsRow1.appendChild(authorWrap);
      fields.appendChild(fieldsRow1);
      var fieldsRow2 = el('div', { class: 'ic-moderate-fields' });
      fieldsRow2.appendChild(editField('sourceyear', 'sourceyear', 'narrow'));
      fieldsRow2.appendChild(editField('sourceepoch', 'sourceepoch', 'narrow'));
      fieldsRow2.appendChild(editField('sourceplace', 'sourceplace', 'wide'));
      fieldsRow2.appendChild(editField('sourceorigauthor', 'sourceorigauthor'));
      fields.appendChild(fieldsRow2);
      row.appendChild(fields);

      // Nur auf schmalen Bildschirmen sichtbar (siehe CSS): Info-Button
      // blendet die Datenfelder von rechts ein/aus.
      var fieldsToggle = el('button', { class: 'ic-home-fields-toggle', title: S.databtn }, [icon('info')]);
      fieldsToggle.addEventListener('click', function (ev) {
        ev.stopPropagation();
        fields.classList.toggle('open');
      });
      row.appendChild(fieldsToggle);

      list.appendChild(row);
    });
    wrap.appendChild(list);
    body.appendChild(wrap);

    // Deutlich sichtbarer +-Button unten rechts - die reine Icon-Navigation
    // oben in der Kopfzeile wurde als zu unauffällig empfunden.
    var addFab = el('button', {
      class: 'ic-home-add-fab' + (maxreached ? ' disabled' : ''), title: S.addphoto, 'aria-label': S.addphoto,
      disabled: maxreached ? 'disabled' : null
    }, ['+']);
    addFab.addEventListener('click', function () { if (!maxreached) { openAddModal(); } });
    body.appendChild(addFab);
  }

  // Öffnet den "Hinzufügen"-Dialog als Modal (wie die Einstellungen), statt
  // seitenweit die ganze Ansicht zu wechseln. Aktionen, die weitere Schritte
  // brauchen (Kamera, Wortfeld/WordArt), schließen das Modal und wechseln
  // erst dann in den jeweiligen Vollbild-Schritt.
  function openAddModal() {
    var existingOverlay = document.getElementById('ic-add-modal-overlay');
    if (existingOverlay) { existingOverlay.remove(); return; }

    var overlay = el('div', { class: 'ic-modal-overlay', id: 'ic-add-modal-overlay' });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) { overlay.remove(); } });
    var panel = el('div', { class: 'ic-add-modal' });
    panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.addobject]));

    function closeAndGo(step, prep) {
      overlay.remove();
      if (prep) { prep(); }
      state.step = step;
      render();
    }

    var fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    fileInput.addEventListener('change', function (ev) {
      var file = ev.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () { overlay.remove(); loadCapturedImage(img); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    panel.appendChild(fileInput);

    var urlRow = el('div', { class: 'ic-url-row', style: 'display:none' });
    var urlInput = el('input', { type: 'url', placeholder: 'https://...' });
    var urlGo = el('button', { class: 'ic-btn ic-btn-primary' }, [S.bg_url_apply]);
    urlGo.addEventListener('click', function () {
      var url = urlInput.value.trim();
      if (!url) { return; }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { overlay.remove(); loadCapturedImage(img); };
      img.onerror = function () { alert(S.url_load_error); };
      img.src = url;
    });
    urlRow.appendChild(urlInput); urlRow.appendChild(urlGo);

    // In Kategorien gegliedert, mit Trennlinien: Bild, Text (Audio/Video
    // und Datei sind noch keine vorhandenen Funktionen).
    panel.appendChild(el('div', { class: 'ic-add-modal-category' }, [S.category_image]));
    var gridImage = el('div', { class: 'ic-add-modal-grid' });
    var camBtn = el('button', { class: 'ic-choice-btn ic-btn-primary' }, [icon('camera'), el('span', {}, [S.takephoto])]);
    camBtn.addEventListener('click', function () { closeAndGo('capture', function () { state.captureMode = 'camera'; }); });
    var uploadBtn = el('button', { class: 'ic-choice-btn' }, [icon('upload'), el('span', {}, [S.uploadphoto])]);
    uploadBtn.addEventListener('click', function () { fileInput.click(); });
    var urlBtn = el('button', { class: 'ic-choice-btn' }, [icon('link'), el('span', {}, [S.addviaurl])]);
    urlBtn.addEventListener('click', function () {
      urlRow.style.display = urlRow.style.display === 'none' ? 'flex' : 'none';
    });
    gridImage.appendChild(camBtn);
    gridImage.appendChild(uploadBtn);
    gridImage.appendChild(urlBtn);
    panel.appendChild(gridImage);
    panel.appendChild(urlRow);

    panel.appendChild(el('div', { class: 'ic-add-modal-category' }, [S.category_text]));
    var gridText = el('div', { class: 'ic-add-modal-grid' });
    var textFrameBtn = el('button', { class: 'ic-choice-btn' }, [icon('text'), el('span', {}, [S.addtextframe])]);
    textFrameBtn.addEventListener('click', function () {
      closeAndGo('textframe', function () { state.textFrame = null; state.wordArtMode = false; });
    });
    var wordArtBtn = el('button', { class: 'ic-choice-btn' }, [icon('text'), el('span', {}, [S.addwordart])]);
    wordArtBtn.addEventListener('click', function () {
      closeAndGo('textframe', function () { state.textFrame = null; state.wordArtMode = true; });
    });
    gridText.appendChild(textFrameBtn);
    gridText.appendChild(wordArtBtn);
    panel.appendChild(gridText);

    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon ic-modal-close', title: S.cancel, 'aria-label': S.cancel }, ['\u2715']);
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  // ==================================================================
  // CAPTURE: Kamera-Aufnahme (Auswahl-Bildschirm ist jetzt ein Modal, siehe
  // openAddModal) - erst nach Klick auf "Kamera" wechselt die Ansicht in
  // den Live-Kamera-Modus und getUserMedia wird angefragt.
  // ==================================================================
  function renderCapture(body) {
    renderCaptureCamera(body);
  }

  function renderCaptureCamera(body) {
    var stage = el('div', { class: 'ic-stage' });
    var video = el('video', { autoplay: 'autoplay', playsinline: 'playsinline', muted: 'muted' });
    stage.appendChild(video);
    body.appendChild(stage);

    var bar = el('div', { class: 'ic-actionbar' });
    var cancelBtn = el('button', {
      class: 'ic-btn ic-btn-ghost ic-btn-icon', title: S.cancel, 'aria-label': S.cancel
    }, ['\u2715']);
    cancelBtn.addEventListener('click', function () {
      stopStream();
      state.captureMode = null;
      state.step = 'home';
      render();
    });
    var shootBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [S.takephoto]);
    shootBtn.addEventListener('click', function () {
      if (!state.stream) { return; }
      var c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      var img = new Image();
      img.onload = function () { loadCapturedImage(img); };
      img.src = c.toDataURL('image/jpeg', 0.92);
    });
    bar.appendChild(cancelBtn); bar.appendChild(shootBtn);
    body.appendChild(bar);

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then(function (stream) {
          state.stream = stream;
          video.srcObject = stream;
        })
        .catch(function () {
          // Keine Berechtigung/kein Kamerazugriff möglich - zurück zu Meine
          // Bilder, dort steht der Datei-Upload-Fallback im "Hinzufügen"-
          // Modal bereit.
          alert(S.camera_error);
          state.captureMode = null;
          state.step = 'home';
          render();
        });
    } else {
      alert(S.camera_error);
      state.captureMode = null;
      state.step = 'home';
      render();
    }
  }

  // Dreht einen Canvas um 90° im Uhrzeigersinn (neuer Canvas, Breite/Höhe
  // vertauscht) - für das Rotieren-Werkzeug im Zuschneide-Schritt.
  function rotateCanvas90(canvas) {
    var rotated = document.createElement('canvas');
    rotated.width = canvas.height; rotated.height = canvas.width;
    var ctx = rotated.getContext('2d');
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return rotated;
  }

  function mirrorCanvas(canvas) {
    var mirrored = document.createElement('canvas');
    mirrored.width = canvas.width; mirrored.height = canvas.height;
    var ctx = mirrored.getContext('2d');
    ctx.translate(mirrored.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0);
    return mirrored;
  }

  function loadCapturedImage(img) {
    // Auf sinnvolle Maximalgröße begrenzen (Performance der Pixel-Operationen).
    var maxdim = 1800;
    var scale = Math.min(1, maxdim / Math.max(img.width, img.height));
    var c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    state.sourceCanvas = c;
    state.corners = null;
    state.step = 'perspective';
    render();
  }

  // ==================================================================
  // PERSPEKTIVE: 4 Eckpunkte ziehen -> Homographie -> Entzerrtes Bild
  // ==================================================================
  function renderPerspective(body) {
    var stage = el('div', { class: 'ic-stage' });
    var canvas = el('canvas', { class: 'ic-view' });
    stage.appendChild(canvas);
    body.appendChild(stage);

    var src = state.sourceCanvas;
    var fitScale = fitImageToStage(canvas, stage, src.width, src.height);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);

    if (!state.corners) {
      var m = 0.12;
      state.corners = [
        { x: canvas.width * m, y: canvas.height * m },
        { x: canvas.width * (1 - m), y: canvas.height * m },
        { x: canvas.width * (1 - m), y: canvas.height * (1 - m) },
        { x: canvas.width * m, y: canvas.height * (1 - m) }
      ];
      state.cornersCanvasW = canvas.width; state.cornersCanvasH = canvas.height;
    } else if (state.cornersCanvasW !== canvas.width || state.cornersCanvasH !== canvas.height) {
      var crx = canvas.width / state.cornersCanvasW, cry = canvas.height / state.cornersCanvasH;
      state.corners = state.corners.map(function (p) { return { x: p.x * crx, y: p.y * cry }; });
      state.cornersCanvasW = canvas.width; state.cornersCanvasH = canvas.height;
    }
    makeDragOverlay(stage, canvas, state.corners, true);
    stageHint(stage, S.perspective_hint);

    stageNavArrows(stage, function () {
      resetCaptureState();
      state.step = 'home';
      render();
    }, function () {
      var scaledCorners = state.corners.map(function (p) {
        return { x: p.x / fitScale, y: p.y / fitScale };
      });
      state.workCanvas = applyPerspectiveCorrection(src, scaledCorners);
      state.step = 'crop';
      render();
    });
  }

  // Passt eine Zielgröße (Quellbild) proportional in den verfügbaren Stage-Bereich ein.
  // Reserviert etwas Rand, damit Ecken-Greifer (r=14) nie vom Stage-Rand abgeschnitten wirken.
  function fitImageToStage(canvas, stage, iw, ih) {
    var rect = stage.getBoundingClientRect();
    var HANDLE_MARGIN = 32;
    var availW = Math.max(200, (rect.width || root.clientWidth) - HANDLE_MARGIN);
    var availH = Math.max(200, (rect.height || (root.clientHeight - 160)) - HANDLE_MARGIN);
    // Bewusst ohne Obergrenze bei 1 (Originalgröße): das Bild soll immer
    // vollständig sichtbar sein UND in einer Richtung die verfügbare
    // Fläche zu 100% ausfüllen - auch wenn das kleine Bilder hochskaliert.
    var scale = Math.min(availW / iw, availH / ih);
    canvas.width = Math.round(iw * scale);
    canvas.height = Math.round(ih * scale);
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
    return scale;
  }

  // Zentrierter Hinweistext direkt im Bildrahmen (statt eigener Zeile -> mehr Platz fürs Bild).
  function stageHint(stage, text) {
    if (!text) { return; }
    stage.appendChild(el('div', { class: 'ic-stage-hint' }, [text]));
  }

  // Erstellt ein SVG-Overlay mit ziehbaren Punkten (Ecken) bzw. einem
  // Rechteck mit vier Eckgriffen. points wird per Referenz aktualisiert.
  function makeDragOverlay(stage, canvas, points, closedPoly) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ic-overlay-svg');
    svg.style.position = 'absolute';
    positionOverlay(svg, canvas);
    stage.appendChild(svg);

    var poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('fill', 'rgba(79,140,255,0.18)');
    poly.setAttribute('stroke', '#4f8cff');
    poly.setAttribute('stroke-width', '2');
    svg.appendChild(poly);

    var handles = points.map(function () {
      var g = document.createElementNS(ns, 'g');
      // Größere, unsichtbare Trefferfläche (~2cm Durchmesser bei 96dpi) - so
      // lässt sich der Punkt auch nahe am Bildrand oder mit dem Finger
      // präzise packen, ohne dass der Finger die Ecke selbst verdeckt ...
      var hit = document.createElementNS(ns, 'circle');
      hit.setAttribute('r', '38');
      hit.setAttribute('class', 'ic-handle-hit');
      hit.setAttribute('fill', 'rgba(0,0,0,0.001)');
      // ... während nur ein kleiner Punkt sichtbar ist und das Bild darunter
      // möglichst wenig verdeckt.
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', '5');
      dot.setAttribute('class', 'ic-handle-dot');
      g.appendChild(hit); g.appendChild(dot);
      svg.appendChild(g);
      return { hit: hit, dot: dot };
    });

    function redraw() {
      poly.setAttribute('points', points.map(function (p) { return p.x + ',' + p.y; }).join(' '));
      handles.forEach(function (h, i) {
        h.hit.setAttribute('cx', points[i].x);
        h.hit.setAttribute('cy', points[i].y);
        h.dot.setAttribute('cx', points[i].x);
        h.dot.setAttribute('cy', points[i].y);
      });
    }
    redraw();

    handles.forEach(function (h, i) {
      var dragging = false;
      function toLocal(ev) {
        var t = ev.touches ? ev.touches[0] : ev;
        var r = svg.getBoundingClientRect();
        return { x: t.clientX - r.left, y: t.clientY - r.top };
      }
      function down(ev) { dragging = true; ev.preventDefault(); }
      function move(ev) {
        if (!dragging) { return; }
        var p = toLocal(ev);
        points[i].x = Math.max(0, Math.min(canvas.width, p.x));
        points[i].y = Math.max(0, Math.min(canvas.height, p.y));
        redraw();
        ev.preventDefault();
      }
      function up() { dragging = false; }
      h.hit.addEventListener('mousedown', down);
      h.hit.addEventListener('touchstart', down, { passive: false });
      window.addEventListener('mousemove', move);
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('mouseup', up);
      window.addEventListener('touchend', up);
    });

    return svg;
  }

  function positionOverlay(svg, canvas) {
    svg.style.left = canvas.offsetLeft + 'px';
    svg.style.top = canvas.offsetTop + 'px';
    svg.style.width = canvas.width + 'px';
    svg.style.height = canvas.height + 'px';
    svg.setAttribute('viewBox', '0 0 ' + canvas.width + ' ' + canvas.height);
  }

  // ------------------------------------------------------------------
  // Perspektivkorrektur (Trapez -> Rechteck) via projektiver Entzerrung.
  // Mathematik nach P. Heckbert: Abbildung Einheitsquadrat -> Viereck;
  // wir nutzen sie invers, um für jeden Zielpixel den Quellpixel zu
  // finden (u,v in [0,1] -> Quellkoordinate), inkl. bilinearer Interpolation.
  // ------------------------------------------------------------------
  function computeUnitSquareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var g, h;
    var denom = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      g = 0; h = 0;
    } else {
      g = (dx3 * dy2 - dx2 * dy3) / denom;
      h = (dx1 * dy3 - dx3 * dy1) / denom;
    }
    var a = x1 - x0 + g * x1;
    var b = x3 - x0 + h * x3;
    var c = x0;
    var d = y1 - y0 + g * y1;
    var e = y3 - y0 + h * y3;
    var f = y0;
    return function (u, v) {
      var den = g * u + h * v + 1;
      return { x: (a * u + b * v + c) / den, y: (d * u + e * v + f) / den };
    };
  }

  function applyPerspectiveCorrection(srcCanvas, corners) {
    // corners: [TL, TR, BR, BL] in Quellbild-Pixelkoordinaten.
    var wTop = dist(corners[0], corners[1]);
    var wBot = dist(corners[3], corners[2]);
    var hLeft = dist(corners[0], corners[3]);
    var hRight = dist(corners[1], corners[2]);
    var outW = Math.round(Math.max(wTop, wBot));
    var outH = Math.round(Math.max(hLeft, hRight));
    var maxdim = 1600;
    var scale = Math.min(1, maxdim / Math.max(outW, outH));
    outW = Math.max(20, Math.round(outW * scale));
    outH = Math.max(20, Math.round(outH * scale));

    var mapFn = computeUnitSquareToQuad(
      corners[0].x, corners[0].y, corners[1].x, corners[1].y,
      corners[2].x, corners[2].y, corners[3].x, corners[3].y
    );

    var sctx = srcCanvas.getContext('2d');
    var srcData = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    var out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    var octx = out.getContext('2d');
    var outData = octx.createImageData(outW, outH);

    for (var y = 0; y < outH; y++) {
      var v = y / outH;
      for (var x = 0; x < outW; x++) {
        var u = x / outW;
        var s = mapFn(u, v);
        var px = bilinearSample(srcData, s.x, s.y);
        var di = (y * outW + x) * 4;
        outData.data[di] = px[0]; outData.data[di + 1] = px[1];
        outData.data[di + 2] = px[2]; outData.data[di + 3] = 255;
      }
    }
    octx.putImageData(outData, 0, 0);
    return out;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function bilinearSample(imgData, x, y) {
    var w = imgData.width, h = imgData.height;
    x = Math.max(0, Math.min(w - 1.001, x));
    y = Math.max(0, Math.min(h - 1.001, y));
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = x0 + 1, y1 = y0 + 1;
    var fx = x - x0, fy = y - y0;
    var d = imgData.data;
    function px(xx, yy) {
      var i = (yy * w + xx) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    }
    var p00 = px(x0, y0), p10 = px(x1, y0), p01 = px(x0, y1), p11 = px(x1, y1);
    var out = [0, 0, 0];
    for (var c = 0; c < 3; c++) {
      var top = p00[c] * (1 - fx) + p10[c] * fx;
      var bot = p01[c] * (1 - fx) + p11[c] * fx;
      out[c] = Math.round(top * (1 - fy) + bot * fy);
    }
    return out;
  }

  // ==================================================================
  // CROP: Rechteck mit vier Eckgriffen auf dem entzerrten Bild
  // ==================================================================
  function renderCrop(body) {
    body.appendChild(stepsBar(2));

    // Kein Zuschnitt-Handle-Schritt mehr hier - die vier Eckpunkte im
    // vorherigen (Perspektive-)Schritt übernehmen Zuschnitt UND
    // Perspektivkorrektur bereits gemeinsam (das Ergebnis ist exakt auf das
    // gewählte Viereck zugeschnitten). Dieser Schritt bietet nur noch
    // Drehen/Spiegeln als einfache Buttons - keine Handles ein zweites Mal.
    var toolRow = el('div', { class: 'ic-crop-tools' });
    var rotateBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [icon('rotate'), el('span', {}, [S.rotate90])]);
    var mirrorBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [icon('mirror'), el('span', {}, [S.mirror])]);
    toolRow.appendChild(rotateBtn); toolRow.appendChild(mirrorBtn);
    body.appendChild(toolRow);

    var stage = el('div', { class: 'ic-stage' });
    var canvas = el('canvas', { class: 'ic-view' });
    stage.appendChild(canvas);
    body.appendChild(stage);

    var src = state.workCanvas;
    fitImageToStage(canvas, stage, src.width, src.height);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);

    rotateBtn.addEventListener('click', function () {
      state.workCanvas = rotateCanvas90(state.workCanvas);
      render();
    });
    mirrorBtn.addEventListener('click', function () {
      state.workCanvas = mirrorCanvas(state.workCanvas);
      render();
    });
    stageNavArrows(stage, function () {
      state.step = 'perspective';
      render();
    }, function () {
      var out = document.createElement('canvas');
      out.width = state.workCanvas.width; out.height = state.workCanvas.height;
      out.getContext('2d').drawImage(state.workCanvas, 0, 0);
      state.finalCanvas = out;
      state.colorSettings = { brightness: 0, contrast: 0, saturation: 0, grayscale: false };
      state.step = 'color';
      render();
    });
  }

  // ==================================================================
  // FARBE: Helligkeit / Kontrast / Sättigung / Graustufen
  // ==================================================================
  function renderColor(body) {
    body.appendChild(stepsBar(3));
    var stage = el('div', { class: 'ic-stage' });
    var canvas = el('canvas', { class: 'ic-view' });
    stage.appendChild(canvas);
    body.appendChild(stage);

    var baseData = null;

    function draw() {
      var f = state.colorSettings;
      canvas.width = state.finalCanvas.width;
      canvas.height = state.finalCanvas.height;
      var ctx = canvas.getContext('2d');
      if (!baseData) {
        ctx.drawImage(state.finalCanvas, 0, 0);
        baseData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      var out = ctx.createImageData(canvas.width, canvas.height);
      applyColorAdjust(baseData, out, f);
      ctx.putImageData(out, 0, 0);
    }
    draw();

    var panel = el('div', { class: 'ic-panel' });
    function slider(labelKey, key, min, max) {
      var row = el('div', { class: 'ic-row' });
      row.appendChild(el('label', {}, [S[labelKey]]));
      var input = el('input', { type: 'range', min: min, max: max, value: state.colorSettings[key] });
      input.addEventListener('input', function () {
        state.colorSettings[key] = parseInt(input.value, 10);
        draw();
      });
      row.appendChild(input);
      panel.appendChild(row);
    }
    slider('brightness', 'brightness', -100, 100);
    slider('contrast', 'contrast', -100, 100);
    slider('saturation', 'saturation', -100, 100);

    var grayRow = el('div', { class: 'ic-row' });
    var grayLabel = el('label', {}, [S.grayscale]);
    var grayInput = el('input', { type: 'checkbox' });
    grayInput.checked = state.colorSettings.grayscale;
    grayInput.addEventListener('change', function () {
      state.colorSettings.grayscale = grayInput.checked;
      draw();
    });
    grayRow.appendChild(grayLabel); grayRow.appendChild(grayInput);
    panel.appendChild(grayRow);
    body.appendChild(panel);

    var isEditingExisting = !!state.editingPhotoId;
    var arrows = stageNavArrows(stage, function () {
      state.step = 'crop';
      render();
    }, function () {
      // Ergebnis fest in finalCanvas übernehmen.
      state.finalCanvas = canvas;
      if (isEditingExisting) {
        arrows.nextBtn.disabled = true;
        var photoId = state.editingPhotoId;
        var dataUrl = state.finalCanvas.toDataURL('image/jpeg', 0.88);
        callAjax('mod_pinnwand_update_photo', { cmid: cfg.cmid, photoid: photoId, imagedata: dataUrl }).then(function (res) {
          var existing = state.photos.filter(function (p) { return p.id === photoId; })[0];
          if (existing) { existing.url = res.url; }
          resetCaptureState();
          state.step = 'home';
          render();
        }).catch(function (e) {
          alert(S.error_save + ' (' + e.message + ')');
          arrows.nextBtn.disabled = false;
        });
        return;
      }
      state.step = 'source';
      render();
    }, isEditingExisting ? 'check' : 'arrowright', isEditingExisting ? S.savephoto : S.next);
  }

  function applyColorAdjust(src, out, f) {
    var d = src.data, o = out.data;
    var bright = f.brightness * 2.55;
    var contrastFactor = (259 * (f.contrast + 255)) / (255 * (259 - f.contrast));
    var satFactor = 1 + f.saturation / 100;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      // Helligkeit
      r += bright; g += bright; b += bright;
      // Kontrast
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;
      // Sättigung
      var gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * satFactor;
      g = gray + (g - gray) * satFactor;
      b = gray + (b - gray) * satFactor;
      if (f.grayscale) {
        var gg = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = gg;
      }
      o[i] = clamp255(r); o[i + 1] = clamp255(g); o[i + 2] = clamp255(b); o[i + 3] = 255;
    }
  }
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  // ==================================================================
  // ANGABEN: Quellenangaben (optional) + Einwilligung, dann Speichern.
  // Das Raster wird NICHT hier festgelegt - es wird erst später in der
  // Galerieansicht (Lightbox) pro Foto definiert (siehe openLightbox()).
  // ==================================================================
  function renderSource(body) {
    body.appendChild(stepsBar(4));

    var preview = el('div', { class: 'ic-stage', style: 'flex:0 0 40%' });
    var img = el('img', { src: state.finalCanvas.toDataURL('image/jpeg', 0.7), style: 'max-width:100%;max-height:100%' });
    preview.appendChild(img);
    body.appendChild(preview);

    var info = { sourcetitle: '', sourceauthor: '', sourceyear: '', sourceepoch: '', sourceplace: '', sourceorigauthor: '' };
    state.sourceInfo = info;

    var form = el('div', { class: 'ic-source-form' });
    form.appendChild(el('p', { class: 'ic-hint', style: 'padding:0 0 8px' }, [S.source_hint]));
    function field(key, labelKey) {
      var wrap = el('div', { class: 'ic-field' });
      wrap.appendChild(el('label', {}, [S[labelKey]]));
      var input = el('input', { type: 'text' });
      input.addEventListener('input', function () { info[key] = input.value; });
      wrap.appendChild(input);
      form.appendChild(wrap);
      return input;
    }

    field('sourcetitle', 'sourcetitle');

    // Autor*in-Feld mit "ich"-Kurzwahl (füllt automatisch den eigenen Namen ein).
    var authorWrap = el('div', { class: 'ic-field' });
    authorWrap.appendChild(el('label', {}, [S.sourceauthor]));
    var inline = el('div', { class: 'ic-field-inline' });
    var authorInput = el('input', { type: 'text' });
    authorInput.addEventListener('input', function () { info.sourceauthor = authorInput.value; });
    var meLabel = el('label', { class: 'ic-me-check' });
    var meCheck = el('input', { type: 'checkbox' });
    meCheck.addEventListener('change', function () {
      meLabel.classList.toggle('checked', meCheck.checked);
      if (meCheck.checked) {
        authorInput.value = cfg.currentuserfullname || '';
        info.sourceauthor = authorInput.value;
        authorInput.disabled = true;
      } else {
        authorInput.disabled = false;
      }
    });
    meLabel.appendChild(meCheck);
    meLabel.appendChild(document.createTextNode(S.author_me));
    inline.appendChild(authorInput);
    inline.appendChild(meLabel);
    authorWrap.appendChild(inline);
    form.appendChild(authorWrap);

    field('sourceyear', 'sourceyear');
    field('sourceepoch', 'sourceepoch');
    field('sourceplace', 'sourceplace');
    field('sourceorigauthor', 'sourceorigauthor');
    body.appendChild(form);

    var consentChecked = false;
    if (cfg.allowconsent) {
      var consentRow = el('div', { class: 'ic-consent-row' });
      var cbox = el('input', { type: 'checkbox', id: 'ic-consent' });
      cbox.addEventListener('change', function () { consentChecked = cbox.checked; });
      var clabel = el('label', { for: 'ic-consent' }, [cfg.consenttext || S.consent_label]);
      consentRow.appendChild(cbox); consentRow.appendChild(clabel);
      body.appendChild(consentRow);
    }

    var bar = el('div', { class: 'ic-actionbar' });
    bar.appendChild(cancelWizardBtn());
    var saveBtn = el('button', { class: 'ic-btn ic-btn-primary ic-btn-icon', title: S.savephoto, 'aria-label': S.savephoto }, [icon('check')]);
    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true;
      // Das Raster wird hier bewusst noch NICHT festgelegt - das passiert
      // erst später pro Foto in der Galerieansicht (Lightbox).
      var dataUrl = state.finalCanvas.toDataURL('image/jpeg', 0.88);
      callAjax('mod_pinnwand_save_photo', {
        cmid: cfg.cmid,
        imagedata: dataUrl,
        gridtype: 'none',
        gridvalue: 0,
        consent: !!consentChecked,
        sourcetitle: info.sourcetitle,
        sourceauthor: info.sourceauthor,
        sourceyear: info.sourceyear,
        sourceepoch: info.sourceepoch,
        sourceplace: info.sourceplace,
        sourceorigauthor: info.sourceorigauthor,
        boardid: state.currentBoard || 0
      }).then(function (res) {
        var maxreached = !!res.maxreached;
        refreshPhotos().then(function () {
          resetCaptureState();
          state.step = maxreached ? 'arrange' : 'home';
          render();
        });
      }).catch(function (e) {
        alert(S.error_save + ' (' + e.message + ')');
        saveBtn.disabled = false;
      });
    });
    bar.appendChild(saveBtn);
    body.appendChild(bar);
  }

  function resetCaptureState() {
    state.sourceCanvas = null;
    state.corners = null;
    state.workCanvas = null;
    state.cropRect = null;
    state.finalCanvas = null;
    state.editingPhotoId = null;
    state.textFrame = null;
    state.captureMode = null;
  }

  // Kleiner, eindeutiger Abbrechen-Button (X) für den gesamten Hinzufügen-
  // Assistenten - ersetzt die früheren breiten "Zurück"-Textbuttons, die je
  // Schritt ein anderes Ziel hatten und Unklarheit erzeugten, ob bereits
  // eingegebene Daten dabei gespeichert werden. Bricht den kompletten
  // Assistenten ab (keine Zwischenspeicherung) und kehrt zu "Meine Bilder"
  // zurück - das Speichern selbst passiert ausschließlich über den
  // Haken-Button am jeweils letzten Schritt.
  function cancelWizardBtn() {
    var b = el('button', {
      class: 'ic-btn ic-btn-ghost ic-btn-icon ic-cancel-btn', title: S.cancel, 'aria-label': S.cancel
    }, ['\u2715']);
    b.addEventListener('click', function () {
      resetCaptureState();
      state.step = 'home';
      render();
    });
    return b;
  }

  // Zurück-/Weiter-Pfeile als kreisrunde Buttons, fest positioniert bei 30%
  // bzw. 60% der Bildbreite am unteren Rand der Bühne (statt einer breiten
  // Aktionsleiste) - für die Schritte mit großformatigem Bild (Perspektive/
  // Zuschnitt/Farbe). nextIcon erlaubt z.B. 'check' statt Pfeil beim
  // letzten Schritt.
  function stageNavArrows(stage, onBack, onNext, nextIcon, nextTitle) {
    var backBtn = el('button', {
      class: 'ic-stage-nav-arrow ic-stage-nav-back', title: S.back, 'aria-label': S.back
    }, [icon('arrowleft')]);
    var nextBtn = el('button', {
      class: 'ic-stage-nav-arrow ic-stage-nav-next', title: nextTitle || S.next, 'aria-label': nextTitle || S.next
    }, [icon(nextIcon || 'arrowright')]);
    backBtn.addEventListener('click', onBack);
    nextBtn.addEventListener('click', onNext);
    stage.appendChild(backBtn);
    stage.appendChild(nextBtn);
    return { backBtn: backBtn, nextBtn: nextBtn };
  }

  // ==================================================================
  // WORTFELD (Textrahmen): Rahmen mit Hintergrund-Preset + einem oder
  // mehreren frei positionierbaren Text-Objekten. Wird beim Speichern zu
  // einem PNG gerendert und über die bestehende Foto-Pipeline gespeichert -
  // dadurch funktionieren Ziehen/Größe/Rotation/Annotieren/Faden usw. ohne
  // jede Sonderbehandlung, wie bei jedem anderen Bild auf der Pinnwand.
  // Scoping: Text-Objekte sind verschiebbar, aber (anders als Fotos) nicht
  // einzeln drehbar - das hätte den Rahmen dieser Phase gesprengt.
  // ==================================================================
  var TEXTFRAME_FONTS = [
    { id: 'sans', label: 'Sans', css: '-apple-system, Roboto, Arial, sans-serif' },
    { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
    { id: 'mono', label: 'Mono', css: '"Courier New", monospace' },
    { id: 'hand', label: 'Handschrift', css: '"Caveat", cursive', webfont: 'Caveat:wght@600' }
  ];
  var TEXTFRAME_PALETTE = ['#e0503f', '#4f8cff', '#3fcf8e', '#e0b23f', '#b06fe0', '#ffffff', '#111111'];
  var textframeRecentColors = [];
  function noteRecentColor(color) {
    textframeRecentColors = [color].concat(textframeRecentColors.filter(function (c) { return c !== color; })).slice(0, 20);
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    function hx(v) { return Math.round((v + m) * 255).toString(16).padStart(2, '0'); }
    return '#' + hx(r) + hx(g) + hx(b);
  }
  // Große 10x10-Palette: oberste 2 Zeilen = zuletzt verwendete Farben,
  // linker Rand (Spalte 0, ab Zeile 2) = Grauverlauf weiß bis schwarz,
  // restliche Felder = Farbraster nach Farbton (Spalte) und Helligkeit
  // (Zeile). Darunter ein Transparenz-Stepper. Wirkt über den
  // übergebenen onPick-Callback auf die aktuelle Auswahl oder das ganze
  // Textobjekt (siehe applyStyleToSelectionOrWhole beim Aufrufer).
  function buildBigColorPalette(container, currentColor, currentOpacity, onPick, onOpacity) {
    container.appendChild(el('div', { class: 'ic-textframe-label' }, [S.tf_recent_colors]));
    var grid = el('div', { class: 'ic-bigpalette-grid' });
    for (var row = 0; row < 10; row++) {
      for (var col = 0; col < 10; col++) {
        var color;
        if (row < 2) {
          var recentIdx = row * 10 + col;
          color = textframeRecentColors[recentIdx] || null;
        } else if (col === 0) {
          var t = (row - 2) / 7;
          var v = Math.round(255 * (1 - t));
          color = '#' + [v, v, v].map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
        } else {
          color = hslToHex((col - 1) * 40, 65, 85 - (row - 2) * 8);
        }
        var cell = el('button', {
          class: 'ic-bigpalette-cell' + (color === currentColor ? ' active' : '') + (color ? '' : ' empty'),
          style: color ? 'background:' + color : '', title: color || ''
        });
        if (color) { cell.addEventListener('click', function (c) { return function () { onPick(c); }; }(color)); }
        grid.appendChild(cell);
      }
    }
    container.appendChild(grid);
    var customColor = el('input', { type: 'color', value: currentColor || '#e0503f', class: 'ic-textframe-custom-color' });
    customColor.addEventListener('change', function () { onPick(customColor.value); });
    container.appendChild(customColor);
    if (onOpacity) {
      var opRow = el('div', { class: 'ic-textframe-edit' });
      opRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_opacity]));
      opRow.appendChild(numberStepper(Math.round((currentOpacity != null ? currentOpacity : 1) * 100), 0, 100, 5, 0, function (v) { onOpacity(v / 100); }));
      container.appendChild(opRow);
    }
  }
  // Kreis-/Dreieck-Farbwähler (HSV-Rad): äußerer Ring = Farbton, inneres
  // Dreieck = Sättigung/Helligkeit für den gewählten Farbton. Klicks lesen
  // die tatsächlich gezeichnete Pixelfarbe aus dem Canvas aus (robuster als
  // eigene Dreiecks-Mathematik nachzubauen).
  function buildColorWheel(container, currentColor, onPick) {
    var size = 150, cx = size / 2, cy = size / 2, outerR = size / 2 - 3, innerR = outerR - 16;
    var hue = 0;
    if (currentColor) {
      var m = /^#([0-9a-f]{6})$/i.exec(currentColor);
      if (m) {
        var r = parseInt(m[1].substr(0, 2), 16) / 255, g = parseInt(m[1].substr(2, 2), 16) / 255, b = parseInt(m[1].substr(4, 2), 16) / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        if (d !== 0) {
          if (max === r) { hue = 60 * (((g - b) / d) % 6); } else if (max === g) { hue = 60 * ((b - r) / d + 2); } else { hue = 60 * ((r - g) / d + 4); }
          if (hue < 0) { hue += 360; }
        }
      }
    }
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    canvas.className = 'ic-colorwheel-canvas';
    var ctx = canvas.getContext('2d');
    function triangleVertices(hueDeg) {
      var a0 = (hueDeg - 90) * Math.PI / 180, a1 = a0 + 2 * Math.PI / 3, a2 = a0 + 4 * Math.PI / 3;
      return [
        { x: cx + innerR * Math.cos(a0), y: cy + innerR * Math.sin(a0) },
        { x: cx + innerR * Math.cos(a1), y: cy + innerR * Math.sin(a1) },
        { x: cx + innerR * Math.cos(a2), y: cy + innerR * Math.sin(a2) }
      ];
    }
    function draw() {
      ctx.clearRect(0, 0, size, size);
      for (var deg = 0; deg < 360; deg += 2) {
        ctx.beginPath();
        ctx.strokeStyle = 'hsl(' + deg + ',100%,50%)';
        ctx.lineWidth = outerR - innerR + 1;
        ctx.arc(cx, cy, (outerR + innerR) / 2, (deg - 1.2) * Math.PI / 180, (deg + 1.2) * Math.PI / 180);
        ctx.stroke();
      }
      var verts = triangleVertices(hue);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y); ctx.lineTo(verts[1].x, verts[1].y); ctx.lineTo(verts[2].x, verts[2].y);
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = 'hsl(' + hue + ',100%,50%)'; ctx.fillRect(0, 0, size, size);
      var gradW = ctx.createLinearGradient(verts[1].x, verts[1].y, verts[0].x, verts[0].y);
      gradW.addColorStop(0, 'rgba(255,255,255,1)'); gradW.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradW; ctx.fillRect(0, 0, size, size);
      var gradB = ctx.createLinearGradient(verts[2].x, verts[2].y, verts[0].x, verts[0].y);
      gradB.addColorStop(0, 'rgba(0,0,0,1)'); gradB.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradB; ctx.fillRect(0, 0, size, size);
      ctx.restore();
      var ringAngle = (hue - 90) * Math.PI / 180, mr = (outerR + innerR) / 2;
      ctx.beginPath(); ctx.arc(cx + mr * Math.cos(ringAngle), cy + mr * Math.sin(ringAngle), 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    draw();
    container.appendChild(canvas);
    canvas.addEventListener('click', function (ev) {
      var rect = canvas.getBoundingClientRect();
      var x = (ev.clientX - rect.left) * (size / rect.width), y = (ev.clientY - rect.top) * (size / rect.height);
      var dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (dist > innerR) {
        hue = (((Math.atan2(y - cy, x - cx) * 180 / Math.PI) + 90) + 360) % 360;
        draw();
      } else {
        var px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        if (px[3] === 0) { return; } // außerhalb des Dreiecks
        var hex = '#' + [px[0], px[1], px[2]].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
        onPick(hex);
      }
    });
  }

  var TEXTFRAME_PRESETS = [
    { id: 'none', bg: null, text: '#f2f3f5', shadow: false },
    { id: 'paper', bg: '#ffffff', text: '#111111', shadow: true },
    { id: 'dark', bg: '#111111', text: '#e0503f', shadow: false },
    { id: 'light', bg: '#000000', text: '#ffffff', shadow: false }
  ];
  var textframeFontsLoaded = {};
  // Pretext.js (Textumbruch-Berechnung für den Umfluss-Modus) wird lokal
  // mitgeliefert (kein CDN, siehe js/vendor/pretext/) und nur bei
  // tatsächlichem Bedarf nachgeladen, nicht bei jedem Editor-Start.
  var pretextPromise = null;
  function loadPretext() {
    if (pretextPromise) { return pretextPromise; }
    var base = cfg.wwwroot + '/mod/pinnwand/js/vendor/';
    var modulePromise = import(base + 'pretext/layout.js');
    var geometryPromise = window.PretextWrapGeometry ? Promise.resolve() : new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = base + 'pretext-wrap-geometry.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    pretextPromise = Promise.all([modulePromise, geometryPromise]).then(function (results) {
      var mod = results[0];
      return {
        prepare: mod.prepare, layout: mod.layout, prepareWithSegments: mod.prepareWithSegments,
        layoutWithLines: mod.layoutWithLines, walkLineRanges: mod.walkLineRanges,
        measureLineStats: mod.measureLineStats, layoutNextLineRange: mod.layoutNextLineRange,
        materializeLineRange: mod.materializeLineRange, geometry: window.PretextWrapGeometry
      };
    });
    return pretextPromise;
  }

  function ensureWebfont(spec) {
    if (!spec || textframeFontsLoaded[spec]) { return; }
    textframeFontsLoaded[spec] = true;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + spec + '&display=swap';
    document.head.appendChild(link);
  }

  // WordArt-Schriftbibliothek: kuratierte Google-Fonts-Auswahl, thematisch
  // in Kategorien geordnet - wird beim Öffnen einer Kategorie on-demand
  // nachgeladen (siehe ensureWebfont), nicht alle ~220 Schriften auf
  // einmal. "websafe" enthält bewusst reine System-/Standard-Schriften
  // ohne Google-Fonts-Ladevorgang.
  var WORDART_FONT_CATEGORIES = {
    deko: ['Notable', 'Diplomata', 'Arbutus', 'Cookie', 'Jomhuria', 'Crushed', 'Limelight', 'Fascinate', 'Gorditas', 'Monoton', 'Modak', 'Mogra', 'Merienda', 'Tillana', 'Coustard', 'Fresca', 'Lobster', 'Codystar', 'Ranga', 'Skranji', 'Ultra', 'Foldit', 'Oi', 'Nabla', 'Texturina', 'Danfo'],
    effect: ['Akronim', 'Neonderthaw', 'Rubik Maze', 'Rubik Distressed', 'Rubik 80s Fade', 'Rubik Gemstones', 'Rubik Iso', 'Rubik Dirt', 'Rubik Wet Paint', 'Rubik Puddles', 'Rubik Moonrocks', 'Rubik Microbe', 'Rubik Glitch', 'Rubik Beastly', 'Rubik Bubbles', 'Rubik Burned', 'Rubik Spray Paint', 'Rubik Storm', 'Rubik Vinyl', 'Rubik Marker Hatch', 'Black And White Picture', 'Moo Lah Lah', 'Faster One', 'Cabin Sketch'],
    foreign: ['Smokum', 'Rye', 'Ewert', 'Bonbon', 'Sancreek', 'Kenia', 'Hanalei', 'Shojumaru', 'Joti One', 'Trochut', 'Ruslan Display', 'Stick', 'Eagle Lake', 'Uncial Antiqua', 'Caesar Dressing', 'Kings', 'Aladin'],
    fraktur: ['Astloch', 'Fruktur', 'Iceberg', 'Bokor', 'UnifrakturMaguntia', 'UnifrakturCook', 'MedievalSharp', 'Texturina', 'Rakkas', 'Fondamento', 'Grenze Gotisch', 'Germania One', 'Pirata One', 'Nova Cut', 'New Rocker', 'Manufacturing Consent'],
    hand: ['Meddon', 'Elsie', 'Bilbo', 'Unkempt', 'Pacifico', 'Knewave', 'Calligraffitti', 'Margarine', 'Allan', 'Borel', 'Charmonman', 'Leckerli One', 'Homemade Apple', 'Sedgwick Ave Display', 'Sedgwick Ave', 'Sail', 'Yellowtail', 'Kaushan Script', 'Festive'],
    horror: ['Eater', 'Creepster', 'Nosifer', 'Flavors', 'Butcherman', 'Frijole', 'Piedra', 'Smythe', 'Grenze', 'Metal Mania', 'Special Elite', 'Trade Winds', 'Road Rage', 'Lacquer', 'Reggae One', 'Jolly Lodger'],
    impro: ['Peralta', 'Bangers', 'Unkempt', 'Ranchers', 'Mansalva', 'Slackey', 'Barriecito', 'Barrio', 'Schoolbell', 'Dokdo', 'Underdog', 'Finger Paint', 'Rampart One', 'Freckle Face', 'Pangolin', 'Londrina Sketch'],
    monospaced: ['Courier New', 'Arvo', 'Roboto', 'BioRhyme', 'Cinzel'],
    narrow: ['Stint Ultra Condensed', 'Instrument Serif', 'Allan', 'Karantina', 'Mouse Memoirs', 'Acme', 'Staatliches', 'Dorsa', 'Bahiana', 'Smythe', 'Smokum', 'Bokor', 'Handjet', 'Ranga', 'Bangers', 'Jolly Lodger', 'Boogaloo', 'Bubblegum Sans', 'Amatic SC'],
    party: ['Risque', 'Bonbon', 'Griffy', 'Miltonian', 'Kranky', 'Purple Purse', 'Kablammo', 'Fontdiner Swanky', 'Henny Penny', 'Princess Sofia'],
    readable: ['Acme', 'Andika', 'Atkinson Hyperlegible', 'Cormorant Upright', 'Lexend', 'Lato', 'Ranchers'],
    schlagzeile: ['Anton'],
    scifi: ['VT323', 'Geo', 'Iceberg', 'Offside', 'Orbitron', 'Audiowide', 'Megrim', 'Baumans', 'Tomorrow', 'Vibes', 'Tektur', 'Press Start 2P', 'Foldit', 'Plaster', 'DotGothic16', 'Handjet', 'Monofett', 'Atomic Age', 'Bitcount Prop Single'],
    sortfield: ['Kaushan Script', 'Ultra', 'Carter One', 'Raleway Dots', 'Bungee Shade', 'Original Surfer', 'Ceviche One', 'Vast Shadow', 'Coiny', 'Cherry Cream Soda', 'Passero One', 'Autour One', 'Train One', 'Tourney', 'Tilt Prism'],
    stencil: ['Stick No Bills', 'Sirin Stencil', 'Emblema One', 'Saira Stencil One', 'Allerta Stencil', 'Stardos Stencil', 'Plaster'],
    websafe: ['Open Sans', 'Courier New', 'Arial Narrow', 'Century Gothic', 'Georgia', 'Times New Roman', 'Palatino'],
  };
  var WORDART_WEBSAFE_FONTS = {
    'Open Sans': '"Open Sans", sans-serif', 'Courier New': '"Courier New", monospace',
    'Arial Narrow': '"Arial Narrow", Arial, sans-serif', 'Century Gothic': '"Century Gothic", sans-serif',
    'Georgia': 'Georgia, serif', 'Times New Roman': '"Times New Roman", serif', 'Palatino': 'Palatino, serif'
  };
  // "Font Name" -> "Font+Name" für die Google-Fonts-CSS2-API.
  function googleFontParam(name) { return name.replace(/ /g, '+'); }
  // Liefert die einsetzbare font-family-CSS-Deklaration für einen
  // WordArt-Katalogeintrag und lädt bei Bedarf die Google-Fonts-Datei nach.
  function wordartFontCss(name) {
    if (WORDART_WEBSAFE_FONTS[name]) { return WORDART_WEBSAFE_FONTS[name]; }
    ensureWebfont(googleFontParam(name));
    return '"' + name + '", sans-serif';
  }
  // Löst t.font in eine einsetzbare font-family-CSS-Deklaration auf -
  // entweder eine der festen TEXTFRAME_FONTS-IDs oder ein Katalog-Font aus
  // der WordArt-Schriftbibliothek (Präfix "google:").
  function resolveFontCss(fontValue) {
    if (fontValue && fontValue.indexOf('google:') === 0) { return wordartFontCss(fontValue.slice(7)); }
    var fontDef = TEXTFRAME_FONTS.filter(function (f) { return f.id === fontValue; })[0] || TEXTFRAME_FONTS[0];
    if (fontDef.webfont) { ensureWebfont(fontDef.webfont); }
    return fontDef.css;
  }

  // WordArt-Schriftbibliothek: Kategorie-Browser als Modal - beim Öffnen
  // einer Kategorie werden deren Google Fonts erst dann nachgeladen (nicht
  // vorab alle ~220 auf einmal), jeder Font-Button zeigt sich direkt in
  // der jeweiligen Schrift als Live-Vorschau.
  var WORDART_CATEGORY_LABELS = {
    deko: 'Deko', effect: 'Effekt', foreign: 'Fremd', fraktur: 'Fraktur', hand: 'Handschrift',
    horror: 'Horror', impro: 'Improvisiert', monospaced: 'Monospaced', narrow: 'Schmal',
    party: 'Party', readable: 'Gut lesbar', schlagzeile: 'Schlagzeile', scifi: 'Sci-Fi',
    sortfield: 'Sortenfeld', stencil: 'Schablone', websafe: 'Websicher'
  };
  // Verschiebbares Modal (keine blockierende Vollbild-Ebene dahinter, damit
  // die Live-Vorschau währenddessen sichtbar/aktualisierbar bleibt) - wird
  // per Titelleiste frei auf dem Bildschirm positioniert. Nur eines
  // gleichzeitig offen (ein neu geöffnetes schließt ein vorheriges).
  function closeDraggableModal() {
    var existing = document.getElementById('ic-draggable-modal');
    if (existing) { existing.remove(); }
  }
  function openDraggableModal(title, anchorEl, buildContent) {
    closeDraggableModal();
    var modal = el('div', { class: 'ic-draggable-modal', id: 'ic-draggable-modal' });
    var titleBar = el('div', { class: 'ic-draggable-modal-titlebar' });
    titleBar.appendChild(el('span', {}, [title]));
    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon', title: S.cancel }, ['\u2715']);
    closeBtn.addEventListener('click', function () { modal.remove(); });
    titleBar.appendChild(closeBtn);
    modal.appendChild(titleBar);
    var content = el('div', { class: 'ic-draggable-modal-content' });
    buildContent(content, modal);
    modal.appendChild(content);

    var anchorRect = anchorEl.getBoundingClientRect();
    modal.style.left = Math.min(anchorRect.left, window.innerWidth - 340) + 'px';
    modal.style.top = Math.min(anchorRect.bottom + 6, window.innerHeight - 200) + 'px';
    root.appendChild(modal);

    var dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    function ptOf(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
    titleBar.addEventListener('mousedown', function (ev) {
      dragging = true; var p = ptOf(ev);
      startX = p.x; startY = p.y; startLeft = modal.offsetLeft; startTop = modal.offsetTop;
      ev.preventDefault();
    });
    titleBar.addEventListener('touchstart', function (ev) {
      dragging = true; var p = ptOf(ev);
      startX = p.x; startY = p.y; startLeft = modal.offsetLeft; startTop = modal.offsetTop;
    }, { passive: true });
    function onMove(ev) {
      if (!dragging) { return; }
      var p = ptOf(ev);
      modal.style.left = Math.max(0, Math.min(window.innerWidth - 60, startLeft + (p.x - startX))) + 'px';
      modal.style.top = Math.max(0, Math.min(window.innerHeight - 40, startTop + (p.y - startY))) + 'px';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', function () { dragging = false; });
    window.addEventListener('touchend', function () { dragging = false; });
    return modal;
  }

  // Formen-Bibliothek für die Vordergrund-Form (Sticker/Badge hinter dem
  // Text) - jede Form ein eigenständiger SVG-Pfad auf einem 0..100-
  // Koordinatensystem, damit dieselbe Definition sowohl für die Live-
  // Vorschau (als Daten-URI) als auch für den SVG-Export verwendet werden
  // kann. Bewusst nur die geometrisch einfachen Formen (Rechteck/Kreis/
  // Oval/Sechseck/Achteck) für die HINTERGRUND-Form der Karte selbst -
  // die reichhaltigere Sammlung hier eignet sich als Container-Fläche
  // für Text kaum und ist daher der dekorativen Vordergrund-Form
  // vorbehalten.
  var FG_SHAPE_CATEGORIES = {
    grundformen: [
      { id: 'triangle', label: 'Dreieck', d: 'M50 5 L95 90 L5 90 Z' },
      { id: 'righttriangle', label: 'Rechtwinklig', d: 'M5 5 L5 90 L95 90 Z' },
      { id: 'trapezoid', label: 'Trapez', d: 'M25 15 L75 15 L95 85 L5 85 Z' },
      { id: 'diamond', label: 'Raute', d: 'M50 5 L95 50 L50 95 L5 50 Z' },
      { id: 'parallelogram', label: 'Parallelogramm', d: 'M25 15 L95 15 L75 85 L5 85 Z' },
      { id: 'pentagon', label: 'Fünfeck', d: 'M50 5 L95 38 L78 92 L22 92 L5 38 Z' },
      { id: 'hexagon', label: 'Sechseck', d: 'M25 5 L75 5 L95 50 L75 95 L25 95 L5 50 Z' },
      { id: 'octagon', label: 'Achteck', d: 'M32 5 L68 5 L95 32 L95 68 L68 95 L32 95 L5 68 L5 32 Z' },
      { id: 'cross', label: 'Kreuz', d: 'M35 5 L65 5 L65 35 L95 35 L95 65 L65 65 L65 95 L35 95 L35 65 L5 65 L5 35 L35 35 Z' },
      { id: 'ring', label: 'Ring', d: 'M50 5 A45 45 0 1 1 49.9 5 Z M50 30 A20 20 0 1 0 50.1 30 Z', fillRule: 'evenodd' },
      { id: 'arch', label: 'Bogen', d: 'M5 95 L5 45 A45 45 0 0 1 95 45 L95 95 Z' },
      { id: 'crescent', label: 'Halbmond', d: 'M65 5 A45 45 0 1 0 65 95 A35 35 0 1 1 65 5 Z', fillRule: 'evenodd' }
    ],
    symbolformen: [
      { id: 'heart', label: 'Herz', d: 'M50 90 C10 60 5 35 25 20 C38 10 50 20 50 32 C50 20 62 10 75 20 C95 35 90 60 50 90 Z' },
      { id: 'cloud', label: 'Wolke', d: 'M25 70 A18 18 0 0 1 28 35 A22 22 0 0 1 70 28 A18 18 0 0 1 80 70 Z' },
      { id: 'nostop', label: 'Verbotsschild', d: 'M50 5 A45 45 0 1 1 49.9 5 Z M18 30 L82 70', fillRule: 'evenodd' },
      { id: 'moon', label: 'Mond', d: 'M65 5 A45 45 0 1 0 65 95 A35 35 0 1 1 65 5 Z', fillRule: 'evenodd' },
      { id: 'lightning', label: 'Blitz', d: 'M55 5 L20 55 L45 55 L35 95 L82 40 L55 40 Z' },
      { id: 'gem', label: 'Diamant', d: 'M20 35 L50 5 L80 35 L50 95 Z' }
    ],
    blockpfeile: [
      { id: 'arrowright', label: 'Pfeil rechts', d: 'M5 35 L60 35 L60 15 L95 50 L60 85 L60 65 L5 65 Z' },
      { id: 'arrowleft', label: 'Pfeil links', d: 'M95 35 L40 35 L40 15 L5 50 L40 85 L40 65 L95 65 Z' },
      { id: 'arrowup', label: 'Pfeil oben', d: 'M35 95 L35 40 L15 40 L50 5 L85 40 L65 40 L65 95 Z' },
      { id: 'arrowdown', label: 'Pfeil unten', d: 'M35 5 L35 60 L15 60 L50 95 L85 60 L65 60 L65 5 Z' }
    ]
  };
  var FG_SHAPE_CATEGORY_LABELS = { grundformen: 'Grundformen', symbolformen: 'Symbolformen', blockpfeile: 'Blockpfeile' };
  function fgShapeSvgDataUri(shape, color) {
    var attrs = 'fill="' + color + '"' + (shape.fillRule ? ' fill-rule="' + shape.fillRule + '"' : '');
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="' + shape.d + '" ' + attrs + '/></svg>'
    );
  }

  function openWordartFontBrowser(active, frame) {
    var overlay = el('div', { class: 'ic-modal-overlay' });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) { overlay.remove(); } });
    var panel = el('div', { class: 'ic-add-modal ic-wordart-font-modal' });
    panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.wordart_fonts]));
    var body2 = el('div', {});
    panel.appendChild(body2);

    function applyFont(name) {
      active.font = 'google:' + name;
      var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
      if (objEl) { objEl.style.fontFamily = resolveFontCss(active.font); }
      overlay.remove();
    }

    function showCategories() {
      body2.innerHTML = '';
      Object.keys(WORDART_FONT_CATEGORIES).forEach(function (cat) {
        var catBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-wordart-cat-btn' },
          [WORDART_CATEGORY_LABELS[cat] || cat, el('span', { class: 'ic-textframe-label' }, [' (' + WORDART_FONT_CATEGORIES[cat].length + ')'])]);
        catBtn.addEventListener('click', function () { showFonts(cat); });
        body2.appendChild(catBtn);
      });
    }
    function showFonts(cat) {
      body2.innerHTML = '';
      var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, ['\u2039 ' + (WORDART_CATEGORY_LABELS[cat] || cat)]);
      backBtn.addEventListener('click', showCategories);
      body2.appendChild(backBtn);
      var grid = el('div', { class: 'ic-wordart-font-grid' });
      WORDART_FONT_CATEGORIES[cat].forEach(function (name) {
        var fb = el('button', { class: 'ic-wordart-font-btn', style: 'font-family:' + resolveFontCss(name) }, [name]);
        fb.addEventListener('click', function () { applyFont(name); });
        grid.appendChild(fb);
      });
      body2.appendChild(grid);
    }
    showCategories();

    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon ic-modal-close', title: S.cancel }, ['\u2715']);
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  function newTextFrame(wordArtMode) {
    return {
      w: wordArtMode ? 320 : 220, h: wordArtMode ? 220 : 320, preset: 'paper',
      texts: [{ id: 1, text: '', font: 'sans', size: 32, x: 0.5, y: 0.5 }]
    };
  }

  // Schrumpft die Schriftgröße, bis der Text (einzeilig) in maxWidth passt -
  // eigene, einfache Umsetzung der pretextjs "fit-text-to-container"-Idee.
  var fitCtx = document.createElement('canvas').getContext('2d');
  function autoFitFontSize(text, fontCss, maxWidth, startSize) {
    var size = startSize;
    if (!text) { return size; }
    while (size > 10) {
      fitCtx.font = size + 'px ' + fontCss;
      if (fitCtx.measureText(text).width <= maxWidth) { break; }
      size -= 2;
    }
    return size;
  }

  // 2D-Auto-Fit für das primäre (füllende, mehrzeilige) Textobjekt im
  // Wortfeld: Binärsuche nach der größten Schriftgröße, bei der der Text
  // (mit Zeilenumbruch) noch vollständig in den Rahmen passt.
  function autoFitPrimaryText(el2, t, frameHeight) {
    if (!el2.textContent) { return; }
    var lo = 10, hi = Math.max(lo, Math.min(96, frameHeight * 0.5)), best = lo;
    for (var i = 0; i < 8; i++) {
      var mid = (lo + hi) / 2;
      el2.style.fontSize = mid + 'px';
      var fits = el2.scrollHeight <= el2.clientHeight + 1 && el2.scrollWidth <= el2.clientWidth + 1;
      if (fits) { best = mid; lo = mid; } else { hi = mid; }
    }
    el2.style.fontSize = best + 'px';
    t.size = best;
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  // UTF-8-sicheres Base64 (btoa allein kann keine Umlaute/Sonderzeichen).
  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // Baut das Wortfeld als SVG-Markup - bleibt dadurch editierbarer Text
  // (kein Raster-PNG): deutlich kleinere Datei, Schrift bleibt bei jeder
  // Anzeigegröße scharf, und die Struktur (Preset/Texte/Maße) lässt sich
  // beim erneuten Bearbeiten aus `wordfielddata` (separat mitgespeichertes
  // JSON, siehe saveTextFrame) wieder exakt herstellen.
  // WordArt-Stile: reine CSS-Technik (Mehrfach-text-shadow für den
  // "3D-Extrude"-Effekt, -webkit-text-stroke für Kontur, drop-shadow für
  // Glow, Verlaufsfüllung per background-clip:text für Chrome/Feuer) - läuft
  // dadurch sowohl live im Editor als auch im foreignObject-SVG-Export
  // (echtes CSS, keine SVG-Pfad-Extraktion einer Schriftart nötig).
  var WORDART_STYLES = [
    { id: 'none', label: 'Normal', css: function (color) { return 'color:' + color + ';'; } },
    { id: 'outline', label: 'Umriss', css: function (color) {
      return 'color:transparent;-webkit-text-stroke:2px ' + color + ';text-stroke:2px ' + color + ';';
    } },
    { id: 'shadow3d', label: '3D', css: function (color) {
      var layers = [];
      for (var i = 1; i <= 10; i++) { layers.push(i + 'px ' + i + 'px 0 rgba(0,0,0,' + (0.55 - i * 0.02) + ')'); }
      return 'color:' + color + ';text-shadow:' + layers.join(',') + ';';
    } },
    { id: 'glow', label: 'Glow', css: function (color) {
      return 'color:' + color + ';filter:drop-shadow(0 0 8px ' + color + ') drop-shadow(0 0 16px ' + color + ');';
    } },
    { id: 'chrome', label: 'Chrome', css: function () {
      return 'background:linear-gradient(180deg,#8baac1 0%,#ffffff 45%,#161d26 50%,#a47c50 78%,#f3e5c8 100%);' +
        '-webkit-background-clip:text;background-clip:text;color:transparent;';
    } },
    { id: 'fire', label: 'Feuer', css: function () {
      return 'background:linear-gradient(0deg,#ff0000 0%,#ff8a00 40%,#ffd500 100%);' +
        '-webkit-background-clip:text;background-clip:text;color:transparent;' +
        'filter:drop-shadow(0 0 6px rgba(255,120,0,.7));';
    } }
  ];
  function wordartCssFor(t, fallbackColor) {
    if (!t.wordartStyle || t.wordartStyle === 'none') { return ''; }
    var style = WORDART_STYLES.filter(function (w) { return w.id === t.wordartStyle; })[0];
    return style ? style.css(t.color || fallbackColor) : '';
  }

  // Block "Farben und Formen": Fill (Vollfarbe oder Verlauf), Kontur
  // (Umriss mit eigener Dicke) und Effekte (Schatten/Glow, jeweils mit
  // eigener Dicke/Unschärfe) - eine gemeinsame Funktion für Live-Vorschau
  // UND SVG-Export, damit beide garantiert übereinstimmen.
  function computeStyle1Css(t, fallbackColor) {
    var css = '';
    if (t.fillGradient && t.fillGradient.length === 2) {
      css += 'background-image:linear-gradient(135deg,' + t.fillGradient[0] + ',' + t.fillGradient[1] + ');' +
        '-webkit-background-clip:text;background-clip:text;color:transparent;';
    } else {
      css += 'color:' + (t.fillColor || fallbackColor) + ';';
    }
    if (t.outlineWidth > 0) {
      css += '-webkit-text-stroke:' + t.outlineWidth + 'px ' + (t.outlineColor || '#000') + ';paint-order:stroke fill;';
    }
    var shadows = [];
    if (t.shadowOn) { shadows.push('0 2px ' + (t.shadowBlur || 4) + 'px ' + (t.shadowColor || '#000')); }
    if (t.glowOn) { shadows.push('0 0 ' + (t.glowWidth || 8) + 'px ' + (t.glowColor || '#fff')); }
    if (shadows.length) { css += 'text-shadow:' + shadows.join(',') + ';'; }
    if (t.opacity != null && t.opacity < 1) { css += 'opacity:' + t.opacity + ';'; }
    return css;
  }

  // Baut die LIVE-Darstellung eines Text-Rahmens (Hintergrund, Formen,
  // Textobjekte als echtes DOM statt Bild) - rein visuell, nicht
  // editierbar. Wird sowohl im Editor als Basis verwendet als auch auf der
  // Pinnwand selbst, damit Text dort lebendig bleibt (Grundlage für
  // dynamischen Umfluss um Formen/Fotos, statt zu einem Bild eingefroren
  // zu werden).
  function buildTextFrameLiveDom(tf) {
    var preset = TEXTFRAME_PRESETS.filter(function (p) { return p.id === tf.preset; })[0] || TEXTFRAME_PRESETS[0];
    var outer = el('div', {
      class: 'ic-tf-live', style: 'position:relative;width:100%;aspect-ratio:' + tf.w + '/' + tf.h + ';' +
        (preset.shadow ? 'box-shadow:0 8px 24px rgba(0,0,0,.4);' : '') + (preset.bg ? '' : 'border:2px dashed rgba(255,255,255,.3);')
    });
    var inner = el('div', {
      class: 'ic-tf-live-inner', style: 'position:relative;width:100%;height:100%;overflow:hidden;border-radius:16px;' +
        (preset.bg ? 'background:' + preset.bg + ';' : 'background:transparent;')
    });
    outer.appendChild(inner);
    (tf.shapes || []).forEach(function (s) {
      var shapeDef = s.type === 'custom' && s.customPoints
        ? { d: s.customPoints.map(function (p, i) { return (i === 0 ? 'M' : 'L') + (p[0] * 100) + ' ' + (p[1] * 100); }).join(' ') + ' Z' }
        : (s.type && s.type !== 'none'
          ? [].concat.apply([], Object.keys(FG_SHAPE_CATEGORIES).map(function (c) { return FG_SHAPE_CATEGORIES[c]; })).concat(BASIC_SHAPES)
            .filter(function (d) { return d.id === s.type; })[0]
          : null);
      if (!shapeDef) { return; }
      var shapeEl = el('div', {
        class: 'ic-tf-live-shape',
        style: 'position:absolute;left:' + (s.x * 100) + '%;top:' + (s.y * 100) + '%;width:' + (s.size * 100) + '%;' +
          'padding-bottom:' + (s.size * 100) + '%;height:0;transform:translate(-50%,-50%);' +
          'background-image:url(' + fgShapeSvgDataUri(shapeDef, s.color || '#e0503f') + ');background-repeat:no-repeat;' +
          'background-position:center;background-size:contain;' + (s.wrapMode === 'front' ? 'z-index:2;' : 'z-index:0;')
      });
      inner.appendChild(shapeEl);
    });
    tf.texts.forEach(function (t) {
      var fontCss = resolveFontCss(t.font);
      var html = t.html || (t.text ? escapeXml(t.text) : '');
      var textEl2 = el('div', {
        class: 'ic-tf-live-text', html: html,
        style: 'position:absolute;left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;transform:translate(-50%,-50%);' +
          'padding:4px 8px;white-space:pre-wrap;text-align:center;max-width:94%;z-index:1;' +
          'font-family:' + fontCss + ';font-size:' + t.size + 'px;font-weight:' + (t.fontWeight || 700) +
          ';line-height:' + (t.lineHeight || 1.2) + ';letter-spacing:' + (t.letterSpacing || 0) + 'px;' +
          (wordartCssFor(t, preset.text) || computeStyle1Css(t, preset.text))
      });
      inner.appendChild(textEl2);
    });
    return outer;
  }

  function buildTextFrameSVG(tf) {
    var preset = TEXTFRAME_PRESETS.filter(function (p) { return p.id === tf.preset; })[0] || TEXTFRAME_PRESETS[0];
    var defs = '';
    var bgRect = '';
    if (preset.bg) {
      if (preset.shadow) {
        defs = '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">' +
          '<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/></filter></defs>';
      }
      bgRect = '<rect x="0" y="0" width="' + tf.w + '" height="' + tf.h + '" rx="16" fill="' + preset.bg + '"' +
        (preset.shadow ? ' filter="url(#shadow)"' : '') + '/>';
    }
    // Formen (Block "Farben und Formen") - jetzt echte, mehrfache Objekte
    // (tf.shapes), Reihenfolge richtet sich nach dem Umfluss-Modus:
    // "vor dem Text" liegt sichtbar über dem Text, sonst darunter.
    function renderShapeSvg(s) {
      var shapeDef = s.type === 'custom' && s.customPoints
        ? { d: s.customPoints.map(function (p, i) { return (i === 0 ? 'M' : 'L') + (p[0] * 100) + ' ' + (p[1] * 100); }).join(' ') + ' Z' }
        : (s.type && s.type !== 'none'
          ? [].concat.apply([], Object.keys(FG_SHAPE_CATEGORIES).map(function (c) { return FG_SHAPE_CATEGORIES[c]; })).concat(BASIC_SHAPES)
            .filter(function (d) { return d.id === s.type; })[0]
          : null);
      if (!shapeDef) { return ''; }
      var fgColor = escapeXml(s.color || '#e0503f');
      var size = Math.min(tf.w, tf.h) * (s.size || 0.4);
      var tx = s.x * tf.w - size / 2, ty = s.y * tf.h - size / 2, scale = size / 100;
      return '<g transform="translate(' + tx + ',' + ty + ') scale(' + scale + ')">' +
        '<path d="' + shapeDef.d + '" fill="' + fgColor + '"' +
        (shapeDef.fillRule ? ' fill-rule="' + shapeDef.fillRule + '"' : '') + '/></g>';
    }
    var behindShapesEl = (tf.shapes || []).filter(function (s) { return s.wrapMode !== 'front'; }).map(renderShapeSvg).join('');
    var frontShapesEl = (tf.shapes || []).filter(function (s) { return s.wrapMode === 'front'; }).map(renderShapeSvg).join('');
    // Alle Textobjekte (nicht nur das primäre) laufen über foreignObject mit
    // echtem HTML-Markup - so bleiben Fett/Kursiv/Unterstrichen/
    // Durchgestrichen/Aufzählung sowie Zeilenabstand/Laufweite erhalten
    // (SVG-<text> unterstützt weder automatischen Umbruch noch Inline-HTML).
    var textEls = tf.texts.map(function (t, idx) {
      var html = t.html || (t.text ? escapeXml(t.text) : '');
      if (!html) { return ''; }
      var fontCss = resolveFontCss(t.font);
      var baseStyle = 'box-sizing:border-box;font-family:' + escapeXml(fontCss) + ';font-size:' + t.size +
        'px;font-weight:' + (t.fontWeight || 700) + ';line-height:' + (t.lineHeight || 1.2) +
        ';letter-spacing:' + (t.letterSpacing || 0) + 'px;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;' +
        (wordartCssFor(t, preset.text) || computeStyle1Css(t, preset.text));
      if (idx === 0) {
        // Primäres Textobjekt: füllt den ganzen Rahmen.
        return '<foreignObject x="0" y="0" width="' + tf.w + '" height="' + tf.h + '">' +
          '<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;padding:12px;' +
          'display:flex;align-items:center;justify-content:center;text-align:center;' + baseStyle + '">' +
          html + '</div></foreignObject>';
      }
      // Weitere Textobjekte: frei positioniert, Box-Größe grob aus dem
      // (Klartext-)Inhalt geschätzt (keine Live-DOM-Messung nötig).
      var plain = t.text || '';
      var lines = Math.max(1, (html.match(/<div|<li|<br/gi) || []).length + (plain ? 1 : 0));
      var textW = Math.min(tf.w * 0.9, fitCtx && plain ? (function () {
        fitCtx.font = t.size + 'px ' + fontCss;
        return fitCtx.measureText(plain).width + 24;
      })() : tf.w * 0.5);
      var boxW = Math.max(60, textW);
      var boxH = lines * t.size * (t.lineHeight || 1.2) + 16;
      var boxX = t.x * tf.w - boxW / 2, boxY = t.y * tf.h - boxH / 2;
      return '<foreignObject x="' + boxX + '" y="' + boxY + '" width="' + boxW + '" height="' + boxH + '">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;' +
        'display:flex;align-items:center;justify-content:center;text-align:center;' + baseStyle + '">' +
        html + '</div></foreignObject>';
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + tf.w + '" height="' + tf.h +
      '" viewBox="0 0 ' + tf.w + ' ' + tf.h + '"><style>' +
      '.ic-frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;' +
      'font-size:.82em;line-height:1.1;margin:0 2px}' +
      '.ic-frac-num{border-bottom:1.5px solid currentColor;padding:0 3px 1px}' +
      '.ic-frac-den{padding:1px 3px 0}' +
      '</style>' + defs + bgRect + behindShapesEl + textEls + frontShapesEl + '</svg>';
  }

  // Bettet die tatsächlich verwendeten Web-Fonts (aktuell nur "Handschrift")
  // direkt als Base64-Daten-URI in einen <style>-Block des SVGs ein, damit
  // die Schriftart auch beim Anzeigen als <img>-Quelle erhalten bleibt (ein
  // extern referenziertes @font-face würde dort sonst nicht geladen). Bei
  // Netzwerkfehlern wird das SVG unverändert zurückgegeben (Systemschrift
  // als Rückfall) statt das Speichern zu blockieren.
  var fontEmbedCache = {};
  function embedFontsInSVG(svgString, tf) {
    var usedFontIds = {};
    tf.texts.forEach(function (t) { if (t.html) { usedFontIds[t.font] = true; } });
    var toEmbed = TEXTFRAME_FONTS.filter(function (f) { return f.webfont && usedFontIds[f.id]; });
    if (toEmbed.length === 0) { return Promise.resolve(svgString); }

    return Promise.all(toEmbed.map(function (f) {
      if (fontEmbedCache[f.id]) { return fontEmbedCache[f.id]; }
      fontEmbedCache[f.id] = fetch('https://fonts.googleapis.com/css2?family=' + f.webfont + '&display=swap')
        .then(function (r) { return r.text(); })
        .then(function (css) {
          var m = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
          if (!m) { return null; }
          return fetch(m[1]).then(function (r) { return r.blob(); }).then(function (blob) {
            return new Promise(function (resolve) {
              var reader = new FileReader();
              reader.onload = function () { resolve(reader.result); };
              reader.onerror = function () { resolve(null); };
              reader.readAsDataURL(blob);
            });
          });
        }).then(function (dataUrl) {
          if (!dataUrl) { return null; }
          var family = f.css.split(',')[0].replace(/['"]/g, '').trim();
          return '@font-face{font-family:\'' + family + '\';src:url(' + dataUrl + ') format("woff2");}';
        }).catch(function () { return null; });
      return fontEmbedCache[f.id];
    })).then(function (rules) {
      var css = rules.filter(Boolean).join('');
      if (!css) { return svgString; }
      var styleBlock = '<style>' + css + '</style>';
      return svgString.replace('<svg ', '<svg ').replace(/(<svg[^>]*>)/, '$1' + styleBlock);
    }).catch(function () { return svgString; });
  }

  // Speichert das Wortfeld (neu oder erneutes Bearbeiten eines bestehenden)
  // - läuft über dieselbe Foto-Pipeline (save_photo/update_photo), damit
  // Ziehen/Größe/Rotation/Annotieren/Faden ohne Sonderbehandlung
  // funktionieren; `wordfielddata` (JSON) wird zusätzlich mitgespeichert,
  // damit "Bearbeiten" später wieder den Wortfeld-Editor öffnen kann.
  function saveTextFrame(tf, saveBtn) {
    saveBtn.disabled = true;
    var svg = buildTextFrameSVG(tf);
    var label = tf.texts.map(function (t) { return t.text; }).filter(Boolean).join(' ');
    var wordfielddata = JSON.stringify(tf);
    var isEditingExisting = !!state.editingPhotoId;

    embedFontsInSVG(svg, tf).then(function (finalSvg) {
      var dataUrl = 'data:image/svg+xml;base64,' + utf8ToBase64(finalSvg);
      var promise = isEditingExisting
        ? callAjax('mod_pinnwand_update_photo', {
          cmid: cfg.cmid, photoid: state.editingPhotoId, imagedata: dataUrl, wordfielddata: wordfielddata
        })
        : callAjax('mod_pinnwand_save_photo', {
          cmid: cfg.cmid, imagedata: dataUrl, gridtype: 'none', gridvalue: 0, consent: false,
          sourcetitle: label, sourceauthor: '', sourceyear: '', sourceepoch: '', sourceplace: '', sourceorigauthor: '',
          boardid: state.currentBoard || 0, wordfielddata: wordfielddata
        });

      promise.then(function (res) {
        var maxreached = !!res.maxreached;
        refreshPhotos().then(function () {
          resetCaptureState();
          state.step = isEditingExisting ? 'arrange' : (maxreached ? 'arrange' : 'home');
          render();
        });
      }).catch(function (e) {
        alert(S.error_save + ' (' + e.message + ')');
        saveBtn.disabled = false;
      });
    });
  }

  function renderTextFrame(body) {
    if (!state.textFrame) { state.textFrame = newTextFrame(state.wordArtMode); }
    var tf = state.textFrame;
    TEXTFRAME_FONTS.forEach(function (f) { if (f.webfont) { ensureWebfont(f.webfont); } });

    // Äußeres Layout: bei einem Hochkant-Zettel stehen die Werkzeug-Blöcke
    // als Seitenleiste RECHTS (Reihe), damit der Zettel selbst die volle
    // Höhe von oben bis unten bekommt, statt durch darunter liegende
    // Blöcke Höhe zu verlieren. Bei Querformat bleiben sie darunter
    // (Spalte). Richtet sich nach dem Seitenverhältnis des Zettels selbst,
    // nicht nach der Bildschirmgröße.
    // Entscheidend ist NICHT das reine Seitenverhältnis, sondern ob der
    // Zettel praktisch zu hoch für das aktuelle Fenster wird - dann lohnt
    // sich die Seitenleiste, weil der Zettel sonst nicht mehr komplett
    // sichtbar wäre. Ein leicht hochkantiger, aber insgesamt kleiner
    // Zettel bleibt dagegen bei der gestapelten Anordnung.
    var tfOrientation = (tf.h > tf.w && tf.h > window.innerHeight * 0.5) ? 'ic-tf-portrait' : 'ic-tf-landscape';
    var layout = el('div', { class: 'ic-textframe-layout ' + tfOrientation });
    var stage = el('div', { class: 'ic-stage' });
    var preset = TEXTFRAME_PRESETS.filter(function (p) { return p.id === tf.preset; })[0];
    var frame = el('div', {
      class: 'ic-textframe-preview',
      style: 'width:' + tf.w + 'px;height:' + tf.h + 'px;' +
        (preset.shadow ? 'box-shadow:0 8px 24px rgba(0,0,0,.4);' : '') +
        (preset.bg ? '' : 'border:2px dashed rgba(255,255,255,.3);')
    });
    // Innerer Container trägt Hintergrundfarbe UND die Formbeschneidung
    // (Kreis/Oval/Rundung) - overflow:hidden bleibt bewusst HIER und nicht
    // auf frame selbst, sonst würde der leicht außerhalb liegende
    // Größenänderungs-Griff (siehe unten) unsichtbar/unklickbar.
    var frameInner = el('div', {
      class: 'ic-textframe-inner',
      style: preset.bg ? 'background:' + preset.bg + ';' : 'background:transparent;'
    });
    frame.appendChild(frameInner);
    stage.appendChild(frame);
    layout.appendChild(stage);
    body.appendChild(layout);

    // Hauptrahmen selbst skalierbar (Eck-Handle unten rechts) - die
    // Textobjekte sind an ihn gebunden (normalisierte 0..1-Koordinaten),
    // sie passen sich beim Skalieren automatisch proportional mit an.
    var frameResizeHandle = el('div', { class: 'ic-resize' });
    frame.appendChild(frameResizeHandle);
    (function () {
      var dragging = false, startX = 0, startY = 0, startW = 0, startH = 0;
      function pt(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
      function down(ev) {
        dragging = true; var p = pt(ev);
        startX = p.x; startY = p.y; startW = tf.w; startH = tf.h;
        ev.stopPropagation(); ev.preventDefault();
      }
      function move(ev) {
        if (!dragging) { return; }
        var p = pt(ev);
        tf.w = Math.max(120, startW + (p.x - startX));
        tf.h = Math.max(80, startH + (p.y - startY));
        frame.style.width = tf.w + 'px'; frame.style.height = tf.h + 'px';
        ev.preventDefault();
      }
      function up() {
        if (dragging) { dragging = false; render(); }
      }
      frameResizeHandle.addEventListener('mousedown', down);
      frameResizeHandle.addEventListener('touchstart', down, { passive: false });
      window.addEventListener('mousemove', move);
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('mouseup', up);
      window.addEventListener('touchend', up);
    })();

    var activeId = tf.texts[0] && tf.texts[0].id;
    function selectText(id) {
      activeId = id;
      frame.querySelectorAll('.ic-textframe-obj').forEach(function (o) {
        o.classList.toggle('active', o.dataset.textid === String(id));
      });
      refreshControls();
    }

    function textEl(t, idx) {
      var isPrimary = idx === 0;
      t.lineHeight = t.lineHeight || 1.2;
      t.letterSpacing = t.letterSpacing || 0;
      t.fontWeight = t.fontWeight || 700;
      var fontCss = resolveFontCss(t.font);
      var el2 = el('div', {
        class: 'ic-textframe-obj' + (isPrimary ? ' primary' : '') + (t.id === activeId ? ' active' : ''),
        'data-textid': String(t.id),
        contenteditable: 'true',
        style: (isPrimary ? '' : 'left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;') +
          'font-family:' + fontCss + ';font-size:' + t.size + 'px;font-weight:' + t.fontWeight +
          ';line-height:' + t.lineHeight + ';letter-spacing:' + t.letterSpacing + 'px;' +
          (wordartCssFor(t, preset.text) || computeStyle1Css(t, preset.text))
      });
      // innerHTML statt textContent: so bleiben Fett/Kursiv/Unterstrichen/
      // Durchgestrichen/Aufzählungen (siehe Formatierungswerkzeuge) beim
      // Zwischenspeichern erhalten statt auf reinen Text reduziert zu werden.
      // Abwärtskompatibel: ältere gespeicherte Wortfelder haben nur t.text
      // (kein t.html) - dann als Klartext übernehmen statt leer zu bleiben.
      if (t.html) { el2.innerHTML = t.html; } else if (t.text) { el2.textContent = t.text; }
      if (!t.html && !t.text) { el2.setAttribute('data-placeholder', S.textframe_placeholder); }
      // Wichtig: hier KEIN render() aufrufen - das würde das gerade fokussierte
      // contenteditable-Element sofort zerstören und den Cursor verlieren,
      // noch bevor überhaupt etwas eingegeben werden kann. Stattdessen wird
      // nur die aktive Markierung + das Steuerelemente-Panel isoliert
      // aktualisiert (siehe selectText/refreshControls).
      el2.addEventListener('focus', function () { selectText(t.id); });
      if (isPrimary) {
        // Primäres Textobjekt: füllt den ganzen Rahmen, bricht automatisch
        // um und passt seine Schriftgröße live an (2D-Fit: Breite + Höhe),
        // statt eines kleinen, frei positionierten einzeiligen Labels.
        el2.addEventListener('input', function () {
          t.html = el2.innerHTML; t.text = el2.textContent;
          autoFitPrimaryText(el2, t, tf.h);
        });
      } else {
        el2.addEventListener('input', function () { t.html = el2.innerHTML; t.text = el2.textContent; });
        var sizeHandle = el('div', { class: 'ic-textframe-size-handle', title: S.fontsize });
        el2.appendChild(sizeHandle);
        makeTextObjectMovable(el2, frame, t, sizeHandle);
        sizeHandle.addEventListener('mousedown', function () { selectText(t.id); });
      }
      return el2;
    }
    tf.texts.forEach(function (t, idx) { frameInner.appendChild(textEl(t, idx)); });

    // Die erste Karte ist beim Öffnen des Editors sofort beschreibbar -
    // Cursor direkt gesetzt, kein zusätzlicher Klick nötig.
    if (!tf._autofocused) {
      tf._autofocused = true;
      var primaryEl = frame.querySelector('.ic-textframe-obj.primary');
      if (primaryEl) {
        setTimeout(function () {
          primaryEl.focus();
          var range = document.createRange();
          range.selectNodeContents(primaryEl);
          range.collapse(false);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }, 0);
      }
    }

    // Werkzeuge in drei klar benannte Blöcke - Anordnung (unter- oder
    // nebeneinander) richtet sich nach dem Seitenverhältnis des Zettels
    // selbst (nicht nach der Bildschirmgröße), siehe CSS .ic-tf-landscape/
    // .ic-tf-portrait.
    var blocksWrap = el('div', { class: 'ic-textframe-blocks ' + tfOrientation });
    // Akkordeon: Überschrift antippen klappt den jeweiligen Block ein/aus -
    // auf dem Handy starten alle Blöcke eingeklappt (siehe CSS), auf
    // größeren Bildschirmen bleiben sie offen.
    function makeAccordionBlock(titleText) {
      var blockEl = el('div', { class: 'ic-textframe-block' });
      var titleEl = el('h3', { class: 'ic-textframe-block-title' }, [titleText]);
      var contentEl = el('div', { class: 'ic-textframe-block-content' });
      titleEl.addEventListener('click', function () { blockEl.classList.toggle('ic-tf-expanded'); });
      blockEl.appendChild(titleEl);
      blockEl.appendChild(contentEl);
      blockEl.content = contentEl;
      return blockEl;
    }
    var blockTemplates = makeAccordionBlock(S.tfblock_templates);
    var blockFonts = makeAccordionBlock(S.tfblock_fonts);
    var blockForm = makeAccordionBlock(state.wordArtMode ? S.tfblock_form : S.tfblock_formulas);
    blocksWrap.appendChild(blockTemplates);
    blocksWrap.appendChild(blockFonts);
    blocksWrap.appendChild(blockForm);
    layout.appendChild(blocksWrap);

    // Block 1 "Farben und Formen" - identisch in beiden Editoren (Zettel
    // und WordArt). Enthält: Form der Kartenfläche selbst (Hintergrund),
    // eine optionale dekorative Form im Vordergrund (Sticker/Badge hinter
    // dem Text), sowie Fill/Kontur/Effekte als Pop-ups, die auf das
    // gerade gewählte Textobjekt wirken. Die übrigen, sich zwischen den
    // Editoren unterscheidenden Blöcke (Text/Schrift, Formeln etc.)
    // folgen in einem späteren Durchgang unverändert weiter unten.
    var TF_SHAPES = ['rect', 'rounded', 'circle', 'ellipse'];
    // Polygon-Werkzeug: eigene Form durch Klicken von Eckpunkten definieren
    // (mindestens 3 nötig), Doppelklick/Enter schließt den Pfad ab. Ist
    // bereits eine Form ausgewählt, wird SIE zur Polygon-Form, sonst
    // entsteht eine neue.
    function startCustomShapeDraw(activeShape) {
      var points = [];
      var overlay = el('div', { class: 'ic-custom-shape-draw-hint' }, [S.tf_shape_custom_hint]);
      body.appendChild(overlay);
      var dotsLayer = el('svg', { class: 'ic-custom-shape-dots' });
      frame.appendChild(dotsLayer);
      function redraw() {
        dotsLayer.innerHTML = '';
        if (points.length > 1) {
          var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          poly.setAttribute('points', points.map(function (p) { return (p[0] * tf.w) + ',' + (p[1] * tf.h); }).join(' '));
          poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', '#4f8cff'); poly.setAttribute('stroke-width', '2');
          dotsLayer.appendChild(poly);
        }
        points.forEach(function (p) {
          var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', p[0] * tf.w); dot.setAttribute('cy', p[1] * tf.h); dot.setAttribute('r', 5);
          dot.setAttribute('fill', '#4f8cff');
          dotsLayer.appendChild(dot);
        });
      }
      function onClick(ev) {
        var rect = frame.getBoundingClientRect();
        points.push([(ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height]);
        redraw();
      }
      function finish() {
        frame.removeEventListener('click', onClick);
        frame.removeEventListener('dblclick', finish);
        document.removeEventListener('keydown', onKey);
        dotsLayer.remove(); overlay.remove();
        if (points.length >= 3) {
          if (activeShape) {
            activeShape.type = 'custom'; activeShape.customPoints = points;
          } else {
            var nextId = (Math.max.apply(null, tf.shapes.map(function (s) { return s.id; }).concat([0])) || 0) + 1;
            tf.shapes.push({ id: nextId, type: 'custom', customPoints: points, x: 0.5, y: 0.5, size: 0.4, color: '#e0503f' });
            state.activeShapeId = nextId;
          }
          render();
        }
      }
      function onKey(ev) { if (ev.key === 'Enter') { finish(); } if (ev.key === 'Escape') { points = []; finish(); } }
      frame.addEventListener('click', onClick);
      frame.addEventListener('dblclick', finish);
      document.addEventListener('keydown', onKey);
    }
    var BASIC_SHAPES = [
      { id: 'rect', label: S.tf_shape_rect, d: 'M5 5 L95 5 L95 95 L5 95 Z' },
      { id: 'rounded', label: S.tf_shape_rounded, d: 'M25 5 L75 5 A20 20 0 0 1 95 25 L95 75 A20 20 0 0 1 75 95 L25 95 A20 20 0 0 1 5 75 L5 25 A20 20 0 0 1 25 5 Z' },
      { id: 'circle', label: S.tf_shape_circle, d: 'M50 5 A45 45 0 1 1 49.9 5 Z' },
      { id: 'ellipse', label: S.tf_shape_ellipse, d: 'M50 20 A45 30 0 1 1 49.9 20 Z' }
    ];
    // Eine gemeinsame Funktion für BEIDE Formen-Buttons (Hintergrund und
    // Vordergrund) - ein einziges, scrollbares Raster mit Icons statt
    // Text, Grundformen zuerst, keine unterschiedliche Gestaltung
    // zwischen beiden Auswahlen mehr.
    function buildShapeGrid(content, currentId, onPick, includeNone) {
      if (includeNone) {
        var noneBtn = el('button', { class: 'ic-btn ic-btn-ghost' + (currentId === 'none' ? ' ic-btn-primary' : ''), title: S.tf_shape_none }, ['\u2715']);
        noneBtn.addEventListener('click', function () { onPick('none'); });
        content.appendChild(noneBtn);
      }
      var allCats = Object.assign({ grundformen_basic: BASIC_SHAPES }, FG_SHAPE_CATEGORIES);
      Object.keys(allCats).forEach(function (cat) {
        var grid = el('div', { class: 'ic-shape-grid' });
        allCats[cat].forEach(function (s) {
          var cell = el('button', {
            class: 'ic-shape-cell' + (currentId === s.id ? ' active' : ''), title: s.label,
            style: 'background-image:url(' + fgShapeSvgDataUri(s, '#cfd2d8') + ')'
          });
          cell.addEventListener('click', function () { onPick(s.id); });
          grid.appendChild(cell);
        });
        content.appendChild(grid);
      });
      // Polygon/Punkte-Pfad: eigene Form durch Klicken von Eckpunkten auf
      // der Karte definieren - Doppelklick oder Enter schließt den Pfad.
      var polyBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.tf_shape_custom }, [icon('pen')]);
      polyBtn.addEventListener('click', function () { onPick('__custom__'); });
      content.appendChild(polyBtn);
    }
    tf.shapes = tf.shapes || [];
    var columnsWrap = el('div', { class: 'ic-cf-columns' });
    blockTemplates.content.appendChild(columnsWrap);

    // Linke Spalte: Formen, inline in einem scrollbaren Feld (kein Modal
    // mehr) - Grundformen oben, dann die Kategorien, dann das
    // Polygon-Werkzeug. Jede Wahl erzeugt eine NEUE Form (keine
    // Übertragung auf eine bereits ausgewählte mehr) - die neue Form
    // lässt sich danach frei über die anderen ziehen und skalieren.
    var shapesCol = el('div', { class: 'ic-cf-shapes-col' });
    columnsWrap.appendChild(shapesCol);
    function pickShapeType(id) {
      if (id === '__custom__') { startCustomShapeDraw(null); return; }
      var nextId = (Math.max.apply(null, tf.shapes.map(function (s) { return s.id; }).concat([0])) || 0) + 1;
      tf.shapes.push({ id: nextId, type: id, x: 0.5, y: 0.5, size: 0.4, color: '#e0503f' });
      state.activeShapeId = nextId;
      render();
    }
    buildShapeGrid(shapesCol, null, pickShapeType, false);

    // Formen als echte Objekte auf dem Zettel - anklickbar zum Auswählen,
    // frei verschiebbar und über den Eck-Griff skalierbar (auch über
    // andere Formen hinweg).
    tf.shapes.forEach(function (s) {
      var shapeDef = s.type === 'custom' && s.customPoints
        ? { d: s.customPoints.map(function (p, i) { return (i === 0 ? 'M' : 'L') + (p[0] * 100) + ' ' + (p[1] * 100); }).join(' ') + ' Z' }
        : (s.type && s.type !== 'none'
          ? [].concat.apply([], Object.keys(FG_SHAPE_CATEGORIES).map(function (c) { return FG_SHAPE_CATEGORIES[c]; })).concat(BASIC_SHAPES)
            .filter(function (d) { return d.id === s.type; })[0]
          : null);
      if (!shapeDef) { return; }
      var pxSize = Math.min(tf.w, tf.h) * s.size;
      var shapeEl = el('div', {
        class: 'ic-textframe-shapeobj' + (state.activeShapeId === s.id ? ' active' : ''),
        style: 'left:' + (s.x * 100) + '%;top:' + (s.y * 100) + '%;width:' + pxSize + 'px;height:' + pxSize + 'px;' +
          (shapeDef ? 'background-image:url(' + fgShapeSvgDataUri(shapeDef, s.color || '#e0503f') + ')' : '')
      });
      shapeEl.addEventListener('click', function (ev) { ev.stopPropagation(); state.activeShapeId = s.id; render(); });
      var shapeSizeHandle = el('div', { class: 'ic-resize ic-textframe-shape-resize' });
      shapeEl.appendChild(shapeSizeHandle);
      makeShapeMovable(shapeEl, frame, s, shapeSizeHandle);
      if (s.wrapMode === 'wrap') {
        // Textumfluss: Form "schwimmt" zur nächstgelegenen Seite, Text
        // soll ihr per shape-outside ausweichen. Wirkt nur bei Text im
        // normalen Fluss - unsere Textobjekte sind frei positioniert
        // (siehe Kommentar bei ic-textframe-obj), daher bislang nur eine
        // Grundlage für spätere Ausbaustufen, kein vollständiger Umfluss.
        shapeEl.style.float = s.x < 0.5 ? 'left' : 'right';
        shapeEl.style.shapeOutside = 'circle(50%)';
      }
      if (s.wrapMode === 'front') {
        frameInner.appendChild(shapeEl);
      } else {
        frameInner.insertBefore(shapeEl, frameInner.firstChild);
      }
    });

    // Rechte Spalte: Fläche/Kontur/Effekte, Transparenz-Slider, Tabs
    // (Raster/Rad).
    var colorsCol = el('div', { class: 'ic-cf-colors-col' });
    columnsWrap.appendChild(colorsCol);
    var styleRow = el('div', { class: 'ic-textframe-formatgrid' });
    var fillBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: S.tf_fill }, [icon('fillicon')]);
    var outlineBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: S.tf_outline }, [icon('outlineicon')]);
    var effectsBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: S.tf_effects }, [icon('effecticon')]);
    styleRow.appendChild(fillBtn); styleRow.appendChild(outlineBtn); styleRow.appendChild(effectsBtn);
    colorsCol.appendChild(styleRow);
    var opacitySliderRow = el('div', { class: 'ic-textframe-edit' });
    colorsCol.appendChild(opacitySliderRow);
    var colorTabsRow = el('div', { class: 'ic-cf-tabs' });
    var tabRaster = el('button', { class: 'ic-cf-tab' + (state.colorTab !== 'wheel' ? ' active' : '') }, [S.tf_tab_grid]);
    var tabWheel = el('button', { class: 'ic-cf-tab' + (state.colorTab === 'wheel' ? ' active' : '') }, [S.tf_tab_wheel]);
    tabRaster.addEventListener('click', function () { state.colorTab = 'grid'; render(); });
    tabWheel.addEventListener('click', function () { state.colorTab = 'wheel'; render(); });
    colorTabsRow.appendChild(tabRaster); colorTabsRow.appendChild(tabWheel);
    colorsCol.appendChild(colorTabsRow);
    var bigPaletteContainer = el('div', { class: 'ic-bigpalette-container' });
    colorsCol.appendChild(bigPaletteContainer);

    var presetOrder = state.wordArtMode
      ? TEXTFRAME_PRESETS
      : TEXTFRAME_PRESETS.slice().sort(function (a, b) {
        var order = { paper: 0, none: 1, dark: 2, light: 3 };
        return order[a.id] - order[b.id];
      });
    var presetRow = el('div', { class: 'ic-textframe-presets' });
    presetOrder.forEach(function (p) {
      var label = p.id === 'none' ? S.preset_none : p.id === 'paper' ? S.preset_paper : p.id === 'dark' ? S.preset_dark : S.preset_light;
      var swatchStyle = p.bg
        ? 'background:' + p.bg + ';box-shadow:inset 0 0 0 2px rgba(255,255,255,.15);'
        : 'background:repeating-linear-gradient(45deg,rgba(255,255,255,.08),rgba(255,255,255,.08) 4px,transparent 4px,transparent 8px);';
      var b = el('button', {
        class: 'ic-preset-swatch' + (tf.preset === p.id ? ' active' : ''), title: label
      }, [el('span', { style: 'color:' + p.text }, ['A'])]);
      b.style.cssText += swatchStyle;
      b.addEventListener('click', function () { tf.preset = p.id; render(); });
      presetRow.appendChild(b);
    });
    blockTemplates.content.appendChild(presetRow);

    // Block 2 (Schriften) + Block 3 (Form/Rand/Schatten/Kontur + Farbpalette)
    // werden isoliert neu aufgebaut (refreshControls), NIE über ein volles
    // render(), damit ein fokussiertes contenteditable-Feld nie mitten in
    // der Bearbeitung zerstört wird.
    var fontsBox = el('div', {});
    var formBox = el('div', {});
    blockFonts.content.appendChild(fontsBox);
    blockForm.content.appendChild(formBox);
    function refreshControls() {
      fontsBox.innerHTML = '';
      formBox.innerHTML = '';
      var active = tf.texts.filter(function (t) { return t.id === activeId; })[0];
      if (!active) { return; }

      // Fill/Kontur/Effekte (Block 1) wirken auf DIESES aktive Textobjekt -
      // Handler werden bei jedem refreshControls() neu gesetzt (überschreibt
      // die vorherige Zuordnung), damit sie immer das gerade gewählte
      // Textobjekt treffen.
      function applyStyle1() {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (objEl) { objEl.style.cssText += ';' + computeStyle1Css(active, preset.text); }
      }
      function openStyle1Popup(anchorBtn, title, buildRows) {
        openDraggableModal(title, anchorBtn, function (content) { buildRows(content); });
      }
      function applyFillColor(color) {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        noteRecentColor(color);
        applyStyleToSelectionOrWhole(objEl, 'color:' + color + ';', function () {
          active.fillColor = active.color = color;
          active.fillGradient = null;
          applyStyle1();
        });
        refreshControls();
      }
      opacitySliderRow.innerHTML = '';
      opacitySliderRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_opacity]));
      var opacitySlider = el('input', {
        type: 'range', min: '0', max: '100', step: '5', value: String(Math.round((active.opacity != null ? active.opacity : 1) * 100)),
        class: 'ic-textframe-range'
      });
      opacitySlider.addEventListener('input', function () {
        active.opacity = parseInt(opacitySlider.value, 10) / 100;
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (objEl) { objEl.style.opacity = active.opacity; }
      });
      opacitySliderRow.appendChild(opacitySlider);

      bigPaletteContainer.innerHTML = '';
      if (state.colorTab === 'wheel') {
        buildColorWheel(bigPaletteContainer, active.fillGradient ? null : (active.fillColor || preset.text), applyFillColor);
      } else {
        buildBigColorPalette(bigPaletteContainer, active.fillGradient ? null : (active.fillColor || preset.text), null, applyFillColor, null);
      }
      var gradToggle = el('label', { class: 'ic-me-check' });
      var gradCheck = el('input', { type: 'checkbox' });
      gradCheck.checked = !!active.fillGradient;
      gradToggle.appendChild(gradCheck);
      gradToggle.appendChild(document.createTextNode(S.tf_use_gradient));
      bigPaletteContainer.appendChild(gradToggle);
      var gradRow = el('div', { class: 'ic-textframe-edit' });
      var g1 = el('input', { type: 'color', value: (active.fillGradient && active.fillGradient[0]) || '#e0503f' });
      var g2 = el('input', { type: 'color', value: (active.fillGradient && active.fillGradient[1]) || '#4f8cff' });
      function updateGrad() { active.fillGradient = [g1.value, g2.value]; applyStyle1(); }
      g1.addEventListener('input', updateGrad); g2.addEventListener('input', updateGrad);
      gradRow.appendChild(g1); gradRow.appendChild(g2);
      gradCheck.addEventListener('change', function () {
        active.fillGradient = gradCheck.checked ? [g1.value, g2.value] : null;
        applyStyle1(); refreshControls();
      });
      bigPaletteContainer.appendChild(gradRow);
      outlineBtn.dataset.popupId = 'outline';
      outlineBtn.onclick = function (ev) {
        ev.stopPropagation();
        openStyle1Popup(outlineBtn, S.tf_outline, function (popup) {
          var row = el('div', { class: 'ic-textframe-edit' });
          var colorInput = el('input', { type: 'color', value: active.outlineColor || '#000000' });
          var widthInput = el('input', { type: 'range', min: '0', max: '6', step: '0.5', value: String(active.outlineWidth || 0) });
          colorInput.addEventListener('input', function () { active.outlineColor = colorInput.value; applyStyle1(); });
          widthInput.addEventListener('input', function () { active.outlineWidth = parseFloat(widthInput.value); applyStyle1(); });
          row.appendChild(colorInput);
          row.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_width]));
          row.appendChild(widthInput);
          popup.appendChild(row);
        });
      };
      effectsBtn.dataset.popupId = 'effects';
      effectsBtn.onclick = function (ev) {
        ev.stopPropagation();
        openStyle1Popup(effectsBtn, S.tf_effects, function (popup) {
          [
            ['shadowOn', 'shadowColor', 'shadowBlur', S.tf_shadow, '#000000', 4],
            ['glowOn', 'glowColor', 'glowWidth', S.tf_glow, '#ffffff', 8]
          ].forEach(function (cfg) {
            var onKey = cfg[0], colorKey = cfg[1], widthKey = cfg[2], label = cfg[3], defColor = cfg[4], defWidth = cfg[5];
            var row = el('div', { class: 'ic-textframe-edit' });
            var toggle = el('label', { class: 'ic-me-check' });
            var check = el('input', { type: 'checkbox' });
            check.checked = !!active[onKey];
            toggle.appendChild(check); toggle.appendChild(document.createTextNode(label));
            var colorInput = el('input', { type: 'color', value: active[colorKey] || defColor });
            var widthInput = el('input', { type: 'range', min: '0', max: '20', step: '1', value: String(active[widthKey] || defWidth) });
            check.addEventListener('change', function () { active[onKey] = check.checked; applyStyle1(); });
            colorInput.addEventListener('input', function () { active[colorKey] = colorInput.value; applyStyle1(); });
            widthInput.addEventListener('input', function () { active[widthKey] = parseFloat(widthInput.value); applyStyle1(); });
            row.appendChild(toggle); row.appendChild(colorInput); row.appendChild(widthInput);
            popup.appendChild(row);
          });
        });
      };

      // Zeichen-Werkzeuge (wirken auf die aktuelle Zeichen-Auswahl, siehe
      // applyStyleToSelectionOrWhole): Fett/Kursiv/Unterstrichen zuerst.
      if (!state.wordArtMode) {
        fontsBox.appendChild(el('div', { class: 'ic-textframe-label' }, [S.tf_group_char]));
        var charRow = el('div', { class: 'ic-textframe-formatgrid' });
        [
          ['bold', 'boldicon', S.format_bold], ['italic', 'italicicon', S.format_italic],
          ['underline', 'underlineicon', S.format_underline]
        ].forEach(function (cmd) {
          var fb = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: cmd[2] }, [icon(cmd[1])]);
          fb.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
          fb.addEventListener('click', function () { document.execCommand(cmd[0], false, null); });
          charRow.appendChild(fb);
        });
        fontsBox.appendChild(charRow);
      }
      var editRow = el('div', { class: 'ic-textframe-edit' });
      var fontSel = el('select', { class: 'ic-textframe-select' });
      TEXTFRAME_FONTS.forEach(function (f) {
        fontSel.appendChild(el('option', { value: f.id, selected: f.id === active.font ? 'selected' : null }, [f.label]));
      });
      fontSel.addEventListener('change', function () {
        var css = (TEXTFRAME_FONTS.filter(function (f) { return f.id === fontSel.value; })[0] || TEXTFRAME_FONTS[0]).css;
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        applyStyleToSelectionOrWhole(objEl, 'font-family:' + css + ';', function () {
          active.font = fontSel.value;
          objEl.style.fontFamily = css;
        });
      });
      editRow.appendChild(fontSel);

      // WordArt: eigener "Fonts"-Button öffnet die kuratierte, nach
      // Kategorien geordnete Schriftbibliothek (siehe WORDART_FONT_CATEGORIES) -
      // getrennt von der schlichten Basis-Auswahl oben, da "wilde"
      // Formatierung hier im Vordergrund steht.
      if (state.wordArtMode) {
        var fontsBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [icon('fonts'), el('span', {}, [S.wordart_fonts])]);
        fontsBtn.addEventListener('click', function () { openWordartFontBrowser(active, frame); });
        fontsBox.appendChild(fontsBtn);
      }

      // Schriftgröße: Größer/Kleiner-Buttons statt Slider (auf Wunsch).
      // Wirkt auf die aktuelle Zeichen-Auswahl, falls vorhanden, sonst auf
      // das ganze Textobjekt.
      var sizeRow = el('div', { class: 'ic-textframe-edit' });
      var sizeDisplay = el('span', { class: 'ic-stepper-value' }, [String(active.size)]);
      var lastSizeDelta = 0;
      function setSize(delta) {
        lastSizeDelta += delta;
        var newSize = Math.max(10, Math.min(200, active.size + lastSizeDelta));
        sizeDisplay.textContent = String(newSize);
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        applyStyleToSelectionOrWhole(objEl, 'font-size:' + newSize + 'px;', function () {
          active.size = newSize;
          objEl.style.fontSize = newSize + 'px';
          lastSizeDelta = 0;
        });
      }
      var sizeDown = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon' }, ['A\u2212']);
      var sizeUp = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon' }, ['A+']);
      sizeDown.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      sizeUp.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      sizeDown.addEventListener('click', function () { setSize(-2); });
      sizeUp.addEventListener('click', function () { setSize(2); });
      sizeRow.appendChild(sizeDown); sizeRow.appendChild(sizeDisplay); sizeRow.appendChild(sizeUp);
      editRow.appendChild(sizeRow);
      fontsBox.appendChild(editRow);

      // Schriftschnitt-Gewicht: Zahlen-Stepper statt Slider. Wirkt auf die
      // aktuelle Zeichen-Auswahl, falls vorhanden, sonst auf das ganze
      // Textobjekt.
      var weightRow = el('div', { class: 'ic-textframe-edit' });
      weightRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.fontweight]));
      weightRow.appendChild(numberStepper(active.fontWeight || 700, 300, 900, 100, 0, function (v) {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        applyStyleToSelectionOrWhole(objEl, 'font-weight:' + v + ';', function () {
          active.fontWeight = v;
          objEl.style.fontWeight = v;
        });
      }));
      fontsBox.appendChild(weightRow);

      var spaceRow = el('div', { class: 'ic-textframe-edit' });
      spaceRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.letterspacing]));
      spaceRow.appendChild(numberStepper(active.letterSpacing || 0, -2, 20, 0.5, 1, function (v) {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        applyStyleToSelectionOrWhole(objEl, 'letter-spacing:' + v + 'px;', function () {
          active.letterSpacing = v;
          objEl.style.letterSpacing = v + 'px';
        });
      }));
      fontsBox.appendChild(spaceRow);

      // Absatz-Werkzeuge (wirken auf die markierten Zeilen bzw. das ganze
      // Textobjekt, nicht auf einzelne Zeichen): Ausrichtung, Zeilenabstand,
      // Durchgestrichen/Aufzählung.
      fontsBox.appendChild(el('div', { class: 'ic-textframe-label' }, [S.tf_group_para]));
      var alignRow = el('div', { class: 'ic-textframe-formatgrid' });
      [
        ['justifyLeft', 'alignleft', S.align_left], ['justifyCenter', 'aligncenter', S.align_center],
        ['justifyRight', 'alignright', S.align_right], ['justifyFull', 'alignjustify', S.align_justify]
      ].forEach(function (cmd) {
        var ab = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: cmd[2] }, [icon(cmd[1])]);
        ab.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        ab.addEventListener('click', function () { document.execCommand(cmd[0], false, null); });
        alignRow.appendChild(ab);
      });
      // Durchgestrichen/Aufzählung gehören inhaltlich ebenfalls zum Absatz
      // und stehen in derselben Zeile statt isoliert für sich - nur im
      // Zettel-Modus (WordArt nutzt die WordArt-Stile weiter unten).
      if (!state.wordArtMode) {
        [
          ['strikeThrough', 'strikeicon', S.format_strike],
          ['insertUnorderedList', 'bulleticon', S.format_bullets]
        ].forEach(function (cmd) {
          var fb = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: cmd[2] }, [icon(cmd[1])]);
          fb.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
          fb.addEventListener('click', function () { document.execCommand(cmd[0], false, null); });
          alignRow.appendChild(fb);
        });
      }
      fontsBox.appendChild(alignRow);

      // Textumfluss der gerade ausgewählten Form: vor dem Text (liegt
      // sichtbar über dem Text), hinter dem Text (Standard), Umfluss
      // (Text fließt um die Form herum, siehe applyShapeWrapMode).
      var activeShapeForWrap = tf.shapes.filter(function (s) { return s.id === state.activeShapeId; })[0];
      if (activeShapeForWrap) {
        var wrapRow = el('div', { class: 'ic-textframe-formatgrid' });
        [
          ['front', 'wrapfront', S.tf_wrap_front], ['behind', 'wrapbehind', S.tf_wrap_behind],
          ['wrap', 'wraparound', S.tf_wrap_around]
        ].forEach(function (w) {
          var wb = el('button', {
            class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn' + ((activeShapeForWrap.wrapMode || 'behind') === w[0] ? ' ic-btn-primary' : ''),
            title: w[2]
          }, [icon(w[1])]);
          wb.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
          wb.addEventListener('click', function () { activeShapeForWrap.wrapMode = w[0]; render(); });
          wrapRow.appendChild(wb);
        });
        fontsBox.appendChild(wrapRow);
      }

      var lineRow = el('div', { class: 'ic-textframe-edit' });
      lineRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.lineheight]));
      lineRow.appendChild(numberStepper(active.lineHeight || 1.2, 0.9, 2.2, 0.1, 1, function (v) {
        active.lineHeight = v;
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (objEl) { objEl.style.lineHeight = v; }
      }));
      fontsBox.appendChild(lineRow);

      // Wendet Farbe UND (falls gesetzt) den WordArt-Stil gemeinsam neu auf
      // das Live-Element an - ein WordArt-Stil kann "color" durch eine
      // Verlaufsfüllung (background-clip:text) ersetzen, ein reines
      // objEl.style.color reicht dafür nicht aus.
      function reapplyTextStyle() {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        objEl.style.cssText += ';' + (wordartCssFor(active, preset.text) || ('color:' + (active.color || preset.text) + ';'));
      }

      // Formeleditor: Hoch-/Tiefstellen, Bruch, Symbol-Palette - nur im
      // Zettel-Modus. Bewusst als reines HTML (sup/sub, verschachtelte
      // Zeichen umgesetzt statt mit einer externen Formel-Bibliothek wie
      // KaTeX. Grund: der Zettel wird am Ende als statisches SVG-Bild
      // exportiert (siehe buildTextFrameSVG/embedFontsInSVG) - externe
      // Web-Fonts müssten dafür aufwendig als Base64 eingebettet werden
      // und liefen Gefahr, im exportierten Bild nicht zu erscheinen.
      // Hoch-/tiefgestellter Text und Unicode-Symbole nutzen dagegen
      // einfach die bereits vorhandene Schriftart weiter.
      if (!state.wordArtMode) {
        var formulaRow = el('div', { class: 'ic-textframe-formatgrid' });
        var supBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: S.format_superscript }, ['x\u00b2']);
        supBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        supBtn.addEventListener('click', function () { document.execCommand('superscript', false, null); });
        formulaRow.appendChild(supBtn);
        var subBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: S.format_subscript }, ['x\u2082']);
        subBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        subBtn.addEventListener('click', function () { document.execCommand('subscript', false, null); });
        formulaRow.appendChild(subBtn);
        var fracBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-textframe-fmt-btn', title: S.format_fraction }, ['a/b']);
        fracBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        fracBtn.addEventListener('click', function () {
          // Fügt eine einfache, direkt editierbare Bruch-Struktur ein
          // (zwei übereinanderliegende Spans mit Trennlinie) - Zähler/
          // Nenner lassen sich danach ganz normal antippen und bearbeiten,
          // da sie Teil desselben contenteditable-Bereichs sind.
          var html = '<span class="ic-frac" contenteditable="false">' +
            '<span class="ic-frac-num" contenteditable="true">a</span>' +
            '<span class="ic-frac-den" contenteditable="true">b</span></span>&nbsp;';
          document.execCommand('insertHTML', false, html);
        });
        formulaRow.appendChild(fracBtn);
        formBox.appendChild(formulaRow);

        var symbolRow = el('div', { class: 'ic-textframe-symbol-row' });
        ['±', '×', '÷', '√', 'π', '∞', '≤', '≥', '≠', '≈', '∑', '∫', '∂', '∆',
          'α', 'β', 'γ', 'θ', 'λ', 'μ', 'σ', 'φ', 'Ω', '→', '°', '‰'].forEach(function (sym) {
          var sb = el('button', { class: 'ic-textframe-symbol-btn' }, [sym]);
          sb.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
          sb.addEventListener('click', function () { document.execCommand('insertText', false, sym); });
          symbolRow.appendChild(sb);
        });
        formBox.appendChild(symbolRow);
      }

      // WordArt-Stile (Form/Rand/Schatten/Kontur) - nur im WordArt-Modus.
      // Jeder Button zeigt seinen eigenen Namen bereits im jeweiligen Stil -
      // dient dadurch gleichzeitig als Live-Vorschau ohne separate Tabs.
      if (state.wordArtMode) {
        var wordartRow = el('div', { class: 'ic-textframe-wordart-row' });
        WORDART_STYLES.forEach(function (w) {
          var wb = el('button', {
            class: 'ic-wordart-preset-btn' + ((active.wordartStyle || 'none') === w.id ? ' active' : ''),
            style: w.css(active.color || preset.text)
          }, [w.label]);
          wb.addEventListener('click', function () {
            active.wordartStyle = w.id;
            reapplyTextStyle();
            refreshControls();
          });
          wordartRow.appendChild(wb);
        });
        formBox.appendChild(wordartRow);
      }

      // Die frühere separate Minipalette hier wurde entfernt - die Palette
      // im Block "Farben und Formen" (Fill-Pop-up) übernimmt diese Aufgabe
      // jetzt vollständig und wirkt zusätzlich auf die Zeichen-Auswahl.

      if (tf.texts.length > 1) {
        var rmBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.removetextobject]);
        rmBtn.addEventListener('click', function () {
          tf.texts = tf.texts.filter(function (t) { return t.id !== active.id; });
          render();
        });
        formBox.appendChild(rmBtn);
      }
    }
    refreshControls();

    // Kein separater "Text hinzufügen"-Button mehr - ein Doppelklick auf
    // eine LEERE Stelle im Editorfeld (nicht auf ein bestehendes
    // Textobjekt) legt WYSIWYG ein neues Textobjekt genau dort an.
    frame.addEventListener('dblclick', function (ev) {
      if (ev.target !== frame) { return; }
      var rect = frame.getBoundingClientRect();
      var nextId = Math.max.apply(null, tf.texts.map(function (t) { return t.id; })) + 1;
      tf.texts.push({
        id: nextId, text: '', font: 'sans', size: 32,
        x: (ev.clientX - rect.left) / rect.width, y: (ev.clientY - rect.top) / rect.height
      });
      render();
    });

    var bar = el('div', { class: 'ic-actionbar' });
    bar.appendChild(cancelWizardBtn());
    var saveBtn = el('button', { class: 'ic-btn ic-btn-primary ic-btn-icon', title: S.savephoto, 'aria-label': S.savephoto }, [icon('check')]);
    saveBtn.addEventListener('click', function () { saveTextFrame(tf, saveBtn); });
    bar.appendChild(saveBtn);
    body.appendChild(bar);
  }

  // Leichtgewichtiges Verschieben (+ per Eck-Handle skalieren der
  // Schriftgröße) eines Textobjekts innerhalb des Rahmens - normalisierte
  // 0..1-Koordinaten, damit ein späteres Skalieren des Hauptrahmens die
  // Textobjekte automatisch proportional mitverschiebt. Erst ab einer
  // Mindestbewegung wird tatsächlich verschoben, damit ein normaler Klick
  // weiterhin den Textcursor im contenteditable setzt.
  // Formen frei verschiebbar und über den Eck-Griff skalierbar (auch über
  // andere Formen hinweg) - analog zu Textobjekten, aber mit normalisierter
  // Größe (Anteil an min(Breite,Höhe) des Zettels) statt Schriftgröße.
  function makeShapeMovable(el2, frame, s, sizeHandle) {
    var dragging = false, startX = 0, startY = 0, totalDelta = 0;
    function point(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
    function down(ev) {
      if (ev.target === sizeHandle) { return; }
      dragging = true; totalDelta = 0;
      var p = point(ev); startX = p.x; startY = p.y;
    }
    function move(ev) {
      if (!dragging) { return; }
      var p = point(ev);
      totalDelta += Math.abs(p.x - startX) + Math.abs(p.y - startY);
      if (totalDelta < 6) { return; }
      var rect = frame.getBoundingClientRect();
      s.x = Math.max(0.02, Math.min(0.98, (p.x - rect.left) / rect.width));
      s.y = Math.max(0.02, Math.min(0.98, (p.y - rect.top) / rect.height));
      el2.style.left = (s.x * 100) + '%'; el2.style.top = (s.y * 100) + '%';
      ev.preventDefault();
    }
    function up() { dragging = false; }
    el2.addEventListener('mousedown', down);
    el2.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    var sDragging = false, sStartX = 0, sStartSize = s.size;
    function sDown(ev) {
      sDragging = true; sStartX = point(ev).x; sStartSize = s.size;
      ev.stopPropagation(); ev.preventDefault();
    }
    function sMove(ev) {
      if (!sDragging) { return; }
      var dx = point(ev).x - sStartX;
      s.size = Math.max(0.05, Math.min(2, sStartSize + dx / Math.min(el2.parentNode.offsetWidth || 300, 300)));
      var pxSize = Math.min(frame.offsetWidth, frame.offsetHeight) * s.size;
      el2.style.width = pxSize + 'px'; el2.style.height = pxSize + 'px';
      ev.preventDefault();
    }
    function sUp() { sDragging = false; }
    sizeHandle.addEventListener('mousedown', sDown);
    sizeHandle.addEventListener('touchstart', sDown, { passive: false });
    window.addEventListener('mousemove', sMove);
    window.addEventListener('touchmove', sMove, { passive: false });
    window.addEventListener('mouseup', sUp);
    window.addEventListener('touchend', sUp);
  }

  function makeTextObjectMovable(el2, frame, t, sizeHandle) {
    var dragging = false, startX = 0, startY = 0, totalDelta = 0;
    function point(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
    function down(ev) {
      if (ev.target === sizeHandle) { return; }
      dragging = true; totalDelta = 0;
      var p = point(ev); startX = p.x; startY = p.y;
    }
    function move(ev) {
      if (!dragging) { return; }
      var p = point(ev);
      totalDelta += Math.abs(p.x - startX) + Math.abs(p.y - startY);
      if (totalDelta < 6) { return; }
      var rect = frame.getBoundingClientRect();
      var nx = (p.x - rect.left) / rect.width, ny = (p.y - rect.top) / rect.height;
      t.x = Math.max(0.05, Math.min(0.95, nx));
      t.y = Math.max(0.05, Math.min(0.95, ny));
      el2.style.left = (t.x * 100) + '%'; el2.style.top = (t.y * 100) + '%';
      ev.preventDefault();
    }
    function up() { dragging = false; }
    el2.addEventListener('mousedown', down);
    el2.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    // Eck-Handle: Ziehen ändert die Schriftgröße (das ist bei einem
    // Textobjekt die sinnvolle Entsprechung zu "skalieren").
    var sDragging = false, sStartX = 0, sStartSize = t.size;
    function sDown(ev) {
      sDragging = true; sStartX = point(ev).x; sStartSize = t.size;
      ev.stopPropagation(); ev.preventDefault();
    }
    function sMove(ev) {
      if (!sDragging) { return; }
      var dx = point(ev).x - sStartX;
      t.size = Math.max(12, Math.min(200, Math.round(sStartSize + dx / 2)));
      el2.style.fontSize = t.size + 'px';
      ev.preventDefault();
    }
    function sUp() { sDragging = false; }
    sizeHandle.addEventListener('mousedown', sDown);
    sizeHandle.addEventListener('touchstart', sDown, { passive: false });
    window.addEventListener('mousemove', sMove);
    window.addEventListener('touchmove', sMove, { passive: false });
    window.addEventListener('mouseup', sUp);
    window.addEventListener('touchend', sUp);
  }

  // ------------------------------------------------------------------
  // Rein per CSS erzeugtes, an/aus schaltbares Raster-Overlay für die
  // Anzeige gespeicherter Fotos (Lightbox, Anordnungs-Leinwand). Nutzt
  // prozentuale background-size-Werte, damit es sich unabhängig von
  // der Anzeigegröße automatisch mitskaliert. Wird NICHT ins Bild
  // eingebrannt - das Original bleibt rasterfrei gespeichert.
  // ------------------------------------------------------------------
  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) { return 'rgba(255,60,60,' + alpha + ')'; }
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }

  function addGridOverlay(container, imgEl, photo) {
    if (!photo || !photo.gridtype || photo.gridtype === 'none' || !photo.gridvalue) {
      return;
    }
    function place() {
      if (!imgEl.naturalWidth || !imgEl.naturalHeight) { return; }
      var xPercent, yPercent;
      if (photo.gridtype === 'square') {
        xPercent = 100 * photo.gridvalue / imgEl.naturalWidth;
        yPercent = 100 * photo.gridvalue / imgEl.naturalHeight;
      } else {
        var divisions = Math.max(2, photo.gridvalue);
        xPercent = 100 / divisions;
        yPercent = 100 / divisions;
      }
      var lineColor = hexToRgba(photo.gridcolor || '#ff3c3c', 0.85);
      var overlay = document.createElement('div');
      overlay.className = 'ic-grid-overlay';
      overlay.style.backgroundImage =
        'linear-gradient(to right, ' + lineColor + ' 1px, transparent 1px),' +
        'linear-gradient(to bottom, ' + lineColor + ' 1px, transparent 1px)';
      overlay.style.backgroundSize = xPercent + '% 100%, 100% ' + yPercent + '%';
      container.appendChild(overlay);
    }
    if (imgEl.complete && imgEl.naturalWidth) { place(); } else { imgEl.addEventListener('load', place); }
  }

  // ------------------------------------------------------------------
  // Zeichen-/Schreib-Ebene: Striche werden vektoriell gespeichert (Punkte
  // normalisiert 0..1, Farbe, Breite, Radierer-Flag) statt als Rasterbild -
  // nach dem Vorbild des Ink-Werkzeugs aus eurem Bento-Projekt. Dadurch
  // lässt sie sich verlustfrei bei jeder Anzeigegröße neu zeichnen und ist
  // - anders als das Raster - auch im Anordnungsmodus sichtbar.
  // ------------------------------------------------------------------
  // Board-Koordinatenfläche: Querformat (die meisten Präsentationsflächen/
  // Bildschirme sind breiter als hoch). Zentrale Konstanten statt
  // verstreuter Zahlenwerte, damit das Format an einer Stelle definiert ist.
  var BOARD_W = 1400, BOARD_H = 1000;
  var INK_COLORS = ['#ef4444', '#111111', '#2563eb', '#22c55e', '#facc15', '#ffffff'];
  var INK_SIZES = [4, 10, 20, 36];

  // Icons für die Zeichenwerkzeuge (dieselben Pfade wie im Bento-Ink-Tool,
  // damit sich das Design vertraut anfühlt). "text" bleibt bewusst ein
  // simpler Buchstabe, genau wie im Original.
  var ICON_SVG = {
    pen: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H8l-6-6a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l7 7a2 2 0 0 1 0 2.8L13 20"/><path d="M6 13l6 6"/></svg>',
    clone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    boxselect: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 3"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    move: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>',
    filter: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4"/></svg>',
    circle: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    undo: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    redo: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    fonts: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V6l4-4 4 4v14"/><path d="M4 14h8"/><path d="M15 20l4-9 4 9"/><path d="M16.5 16.5h5"/></svg>',
    nomedia: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5-5 5"/><line x1="3" y1="21" x2="21" y2="3"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="6 4 20 12 6 20"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    frameicon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>',
    starfg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    boldicon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 4h7a4 4 0 0 1 3 6.7A4.5 4.5 0 0 1 14 19H6z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>',
    italicicon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="14" y1="4" x2="9" y2="20"/><line x1="17" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="7" y2="20"/></svg>',
    underlineicon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 3v8a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
    strikeicon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 8c0-2.5 2.5-4 6-4s5 1.2 5 3"/><path d="M7 16c0 2.2 2.3 4 5 4s6-1.2 6-3.5"/><line x1="3" y1="12" x2="21" y2="12"/></svg>',
    bulleticon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/></svg>',
    alignleft: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>',
    aligncenter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    alignright: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>',
    alignjustify: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    fillicon: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="4" width="16" height="16" rx="2" fill="#e0503f"/></svg>',
    outlineicon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><rect x="5" y="5" width="14" height="14" rx="2" stroke="#e0503f" stroke-width="2.5"/></svg>',
    wrapfront: '<svg viewBox="0 0 24 24" width="16" height="16"><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="6" fill="#e0503f"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 3"/></svg>',
    wrapbehind: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="6" fill="#e0503f" opacity=".5"/><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wraparound: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="6" fill="#e0503f"/><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="9" x2="7" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="15" x2="7" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="15" x2="21" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    effecticon: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="7" y="7" width="14" height="14" rx="2" fill="#e0503f" opacity=".55"/><rect x="4" y="4" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c-3 0-5.5 2.4-5.5 5.5 0 4 5.5 10.5 5.5 10.5s5.5-6.5 5.5-10.5C17.5 4.4 15 2 12 2z"/><circle cx="12" cy="7.5" r="2"/></svg>',
    group: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6"/><circle cx="18" cy="8.5" r="2.3"/><path d="M15.5 14.2c2.7.4 4.5 2.6 4.5 5.3"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 3 6.7"/><polyline points="3 21 3 15 9 15"/></svg>',
    mirror: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M16 8l4 4-4 4"/><path d="M8 8l-4 4 4 4"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    courseback: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
    scissors: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="8.5" y1="8" x2="20" y2="19"/><line x1="8.5" y1="16" x2="20" y2="5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    brush: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 3 21"/><path d="M14 3c2 0 4 2 4 4 0 3-3 4-5 6l-4 4-3-3 4-4c2-2 3-5 6-5 0 0 0-2-2-2z"/></svg>',
    arrowleft: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
    thumbtack: '<svg viewBox="0 0 1502 1502" width="16" height="16" fill="currentColor"><path d="M887.379 265.37c-71.92 39.67-90.783 153.676-73.858 220.443 25.373 89.642 120.263 184.87 208.333 223.115 88.825 39.357 213.79 19.878 236.138-70.095 17.062-70.586-14.408-161.368-105.1-252.481-51.592-61.787-195.222-150.364-265.514-120.983zm230.112 132.709c146.728 158.437 175.269 364.057-102.498 170.535-34.831-24.267-35.33-25.11-63.176-61.653-180.218-260.581 36.104-234.896 165.675-108.882zm-427.136 211.52c-30.14 129.742 141.096 224.808 206.885 226.635l115.713-114.768s-15.115-7.428-22.352-9.622c-95.305-35.201-153.483-115.01-186.185-198.223zM485.279 724.858c11.704 135.014 160.179 270.964 278.146 298.044 94.23 22.034 149.97-90.424 137.659-165.743-124.499-1.779-264.574-142.482-229.575-240.563-75.865-20.138-185.011 41.747-186.23 108.261zm-183.466 469.254c-10.709 15.142 2.074 28.789 19.1 14.38l288.835-244.45c-32.143-18.286-42.019-27.02-60.405-61.83 0 0-161.602 197.241-247.53 291.9z"/></svg>',
    hand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V6a2 2 0 0 0-4 0v10"/><path d="M6 14l-1.5-1.8a1.8 1.8 0 0 0-2.7 2.3L6 21h9a4 4 0 0 0 4-4v-5a2 2 0 0 0-4 0"/></svg>',
    thread: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e0503f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="6" r="1.6" fill="#e0503f"/><circle cx="20" cy="18" r="1.6" fill="#e0503f"/><path d="M4 6c4 0 2 6 6 6s2-6 6-6 2 6 4 6"/></svg>',
    layers: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    arrowright: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    stream: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
  };
  // Zahlen-Stepper statt Schieberegler - Zahl mit kleinen Hoch-/Runter-
  // Pfeilen, spart deutlich Platz gegenüber einem Slider.
  // Wendet Inline-CSS auf die aktuelle ZEICHEN-Auswahl an (falls eine
  // Textmarkierung innerhalb des aktiven Textobjekts vorliegt), sonst
  // auf das gesamte Textobjekt als Fallback. Grundlage dafür, dass
  // Schriftart/-größe/-gewicht/Laufweite/Farbe auf einzelne Zeichen
  // wirken können statt nur auf den gesamten Text.
  // Entfernt dieselben CSS-Eigenschaften aus allen verschachtelten
  // Elementen innerhalb von root, BEVOR eine neue Formatierung außen
  // darüber gelegt wird - sonst bliebe eine früher gesetzte Farbe/Größe
  // auf einem inneren Element durch CSS-Vererbung weiterhin sichtbar,
  // obwohl gerade eine neue Formatierung über den ganzen Bereich gewählt
  // wurde (die "Farbe über Farbe löscht die darunterliegende nicht"-Lücke).
  function stripConflictingStyles(root, cssText) {
    var props = cssText.split(';').map(function (s) { return s.split(':')[0].trim(); }).filter(Boolean);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    var node;
    while ((node = walker.nextNode())) {
      if (!node.style) { continue; }
      props.forEach(function (p) { node.style.removeProperty(p); });
      if (!node.getAttribute('style')) { node.removeAttribute('style'); }
    }
  }
  function applyStyleToSelectionOrWhole(objEl, cssText, wholeObjectFallback) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      var range = sel.getRangeAt(0);
      if (objEl.contains(range.commonAncestorContainer)) {
        try {
          var span = document.createElement('span');
          span.style.cssText = cssText;
          var content = range.extractContents();
          stripConflictingStyles(content, cssText);
          span.appendChild(content);
          range.insertNode(span);
          sel.removeAllRanges();
          var newRange = document.createRange();
          newRange.selectNodeContents(span);
          sel.addRange(newRange);
          return true;
        } catch (e) { /* Auswahl reicht über Element-Grenzen - Fallback */ }
      }
    }
    wholeObjectFallback();
    return false;
  }

  function numberStepper(value, min, max, step, decimals, onChange) {
    var wrap = el('div', { class: 'ic-stepper' });
    var display = el('span', { class: 'ic-stepper-value' }, [decimals ? value.toFixed(decimals) : String(value)]);
    function update(v) {
      v = Math.max(min, Math.min(max, v));
      value = v;
      display.textContent = decimals ? v.toFixed(decimals) : String(v);
      onChange(v);
    }
    var upBtn = el('button', { class: 'ic-stepper-btn', type: 'button' }, ['\u25B2']);
    var downBtn = el('button', { class: 'ic-stepper-btn', type: 'button' }, ['\u25BC']);
    upBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    downBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    upBtn.addEventListener('click', function () { update(value + step); });
    downBtn.addEventListener('click', function () { update(value - step); });
    wrap.appendChild(display);
    wrap.appendChild(el('div', { class: 'ic-stepper-arrows' }, [upBtn, downBtn]));
    return wrap;
  }

  function icon(name) {
    if (name === 'text') {
      var t = document.createElement('span');
      t.textContent = 'T';
      t.style.fontWeight = '700';
      return t;
    }
    var span = document.createElement('span');
    span.className = 'ic-icon';
    span.innerHTML = ICON_SVG[name] || '';
    return span;
  }

  function parseStrokes(photo) {
    try {
      var s = JSON.parse(photo.annotationdata || '[]');
      return Array.isArray(s) ? s : [];
    } catch (e) { return []; }
  }

  // Zeichnet alle Striche auf einen bereits passend dimensionierten Canvas.
  // width/height des Canvas bestimmen die Auflösung; Punkte sind 0..1-normalisiert,
  // die Strichbreite ist relativ zur Canvas-Höhe gespeichert (wie in present.ts).
  function redrawInk(canvas, ctx, strokes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width, h = canvas.height;
    strokes.forEach(function (s) {
      if (s.type === 'text') {
        if (!s.text) { return; }
        var fontPx = Math.max(10, (s.size || 20) * (h / 900) * 1.6);
        ctx.font = fontPx + 'px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillStyle = s.color;
        ctx.fillText(s.text, s.x * w, s.y * h);
        return;
      }
      if (!s.points || s.points.length < 1) { return; }
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * h);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
      for (var i = 1; i < s.points.length; i++) { ctx.lineTo(s.points[i].x * w, s.points[i].y * h); }
      ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  // Findet den obersten Strich bzw. Text, der einen Punkt (0..1-normalisiert)
  // trifft - für "Doppelklick mit Radierer löscht ganzen Strich/Text".
  function findStrokeAt(strokes, w, h, pt) {
    var threshold = 14, px = pt.x * w, py = pt.y * h;
    for (var i = strokes.length - 1; i >= 0; i--) {
      var s = strokes[i];
      if (s.type === 'text') {
        var fontPx = Math.max(10, (s.size || 20) * (h / 900) * 1.6);
        var tx = s.x * w, ty = s.y * h;
        var approxW = (s.text || '').length * fontPx * 0.55;
        if (px >= tx - 6 && px <= tx + approxW + 6 && py >= ty - 6 && py <= ty + fontPx + 6) { return i; }
        continue;
      }
      var pts = s.points;
      for (var j = 1; j < pts.length; j++) {
        var x0 = pts[j - 1].x * w, y0 = pts[j - 1].y * h, x1 = pts[j].x * w, y1 = pts[j].y * h;
        var dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
        var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        var cx = x0 + t * dx, cy = y0 + t * dy;
        if (Math.hypot(px - cx, py - cy) <= threshold) { return i; }
      }
    }
    return -1;
  }

  // Erstellt/aktualisiert eine reine Anzeige-Ebene (nicht editierbar) - für
  // Anordnungs-Leinwand und Momentaufnahmen in der Galerie außerhalb des
  // Zeichenmodus. Größe folgt dem umgebenden Container automatisch mit.
  function buildInkDisplay(container, photo) {
    var strokes = parseStrokes(photo);
    if (!strokes.length) { return null; }
    var canvas = document.createElement('canvas');
    canvas.className = 'ic-annot-layer';
    container.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    function resize() {
      var r = container.getBoundingClientRect();
      // Ohne reale Größe (Bild noch nicht geladen, Container noch nicht im
      // DOM) lässt sich nichts sinnvoll zeichnen - dann später erneut
      // versuchen statt eine 0/1px-Ebene zu erzeugen, die dauerhaft leer bleibt.
      if (!r.width || !r.height) { return; }
      canvas.width = Math.max(1, Math.round(r.width));
      canvas.height = Math.max(1, Math.round(r.height));
      redrawInk(canvas, ctx, strokes);
    }
    var imgEl = container.querySelector('img');
    if (imgEl && !imgEl.complete) {
      imgEl.addEventListener('load', resize);
    }
    resize();
    // ResizeObserver deckt Größenänderungen ab (z.B. Skalier-Griff in der
    // Anordnung) und fängt auch den Fall ab, dass der Container beim ersten
    // resize()-Aufruf noch keine Größe hatte.
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(resize);
      ro.observe(container);
    }
    return canvas;
  }

  // ==================================================================
  // ANORDNEN: Fotos frei auf einer Leinwand skalieren/positionieren
  // ==================================================================
  var BOARD_CAPACITY = 30; // Ab dieser Anzahl gilt ein Board als "voll" (Hinweis zum Anlegen eines weiteren Boards)

  function boardList() {
    var ids = {};
    state.photos.forEach(function (p) { ids[p.boardid || 0] = true; });
    ids[state.currentBoard] = true; // frisch angelegtes, noch leeres Board sichtbar halten
    return Object.keys(ids).map(Number).sort(function (a, b) { return a - b; });
  }

  // Kombinierter Board-Titel + Umschalter für die Kopfzeile (ersetzt die
  // vormals separate Board-Leiste auf der Leinwand). Titel per Klick auf
  // den Text bearbeitbar (contenteditable) - speichert bei "blur"/Enter.
  // Board-Dropdown (Klick auf den Kopfzeilen-Titel): listet alle
  // sichtbaren Boards. Eigene sind anklickbar (wechselt dorthin) und haben
  // ein Augen-Symbol zum Aus-/Einblenden für andere Lernende. Fremde Boards
  // werden vorerst nur informativ gelistet (Wechsel zu fremden Boards ist
  // ein größeres, eigenständiges Feature - siehe Scoping-Hinweis im Plan).
  function closeBoardDropdown() {
    var existing = document.getElementById('ic-board-dropdown');
    if (existing) { existing.remove(); }
  }
  function toggleBoardDropdown(anchorEl) {
    var existing = document.getElementById('ic-board-dropdown');
    if (existing) { existing.remove(); return; }
    var dropdown = el('div', { class: 'ic-board-dropdown', id: 'ic-board-dropdown' });
    dropdown.appendChild(el('p', { class: 'ic-hint' }, [S.boardswitcher]));
    callAjax('mod_pinnwand_get_all_boards', { cmid: cfg.cmid }).then(function (res) {
      var boards = res.boards || [];
      // Eigene Boards ohne Fotos (z.B. das Masterboard, wenn gerade alles
      // aufs geklonte Board verschoben wurde) fehlen in der Server-Antwort,
      // da diese nur Boards mit mindestens einem Foto findet - hier aus der
      // lokal bekannten Liste ergänzen.
      boardList().forEach(function (bid) {
        if (!boards.some(function (b) { return b.isown && b.boardid === bid; })) {
          boards.unshift({ userid: 0, boardid: bid, ownername: '', isown: true, name: '', hidden: false });
        }
      });
      boards.forEach(function (b) {
        var row = el('div', { class: 'ic-board-dropdown-row' + (b.isown && b.boardid === state.currentBoard ? ' active' : '') });
        var label = el('span', { class: 'ic-board-dropdown-label' + (b.isown ? '' : ' ic-board-dropdown-foreign') },
          [(b.name || (b.isown ? boardDisplayName(b.boardid) : b.ownername)) + (b.isown ? '' : ' (' + b.ownername + ')')]);
        if (b.isown) {
          label.addEventListener('click', function () {
            state.currentBoard = b.boardid;
            closeBoardDropdown();
            render();
          });
        }
        row.appendChild(label);
        if (b.isown) {
          var eyeBtn = el('button', {
            class: 'ic-icon-btn' + (b.hidden ? ' active' : ''), title: b.hidden ? S.boardshow : S.boardhide
          }, [icon('eye')]);
          eyeBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var newHidden = !b.hidden;
            callAjax('mod_pinnwand_set_board_hidden', { cmid: cfg.cmid, boardid: b.boardid, hidden: newHidden }).then(function () {
              b.hidden = newHidden;
              eyeBtn.classList.toggle('active', newHidden);
              eyeBtn.title = newHidden ? S.boardshow : S.boardhide;
            });
          });
          row.appendChild(eyeBtn);
        }
        dropdown.appendChild(row);
      });
    });
    root.appendChild(dropdown);
    setTimeout(function () {
      document.addEventListener('click', function closeOnce(ev) {
        if (!dropdown.contains(ev.target)) { dropdown.remove(); }
        document.removeEventListener('click', closeOnce);
      });
    }, 0);
  }

  function renderBoardTitleBar() {
    var boards = boardList();
    var boardIdx = boards.indexOf(state.currentBoard);
    var wrap = el('div', { class: 'ic-board-title-bar' });

    var prevBoard = el('button', { class: 'ic-icon-btn', title: S.back, disabled: boardIdx <= 0 ? 'disabled' : null }, ['\u2039']);
    prevBoard.addEventListener('click', function () { state.currentBoard = boards[boardIdx - 1]; render(); });
    wrap.appendChild(prevBoard);

    var titleEl = el('span', {
      class: 'ic-board-title-edit', contenteditable: 'true', title: S.boardrename_hint
    }, [boardDisplayName(state.currentBoard)]);
    // Kein Fokus/Bearbeitungsmodus bei einfachem Klick (Standardverhalten
    // von contenteditable) - der ist für das Dropdown reserviert. Erst ein
    // Doppelklick aktiviert das Umbenennen.
    var titleEditing = false;
    titleEl.addEventListener('mousedown', function (ev) {
      if (!titleEditing) { ev.preventDefault(); }
    });
    titleEl.addEventListener('click', function (ev) {
      if (titleEditing) { return; }
      ev.stopPropagation();
      toggleBoardDropdown(titleEl);
    });
    titleEl.addEventListener('dblclick', function (ev) {
      ev.stopPropagation();
      closeBoardDropdown();
      titleEditing = true;
      titleEl.focus();
      var range = document.createRange();
      range.selectNodeContents(titleEl);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    titleEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); titleEl.blur(); }
    });
    titleEl.addEventListener('blur', function () {
      titleEditing = false;
      var text = titleEl.textContent.trim();
      var boardId = state.currentBoard;
      if (!text || text === boardDisplayName(boardId)) { titleEl.textContent = boardDisplayName(boardId); return; }
      state.boardNames[boardId] = text;
      callAjax('mod_pinnwand_set_board_name', { cmid: cfg.cmid, boardid: boardId, name: text });
      subtitleEl.textContent = boardSubtitle(boardId);
    });
    wrap.appendChild(titleEl);
    // Untertitel: zeigt den eigenen Namen, sobald ein echter (vom
    // provisorischen Namen abweichender) Titel vergeben wurde.
    var subtitleEl = el('span', { class: 'ic-board-title-subtitle' }, [boardSubtitle(state.currentBoard)]);
    wrap.appendChild(subtitleEl);

    var nextBoard = el('button', { class: 'ic-icon-btn', title: S.next, disabled: boardIdx >= boards.length - 1 ? 'disabled' : null }, ['\u203A']);
    nextBoard.addEventListener('click', function () { state.currentBoard = boards[boardIdx + 1]; render(); });
    wrap.appendChild(nextBoard);

    if (state.canmoderate || cfg.studentboardcreate) {
      var addBoard = el('button', { class: 'ic-icon-btn', title: S.newboard }, ['+']);
      addBoard.addEventListener('click', function () {
        var newBoardId = Math.max.apply(null, boards) + 1;
        state.currentBoard = newBoardId;
        // Provisorischer Titel = eigener Name, damit das taufrische Board
        // sofort serverseitig auffindbar ist (siehe
        // toggle_own_board_placement) - wird automatisch zum Untertitel,
        // sobald ein echter Titel vergeben wird.
        if (cfg.currentuserfullname) {
          state.boardNames[newBoardId] = cfg.currentuserfullname;
          callAjax('mod_pinnwand_set_board_name', { cmid: cfg.cmid, boardid: newBoardId, name: cfg.currentuserfullname });
        }
        render();
      });
      wrap.appendChild(addBoard);
    }

    if (state.canmoderate || cfg.studentboardclone) {
      var cloneBoard = el('button', { class: 'ic-icon-btn', title: S.cloneboard }, [icon('clone')]);
      cloneBoard.addEventListener('click', function () {
        if (!confirm(S.cloneboard_confirm)) { return; }
        if (cloneBoard.disabled) { return; } // Schutz vor Doppelklick - hat sonst alle Fotos zweimal dupliziert
        cloneBoard.disabled = true;
        callAjax('mod_pinnwand_clone_board', { cmid: cfg.cmid, boardid: state.currentBoard }).then(function (res) {
          refreshPhotos().then(function () {
            state.currentBoard = res.newboardid;
            // Absicherung: falls das Quellboard leer war (nichts kopiert,
            // kein Name übernommen), eigenen Namen als provisorischen
            // Titel setzen, damit das Board trotzdem sofort auffindbar ist.
            if (cfg.currentuserfullname && !state.boardNames[res.newboardid]) {
              state.boardNames[res.newboardid] = cfg.currentuserfullname;
              callAjax('mod_pinnwand_set_board_name', { cmid: cfg.cmid, boardid: res.newboardid, name: cfg.currentuserfullname });
            }
            render();
          });
        }).catch(function () { cloneBoard.disabled = false; });
      });
      wrap.appendChild(cloneBoard);
    }

    return wrap;
  }


  // mit fortlaufender Nummer ("Klassenfoto", "Klassenfoto 2", ...) - außer
  // die Person hat dem Board über set_board_name einen eigenen Titel gegeben.
  // Schaltet die Zugehörigkeit eines Objekts zur Mehrfachauswahl um - auf
  // Modulebene, damit sowohl renderArrange als auch die eigenständigen
  // Panel-Funktionen (Layer/Faden) darauf zugreifen können.
  function toggleMultiSelectGlobal(key) {
    var idx = state.multiSelect.indexOf(key);
    if (idx === -1) { state.multiSelect.push(key); } else { state.multiSelect.splice(idx, 1); }
    render();
  }

  // Zeilen-Einfärbung nach Zustand (Meine Bilder + Klassenansicht) - gepinnt
  // (auf einem zusätzlichen Board platziert) hat Vorrang vor gesendet
  // (auf der Masterpinnwand sichtbar), falls beides zutrifft.
  function rowStateClass(p) {
    if (p.otherboardcount > 0) { return ' ic-row-pinned'; }
    if (!p.hiddenfromboard) { return ' ic-row-sent'; }
    return '';
  }

  function boardDisplayName(boardId) {
    if (state.boardNames && state.boardNames[boardId]) { return state.boardNames[boardId]; }
    var boards = boardList();
    var idx = boards.indexOf(boardId);
    var base = root.dataset.title || S.pinboard;
    return idx > 0 ? (base + ' ' + (idx + 1)) : base;
  }

  // Sobald ein eigenes Board einen ECHTEN, vom provisorischen Namen
  // abweichenden Titel bekommt, wird der eigene Name als Untertitel
  // angezeigt (damit ein taufrisches, nur nach der Person benanntes
  // Board weiterhin auffindbar bleibt UND erkennbar bleibt, wem es
  // gehört, auch nachdem ein "richtiger" Titel vergeben wurde).
  function boardSubtitle(boardId) {
    var name = state.boardNames && state.boardNames[boardId];
    if (name && cfg.currentuserfullname && name !== cfg.currentuserfullname) { return cfg.currentuserfullname; }
    return '';
  }

  function renderArrange(body) {
    // Fadenfarbe als CSS-Variable bereitstellen - die Umrandung der
    // Mehrfachauswahl soll der Fadenfarbe entsprechen statt einem fest
    // verdrahteten Blau.
    var ownThreadForColor = ownThread();
    root.style.setProperty('--ic-thread-color', (ownThreadForColor && ownThreadForColor.color) || '#4f8cff');

    var wrap = el('div', { class: 'ic-canvas-wrap' + (cfg.boardpannable ? ' pannable' : '') });
    // Tapete: AUSSERHALB der gezoomten .ic-canvas-panzoom-Ebene, sonst würde
    // sie mit skaliert und bei einem Zoom < 1 (typischer Fall) nur einen Teil
    // des Fensters füllen. Füllt dadurch immer den kompletten sichtbaren
    // Bereich, unabhängig vom Board-Zoom.
    var wallpaper = el('div', { class: 'ic-canvas-wallpaper' });
    wrap.appendChild(wallpaper);
    var panZoomLayer = el('div', { class: 'ic-canvas-panzoom' });
    var bgLayer = el('div', { class: 'ic-canvas-bg' });
    panZoomLayer.appendChild(bgLayer);
    applyBackground(bgLayer);
    applyWallpaperColor(wallpaper);
    var canvas = el('div', { class: 'ic-arrange-canvas' });
    panZoomLayer.appendChild(canvas);
    wrap.appendChild(panZoomLayer);
    body.appendChild(wrap);

    // Board beim ersten Anzeigen auf den sichtbaren Bereich einpassen und
    // zentrieren - sonst bleibt der Zoom dauerhaft bei 1 (unskaliert) und
    // die 1400x1000-Koordinatenfläche (mitsamt Hintergrundbild) wirkt auf
    // vielen Bildschirmen wie eine zu kleine Insel, während der Rest des
    // Fensters leer bleibt. Nur einmal je Board - spätere manuelle Zoom-/
    // Pan-Anpassungen der Person bleiben danach erhalten. Die "Abschneiden/
    // Füllen"-Einstellung des Hintergrunds (siehe Settings) steuert dabei
    // auch, wie das Board selbst eingepasst wird: "Füllen" (contain) zeigt
    // das ganze Board (ggf. mit Rand), "Abschneiden" (cover) füllt den
    // Bildschirm komplett aus (überschüssiger Rand wird abgeschnitten).
    if (!state._boardFitted) { state._boardFitted = {}; }
    if (!state._boardFitted[state.currentBoard]) {
      state._boardFitted[state.currentBoard] = true;
      requestAnimationFrame(function () {
        var r = wrap.getBoundingClientRect();
        if (r.width > 20 && r.height > 20) {
          var bg = state.background || {};
          var wRatio = r.width / BOARD_W, hRatio = r.height / BOARD_H;
          var fit = bg.fit === 'cover' ? Math.max(wRatio, hRatio) : Math.min(wRatio, hRatio, 1);
          state.boardZoom = Math.max(0.15, fit);
          state.boardPanX = (r.width - BOARD_W * state.boardZoom) / 2;
          state.boardPanY = (r.height - BOARD_H * state.boardZoom) / 2;
          applyBoardTransform();
        }
      });
    }

    // Stylus-Zeichenebene: exakt 1400x1000 wie der Hintergrund (siehe
    // .ic-canvas-bg-image) - Striche liegen dadurch immer exakt an der
    // richtigen Stelle über dem Hintergrundbild, unabhängig von Zoom/Board-
    // Größe. Hohe Z-Ebene: Striche sollen über Fotos/Objekte hinweg gemalt
    // werden können und dabei sichtbar bleiben (z.B. um mehrere Fotos zu
    // verbinden oder etwas Übergreifendes zu markieren).
    if (state.boardInkBoard !== state.currentBoard) {
      state.boardInkBoard = state.currentBoard;
      state.boardInkStrokes = [];
      callAjax('mod_pinnwand_get_board_ink', { cmid: cfg.cmid, boardid: state.currentBoard }).then(function (res) {
        if (state.currentBoard !== state.boardInkBoard) { return; }
        try { state.boardInkStrokes = JSON.parse(res.strokedata || '[]'); } catch (e) { state.boardInkStrokes = []; }
        render();
      });
    }
    // Zusätzliche Objekt-Platzierungen dieses Boards (z.B. nach Klonen) -
    // separat von state.photos gehalten, damit die bestehende, überall
    // verwendete Foto-Logik unangetastet bleibt. Werden unten als
    // eigenständige, einfachere Kacheln gerendert (anzeigen/verschieben/
    // entfernen - kein Zeichnen/Raster/Wortfeld-Bearbeiten auf ihnen).
    if (state.extraPlacementsBoard !== state.currentBoard) {
      state.extraPlacementsBoard = state.currentBoard;
      state.extraPlacements = [];
      callAjax('mod_pinnwand_get_object_placements', { cmid: cfg.cmid, boardid: state.currentBoard }).then(function (res) {
        if (state.currentBoard !== state.extraPlacementsBoard) { return; }
        state.extraPlacements = res.placements || [];
        render();
      });
    }
    var inkCanvas = el('canvas', {
      class: 'ic-board-ink-layer' + (state.boardInkHidden ? ' ic-hidden' : ''), width: String(BOARD_W), height: String(BOARD_H)
    });
    canvas.appendChild(inkCanvas);
    var inkCtx = inkCanvas.getContext('2d');
    redrawInk(inkCanvas, inkCtx, state.boardInkStrokes || []);
    if (state.boardDrawMode) {
      inkCanvas.classList.add('active');
      var curStroke = null;
      function inkPoint(ev) {
        var t = ev.touches ? ev.touches[0] : ev;
        var r = inkCanvas.getBoundingClientRect();
        return { x: (t.clientX - r.left) / r.width, y: (t.clientY - r.top) / r.height };
      }
      function inkDown(ev) {
        ev.preventDefault();
        curStroke = {
          id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
          points: [inkPoint(ev)],
          color: state.boardDrawColor || INK_COLORS[0],
          width: state.boardDrawWidth || 0.01,
          erase: !!state.boardDrawErase
        };
        state.boardInkStrokes.push(curStroke);
      }
      function inkMove(ev) {
        if (!curStroke) { return; }
        ev.preventDefault();
        curStroke.points.push(inkPoint(ev));
        redrawInk(inkCanvas, inkCtx, state.boardInkStrokes);
      }
      function inkUp() {
        if (!curStroke) { return; }
        curStroke = null;
        callAjax('mod_pinnwand_save_board_ink', {
          cmid: cfg.cmid, boardid: state.currentBoard, strokes: JSON.stringify(state.boardInkStrokes)
        });
      }
      inkCanvas.addEventListener('mousedown', inkDown);
      inkCanvas.addEventListener('touchstart', inkDown, { passive: false });
      inkCanvas.addEventListener('mousemove', inkMove);
      inkCanvas.addEventListener('touchmove', inkMove, { passive: false });
      window.addEventListener('mouseup', inkUp);
      window.addEventListener('touchend', inkUp);
    }

    function applyBoardTransform() {
      panZoomLayer.style.transform =
        'translate(' + state.boardPanX + 'px,' + state.boardPanY + 'px) scale(' + state.boardZoom + ')';
    }
    applyBoardTransform();

    // Nur Fotos zeigen, die nicht ausgeblendet sind UND zum aktuell
    // gewählten Board gehören (Mehrfach-Boards, siehe Board-Leiste unten).
    // Als Rückseite verknüpfte Fotos erscheinen NICHT als eigene Karte -
    // sie werden über ihre Vorderseite per Doppelklick eingeblendet.
    var backsideIds = {};
    state.photos.forEach(function (p) { if (p.backphotoid) { backsideIds[p.backphotoid] = true; } });
    var visible = state.photos.filter(function (p) {
      return !p.hiddenfromboard && p.boardplaced && (p.boardid || 0) === state.currentBoard && !backsideIds[p.id];
    });
    if (state.boardFilter && state.boardFilter.trim()) {
      var fq = state.boardFilter.trim().toLowerCase();
      visible = visible.filter(function (p) {
        return [p.sourcetitle, p.sourceyear, p.sourceepoch, p.sourceorigauthor, p.sourceauthor].some(function (v) {
          return (v || '').toLowerCase().indexOf(fq) !== -1;
        });
      });
    }
    if (state.boardHideMedia) {
      // Lupenmenü "Medien ausblenden": nur Texte/Wortfelder bleiben
      // sichtbar (technisch Fotos mit wordfielddata), reine Bild-Medien
      // werden ausgeblendet.
      visible = visible.filter(function (p) { return !!p.wordfielddata; });
    }

    // Roter Faden: wenn das Faden-Panel offen ist, bekommen enthaltene
    // Fotos einen roten Rahmen direkt auf dem Board (siehe unten).
    var threadPhotoIds = {};
    if (state.threadPanelOpen) {
      var ot = ownThread();
      if (ot) {
        ot.items.forEach(function (it) { if (it.itemtype === 'photo') { threadPhotoIds[it.photoid] = true; } });
      }
    }

    visible.forEach(function (p) {
      var item = el('div', {
        class: 'ic-arrange-item' + (p.wordfielddata ? ' ic-wordfield-item' : '') + (threadPhotoIds[p.id] ? ' ic-in-thread' : '') +
          (state.selectedItemKey === 'photo:' + p.id ? ' selected' : '') +
          (state.multiSelect.indexOf('photo:' + p.id) !== -1 ? ' multi-selected' : ''),
        'data-multikey': 'photo:' + p.id,
        style: 'left:' + p.canvasx + 'px;top:' + p.canvasy + 'px;width:' + p.canvasw + 'px;' +
          'transform:rotate(' + (p.canvasrot || 0) + 'deg)'
      });
      item.style.zIndex = p.canvasz || 0;
      var backPhoto = p.backphotoid ? state.photos.filter(function (o) { return o.id === p.backphotoid; })[0] : null;
      if (p.wordfielddata && !p.showingback) {
        // Textobjekt: live rendern (echtes DOM statt eingefrorenes Bild) -
        // Grundlage für dynamischen Umfluss um Formen/Fotos in der Nähe.
        // Bei einem Rückseiten-Foto (backPhoto) oder falls die
        // gespeicherten Daten unlesbar sind, auf das eingefrorene Bild
        // zurückfallen.
        try {
          var liveTf = JSON.parse(p.wordfielddata);
          item.appendChild(buildTextFrameLiveDom(liveTf));
        } catch (e) {
          item.appendChild(el('img', { src: p.url, alt: '' }));
        }
      } else {
        var img = el('img', { src: (p.showingback && backPhoto) ? backPhoto.url : p.url, alt: '' });
        item.appendChild(img);
      }
      if (backPhoto) {
        item.addEventListener('dblclick', function (ev) {
          ev.stopPropagation();
          callAjax('mod_pinnwand_toggle_backside', { cmid: cfg.cmid, photoid: p.id }).then(function (res) {
            p.showingback = res.showingback;
            render();
          });
        });
      }

      // Pin/Unpin direkt auf dem Board (Vorgabe-Icon) - von der Pinnwand
      // entfernen blendet das Foto hier sofort aus (bleibt in "Meine Bilder").
      var pinToggle = null;
      if (state.studentcansend) {
        pinToggle = el('button', { class: 'ic-pin-toggle', title: S.removefromboard }, [icon('thumbtack')]);
        pinToggle.addEventListener('click', function (ev) {
          ev.stopPropagation();
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: p.id, hidden: true }).then(function () {
            p.hiddenfromboard = true;
            p.boardplaced = false;
            loadStreamPhotos();
            render();
          });
        });
        item.appendChild(pinToggle);
      }

      // Zum Roten Faden hinzufügen - nur während das Faden-Panel offen ist,
      // um die Pinnwand im Normalfall nicht zusätzlich zu überladen.
      if (state.threadPanelOpen && state.canusethreads) {
        var already = false;
        var own = ownThread();
        if (own) {
          already = own.items.some(function (it) { return it.itemtype === 'photo' && it.photoid === p.id; });
        }
        if (!already) {
          var addThreadBtn = el('button', { class: 'ic-thread-add-toggle', title: S.addtothread }, [icon('thread')]);
          addThreadBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            callAjax('mod_pinnwand_add_thread_item', {
              cmid: cfg.cmid, itemtype: 'photo', photoid: p.id, boardid: state.currentBoard
            }).then(function (res) {
              replaceOwnThread(res);
              render();
            });
          });
          item.appendChild(addThreadBtn);
        }
      }

      var resize = el('div', { class: 'ic-resize' });
      item.appendChild(resize);
      var rotateHandle = el('div', { class: 'ic-rotate-handle' });
      item.appendChild(rotateHandle);
      canvas.appendChild(item);
      // Item erst jetzt (im DOM) - erst danach hat es eine reale Größe,
      // die die Zeichenebene und Bildunterschrift zum Messen brauchen.
      // Das Raster ist bewusst nur im Galeriemodus sichtbar. Die Zeichen-/
      // Schreib-Ebene hingegen ist - anders als das Raster - grundsätzlich
      // auch hier zu sehen, außer die Person hat sie explizit für die
      // Pinnwand ausgeblendet (annotationonboard).
      if (p.annotationonboard !== false) { buildInkDisplay(item, p); }
      if (state.showData) { item.appendChild(el('div', { class: 'ic-item-caption' }, [itemCaptionText(p)])); }

      // Handles (Größe/Rotation) nur bei Hover (Maus) bzw. nach Antippen
      // (Touch) einblenden - siehe .ic-arrange-item.show-handles in CSS.
      item.addEventListener('click', function (ev) {
        if (ev.target.closest && ev.target.closest('.ic-pin-toggle, .ic-thread-add-toggle')) { return; }
        item.classList.toggle('show-handles');
      });

      var moved = false;
      var groupKey = 'photo:' + p.id;
      var undoBefore = null;
      function captureUndoBefore() {
        if (undoBefore) { return; }
        undoBefore = { x: p.canvasx, y: p.canvasy, w: p.canvasw, rot: p.canvasrot || 0 };
      }
      function pushPhotoUndoIfChanged() {
        if (!undoBefore) { return; }
        var before = undoBefore, after = { x: p.canvasx, y: p.canvasy, w: p.canvasw, rot: p.canvasrot || 0 };
        undoBefore = null;
        if (before.x === after.x && before.y === after.y && before.w === after.w && before.rot === after.rot) { return; }
        pushUndo({
          undo: function () {
            p.canvasx = before.x; p.canvasy = before.y; p.canvasw = before.w; p.canvasrot = before.rot;
            persistLayout(p);
          },
          redo: function () {
            p.canvasx = after.x; p.canvasy = after.y; p.canvasw = after.w; p.canvasrot = after.rot;
            persistLayout(p);
          }
        });
      }
      makeMovable(item, canvas, function (x, y) {
        captureUndoBefore();
        var dx = x - p.canvasx, dy = y - p.canvasy;
        p.canvasx = x; p.canvasy = y; moved = true;
        applyGroupDelta(groupKey, dx, dy);
      }, function () {
        if (moved) {
          persistLayout(p);
          pushPhotoUndoIfChanged();
          if (state.multiSelect.indexOf(groupKey) !== -1 && state.multiSelect.length > 1) {
            persistGroupExcept(groupKey);
            render();
          }
          moved = false;
          // Der Rote Faden (rote Rahmen + Verbindungslinie) muss neu
          // gezeichnet werden, sobald sich die Position eines enthaltenen
          // Fotos ändert - sonst "hinkt" die Linie der neuen Position
          // hinterher, bis irgendein anderer Grund einen Re-Render auslöst.
          if (state.threadPanelOpen) { render(); }
        } else if (lastPointerCtrl || state.multiSelectAddMode) {
          toggleMultiSelectGlobal(groupKey);
        } else if (state.threadPanelOpen || state.layerPanelOpen) {
          // Im Layer-/Faden-Modus: einfacher Klick markiert das Objekt statt
          // die Galerie zu öffnen (siehe dblclick weiter unten für die
          // Präsentations-Vorschau).
          selectItem(groupKey);
        }
        else if (state.boardDrawMode) { openLightbox(state.photos.indexOf(p), true); }
        else { openLightbox(state.photos.indexOf(p)); }
      });
      item.addEventListener('dblclick', function (ev) {
        if ((state.threadPanelOpen || state.layerPanelOpen) && openPresentationAtItem('photo', p.id)) {
          ev.preventDefault();
        }
      });
      makeResizable(resize, item, function (w) {
        captureUndoBefore();
        p.canvasw = w;
      }, function () { persistLayout(p); pushPhotoUndoIfChanged(); if (state.threadPanelOpen) { render(); } });
      makeRotatable(rotateHandle, item, function (deg) {
        captureUndoBefore();
        p.canvasrot = deg;
      }, function () { persistLayout(p); pushPhotoUndoIfChanged(); if (state.threadPanelOpen) { render(); } });
    });

    // Roter Faden auf dem Board: gesetzte Leerrahmen anzeigen + eine Linie,
    // die jeweils zwei aufeinanderfolgende Stationen verbindet - nur für
    // Stationen auf dem gerade angezeigten Board (siehe Scoping-Hinweis zu
    // Mehrfach-Board-Präsentationen in Phase 3/6).
    if (state.threadPanelOpen || state.layerPanelOpen) {
      var threadForCanvas = ownThread();
      if (threadForCanvas) {
        var boardItems = threadForCanvas.items.filter(function (it) { return (it.boardid || 0) === state.currentBoard; });

        // Leerrahmen als sichtbare, gestrichelte Rechtecke - verschiebbar,
        // skalierbar und drehbar (nur im eigenen, bearbeitbaren Faden).
        boardItems.forEach(function (it) {
          if (it.itemtype !== 'frame') { return; }
          it.framerot = it.framerot || 0;
          var lineColor = threadForCanvas.color || '#e0503f';
          var lineWidth = threadForCanvas.linewidth || 3;
          var frameEl = el('div', {
            class: 'ic-thread-frame-onboard' + (threadForCanvas.isown ? ' editable' : '') +
              (state.selectedItemKey === 'frame:' + it.id ? ' selected' : '') +
              (state.multiSelect.indexOf('frame:' + it.id) !== -1 ? ' multi-selected' : ''),
            'data-multikey': 'frame:' + it.id,
            style: 'left:' + it.framex + 'px;top:' + it.framey + 'px;width:' + it.framew + 'px;height:' + it.frameh + 'px;' +
              'transform:rotate(' + it.framerot + 'deg);border-color:' + lineColor + ';border-width:' + lineWidth + 'px'
          });
          frameEl.style.zIndex = it.framez || 0;
          var stepNum = boardItems.indexOf(it) + 1;
          frameEl.appendChild(el('span', { style: 'color:' + lineColor }, [it.framelabel || String(stepNum)]));
          canvas.appendChild(frameEl);

          if (!threadForCanvas.isown) { return; }

          function persistFrame() {
            callAjax('mod_pinnwand_update_thread_frame', {
              cmid: cfg.cmid, itemid: it.id, framex: it.framex, framey: it.framey,
              framew: it.framew, frameh: it.frameh, framerot: it.framerot, framez: it.framez || 0
            });
          }
          var frameGroupKey = 'frame:' + it.id;
          var frameUndoBefore = null;
          makeMovable(frameEl, canvas, function (x, y) {
            if (!frameUndoBefore) { frameUndoBefore = { x: it.framex, y: it.framey }; }
            var dx = x - it.framex, dy = y - it.framey;
            it.framex = x; it.framey = y;
            applyGroupDelta(frameGroupKey, dx, dy);
          }, function (moved) {
            if (moved) {
              persistFrame();
              if (frameUndoBefore && (frameUndoBefore.x !== it.framex || frameUndoBefore.y !== it.framey)) {
                (function (before, itRef) {
                  var after = { x: itRef.framex, y: itRef.framey };
                  pushUndo({
                    undo: function () { itRef.framex = before.x; itRef.framey = before.y; persistFrame(); },
                    redo: function () { itRef.framex = after.x; itRef.framey = after.y; persistFrame(); }
                  });
                })(frameUndoBefore, it);
              }
              frameUndoBefore = null;
              if (state.multiSelect.indexOf(frameGroupKey) !== -1 && state.multiSelect.length > 1) {
                persistGroupExcept(frameGroupKey);
              }
              render();
            } else if (lastPointerCtrl || state.multiSelectAddMode) { toggleMultiSelectGlobal(frameGroupKey); }
            else { selectItem(frameGroupKey); }
          });
          frameEl.addEventListener('dblclick', function (ev) {
            if (openPresentationAtItem('frame', it.id)) { ev.preventDefault(); }
          });

          var frameResize = el('div', { class: 'ic-resize' });
          frameEl.appendChild(frameResize);
          var frDragging = false, frStartX = 0, frStartY = 0, frStartW = 0, frStartH = 0;
          function frPoint(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
          frameResize.addEventListener('mousedown', function (ev) {
            frDragging = true; var p = frPoint(ev);
            frStartX = p.x; frStartY = p.y; frStartW = it.framew; frStartH = it.frameh;
            ev.stopPropagation(); ev.preventDefault();
          });
          frameResize.addEventListener('touchstart', function (ev) {
            frDragging = true; var p = frPoint(ev);
            frStartX = p.x; frStartY = p.y; frStartW = it.framew; frStartH = it.frameh;
            ev.stopPropagation();
          }, { passive: true });
          function frMove(ev) {
            if (!frDragging) { return; }
            var p = frPoint(ev);
            var z = state.boardZoom || 1;
            it.framew = Math.max(60, frStartW + (p.x - frStartX) / z);
            it.frameh = Math.max(60, frStartH + (p.y - frStartY) / z);
            frameEl.style.width = it.framew + 'px'; frameEl.style.height = it.frameh + 'px';
            ev.preventDefault();
          }
          window.addEventListener('mousemove', frMove);
          window.addEventListener('touchmove', frMove, { passive: false });
          function frUp() { if (frDragging) { frDragging = false; persistFrame(); render(); } }
          window.addEventListener('mouseup', frUp);
          window.addEventListener('touchend', frUp);

          // Rotations-Handle (analog zu Fotos) - kleiner Griff oben mittig.
          var frameRotateHandle = el('div', { class: 'ic-rotate-handle' });
          frameEl.appendChild(frameRotateHandle);
          makeRotatable(frameRotateHandle, frameEl, function (deg) {
            it.framerot = deg;
          }, function () { persistFrame(); render(); });
        });

        // Verbindungslinie zwischen den Mittelpunkten aufeinanderfolgender
        // Stationen (in Faden-Reihenfolge).
        function centerOf(it) {
          if (it.itemtype === 'frame') {
            return { x: it.framex + it.framew / 2, y: it.framey + it.frameh / 2 };
          }
          var photo = state.photos.filter(function (o) { return o.id === it.photoid; })[0];
          if (!photo) { return null; }
          return { x: photo.canvasx + photo.canvasw / 2, y: photo.canvasy + (photo.canvasw * 0.7) / 2 };
        }
        var pts = boardItems.map(centerOf).filter(Boolean);
        if (pts.length >= 2) {
          // Canvas2D statt SVG: canvas.width/height sind echte Pixel-
          // Dimensionen des Zeichenpuffers, ohne jede Mehrdeutigkeit
          // zwischen Element-Attribut und CSS-Größe (wie sie bei einem
          // <svg> ohne exakt übereinstimmendes viewBox/CSS entstehen kann -
          // das war die Ursache dafür, dass die Linie nur in einem
          // Teilbereich sichtbar/abgeschnitten war).
          // Zusätzlicher Rand (THREAD_LINE_MARGIN) rundherum, da Objekte
          // außerhalb der nominalen Board-Fläche (0..BOARD_W/H) liegen
          // können - ohne diesen Rand würde die Linie zu solchen Objekten
          // an der Canvas-eigenen Boxgröße abgeschnitten.
          var THREAD_LINE_MARGIN = 800;
          var lineCanvas = el('canvas', {
            class: 'ic-thread-line-canvas',
            width: String(BOARD_W + THREAD_LINE_MARGIN * 2), height: String(BOARD_H + THREAD_LINE_MARGIN * 2),
            style: 'left:-' + THREAD_LINE_MARGIN + 'px;top:-' + THREAD_LINE_MARGIN + 'px;'
          });
          var lctx = lineCanvas.getContext('2d');
          lctx.translate(THREAD_LINE_MARGIN, THREAD_LINE_MARGIN);
          lctx.strokeStyle = threadForCanvas.color || '#e0503f';
          lctx.lineWidth = threadForCanvas.linewidth || 3;
          lctx.lineCap = 'round';
          lctx.lineJoin = 'round';
          lctx.beginPath();
          lctx.moveTo(pts[0].x, pts[0].y);
          // Durchgehende, an den Wegpunkten (Bildern) abgerundete Kurve
          // (Catmull-Rom in kubische Bezier umgerechnet) - läuft exakt durch
          // jeden Objekt-Mittelpunkt, aber ohne Knick an den Übergängen wie
          // bei unabhängigen Einzelsegmenten.
          for (var ti = 0; ti < pts.length - 1; ti++) {
            var p0 = pts[ti - 1] || pts[ti];
            var p1 = pts[ti];
            var p2 = pts[ti + 1];
            var p3 = pts[ti + 2] || p2;
            var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
            var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
            lctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
          }
          lctx.stroke();
          canvas.appendChild(lineCanvas);
        }
      }
    }

    // Board-Titel/-Umschalter sitzt jetzt in der Kopfzeile (siehe
    // renderBoardTitleBar) - hier nur noch die Liste für den Voll-Hinweis.
    var boards = boardList();
    if (visible.length >= BOARD_CAPACITY) {
      var fullHint = el('div', { class: 'ic-board-full-hint' }, [S.boardfull_confirm]);
      fullHint.addEventListener('click', function () {
        if (confirm(S.boardfull_confirm)) { state.currentBoard = Math.max.apply(null, boards) + 1; render(); }
      });
      body.appendChild(fullHint);
    }

    // ---- Zoom: Lupe im zentralen Menü öffnet ein Mini-Popup mit Regler +
    // Plus/Minus (siehe fabRow weiter unten) ----
    // Zoomt so, dass der angegebene Bildschirmpunkt (Mauszeiger/Finger bzw.
    // bei den Buttons die Board-Mitte) an derselben Stelle stehen bleibt.
    function zoomBoardBy(factor, clientX, clientY) {
      var newZoom = Math.max(0.1, Math.min(3, state.boardZoom * factor));
      var rect = wrap.getBoundingClientRect();
      var cx = (clientX != null ? clientX : rect.left + rect.width / 2) - rect.left;
      var cy = (clientY != null ? clientY : rect.top + rect.height / 2) - rect.top;
      var wx = (cx - state.boardPanX) / state.boardZoom;
      var wy = (cy - state.boardPanY) / state.boardZoom;
      state.boardZoom = newZoom;
      state.boardPanX = cx - wx * newZoom;
      state.boardPanY = cy - wy * newZoom;
      applyBoardTransform();
    }
    function zoomBoardTo(zoomValue, clientX, clientY) {
      zoomBoardBy(Math.max(0.1, zoomValue) / state.boardZoom, clientX, clientY);
    }

    // Springt mit Kamera-Zoom/-Position exakt auf den Ausschnitt, in dem
    // alle aktuell ausgewählten Objekte zu sehen sind.
    function fitViewToRect(minX, minY, maxX, maxY) {
      var rect = wrap.getBoundingClientRect();
      var fit = Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY), 3);
      state.boardZoom = Math.max(0.1, fit);
      state.boardPanX = rect.width / 2 - (minX + maxX) / 2 * state.boardZoom;
      state.boardPanY = rect.height / 2 - (minY + maxY) / 2 * state.boardZoom;
      applyBoardTransform();
    }
    function fitViewToSelection() {
      if (!state.multiSelect.length) { return; }
      var rects = state.multiSelect.map(function (k) {
        var parts = k.split(':'); var kind = parts[0], id = parseInt(parts[1], 10);
        if (kind === 'photo') {
          var op = state.photos.filter(function (o) { return o.id === id; })[0];
          return op ? boardRectOf(op, 'photo') : null;
        }
        var ot = ownThread();
        var oi = ot ? ot.items.filter(function (o) { return o.itemtype === 'frame' && o.id === id; })[0] : null;
        return oi ? boardRectOf(oi, 'frame') : null;
      }).filter(Boolean);
      if (!rects.length) { return; }
      var minX = Math.min.apply(null, rects.map(function (r) { return r.x; })) - 30;
      var minY = Math.min.apply(null, rects.map(function (r) { return r.y; })) - 30;
      var maxX = Math.max.apply(null, rects.map(function (r) { return r.x + r.w; })) + 30;
      var maxY = Math.max.apply(null, rects.map(function (r) { return r.y + r.h; })) + 30;
      fitViewToRect(minX, minY, maxX, maxY);
    }
    // Ohne Auswahl: erster Klick zeigt alle Objekte + Hintergrund (Standard-
    // Zoom), ein weiterer Klick direkt danach zoomt gezielt auf den
    // Hintergrundbereich selbst.
    function fitViewDefault() {
      var rects = visible.map(function (p) { return boardRectOf(p, 'photo'); });
      var minX = Math.min(0, Math.min.apply(null, rects.map(function (r) { return r.x; }).concat([0]))) - 20;
      var minY = Math.min(0, Math.min.apply(null, rects.map(function (r) { return r.y; }).concat([0]))) - 20;
      var maxX = Math.max(BOARD_W, Math.max.apply(null, rects.map(function (r) { return r.x + r.w; }).concat([BOARD_W]))) + 20;
      var maxY = Math.max(BOARD_H, Math.max.apply(null, rects.map(function (r) { return r.y + r.h; }).concat([BOARD_H]))) + 20;
      fitViewToRect(minX, minY, maxX, maxY);
    }
    function fitViewToBackground() {
      fitViewToRect(0, 0, BOARD_W, BOARD_H);
    }

    // Mausrad zoomt (zentriert auf den Mauszeiger) - unabhängig von der
    // "Pinnwand verschiebbar"-Einstellung, da Zoomen ein grundlegendes
    // Bedürfnis ist, das nicht an ein Werkzeug gebunden sein muss.
    wrap.addEventListener('wheel', function (ev) {
      if (!ev.ctrlKey && Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) { return; } // horizontales Scrollen ignorieren
      ev.preventDefault();
      var factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomBoardBy(factor, ev.clientX, ev.clientY);
    }, { passive: false });

    // Verschieben auf leerer Fläche (nicht auf einem Foto/Rahmen/Bedienelement)
    // funktioniert jetzt immer - unabhängig von Instanzeinstellung/Werkzeug.
    // Kurzes Ziehen = Verschieben der Ansicht; langes Halten OHNE Bewegung
    // löst stattdessen eine Auswahlbox aus (Mehrfachauswahl).
    var panDragging = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
    // Aktualisiert die Sichtbarkeit anhand der Filterleiste direkt im DOM
    // (kein render(), sonst würde das Eingabefeld bei jedem Tastendruck
    // mitten in der Eingabe zerstört und den Fokus verlieren).
    function applyBoardFilterVisibility() {
      var fq = (state.boardFilter || '').trim().toLowerCase();
      canvas.querySelectorAll('[data-multikey^="photo:"]').forEach(function (el2) {
        var id = parseInt(el2.getAttribute('data-multikey').split(':')[1], 10);
        var p = state.photos.filter(function (o) { return o.id === id; })[0];
        var match = !fq || !p || [p.sourcetitle, p.sourceyear, p.sourceepoch, p.sourceorigauthor, p.sourceauthor].some(function (v) {
          return (v || '').toLowerCase().indexOf(fq) !== -1;
        });
        el2.style.display = match ? '' : 'none';
      });
    }

    function isEmptyAreaTarget(target) {
      return !target.closest('.ic-arrange-item, .ic-thread-frame-onboard, button, input, a, .ic-board-ink-layer.active');
    }

    var longPressTimer = null, longPressStartX = 0, longPressStartY = 0;
    var boxModeArmed = false; // per Lupen-Popup aktiviert - nächster Klick auf leere Fläche startet die Box sofort
    var selectionBoxEl = null, selBoxStartWorld = null, selBoxAdd = false;

    var lastPointerCtrl = false;
    canvas.addEventListener('mousedown', function (ev) { lastPointerCtrl = ev.ctrlKey || ev.metaKey; }, true);

    // Wendet denselben Versatz (dx,dy) auf alle ÜBRIGEN Mitglieder der
    // Mehrfachauswahl an (nur die Daten - sichtbar wird es nach dem
    // Loslassen per render(), siehe persistGroupExcept).
    function applyGroupDelta(exceptKey, dx, dy) {
      if (state.multiSelect.indexOf(exceptKey) === -1 || state.multiSelect.length < 2) { return; }
      state.multiSelect.forEach(function (k) {
        if (k === exceptKey) { return; }
        var parts = k.split(':'); var kind = parts[0], id = parseInt(parts[1], 10);
        if (kind === 'photo') {
          var op = state.photos.filter(function (o) { return o.id === id; })[0];
          if (op) { op.canvasx += dx; op.canvasy += dy; }
        } else {
          var ot = ownThread();
          var oi = ot ? ot.items.filter(function (o) { return o.itemtype === 'frame' && o.id === id; })[0] : null;
          if (oi) { oi.framex += dx; oi.framey += dy; }
        }
      });
    }
    function persistGroupExcept(exceptKey) {
      state.multiSelect.forEach(function (k) {
        if (k === exceptKey) { return; }
        var parts = k.split(':'); var kind = parts[0], id = parseInt(parts[1], 10);
        if (kind === 'photo') {
          var op = state.photos.filter(function (o) { return o.id === id; })[0];
          if (op) { persistLayout(op); }
        } else {
          var ot = ownThread();
          var oi = ot ? ot.items.filter(function (o) { return o.itemtype === 'frame' && o.id === id; })[0] : null;
          if (oi) {
            callAjax('mod_pinnwand_update_thread_frame', {
              cmid: cfg.cmid, itemid: oi.id, framex: oi.framex, framey: oi.framey,
              framew: oi.framew, frameh: oi.frameh, framerot: oi.framerot || 0, framez: oi.framez || 0
            });
          }
        }
      });
    }
    function boardRectOf(idOrItem, kind) {
      if (kind === 'photo') {
        return { x: idOrItem.canvasx, y: idOrItem.canvasy, w: idOrItem.canvasw, h: idOrItem.canvasw * 0.75 };
      }
      return { x: idOrItem.framex, y: idOrItem.framey, w: idOrItem.framew, h: idOrItem.frameh };
    }

    function startSelectionBox(clientX, clientY, addMode) {
      panDragging = false;
      selBoxAdd = addMode;
      selBoxStartWorld = screenToCanvas(clientX, clientY);
      selectionBoxEl = el('div', { class: 'ic-selection-box' });
      canvas.appendChild(selectionBoxEl);
      updateSelectionBox(clientX, clientY);
    }
    function updateSelectionBox(clientX, clientY) {
      if (!selectionBoxEl) { return; }
      var cur = screenToCanvas(clientX, clientY);
      var x = Math.min(selBoxStartWorld.x, cur.x), y = Math.min(selBoxStartWorld.y, cur.y);
      var w = Math.abs(cur.x - selBoxStartWorld.x), h = Math.abs(cur.y - selBoxStartWorld.y);
      selectionBoxEl.style.left = x + 'px'; selectionBoxEl.style.top = y + 'px';
      selectionBoxEl.style.width = w + 'px'; selectionBoxEl.style.height = h + 'px';
      selectionBoxEl._rect = { x: x, y: y, w: w, h: h };
    }
    function finishSelectionBox() {
      if (!selectionBoxEl) { return; }
      var box = selectionBoxEl._rect;
      selectionBoxEl.remove();
      selectionBoxEl = null;
      if (!box || box.w < 4 || box.h < 4) { return; }
      var found = [];
      state.photos.forEach(function (p) {
        if (p.hiddenfromboard || !p.boardplaced || (p.boardid || 0) !== state.currentBoard) { return; }
        var r = boardRectOf(p, 'photo');
        if (r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y) {
          found.push('photo:' + p.id);
        }
      });
      if (state.threadPanelOpen || state.layerPanelOpen) {
        var ot = ownThread();
        if (ot) {
          ot.items.forEach(function (it) {
            if (it.itemtype !== 'frame' || (it.boardid || 0) !== state.currentBoard) { return; }
            var r = boardRectOf(it, 'frame');
            if (r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y) {
              found.push('frame:' + it.id);
            }
          });
        }
      }
      if (selBoxAdd) {
        found.forEach(function (k) { if (state.multiSelect.indexOf(k) === -1) { state.multiSelect.push(k); } });
      } else {
        state.multiSelect = found;
      }
      render();
    }

    wrap.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType === 'touch' && activeTouches > 1) { return; } // Pinch hat Vorrang
      if (!isEmptyAreaTarget(ev.target)) { return; }
      if (boxModeArmed) {
        boxModeArmed = false;
        startSelectionBox(ev.clientX, ev.clientY, ev.ctrlKey || ev.metaKey);
        return;
      }
      // Klick innerhalb der Box der Mehrfachauswahl (aber auf kein Objekt
      // getroffen) bewegt die ganze Gruppe statt die Ansicht zu verschieben.
      if (selBoundingBox && state.multiSelect.length > 0) {
        var wp = screenToCanvas(ev.clientX, ev.clientY);
        if (wp.x >= selBoundingBox.x && wp.x <= selBoundingBox.x + selBoundingBox.w &&
            wp.y >= selBoundingBox.y && wp.y <= selBoundingBox.y + selBoundingBox.h) {
          startGroupDrag(ev.clientX, ev.clientY);
          return;
        }
      }
      panDragging = true;
      panStartX = ev.clientX; panStartY = ev.clientY;
      panOrigX = state.boardPanX; panOrigY = state.boardPanY;
      // Langes Halten ohne Bewegung -> Auswahlbox statt Verschieben.
      longPressStartX = ev.clientX; longPressStartY = ev.clientY;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        startSelectionBox(ev.clientX, ev.clientY, ev.ctrlKey || ev.metaKey);
      }, 450);
    });
    wrap.addEventListener('pointermove', function (ev) {
      if (longPressTimer && (Math.abs(ev.clientX - longPressStartX) > 6 || Math.abs(ev.clientY - longPressStartY) > 6)) {
        clearTimeout(longPressTimer); longPressTimer = null;
      }
      if (selectionBoxEl) { updateSelectionBox(ev.clientX, ev.clientY); return; }
      if (!panDragging) { return; }
      state.boardPanX = panOrigX + (ev.clientX - panStartX);
      state.boardPanY = panOrigY + (ev.clientY - panStartY);
      applyBoardTransform();
    });
    window.addEventListener('pointerup', function () {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (selectionBoxEl) { finishSelectionBox(); }
      panDragging = false;
    });

    // Pinch-Zoom (zwei Finger) - eigene touch-Behandlung, da Pointer Events
    // Mehrfingergesten nicht direkt abbilden.
    var activeTouches = 0, pinchStartDist = 0, pinchStartZoom = 1, pinchMidX = 0, pinchMidY = 0;
    function touchDist(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    wrap.addEventListener('touchstart', function (ev) {
      activeTouches = ev.touches.length;
      if (ev.touches.length === 2) {
        panDragging = false;
        pinchStartDist = touchDist(ev.touches) || 1;
        pinchStartZoom = state.boardZoom;
        pinchMidX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2;
        pinchMidY = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
      }
    }, { passive: true });
    wrap.addEventListener('touchmove', function (ev) {
      if (ev.touches.length !== 2) { return; }
      ev.preventDefault();
      var dist = touchDist(ev.touches) || 1;
      zoomBoardTo(pinchStartZoom * (dist / pinchStartDist), pinchMidX, pinchMidY);
    }, { passive: false });
    wrap.addEventListener('touchend', function (ev) { activeTouches = ev.touches.length; });

    // Schwebende runde Icon-Buttons unten mittig (transparent/geblurrt,
    // siehe .ic-fab in CSS) - Overlay-Werkzeuge der Galerie (Raster/Daten/
    // Zeichnen) bleiben davon bewusst getrennt (eigene linke Dock-Leiste dort).
    var fabRow = el('div', { class: 'ic-fab-row' });

    var gearBtn = el('button', { class: 'ic-fab ic-tablet-up ic-fab-biglabel', title: S.options }, ['\u2699']);
    gearBtn.addEventListener('click', function () { openBackgroundPanel(body); });
    fabRow.appendChild(gearBtn);

    var dataBtn = el('button', { class: 'ic-fab' + (state.showData ? ' active' : ''), title: state.showData ? S.hidedata : S.showdata }, ['\u{1F3F7}']);
    dataBtn.addEventListener('click', function () { state.showData = !state.showData; render(); });
    fabRow.appendChild(dataBtn);

    // Lupe: öffnet ein kleines Zoom-Popup (Regler + Plus/Minus + Auswahl-
    // Werkzeuge + Filterleiste) statt mehrerer permanent sichtbarer Buttons.
    var zoomBtn = el('button', { class: 'ic-fab' + (state.boardFilter ? ' active' : ''), title: S.zoomtool }, [icon('search')]);
    zoomBtn.addEventListener('click', function () {
      var existing = document.getElementById('ic-zoom-popup');
      if (existing) { existing.remove(); return; }
      var popup = el('div', { class: 'ic-zoom-popup', id: 'ic-zoom-popup' });
      var zoomOutBtn = el('button', { class: 'ic-icon-btn', title: S.zoomout }, ['\u2212']);
      zoomOutBtn.addEventListener('click', function () { zoomBoardBy(0.85); zoomSlider.value = Math.round(state.boardZoom * 100); });
      var zoomSlider = el('input', {
        type: 'range', min: '25', max: '200', step: '5', value: String(Math.round(state.boardZoom * 100))
      });
      zoomSlider.addEventListener('input', function () { zoomBoardTo(parseInt(zoomSlider.value, 10) / 100); });
      var zoomInBtn = el('button', { class: 'ic-icon-btn', title: S.zoomin }, ['+']);
      zoomInBtn.addEventListener('click', function () { zoomBoardBy(1 / 0.85); zoomSlider.value = Math.round(state.boardZoom * 100); });
      var row1 = el('div', { class: 'ic-zoom-popup-row' });
      row1.appendChild(zoomOutBtn); row1.appendChild(zoomSlider); row1.appendChild(zoomInBtn);

      // Box-Symbol: wählt sofort alle gerade angezeigten (gefilterten)
      // Objekte aus. Kreis-Symbol: aktiviert den Hinzufügen/Entfernen-Modus
      // (danach angetippte einzelne Objekte werden zur Auswahl hinzugefügt/
      // entfernt). Auge: springt mit der Kamera genau auf den Ausschnitt,
      // in dem die aktuelle Auswahl zu sehen ist.
      var boxSelBtn = el('button', { class: 'ic-icon-btn', title: S.boxselect }, [icon('boxselect')]);
      boxSelBtn.addEventListener('click', function () {
        popup.remove();
        var keys = visible.map(function (p) { return 'photo:' + p.id; });
        if (state.threadPanelOpen || state.layerPanelOpen) {
          var ot = ownThread();
          if (ot) {
            ot.items.forEach(function (it) {
              if (it.itemtype === 'frame' && (it.boardid || 0) === state.currentBoard) { keys.push('frame:' + it.id); }
            });
          }
        }
        state.multiSelect = keys;
        render();
      });
      var addSelBtn = el('button', { class: 'ic-icon-btn ic-icon-btn-circle', title: S.selection_add }, [icon('circle')]);
      addSelBtn.addEventListener('click', function () {
        popup.remove();
        state.multiSelectAddMode = true;
        render();
      });
      var fitSelBtn = el('button', { class: 'ic-icon-btn', title: S.selection_fit }, [icon('eye')]);
      fitSelBtn.addEventListener('click', function () {
        popup.remove();
        if (state.multiSelect.length > 0) { fitViewToSelection(); return; }
        // Ohne Auswahl: erster Klick zeigt alles (Standard-Zoom), ein
        // weiterer Klick direkt danach zoomt gezielt auf den
        // Hintergrundbereich selbst.
        if (state._eyeShowedDefault) { fitViewToBackground(); state._eyeShowedDefault = false; }
        else { fitViewDefault(); state._eyeShowedDefault = true; }
      });
      var hideMediaBtn = el('button', {
        class: 'ic-icon-btn' + (state.boardHideMedia ? ' active' : ''), title: S.hidemedia
      }, [icon('nomedia')]);
      hideMediaBtn.addEventListener('click', function () {
        popup.remove();
        state.boardHideMedia = !state.boardHideMedia;
        render();
      });
      var row2 = el('div', { class: 'ic-zoom-popup-row' });
      row2.appendChild(boxSelBtn); row2.appendChild(addSelBtn); row2.appendChild(fitSelBtn); row2.appendChild(hideMediaBtn);

      // Filterleiste (Titel/Jahr/Epoche/Autor der Vorlage/Autor) direkt
      // hier statt eines eigenen Buttons.
      var filterInput = el('input', {
        type: 'text', placeholder: S.filterbar_placeholder, value: state.boardFilter, class: 'ic-zoom-filter-input'
      });
      filterInput.addEventListener('input', function () {
        state.boardFilter = filterInput.value;
        applyBoardFilterVisibility();
      });
      var filterClear = el('button', { class: 'ic-icon-btn', title: S.filterbar_clear }, ['\u2715']);
      filterClear.addEventListener('click', function () { state.boardFilter = ''; filterInput.value = ''; applyBoardFilterVisibility(); });
      var row3 = el('div', { class: 'ic-zoom-popup-row' });
      row3.appendChild(filterInput); row3.appendChild(filterClear);

      popup.appendChild(row1); popup.appendChild(row2); popup.appendChild(row3);
      body.appendChild(popup);
    });
    fabRow.appendChild(zoomBtn);

    // Play-Button: startet die Präsentation des eigenen Fadens direkt, ohne
    // erst das Faden-Panel öffnen zu müssen.
    var ownForPlay = ownThread();
    if (ownForPlay && ownForPlay.items.length > 0) {
      var playBtn = el('button', { class: 'ic-fab', title: S.presentthread }, [icon('play')]);
      playBtn.addEventListener('click', function () { openPresentation(ownForPlay); });
      fabRow.appendChild(playBtn);
    }

    // Seitenleisten-Buttons (Post-Stream / Roter Faden / Schichtung /
    // Trashbin, in dieser Reihenfolge) in der oberen rechten Ecke der
    // Pinnwand - schließen sich gegenseitig, da sie sich denselben rechten
    // Rand teilen.
    var SIDEBAR_PANELS = ['streamPanelOpen', 'threadPanelOpen', 'layerPanelOpen', 'trashPanelOpen'];
    function openSidebar(key) {
      SIDEBAR_PANELS.forEach(function (k) { state[k] = (k === key); });
      if (key === 'streamPanelOpen') { loadStreamPhotos(); }
      if (key === 'trashPanelOpen') { loadTrash(); }
      render();
    }
    function toggleSidebar(key) {
      if (state[key]) { state[key] = false; render(); } else { openSidebar(key); }
    }
    var sidebarBar = el('div', { class: 'ic-sidebar-toggle-bar' });
    if (state.canusepoststream) {
      var streamBtn = el('button', { class: 'ic-icon-btn' + (state.streamPanelOpen ? ' active' : ''), title: S.poststream }, [icon('stream')]);
      streamBtn.addEventListener('click', function () { toggleSidebar('streamPanelOpen'); });
      sidebarBar.appendChild(streamBtn);
    }
    if (state.canusethreads || state.threads.length > 0) {
      var threadBtn = el('button', { class: 'ic-icon-btn' + (state.threadPanelOpen ? ' active' : ''), title: S.thread }, [icon('thread')]);
      threadBtn.addEventListener('click', function () { toggleSidebar('threadPanelOpen'); });
      sidebarBar.appendChild(threadBtn);
    }
    if (state.canuselayers) {
      var layerBtn = el('button', { class: 'ic-icon-btn' + (state.layerPanelOpen ? ' active' : ''), title: S.layers }, [icon('layers')]);
      layerBtn.addEventListener('click', function () { toggleSidebar('layerPanelOpen'); });
      sidebarBar.appendChild(layerBtn);
    }
    var trashBtn = el('button', { class: 'ic-icon-btn' + (state.trashPanelOpen ? ' active' : ''), title: S.trashbin }, [icon('trash')]);
    trashBtn.addEventListener('click', function () { toggleSidebar('trashPanelOpen'); });
    sidebarBar.appendChild(trashBtn);
    body.appendChild(sidebarBar);

    // Stylus: eigener Button unten links, direkt mit den Annotationswerkzeugen
    // verknüpft - zeichnet direkt auf den Hintergrund (genau auf dessen
    // 1400x1000-Koordinatenfläche gemappt, siehe Zeichen-Ebene weiter unten),
    // nicht an ein einzelnes Foto gebunden.
    var stylusBar = el('div', { class: 'ic-stylus-bar' });
    var stylusBtn = el('button', { class: 'ic-fab' + (state.boardDrawMode ? ' active' : ''), title: S.drawonboard }, [icon('pen')]);
    stylusBtn.addEventListener('click', function () { state.boardDrawMode = !state.boardDrawMode; render(); });
    stylusBar.appendChild(stylusBtn);
    if (state.boardDrawMode) {
      var stylusTools = el('div', { class: 'ic-stylus-tools' });
      var stylusColorRow = el('div', { class: 'ic-stylus-tools-row' });
      INK_COLORS.forEach(function (c) {
        var sw = el('button', {
          class: 'ic-color-swatch' + (state.boardDrawColor === c && !state.boardDrawErase ? ' active' : ''), style: 'background:' + c
        });
        sw.addEventListener('click', function () { state.boardDrawColor = c; state.boardDrawErase = false; render(); });
        stylusColorRow.appendChild(sw);
      });
      // Palettenbutton: freie Farbwahl über den nativen Farbwähler, für
      // mehr Auswahl als die feste Farbliste.
      var stylusCustomColor = el('input', {
        type: 'color', value: state.boardDrawColor || INK_COLORS[0], class: 'ic-textframe-custom-color'
      });
      stylusCustomColor.addEventListener('change', function () {
        state.boardDrawColor = stylusCustomColor.value; state.boardDrawErase = false; render();
      });
      stylusColorRow.appendChild(stylusCustomColor);
      stylusTools.appendChild(stylusColorRow);

      var stylusActionRow = el('div', { class: 'ic-stylus-tools-row' });
      var eraseBtn = el('button', { class: 'ic-icon-btn' + (state.boardDrawErase ? ' active' : ''), title: S.erase }, [icon('eraser')]);
      eraseBtn.addEventListener('click', function () { state.boardDrawErase = !state.boardDrawErase; render(); });
      stylusActionRow.appendChild(eraseBtn);
      var sizeSlider = el('input', {
        type: 'range', min: '0.004', max: '0.03', step: '0.002', value: String(state.boardDrawWidth || 0.01), class: 'ic-stylus-size'
      });
      sizeSlider.addEventListener('input', function () { state.boardDrawWidth = parseFloat(sizeSlider.value); });
      stylusActionRow.appendChild(sizeSlider);
      // Ausblenden: blendet die eigenen Anmerkungen aus, ohne sie zu
      // löschen (rein visuell, clientseitig) - ein erneuter Klick blendet
      // sie wieder ein.
      var hideInkBtn = el('button', {
        class: 'ic-icon-btn' + (state.boardInkHidden ? ' active' : ''), title: state.boardInkHidden ? S.showannotations : S.hideannotations
      }, [icon('eye')]);
      hideInkBtn.addEventListener('click', function () { state.boardInkHidden = !state.boardInkHidden; render(); });
      stylusActionRow.appendChild(hideInkBtn);
      // Komplett löschen: entfernt alle eigenen Striche auf diesem Board
      // endgültig (mit Rückfrage, da nicht rückgängig machbar).
      var clearInkBtn = el('button', { class: 'ic-icon-btn', title: S.clearannotations }, [icon('trash')]);
      clearInkBtn.addEventListener('click', function () {
        if (!confirm(S.clearannotations_confirm)) { return; }
        state.boardInkStrokes = [];
        callAjax('mod_pinnwand_save_board_ink', { cmid: cfg.cmid, boardid: state.currentBoard, strokes: '[]' });
        render();
      });
      stylusActionRow.appendChild(clearInkBtn);
      stylusTools.appendChild(stylusActionRow);
      stylusBar.appendChild(stylusTools);
    }
    body.appendChild(stylusBar);

    var maxreached = state.maxpictures > 0 && state.photos.length >= state.maxpictures;
    var addBtn = el('button', { class: 'ic-fab ic-fab-primary ic-fab-biglabel', title: S.addphoto, disabled: maxreached ? 'disabled' : null }, ['+']);
    addBtn.addEventListener('click', function () { if (!maxreached) { openAddModal(); } });
    fabRow.appendChild(addBtn);

    body.appendChild(fabRow);

    // Undo/Redo rechts neben dem Stylus-Button (unten links) statt neben
    // dem zentralen Menü, damit sie sich nie überlagern können.
    var undoBar = el('div', { class: 'ic-undo-bar' });
    var undoBtn = el('button', { class: 'ic-fab' + (undoStack.length ? '' : ' disabled'), title: S.undo }, [icon('undo')]);
    undoBtn.addEventListener('click', function () { performUndo(); });
    var redoBtn = el('button', { class: 'ic-fab' + (redoStack.length ? '' : ' disabled'), title: S.redo }, [icon('redo')]);
    redoBtn.addEventListener('click', function () { performRedo(); });
    undoBar.appendChild(undoBtn); undoBar.appendChild(redoBtn);
    body.appendChild(undoBar);
    undoBtnEl = undoBtn; redoBtnEl = redoBtn;

    if (state.threadPanelOpen) { body.appendChild(renderThreadPanel()); }
    if (state.streamPanelOpen) { body.appendChild(renderStreamPanel()); }
    if (state.layerPanelOpen) { body.appendChild(renderLayerPanel()); }
    if (state.trashPanelOpen) { body.appendChild(renderTrashPanel()); }

    // Drop-Zone: Karte aus dem Post-Stream auf das Board ziehen = Kopie
    // anlegen (siehe renderStreamPanel/adopt_photo_to_board).
    var selBoundingBox = null; // Bounding-Box der Mehrfachauswahl in Board-Koordinaten (für "Klick in die Box bewegt Gruppe")

    // Wendet denselben Versatz auf ALLE Mitglieder der Mehrfachauswahl an
    // (für das Verschieben über die Box selbst bzw. den Mittelpunkt-Griff,
    // nicht von einem einzelnen gezogenen Objekt ausgehend).
    function applyGroupDeltaAll(dx, dy) {
      state.multiSelect.forEach(function (k) {
        var parts = k.split(':'); var kind = parts[0], id = parseInt(parts[1], 10);
        if (kind === 'photo') {
          var op = state.photos.filter(function (o) { return o.id === id; })[0];
          if (op) { op.canvasx += dx; op.canvasy += dy; }
        } else {
          var ot = ownThread();
          var oi = ot ? ot.items.filter(function (o) { return o.itemtype === 'frame' && o.id === id; })[0] : null;
          if (oi) { oi.framex += dx; oi.framey += dy; }
        }
      });
    }
    function persistGroupAll() {
      state.multiSelect.forEach(function (k) {
        var parts = k.split(':'); var kind = parts[0], id = parseInt(parts[1], 10);
        if (kind === 'photo') {
          var op = state.photos.filter(function (o) { return o.id === id; })[0];
          if (op) { persistLayout(op); }
        } else {
          var ot = ownThread();
          var oi = ot ? ot.items.filter(function (o) { return o.itemtype === 'frame' && o.id === id; })[0] : null;
          if (oi) {
            callAjax('mod_pinnwand_update_thread_frame', {
              cmid: cfg.cmid, itemid: oi.id, framex: oi.framex, framey: oi.framey,
              framew: oi.framew, frameh: oi.frameh, framerot: oi.framerot || 0, framez: oi.framez || 0
            });
          }
        }
      });
    }
    // Zieht man auf der Box selbst (ohne ein Objekt zu treffen) oder am
    // Mittelpunkt-Griff, bewegt sich die ganze Gruppe gemeinsam.
    function startGroupDrag(startClientX, startClientY) {
      var lastX = startClientX, lastY = startClientY;
      function move(ev) {
        var dx = (ev.clientX - lastX) / (state.boardZoom || 1);
        var dy = (ev.clientY - lastY) / (state.boardZoom || 1);
        lastX = ev.clientX; lastY = ev.clientY;
        applyGroupDeltaAll(dx, dy);
        var overlayEl = document.querySelector('.ic-selection-overlay');
        if (overlayEl) {
          overlayEl.style.left = (parseFloat(overlayEl.style.left) + dx) + 'px';
          overlayEl.style.top = (parseFloat(overlayEl.style.top) + dy) + 'px';
        }
        state.multiSelect.forEach(function (k) {
          var kEl = canvas.querySelector('[data-multikey="' + k + '"]');
          if (kEl) {
            kEl.style.left = (parseFloat(kEl.style.left) + dx) + 'px';
            kEl.style.top = (parseFloat(kEl.style.top) + dy) + 'px';
          }
        });
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        persistGroupAll();
        render();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }


    // Zusätzliche Objekt-Platzierungen (z.B. nach Klonen) - einfache
    // Kacheln: anzeigen, verschieben, entfernen (blauer Pin = "von diesem
    // Board entfernen", landet im Trashbin). Referenzieren die Bilddaten
    // aus state.photos (dort bereits vollständig geladen, unabhängig vom
    // Board), OHNE dort selbst einen Eintrag anzulegen.
    state.extraPlacements.forEach(function (pl) {
      var srcPhoto = state.photos.filter(function (o) { return o.id === pl.photoid; })[0];
      if (!srcPhoto) { return; }
      var plItem = el('div', {
        class: 'ic-arrange-item ic-extra-placement',
        style: 'left:' + pl.canvasx + 'px;top:' + pl.canvasy + 'px;width:' + pl.canvasw + 'px;' +
          'transform:rotate(' + (pl.canvasrot || 0) + 'deg)'
      });
      plItem.style.zIndex = pl.canvasz || 0;
      plItem.appendChild(el('img', { src: srcPhoto.url, alt: '' }));
      var unpinBtn = el('button', { class: 'ic-extra-placement-unpin', title: S.unpintooltip }, [icon('thumbtack')]);
      unpinBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        callAjax('mod_pinnwand_set_placement_status', { cmid: cfg.cmid, placementid: pl.id, status: 'trash' }).then(function () {
          state.extraPlacements = state.extraPlacements.filter(function (o) { return o.id !== pl.id; });
          render();
        });
      });
      plItem.appendChild(unpinBtn);
      makeMovable(plItem, canvas, function (x, y) {
        pl.canvasx = x; pl.canvasy = y;
      }, function (moved) {
        if (!moved) { return; }
        callAjax('mod_pinnwand_update_object_placement', {
          cmid: cfg.cmid, placementid: pl.id, x: pl.canvasx, y: pl.canvasy, w: pl.canvasw,
          rot: pl.canvasrot || 0, z: pl.canvasz || 0
        });
      });
      canvas.appendChild(plItem);
    });

    // Umrandung der Mehrfachauswahl mit Plus-Button oben rechts - Klick
    // darauf aktiviert den Hinzufügen/Entfernen-Modus: normale Klicks auf
    // Objekte schalten deren Zugehörigkeit zur Auswahl um (wie Strg+Klick),
    // bis auf leere Fläche geklickt wird (siehe Klick-Logik weiter unten).
    if (state.multiSelect.length > 0) {
      var selRects = state.multiSelect.map(function (k) {
        var parts = k.split(':'); var kind = parts[0], id = parseInt(parts[1], 10);
        if (kind === 'photo') {
          var op = state.photos.filter(function (o) { return o.id === id; })[0];
          return op ? boardRectOf(op, 'photo') : null;
        }
        var ot = ownThread();
        var oi = ot ? ot.items.filter(function (o) { return o.itemtype === 'frame' && o.id === id; })[0] : null;
        return oi ? boardRectOf(oi, 'frame') : null;
      }).filter(Boolean);
      if (selRects.length > 0) {
        var minX = Math.min.apply(null, selRects.map(function (r) { return r.x; }));
        var minY = Math.min.apply(null, selRects.map(function (r) { return r.y; }));
        var maxX = Math.max.apply(null, selRects.map(function (r) { return r.x + r.w; }));
        var maxY = Math.max.apply(null, selRects.map(function (r) { return r.y + r.h; }));
        selBoundingBox = { x: minX - 6, y: minY - 6, w: maxX - minX + 12, h: maxY - minY + 12 };
        var selOverlay = el('div', {
          class: 'ic-selection-overlay' + (state.multiSelectAddMode ? ' add-mode' : ''),
          style: 'left:' + (minX - 6) + 'px;top:' + (minY - 6) + 'px;width:' + (maxX - minX + 12) + 'px;height:' + (maxY - minY + 12) + 'px;'
        });
        var selAddBtn = el('button', {
          class: 'ic-selection-add-btn' + (state.multiSelectAddMode ? ' active' : ''), title: S.selection_add
        }, [icon('circle')]);
        selAddBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          state.multiSelectAddMode = true;
          render();
        });
        selOverlay.appendChild(selAddBtn);

        // Mittelpunkt-Griff: zieht man daran, bewegt sich die ganze Gruppe -
        // eine klar erkennbare, dedizierte Grifffläche zusätzlich zum Klick
        // auf die Box selbst (siehe wrap-pointerdown weiter unten).
        var selMoveHandle = el('div', { class: 'ic-selection-move-handle', title: S.selection_move }, [icon('move')]);
        selMoveHandle.addEventListener('pointerdown', function (ev) {
          ev.stopPropagation();
          startGroupDrag(ev.clientX, ev.clientY);
        });
        selOverlay.appendChild(selMoveHandle);

        canvas.appendChild(selOverlay);
      }
      // Klick auf leere Fläche: im Hinzufügen-Modus beendet der erste Klick
      // nur diesen Modus (Auswahl bleibt bestehen) - ein weiterer Klick auf
      // leere Fläche löst danach die gesamte Auswahl auf.
      wrap.addEventListener('click', function clearSel(ev) {
        if (!isEmptyAreaTarget(ev.target)) { return; }
        if (state.multiSelectAddMode) {
          state.multiSelectAddMode = false;
        } else if (state.multiSelect.length > 0) {
          state.multiSelect = [];
        }
        render();
      }, { once: true });
    }

    function screenToCanvas(clientX, clientY) {
      var rect = wrap.getBoundingClientRect();
      var offX = clientX - rect.left + wrap.scrollLeft;
      var offY = clientY - rect.top + wrap.scrollTop;
      return {
        x: (offX - state.boardPanX) / (state.boardZoom || 1),
        y: (offY - state.boardPanY) / (state.boardZoom || 1)
      };
    }
    wrap.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    wrap.addEventListener('drop', function (ev) {
      ev.preventDefault();
      var photoid = parseInt(ev.dataTransfer.getData('text/pinnwand-stream-photoid'), 10);
      if (!photoid) { return; }
      var mine = ev.dataTransfer.getData('text/pinnwand-stream-mine') === '1';
      var pt = screenToCanvas(ev.clientX, ev.clientY);
      placeStreamPhoto(photoid, pt.x - 100, pt.y - 100, mine);
    });
  }

  // ------------------------------------------------------------------
  // POST-STREAM: neue Einreichungen anderer Lernender für die Lehrkraft -
  // Karten stapeln sich von unten (neu) nach oben (älter, kollabiert).
  // ------------------------------------------------------------------
  var streamPollTimer = null;
  function loadTrash() {
    callAjax('mod_pinnwand_get_trash', { cmid: cfg.cmid }).then(function (res) {
      state.trashItems = res.items || [];
      if (state.step === 'arrange' && state.trashPanelOpen) { render(); }
    }).catch(function () { /* Trashbin bleibt leer */ });
  }

  function loadStreamPhotos() {
    callAjax('mod_pinnwand_get_stream_photos', { cmid: cfg.cmid }).then(function (res) {
      state.streamPhotos = res.photos || [];
      // Beim allerersten Laden: wenn es Einreichungen gibt, den Post-Stream
      // gleich mit öffnen, statt dass sie unbemerkt bleiben.
      if (!state._streamAutoOpenChecked) {
        state._streamAutoOpenChecked = true;
        if (state.streamPhotos.length > 0 && state.step === 'arrange' && !state.threadPanelOpen && !state.layerPanelOpen) {
          state.streamPanelOpen = true;
        }
      }
      if (state.step === 'arrange' && state.streamPanelOpen) { render(); }
    }).catch(function () { /* Stream bleibt leer, Board funktioniert trotzdem */ });
    if (!streamPollTimer) {
      streamPollTimer = setInterval(function () {
        if (state.step === 'arrange' && state.streamPanelOpen) { loadStreamPhotos(); }
        else { clearInterval(streamPollTimer); streamPollTimer = null; }
      }, 15000);
    }
  }

  function adoptStreamPhoto(photoid, x, y) {
    callAjax('mod_pinnwand_adopt_photo_to_board', {
      cmid: cfg.cmid, photoid: photoid, x: x, y: y, boardid: state.currentBoard
    }).then(function () {
      state.streamPhotos = state.streamPhotos.filter(function (p) { return p.id !== photoid; });
      refreshPhotos().then(render);
    });
  }

  // Eigenes, noch nicht platziertes Foto aus dem Post-Stream direkt auf das
  // Board übernehmen (keine Kopie nötig, es ist ja bereits das eigene Foto) -
  // im Unterschied zu fremden Einreichungen (siehe adoptStreamPhoto).
  function placeStreamPhoto(photoid, x, y, mine) {
    if (!mine) { adoptStreamPhoto(photoid, x, y); return; }
    var existing = state.photos.filter(function (p) { return p.id === photoid; })[0];
    var w = existing ? existing.canvasw : 200;
    callAjax('mod_pinnwand_update_layout', {
      cmid: cfg.cmid, photoid: photoid, x: x, y: y, w: w, rot: 0, z: state.photos.length, boardid: state.currentBoard
    }).then(function () {
      state.streamPhotos = state.streamPhotos.filter(function (p) { return p.id !== photoid; });
      refreshPhotos().then(render);
    });
  }

  // Breite per Drag am linken Rand des Panels änderbar - gemeinsam für alle
  // vier Seitenleisten (Post-Stream/Faden/Layer/Trashbin), die sich
  // dieselbe state.sidebarWidth teilen.
  function attachSidebarResize(panel) {
    panel.style.width = state.sidebarWidth + 'px';
    var resizeHandle = el('div', { class: 'ic-stream-resize' });
    panel.insertBefore(resizeHandle, panel.firstChild);
    var resizing = false, startX = 0, startW = 0;
    resizeHandle.addEventListener('mousedown', function (ev) {
      resizing = true; startX = ev.clientX; startW = state.sidebarWidth; ev.preventDefault();
    });
    resizeHandle.addEventListener('touchstart', function (ev) {
      resizing = true; startX = ev.touches[0].clientX; startW = state.sidebarWidth;
    }, { passive: true });
    function move(clientX) {
      if (!resizing) { return; }
      state.sidebarWidth = Math.max(160, Math.min(420, startW - (clientX - startX)));
      panel.style.width = state.sidebarWidth + 'px';
    }
    window.addEventListener('mousemove', function (ev) { move(ev.clientX); });
    window.addEventListener('touchmove', function (ev) { if (resizing) { move(ev.touches[0].clientX); } }, { passive: true });
    window.addEventListener('mouseup', function () { resizing = false; });
    window.addEventListener('touchend', function () { resizing = false; });
  }

  function renderStreamPanel() {
    var panel = el('div', { class: 'ic-stream-panel' });
    attachSidebarResize(panel);

    var filterBar = el('input', {
      type: 'text', class: 'ic-stream-filter', placeholder: S.stream_filter_placeholder, value: state.streamFilter
    });
    filterBar.addEventListener('input', function () { state.streamFilter = filterBar.value; renderCards(); });
    panel.appendChild(filterBar);

    var cardsWrap = el('div', { class: 'ic-stream-cards' });
    panel.appendChild(cardsWrap);

    function renderCards() {
      cardsWrap.innerHTML = '';
      var q = state.streamFilter.trim().toLowerCase();
      var list = state.streamPhotos.filter(function (p) {
        if (!q) { return true; }
        return (p.userfullname + ' ' + p.sourcetitle).toLowerCase().indexOf(q) !== -1;
      });
      if (list.length === 0) {
        cardsWrap.appendChild(el('p', { class: 'ic-hint' }, [S.stream_empty]));
        return;
      }
      var FULL_H = 220, COLLAPSED_H = 48, GAP = 6;
      list.forEach(function (p, idx) {
        var collapsed = idx >= 2;
        var card = el('div', {
          class: 'ic-stream-card' + (collapsed ? ' collapsed' : ''),
          draggable: 'true', title: S.stream_hint
        });
        card.style.zIndex = String(list.length - idx);
        var bottomOffset;
        if (idx === 0) { bottomOffset = 0; } else if (idx === 1) { bottomOffset = FULL_H + GAP; } else {
          bottomOffset = FULL_H * 2 + GAP * 2 + (idx - 2) * (COLLAPSED_H + GAP);
        }
        card.style.bottom = bottomOffset + 'px';
        var cardImg = el('img', { src: p.url, alt: '' });
        // Bildmaße kommen nicht vom Server - nach dem Laden clientseitig
        // prüfen, ob es sich um ein Hochformat-Bild handelt, und dann
        // vollständig (statt ausschnittsweise) sowie etwas schmaler und
        // zentriert darstellen (siehe .ic-stream-card-portrait).
        cardImg.addEventListener('load', function () {
          if (cardImg.naturalHeight > cardImg.naturalWidth) { card.classList.add('ic-stream-card-portrait'); }
        });
        card.appendChild(cardImg);
        var labelWrap = el('div', { class: 'ic-stream-card-label' });
        if (collapsed) {
          // Eingeklappt (ältere Einreichung): bis zu drei Zeilen, unten
          // ausgerichtet - Titel (falls vergeben), Autor/Jahr der Vorlage
          // (falls vorhanden), zuletzt immer die hochladende Person.
          if (p.sourcetitle) { labelWrap.appendChild(el('span', { class: 'ic-stream-label-title' }, [p.sourcetitle])); }
          var authorYear = [p.sourceauthor, p.sourceyear].filter(Boolean).join(' · ');
          if (authorYear) { labelWrap.appendChild(el('span', { class: 'ic-stream-label-authoryear' }, [authorYear])); }
          labelWrap.appendChild(el('span', { class: 'ic-stream-label-uploader' }, [p.userfullname]));
        } else {
          // Vollständig dargestellt (neue Einreichung): nur die
          // hochladende Person darunter.
          labelWrap.appendChild(el('span', { class: 'ic-stream-label-uploader' }, [p.userfullname]));
        }
        card.appendChild(labelWrap);

        function centerPoint() {
          var wrapEl = document.querySelector('.ic-canvas-wrap');
          var rect = wrapEl ? wrapEl.getBoundingClientRect() : { width: 400, height: 400 };
          // Der Post-Stream selbst deckt einen Teil rechts ab - "Mitte" auf
          // den davon freien Bereich beziehen, sonst landet das Foto hinter
          // der eigenen Leiste (unsichtbar/unklickbar, bis sie geschlossen wird).
          var usableWidth = Math.max(100, rect.width - (state.sidebarWidth || 0));
          return {
            x: (usableWidth / 2 - state.boardPanX) / (state.boardZoom || 1) - 100,
            y: (rect.height / 2 - state.boardPanY) / (state.boardZoom || 1) - 100
          };
        }

        // PIN-Icon: Foto direkt mittig auf die (sichtbare) Pinnwand legen -
        // ohne Drag, ein Tippen genügt.
        var pinBtn = el('button', { class: 'ic-stream-pin-btn', title: S.stream_pin_hint }, [icon('thumbtack')]);
        pinBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var pt = centerPoint();
          placeStreamPhoto(p.id, pt.x, pt.y, p.mine);
        });
        card.appendChild(pinBtn);

        card.addEventListener('dragstart', function (ev) {
          ev.dataTransfer.setData('text/pinnwand-stream-photoid', String(p.id));
          ev.dataTransfer.setData('text/pinnwand-stream-mine', p.mine ? '1' : '0');
        });
        card.addEventListener('click', function () {
          // Eigene Fotos: Kartenkörper öffnet die große Lightbox-Ansicht.
          // Fremde Einreichungen (nur Lehrkraft) haben keine eigene
          // Lightbox verfügbar - Tippen wirkt dort wie das PIN-Icon.
          if (p.mine) {
            var idx = state.photos.findIndex(function (o) { return o.id === p.id; });
            if (idx !== -1) { openLightbox(idx); return; }
          }
          var pt = centerPoint();
          placeStreamPhoto(p.id, pt.x, pt.y, p.mine);
        });
        cardsWrap.appendChild(card);
      });
    }
    renderCards();

    return panel;
  }

  // ------------------------------------------------------------------
  // SCHICHTUNG: Reihenfolge (Z-Ebene) der platzierten Fotos auf dem
  // aktuellen Board - oben in der Liste = ganz vorne (höchstes canvasz).
  // ------------------------------------------------------------------
  // Trashbin: eigene gelöschte Objekte und entfernte Zusatz-Platzierungen,
  // gruppiert nach Board (auf dem sie zuletzt waren). Objekte, die noch auf
  // einem anderen Board aktiv sind, können hier nicht endgültig gelöscht
  // werden - nur ihre eigene Zeile lässt sich wiederherstellen.
  function renderTrashPanel() {
    var panel = el('div', { class: 'ic-thread-panel' });
    attachSidebarResize(panel);
    panel.appendChild(el('h3', { class: 'ic-thread-panel-title' }, [S.trashbin]));
    if (!state.trashItems.length) {
      panel.appendChild(el('p', { class: 'ic-hint' }, [S.trashbin_empty]));
      return panel;
    }
    var byBoard = {};
    state.trashItems.forEach(function (it) {
      (byBoard[it.boardid] = byBoard[it.boardid] || []).push(it);
    });
    Object.keys(byBoard).sort(function (a, b) { return a - b; }).forEach(function (boardKey) {
      var boardId = parseInt(boardKey, 10);
      panel.appendChild(el('h4', { class: 'ic-thread-panel-subtitle' }, [boardDisplayName(boardId)]));
      byBoard[boardKey].forEach(function (it) {
        var row = el('div', { class: 'ic-thread-item' });
        row.appendChild(el('span', { class: 'ic-thread-item-label' }, [
          it.kind === 'object' ? (it.sourcetitle || S.emptyframe) : S.trashbin_placement_label
        ]));
        var restoreBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.trashbin_restore }, [icon('undo')]);
        restoreBtn.addEventListener('click', function () {
          var call = it.kind === 'object'
            ? callAjax('mod_pinnwand_restore_photo', { cmid: cfg.cmid, photoid: it.id })
            : callAjax('mod_pinnwand_set_placement_status', { cmid: cfg.cmid, placementid: it.id, status: 'active' });
          call.then(function () {
            state.trashItems = state.trashItems.filter(function (o) { return !(o.kind === it.kind && o.id === it.id); });
            refreshPhotos();
            state.extraPlacementsBoard = null; // erzwingt Neuladen der Platzierungen
            render();
          });
        });
        row.appendChild(restoreBtn);
        if (it.kind === 'object' && !it.usedelsewhere) {
          var delBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.trashbin_delete_forever }, ['\u2715']);
          delBtn.addEventListener('click', function () {
            if (!confirm(S.trashbin_delete_forever_confirm)) { return; }
            callAjax('mod_pinnwand_permanently_delete_photo', { cmid: cfg.cmid, photoid: it.id }).then(function () {
              state.trashItems = state.trashItems.filter(function (o) { return !(o.kind === it.kind && o.id === it.id); });
              render();
            });
          });
          row.appendChild(delBtn);
        }
        panel.appendChild(row);
      });
    });
    return panel;
  }

  function renderLayerPanel() {
    var panel = el('div', { class: 'ic-thread-panel' });
    attachSidebarResize(panel);
    panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.layers]));

    var photoItems = state.photos.filter(function (p) {
      return !p.hiddenfromboard && p.boardplaced && (p.boardid || 0) === state.currentBoard;
    }).map(function (p) { return { kind: 'photo', z: p.canvasz || 0, ref: p }; });

    var ownForLayers = ownThread();
    var frameItems = (ownForLayers ? ownForLayers.items : []).filter(function (it) {
      return it.itemtype === 'frame' && (it.boardid || 0) === state.currentBoard;
    }).map(function (it) { return { kind: 'frame', z: it.framez || 0, ref: it }; });

    // Fotos und Rahmen gemeinsam nach Z-Reihenfolge - oben in der Liste =
    // ganz vorne (höchstes z).
    var items = photoItems.concat(frameItems).sort(function (a, b) { return b.z - a.z; });

    var list = el('div', { class: 'ic-thread-list' });
    if (items.length === 0) {
      list.appendChild(el('p', { class: 'ic-hint' }, [S.layers_empty]));
      panel.appendChild(list);
      return panel;
    }

    var dragFromIdx = null;
    items.forEach(function (entry, idx) {
      var key = entry.kind + ':' + entry.ref.id;
      var row = el('div', {
        class: 'ic-thread-item' + (state.selectedItemKey === key ? ' selected' : '') +
          (state.multiSelect.indexOf(key) !== -1 ? ' multi-selected' : ''),
        draggable: 'true'
      });
      row.addEventListener('click', function (ev) {
        if (ev.ctrlKey || ev.metaKey || state.multiSelectAddMode) { toggleMultiSelectGlobal(key); return; }
        if (openPresentationAtItem(entry.kind, entry.ref.id)) { return; }
        selectItem(key);
      });
      if (entry.kind === 'photo') {
        row.appendChild(el('img', { src: entry.ref.url, alt: '' }));
        row.appendChild(el('span', { class: 'ic-thread-item-label' }, [entry.ref.sourcetitle || itemCaptionText(entry.ref)]));
      } else {
        row.appendChild(el('div', { class: 'ic-thread-frame-thumb' }, ['\u2b1a']));
        var frameLabelEl = el('span', {
          class: 'ic-thread-item-label ic-thread-item-label-editable', contenteditable: 'true'
        }, [entry.ref.framelabel || S.emptyframe]);
        var layerLabelEditing = false;
        frameLabelEl.addEventListener('mousedown', function (ev) { if (!layerLabelEditing) { ev.preventDefault(); } });
        frameLabelEl.addEventListener('dblclick', function (ev) {
          ev.stopPropagation();
          layerLabelEditing = true;
          frameLabelEl.focus();
          var range = document.createRange();
          range.selectNodeContents(frameLabelEl);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        frameLabelEl.addEventListener('focus', function () {
          if (!entry.ref.framelabel) { frameLabelEl.textContent = ''; }
        });
        frameLabelEl.addEventListener('blur', function () {
          layerLabelEditing = false;
          var text = frameLabelEl.textContent.trim();
          entry.ref.framelabel = text;
          if (!text) { frameLabelEl.textContent = S.emptyframe; }
          callAjax('mod_pinnwand_set_frame_label', { cmid: cfg.cmid, itemid: entry.ref.id, framelabel: text });
        });
        row.appendChild(frameLabelEl);
      }

      row.addEventListener('dragstart', function () { dragFromIdx = idx; row.classList.add('dragging'); });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
      row.addEventListener('dragover', function (ev) { ev.preventDefault(); });
      row.addEventListener('drop', function (ev) {
        ev.preventDefault();
        if (dragFromIdx === null || dragFromIdx === idx) { return; }
        var draggedKey = items[dragFromIdx].kind + ':' + items[dragFromIdx].ref.id;
        var targetKey = key;
        // Gehört das gezogene Element zu einer bestehenden Mehrfachauswahl,
        // wird der GANZE Block gemeinsam verschoben - die interne
        // Reihenfolge der ausgewählten Elemente untereinander bleibt dabei
        // unverändert, nur ihre Position in der Gesamtliste ändert sich.
        var blockKeys = (state.multiSelect.indexOf(draggedKey) !== -1 && state.multiSelect.length > 1)
          ? items.filter(function (it) { return state.multiSelect.indexOf(it.kind + ':' + it.ref.id) !== -1; })
          : [items[dragFromIdx]];
        var blockKeySet = {};
        blockKeys.forEach(function (it) { blockKeySet[it.kind + ':' + it.ref.id] = true; });
        var rest = items.filter(function (it) { return !blockKeySet[it.kind + ':' + it.ref.id]; });
        var targetPos = rest.findIndex(function (it) { return (it.kind + ':' + it.ref.id) === targetKey; });
        if (targetPos === -1) { targetPos = rest.length; }
        rest.splice(targetPos, 0, blockKeys[0]);
        rest.splice.apply(rest, [targetPos + 1, 0].concat(blockKeys.slice(1)));
        items = rest;
        dragFromIdx = null;
        // Oben in der Liste = vorne -> höchstes z zuerst vergeben.
        var total = items.length;
        items.forEach(function (it2, i) {
          it2.z = total - i;
          if (it2.kind === 'photo') {
            var p = it2.ref;
            p.canvasz = it2.z;
            callAjax('mod_pinnwand_update_layout', {
              cmid: cfg.cmid, photoid: p.id, x: p.canvasx, y: p.canvasy, w: p.canvasw,
              rot: p.canvasrot || 0, z: p.canvasz, boardid: p.boardid || 0
            });
          } else {
            var fr = it2.ref;
            fr.framez = it2.z;
            callAjax('mod_pinnwand_update_thread_frame', {
              cmid: cfg.cmid, itemid: fr.id, framex: fr.framex, framey: fr.framey,
              framew: fr.framew, frameh: fr.frameh, framerot: fr.framerot || 0, framez: fr.framez
            });
          }
        });
        render();
      });
      list.appendChild(row);
    });
    panel.appendChild(list);
    return panel;
  }

  // ------------------------------------------------------------------
  // ROTER FADEN: Seitenpanel mit den Stationen des eigenen Fadens
  // (Fotos + Leerrahmen), per Drag umsortierbar, plus - falls vorhanden -
  // schreibgeschützte Ansicht des Fadens der Lehrkraft.
  // ------------------------------------------------------------------
  // Markiert ein Objekt (Foto oder Rahmen) als "aktiv" - wird in allen
  // offenen Seitenleisten (Faden, Schichtung) UND direkt auf dem Board
  // hervorgehoben (siehe renderArrange/renderLayerPanel/renderThreadList).
  function selectItem(key) {
    state.selectedItemKey = (state.selectedItemKey === key) ? null : key;
    render();
  }

  // Öffnet die Präsentation direkt an der Station eines bestimmten Objekts
  // (Doppelklick auf ein Foto/Rahmen im Layer- oder Faden-Modus) - nur
  // möglich, wenn das Objekt tatsächlich Teil des eigenen Fadens ist.
  function openPresentationAtItem(kind, id) {
    var own = ownThread();
    if (!own || !own.items.length) { return false; }
    // Index bezieht sich auf die nach dem aktuellen Board gefilterte Liste
    // (dieselbe Filterung wie in openPresentation), da ein Doppelklick auf
    // dem Board immer ein Objekt DES gerade angezeigten Boards trifft.
    var boardItems = own.items.filter(function (it) { return (it.boardid || 0) === state.currentBoard; });
    var idx = -1;
    for (var i = 0; i < boardItems.length; i++) {
      var it = boardItems[i];
      if (kind === 'photo' && it.itemtype === 'photo' && it.photoid === id) { idx = i; break; }
      if (kind === 'frame' && it.itemtype === 'frame' && it.id === id) { idx = i; break; }
    }
    if (idx === -1) { return false; }
    return openPresentation(own, idx);
  }

  function ownThread() {
    for (var i = 0; i < state.threads.length; i++) { if (state.threads[i].isown) { return state.threads[i]; } }
    return null;
  }
  function sharedThread() {
    for (var i = 0; i < state.threads.length; i++) { if (!state.threads[i].isown) { return state.threads[i]; } }
    return null;
  }
  // Ersetzt den eigenen Faden nach einer add_thread_item-Antwort - bewahrt
  // dabei bgmoves/linewidth (die add_thread_item selbst nicht zurückgibt),
  // damit diese Einstellungen nicht bei jedem Hinzufügen verloren gehen.
  function replaceOwnThread(res) {
    var prevOwn = ownThread();
    state.threads = state.threads.filter(function (t) { return !t.isown; });
    state.threads.push({
      id: res.threadid, color: res.color,
      bgmoves: prevOwn ? prevOwn.bgmoves : false,
      linewidth: prevOwn ? prevOwn.linewidth : 3,
      isown: true, items: res.items
    });
  }

  function threadItemLabel(item) {
    if (item.itemtype === 'overview') { return S.addoverview; }
    if (item.itemtype === 'frame') { return item.framelabel || S.emptyframe; }
    var p = null;
    for (var i = 0; i < state.photos.length; i++) { if (state.photos[i].id === item.photoid) { p = state.photos[i]; break; } }
    return p ? (p.sourcetitle || itemCaptionText(p)) : '';
  }

  function renderThreadList(thread, editable) {
    var list = el('div', { class: 'ic-thread-list' });
    if (!thread || thread.items.length === 0) {
      list.appendChild(el('p', { class: 'ic-hint' }, [S.threads_empty]));
      return list;
    }
    var dragFromIdx = null;
    thread.items.forEach(function (item, idx) {
      var itemKey = item.itemtype === 'photo' ? 'photo:' + item.photoid
        : item.itemtype === 'frame' ? 'frame:' + item.id : null;
      var row = el('div', {
        class: 'ic-thread-item' + (itemKey && state.selectedItemKey === itemKey ? ' selected' : '') +
          (itemKey && state.multiSelect.indexOf(itemKey) !== -1 ? ' multi-selected' : ''),
        draggable: editable ? 'true' : null
      });
      if (itemKey) {
        row.addEventListener('click', function (ev) {
          if (ev.ctrlKey || ev.metaKey || state.multiSelectAddMode) { toggleMultiSelectGlobal(itemKey); return; }
          // Kurzer Klick (kein Ziehen - ein echter Drag löst kein click-Event
          // aus) springt im eigenen, bearbeitbaren Faden direkt zu dieser
          // Station in der Präsentation.
          if (editable && item.itemtype !== 'overview' && openPresentationAtItem(item.itemtype, item.itemtype === 'photo' ? item.photoid : item.id)) {
            return;
          }
          selectItem(itemKey);
        });
      }
      var photo = item.itemtype === 'photo'
        ? state.photos.filter(function (p) { return p.id === item.photoid; })[0] : null;
      if (photo) {
        row.appendChild(el('img', { src: photo.url, alt: '' }));
      } else {
        row.appendChild(el('div', { class: 'ic-thread-frame-thumb' }, [item.itemtype === 'overview' ? '\u26f6' : '\u2b1a']));
      }
      if (editable && item.itemtype === 'frame') {
        var frameLabelEl2 = el('span', {
          class: 'ic-thread-item-label ic-thread-item-label-editable', contenteditable: 'true'
        }, [item.framelabel || String(idx + 1)]);
        // Bearbeiten per Doppelklick (nicht einfacher Klick) - ein
        // einfacher Klick auf den Text soll normal zur Zeile durchgereicht
        // werden und in die Präsentation springen (siehe row-Klick-Handler
        // oben), statt das Bearbeiten zu blockieren.
        var frameLabelEditing = false;
        frameLabelEl2.addEventListener('mousedown', function (ev) { if (!frameLabelEditing) { ev.preventDefault(); } });
        frameLabelEl2.addEventListener('dblclick', function (ev) {
          ev.stopPropagation();
          frameLabelEditing = true;
          frameLabelEl2.focus();
          var range = document.createRange();
          range.selectNodeContents(frameLabelEl2);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        frameLabelEl2.addEventListener('focus', function () {
          if (!item.framelabel) { frameLabelEl2.textContent = ''; }
        });
        frameLabelEl2.addEventListener('blur', function () {
          frameLabelEditing = false;
          var text = frameLabelEl2.textContent.trim();
          item.framelabel = text;
          if (!text) { frameLabelEl2.textContent = String(idx + 1); }
          callAjax('mod_pinnwand_set_frame_label', { cmid: cfg.cmid, itemid: item.id, framelabel: text });
        });
        row.appendChild(frameLabelEl2);
      } else {
        row.appendChild(el('span', { class: 'ic-thread-item-label' }, [threadItemLabel(item)]));
      }
      if (editable) {
        var rm = el('button', { class: 'ic-thread-remove', title: S.removefromthread }, ['\u2715']);
        rm.addEventListener('click', function (ev) {
          ev.stopPropagation();
          callAjax('mod_pinnwand_remove_thread_item', { cmid: cfg.cmid, itemid: item.id }).then(function () {
            thread.items.splice(idx, 1);
            render();
          });
        });
        row.appendChild(rm);

        row.addEventListener('dragstart', function () { dragFromIdx = idx; row.classList.add('dragging'); });
        row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
        row.addEventListener('dragover', function (ev) { ev.preventDefault(); });
        row.addEventListener('drop', function (ev) {
          ev.preventDefault();
          if (dragFromIdx === null || dragFromIdx === idx) { return; }
          var draggedItem = thread.items[dragFromIdx];
          var draggedKey = draggedItem.itemtype === 'photo' ? 'photo:' + draggedItem.photoid : 'frame:' + draggedItem.id;
          // Gehört das gezogene Element zu einer bestehenden Mehrfachauswahl,
          // wird der ganze Block gemeinsam verschoben - die interne
          // Reihenfolge der ausgewählten Elemente untereinander bleibt dabei
          // unverändert.
          var blockItems = (state.multiSelect.indexOf(draggedKey) !== -1 && state.multiSelect.length > 1)
            ? thread.items.filter(function (it) {
                var k = it.itemtype === 'photo' ? 'photo:' + it.photoid : 'frame:' + it.id;
                return state.multiSelect.indexOf(k) !== -1;
              })
            : [draggedItem];
          var blockIdSet = {};
          blockItems.forEach(function (it) { blockIdSet[it.id] = true; });
          var rest = thread.items.filter(function (it) { return !blockIdSet[it.id]; });
          var targetPos = rest.indexOf(item);
          if (targetPos === -1) { targetPos = rest.length; }
          rest.splice(targetPos, 0, blockItems[0]);
          rest.splice.apply(rest, [targetPos + 1, 0].concat(blockItems.slice(1)));
          thread.items = rest;
          dragFromIdx = null;
          callAjax('mod_pinnwand_reorder_thread_items', {
            cmid: cfg.cmid, itemids: thread.items.map(function (it) { return it.id; })
          });
          render();
        });
      }
      list.appendChild(row);
    });
    return list;
  }

  // Zeigt ALLE auf dem aktuellen Board platzierten Fotos mit einem
  // Umschalter "im Faden" - plus Filter (alle/mit Faden/ohne Faden). Damit
  // lässt sich der Faden direkt aus der Gesamtübersicht der Pinnwand heraus
  // zusammenstellen, statt nur einzeln über den Board-Button pro Foto.
  function renderThreadObjectList(own) {
    var wrap = el('div', { class: 'ic-thread-objects' });

    var inThreadIds = {};
    if (own) {
      own.items.forEach(function (it) { if (it.itemtype === 'photo') { inThreadIds[it.photoid] = it.id; } });
    }
    var boardPhotos = state.photos.filter(function (p) {
      return !p.hiddenfromboard && p.boardplaced && (p.boardid || 0) === state.currentBoard;
    });
    // Nur die noch nicht im Faden enthaltenen ("nicht in Präsentation")
    // Objekte anzeigen - kein Filter, kein separater Titel nötig.
    var visible = boardPhotos.filter(function (p) { return !inThreadIds[p.id]; });

    var list = el('div', { class: 'ic-thread-list' });
    if (visible.length === 0) {
      list.appendChild(el('p', { class: 'ic-hint' }, [S.thread_objects_empty]));
    }
    visible.forEach(function (p) {
      var key = 'photo:' + p.id;
      var row = el('div', { class: 'ic-thread-item' + (state.selectedItemKey === key ? ' selected' : '') });
      row.addEventListener('click', function (ev) {
        if (ev.target.closest('.ic-me-check')) { return; }
        selectItem(key);
      });
      row.appendChild(el('img', { src: p.url, alt: '' }));
      row.appendChild(el('span', { class: 'ic-thread-item-label' }, [p.sourcetitle || itemCaptionText(p)]));
      var toggle = el('label', { class: 'ic-me-check', title: S.not_in_presentation });
      var check = el('input', { type: 'checkbox' });
      check.checked = false;
      check.addEventListener('change', function () {
        callAjax('mod_pinnwand_add_thread_item', {
          cmid: cfg.cmid, itemtype: 'photo', photoid: p.id, boardid: state.currentBoard
        }).then(function (res) {
          replaceOwnThread(res);
          render();
        });
      });
      toggle.appendChild(check);
      row.appendChild(toggle);
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderThreadPanel() {
    var panel = el('div', { class: 'ic-thread-panel' });
    attachSidebarResize(panel);
    var own = ownThread();
    var shared = sharedThread();

    // 1. Gewählt: Präsentieren-Button + die Stationen-Liste des eigenen Fadens.
    if (own && own.items.length > 0) {
      var presentBtn = el('button', {
        class: 'ic-btn ic-thread-present-btn', style: 'background:' + (own.color || '#e0503f') + ';color:#fff'
      }, [S.presentthread]);
      presentBtn.addEventListener('click', function () { openPresentation(own); });
      panel.appendChild(presentBtn);
    }
    panel.appendChild(renderThreadList(own, true));

    if (state.canusethreads) {
      // 2. Rahmen + Überblick hinzufügen in einer Zeile.
      var actions = el('div', { class: 'ic-thread-actions' });
      var addFrameBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.addframetothread]);
      addFrameBtn.addEventListener('click', function () {
        // Kein prompt()-Dialog mehr - der kann in eingebetteten Kontexten
        // blockiert sein/werfen und dadurch die Rahmen-Erstellung komplett
        // verhindern. Rahmen wird sofort ohne Titel angelegt; ein Titel
        // lässt sich danach jederzeit hier im Panel oder direkt am Rahmen
        // auf dem Board vergeben (siehe contenteditable-Beschriftung).
        callAjax('mod_pinnwand_add_thread_item', {
          cmid: cfg.cmid, itemtype: 'frame', boardid: state.currentBoard,
          framex: 40, framey: 40, framew: 240, frameh: 180, framelabel: ''
        }).then(function (res) {
          replaceOwnThread(res);
          render();
        });
      });
      actions.appendChild(addFrameBtn);
      var addOverviewBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.addoverview]);
      addOverviewBtn.addEventListener('click', function () {
        callAjax('mod_pinnwand_add_thread_item', {
          cmid: cfg.cmid, itemtype: 'overview', boardid: state.currentBoard
        }).then(function (res) {
          replaceOwnThread(res);
          render();
        });
      });
      actions.appendChild(addOverviewBtn);
      panel.appendChild(actions);

      // 3. Hintergrund + Fadenfarbe/-dicke - Überschrift über dem Regler
      // statt daneben, damit die Zeile selbst schmaler bleibt.
      var bgLabel = el('label', { class: 'ic-me-check', style: 'margin:10px 0' });
      var bgCheck = el('input', { type: 'checkbox' });
      bgCheck.checked = !!(own && own.bgmoves);
      bgCheck.addEventListener('change', function () {
        if (own) { own.bgmoves = bgCheck.checked; }
        callAjax('mod_pinnwand_set_thread_bgmoves', { cmid: cfg.cmid, bgmoves: bgCheck.checked });
      });
      bgLabel.appendChild(bgCheck);
      bgLabel.appendChild(document.createTextNode(S.bgmoves_with_zoom));
      panel.appendChild(bgLabel);

      var styleBox = el('div', { class: 'ic-thread-style' });
      styleBox.appendChild(el('h3', { class: 'ic-thread-panel-subtitle' }, [S.threadstyle]));
      var styleRow = el('div', { class: 'ic-textframe-edit' });
      var colorInput = el('input', { type: 'color', value: (own && own.color) || '#e0503f', class: 'ic-textframe-custom-color' });
      var widthInput = el('input', { type: 'range', min: '1', max: '12', step: '0.5', value: String((own && own.linewidth) || 3) });
      function persistThreadStyle() {
        var color = colorInput.value, width = parseFloat(widthInput.value);
        if (own) { own.color = color; own.linewidth = width; }
        callAjax('mod_pinnwand_set_thread_style', { cmid: cfg.cmid, color: color, linewidth: width });
      }
      var styleDebounce = null;
      function persistThreadStyleDebounced() {
        if (styleDebounce) { clearTimeout(styleDebounce); }
        styleDebounce = setTimeout(persistThreadStyle, 400);
      }
      colorInput.addEventListener('input', function () {
        if (own) { own.color = colorInput.value; }
        persistThreadStyleDebounced();
      });
      colorInput.addEventListener('change', function () { persistThreadStyle(); render(); });
      widthInput.addEventListener('input', function () {
        if (own) { own.linewidth = parseFloat(widthInput.value); }
        persistThreadStyleDebounced();
      });
      widthInput.addEventListener('change', function () { persistThreadStyle(); render(); });
      // Überschrift "Fadenfarbe/-dicke" (S.threadwidth) über den Regler statt
      // in derselben Zeile - die Zeile selbst enthält dadurch nur noch
      // Farbwähler + Regler und bleibt schmaler.
      styleBox.appendChild(el('div', { class: 'ic-textframe-label', style: 'margin-bottom:4px' }, [S.threadwidth]));
      styleRow.appendChild(colorInput);
      styleRow.appendChild(widthInput);
      styleBox.appendChild(styleRow);
      panel.appendChild(styleBox);

      // 4. Die noch nicht gewählten Objekte (nicht im Faden enthalten).
      panel.appendChild(renderThreadObjectList(own));

      // Faden komplett löschen - separat am Ende.
      if (own && own.items.length > 0) {
        var delBtn = el('button', { class: 'ic-btn ic-btn-danger', style: 'margin-top:10px' }, [S.deletethread]);
        delBtn.addEventListener('click', function () {
          if (confirm(S.confirmdeletethread)) {
            callAjax('mod_pinnwand_delete_thread', { cmid: cfg.cmid }).then(function () {
              state.threads = state.threads.filter(function (t) { return !t.isown; });
              render();
            });
          }
        });
        panel.appendChild(delBtn);
      }
    }

    if (shared) {
      panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.teacherthread]));
      if (shared.items.length > 0) {
        var presentSharedBtn = el('button', {
          class: 'ic-btn ic-thread-present-btn', style: 'background:' + (shared.color || '#e0231f') + ';color:#fff'
        }, [S.presentthread]);
        presentSharedBtn.addEventListener('click', function () { openPresentation(shared); });
        panel.appendChild(presentSharedBtn);
      }
      panel.appendChild(renderThreadList(shared, false));
    }

    return panel;
  }

  function openPresentation(thread, startIndex) {
    if (window.innerWidth < 900) { alert(S.present_smallscreen); return false; }
    var overlay = el('div', { class: 'ic-present-overlay' });
    var stageEl = el('div', { class: 'ic-present-stage' });
    var bgLayer = el('div', { class: 'ic-present-bg' + (thread.bgmoves ? ' ic-present-bg-moves' : '') });
    applyBackground(bgLayer);
    // Die gewählte Hintergrundfarbe zusätzlich aufs Overlay selbst legen,
    // damit sie in jedem Fall sichtbar bleibt (z.B. wenn "Füllen" einen
    // Rand lässt oder beim Herauszoomen der 1400x1000-Bereich nicht die
    // ganze Bildschirmfläche ausfüllt) - sonst zeigte sich dort die feste
    // dunkle Overlay-Farbe statt der gewählten Hintergrundfarbe.
    overlay.style.backgroundColor = (state.background && state.background.color) || '#2b2d33';
    var canvasEl = el('div', { class: 'ic-present-canvas' });
    // Hintergrund bewegt sich beim Zoom mit (Checkbox im Faden-Panel): Teil
    // der gezoomten Leinwand, exakt 1400x1000 - dasselbe Koordinatensystem
    // wie Fotos/Rahmen (siehe .ic-canvas-bg auf der echten Pinnwand) - so
    // zeigen Rahmen zuverlässig auf dieselbe Stelle im Hintergrundbild wie
    // beim Einrichten auf dem Board. Sonst (Standard) eine eigenständige,
    // bildschirmfüllende Ebene dahinter - Maße explizit per JS gesetzt statt
    // über eine CSS-Vererbungskette, um jede Mehrdeutigkeit auszuschließen.
    if (thread.bgmoves) {
      canvasEl.appendChild(bgLayer);
    } else {
      bgLayer.style.left = '0'; bgLayer.style.top = '0';
      bgLayer.style.width = window.innerWidth + 'px';
      bgLayer.style.height = window.innerHeight + 'px';
      stageEl.appendChild(bgLayer);
    }
    stageEl.appendChild(canvasEl);
    overlay.appendChild(stageEl);

    // Alle Stationen müssen vom selben Board stammen, um gemeinsam
    // dargestellt zu werden. Beim eigenen Faden ist das Referenz-Board das
    // gerade angezeigte Board (nicht mehr das Board der allerersten
    // jemals hinzugefügten Station - das führte dazu, dass neu
    // hinzugefügte Stationen auf einem anderen Board unsichtbar aus der
    // Präsentation herausfielen, obwohl sie im Faden-Panel - das alle
    // Boards ungefiltert zeigt - ganz normal erschienen). Bei einem
    // FREMDEN (geteilten) Faden hat state.currentBoard keine Bedeutung
    // für dessen Board-Nummernschema - dort bleibt die Station der
    // ersten Station die Referenz.
    var firstBoardId = thread.isown
      ? (state.currentBoard || 0)
      : (thread.items.length ? (thread.items[0].boardid || 0) : 0);

    // Alle auf diesem Board platzierten Fotos zeigen (nicht nur die des
    // Fadens) - Textrahmen (Wortfeld) sind technisch auch nur Fotos und
    // erscheinen dadurch automatisch mit. Ein Klick auf ein noch nicht im
    // Faden enthaltenes Foto hängt es direkt ans Ende des Fadens an.
    var boardPhotos = state.photos.filter(function (p) {
      return !p.hiddenfromboard && p.boardplaced && (p.boardid || 0) === firstBoardId;
    });
    var photoRecs = {};
    var inThreadIds = {};
    thread.items.forEach(function (it) { if (it.itemtype === 'photo') { inThreadIds[it.photoid] = true; } });
    boardPhotos.forEach(function (p) {
      var pEl = el('div', {
        class: 'ic-present-photo',
        style: 'left:' + p.canvasx + 'px;top:' + p.canvasy + 'px;width:' + p.canvasw + 'px;' +
          'transform:rotate(' + (p.canvasrot || 0) + 'deg)'
      });
      pEl.style.zIndex = p.canvasz || 0;
      pEl.appendChild(el('img', { src: p.url, alt: '' }));
      if (!inThreadIds[p.id]) {
        pEl.classList.add('ic-present-addable');
        pEl.title = S.stream_pin_hint;
        pEl.addEventListener('click', function () {
          callAjax('mod_pinnwand_add_thread_item', {
            cmid: cfg.cmid, itemtype: 'photo', photoid: p.id, boardid: firstBoardId
          }).then(function (res) {
            var newItem = res.items[res.items.length - 1];
            thread.items.push(newItem);
            inThreadIds[p.id] = true;
            pEl.classList.remove('ic-present-addable');
            steps.push(buildStep(newItem));
            goToStep(steps.length - 1);
          });
        });
      }
      canvasEl.appendChild(pEl);
      photoRecs[p.id] = { el: pEl, z: p.canvasz || 0 };
    });

    // Stylus-Anmerkungen des Boards - über den Fotos, damit Linien auch
    // über Objekte hinweg gemalt sichtbar bleiben (nicht von der
    // Occlusion-Logik betroffen, da sie kein "photoRecs"-Eintrag sind).
    var presentInkCanvas = el('canvas', {
      class: 'ic-board-ink-layer', width: String(BOARD_W), height: String(BOARD_H), style: 'z-index:600'
    });
    canvasEl.appendChild(presentInkCanvas);
    callAjax('mod_pinnwand_get_board_ink', { cmid: cfg.cmid, boardid: firstBoardId }).then(function (res) {
      var strokes = [];
      try { strokes = JSON.parse(res.strokedata || '[]'); } catch (e) { strokes = []; }
      redrawInk(presentInkCanvas, presentInkCanvas.getContext('2d'), strokes);
    });

    // Für jede Station (Foto oder Leerrahmen) Zielposition/-größe merken -
    // Kamera-Transformation wird komplett selbst berechnet (siehe goToStep),
    // ohne uns auf interne Skalierungs-Mechanik einer Bibliothek zu
    // verlassen.
    function buildStep(it) {
      if (it.itemtype === 'overview') {
        // Kein sichtbares Element nötig - reiner Kamera-Haltepunkt, der auf
        // das ganze Board zoomt (Überblick, siehe "Überblick einfügen").
        return { el: null, cx: BOARD_W / 2, cy: BOARD_H / 2, w: BOARD_W, h: BOARD_H, rot: 0, overview: true };
      }
      if (it.itemtype === 'frame') {
        // Unsichtbar in der Präsentation - dient nur als Zoom-Ziel, damit
        // auf Details des Hintergrunds/anderer Objekte hingewiesen werden
        // kann, ohne selbst als Kasten sichtbar zu sein. Ist der Rahmen
        // gedreht, dreht sich die Kamera beim Anfliegen mit.
        var fEl = el('div', {
          class: 'ic-present-step-frame',
          style: 'left:' + it.framex + 'px;top:' + it.framey + 'px;width:' + it.framew + 'px;height:' + it.frameh + 'px;'
        });
        canvasEl.appendChild(fEl);
        return {
          el: fEl, cx: it.framex + it.framew / 2, cy: it.framey + it.frameh / 2,
          // Die Kamera muss der Rahmen-Drehung ENTGEGENGESETZT drehen, damit
          // der eingerahmte Bereich am Ende gerade (nicht schief) erscheint -
          // sonst würde sich die Neigung verdoppeln statt aufgehoben zu werden.
          w: it.framew, h: it.frameh, rot: -(it.framerot || 0), z: it.framez || 0, frame: true
        };
      }
      var rec = photoRecs[it.photoid];
      if (!rec) { return null; }
      var natW = parseFloat(rec.el.style.width) || 200;
      var img = rec.el.querySelector('img');
      // Echtes Seitenverhältnis, sobald das Bild geladen ist - bis dahin
      // eine grobe Näherung (4:3), damit der erste Zoom nicht völlig daneben
      // liegt.
      var natH = (img.naturalWidth && img.naturalHeight) ? natW * (img.naturalHeight / img.naturalWidth) : natW * 0.75;
      var stepData = {
        el: rec.el,
        cx: parseFloat(rec.el.style.left) + natW / 2,
        cy: parseFloat(rec.el.style.top) + natH / 2,
        w: natW, h: natH, z: rec.z, rot: 0
      };
      if (!img.complete) {
        img.addEventListener('load', function () {
          stepData.h = natW * (img.naturalHeight / img.naturalWidth);
          if (steps[currentIdx] === stepData) { goToStep(currentIdx, true); }
        });
      }
      return stepData;
    }

    var steps = thread.items
      .filter(function (it) { return (it.boardid || 0) === firstBoardId; })
      .map(buildStep)
      .filter(Boolean);

    function targetFor(s) {
      return {
        scale: Math.min(window.innerWidth / s.w, window.innerHeight / s.h),
        cx: s.cx, cy: s.cy, rot: s.rot || 0
      };
    }

    function applyTransform(scale, cx, cy, rot) {
      // Die Kamera-Transformation ist translate(tx,ty) rotate(rot) scale(scale)
      // mit transform-origin 0 0 - das bedeutet, cx/cy müssen VOR der
      // Verschiebungsberechnung ebenfalls um "rot" gedreht werden, sonst
      // landet der Zielpunkt bei gedrehten Rahmen nicht in der Bildschirm-
      // mitte (bei rot=0 war der Fehler unsichtbar, da cos(0)=1/sin(0)=0).
      var rad = (rot || 0) * Math.PI / 180;
      var rx = cx * Math.cos(rad) - cy * Math.sin(rad);
      var ry = cx * Math.sin(rad) + cy * Math.cos(rad);
      var tx = window.innerWidth / 2 - scale * rx;
      var ty = window.innerHeight / 2 - scale * ry;
      canvasEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) rotate(' + (rot || 0) + 'deg) scale(' + scale + ')';
    }

    // Easing für den Zeitverlauf selbst (nicht die Bogenhöhe!) - langsamer,
    // schwungvoller Start, gleichmäßige Mitte, sanfte Landung.
    function easeInOutCubic(x) {
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    var cameraFrame = null;

    // Eine einzige durchgehende Animation von "from" nach "to" - kein
    // zweigeteilter Übergang mit Pause dazwischen mehr. Bei kurzen Wegen
    // ("elastisches Gleiten") bleibt die Zoom-Kurve nahezu gerade; bei
    // weiten Wegen wölbt sie sich wie eine Parabel nach oben (kurzzeitig
    // stärker herauszoomen, um einen Überblick über die Strecke zu geben),
    // bevor sie zur Zielstation landet. Die Bogenhöhe folgt sin(t·π), damit
    // sie am Anfang UND Ende sanft bei 0 ist (keine Ecke), unabhängig von
    // der Zeit-Easing-Funktion, die den Bewegungsablauf selbst gestaltet.
    function animateCamera(from, to, onDone) {
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
      var dist = Math.sqrt(Math.pow(to.cx - from.cx, 2) + Math.pow(to.cy - from.cy, 2));
      var duration = Math.min(2400, Math.max(500, 550 + dist * 0.55));
      // 0 bei sehr kurzen Wegen (reines elastisches Gleiten) bis 0.55 bei
      // sehr weiten Wegen (deutlicher Bogen/Sprung).
      var hopFactor = Math.min(0.55, Math.max(0, (dist - 120) / 1800));
      var minScale = Math.min(from.scale, to.scale);
      var hopAmount = minScale * hopFactor;
      var rotDelta = (to.rot - from.rot + 540) % 360 - 180; // kürzester Drehweg

      var start = null;
      function frame(now) {
        if (start === null) { start = now; }
        var raw = Math.min(1, (now - start) / duration);
        var te = easeInOutCubic(raw);
        var arc = Math.sin(te * Math.PI) * hopAmount;
        var scale = from.scale + (to.scale - from.scale) * te - arc;
        var cx = from.cx + (to.cx - from.cx) * te;
        var cy = from.cy + (to.cy - from.cy) * te;
        var rot = from.rot + rotDelta * te;
        applyTransform(scale, cx, cy, rot);
        if (raw < 1) {
          cameraFrame = requestAnimationFrame(frame);
        } else {
          cameraFrame = null;
          if (onDone) { onDone(); }
        }
      }
      cameraFrame = requestAnimationFrame(frame);
    }

    var currentIdx = 0;
    var currentTransform = null; // { scale, cx, cy, rot } - letzter tatsächlich erreichter Zustand

    // Manuelles Zoomen/Verschieben während der Präsentation (Mausrad, Ziehen
    // auf leerer Fläche, Pinch) - aktualisiert currentTransform direkt, damit
    // der nächste Vorwärts-/Zurück-Schritt von der manuell angepassten
    // Ansicht aus normal fortsetzt, statt zur automatischen Position
    // zurückzuspringen.
    function manualZoomAt(newScale, clientX, clientY) {
      if (!currentTransform) { return; }
      newScale = Math.max(0.05, Math.min(8, newScale));
      var rad = (currentTransform.rot || 0) * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      var dx = clientX - window.innerWidth / 2, dy = clientY - window.innerHeight / 2;
      // Bildschirm-Versatz -> Welt-Versatz: inverse Rotation (R(-rot)) anwenden,
      // da die Kamera selbst um "rot" gedreht ist (siehe applyTransform).
      var wx = currentTransform.cx + (dx * cos + dy * sin) / currentTransform.scale;
      var wy = currentTransform.cy + (-dx * sin + dy * cos) / currentTransform.scale;
      currentTransform.scale = newScale;
      currentTransform.cx = wx - (dx * cos + dy * sin) / newScale;
      currentTransform.cy = wy - (-dx * sin + dy * cos) / newScale;
      applyTransform(currentTransform.scale, currentTransform.cx, currentTransform.cy, currentTransform.rot);
    }
    var presentPanDragging = false, presentPanStartX = 0, presentPanStartY = 0, presentPanStartCx = 0, presentPanStartCy = 0;
    stageEl.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.ic-present-close, .ic-present-nav') || !currentTransform) { return; }
      presentPanDragging = true;
      presentPanStartX = ev.clientX; presentPanStartY = ev.clientY;
      presentPanStartCx = currentTransform.cx; presentPanStartCy = currentTransform.cy;
    });
    stageEl.addEventListener('pointermove', function (ev) {
      if (!presentPanDragging || !currentTransform) { return; }
      var scale = currentTransform.scale;
      var rad = (currentTransform.rot || 0) * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      var dx = ev.clientX - presentPanStartX, dy = ev.clientY - presentPanStartY;
      // Bildschirm-Versatz -> Welt-Versatz: inverse Rotation (R(-rot))
      // anwenden, da die Kamera selbst um "rot" gedreht ist.
      currentTransform.cx = presentPanStartCx - (dx * cos + dy * sin) / scale;
      currentTransform.cy = presentPanStartCy - (-dx * sin + dy * cos) / scale;
      applyTransform(currentTransform.scale, currentTransform.cx, currentTransform.cy, currentTransform.rot);
    });
    window.addEventListener('pointerup', function () { presentPanDragging = false; });
    stageEl.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      manualZoomAt((currentTransform ? currentTransform.scale : 1) * factor, ev.clientX, ev.clientY);
    }, { passive: false });
    var presentPinchDist = 0, presentPinchScale = 1, presentPinchMidX = 0, presentPinchMidY = 0;
    function presentTouchDist(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    stageEl.addEventListener('touchstart', function (ev) {
      if (ev.touches.length === 2 && currentTransform) {
        presentPanDragging = false;
        presentPinchDist = presentTouchDist(ev.touches) || 1;
        presentPinchScale = currentTransform.scale;
        presentPinchMidX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2;
        presentPinchMidY = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
      }
    }, { passive: true });
    stageEl.addEventListener('touchmove', function (ev) {
      if (ev.touches.length !== 2) { return; }
      ev.preventDefault();
      var dist = presentTouchDist(ev.touches) || 1;
      manualZoomAt(presentPinchScale * (dist / presentPinchDist), presentPinchMidX, presentPinchMidY);
    }, { passive: false });

    function goToStep(idx, skipTransition) {
      var fromIdx = currentIdx;
      currentIdx = Math.max(0, Math.min(steps.length - 1, idx));
      var s = steps[currentIdx];
      if (!s) { return; }
      var target = targetFor(s);

      // Das neue Ziel zuerst schnell einblenden (falls es zuvor wegen
      // einer höheren Z-Ebene ausgeblendet war), DANN erst die Kamera
      // dorthin schwenken - sorgt für Orientierung, da das Objekt beim
      // Ankommen der Kamera schon sichtbar ist statt erst danach
      // "aufzutauchen".
      updateOcclusion();

      if (skipTransition || fromIdx === currentIdx || !currentTransform) {
        if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
        applyTransform(target.scale, target.cx, target.cy, target.rot);
        currentTransform = target;
        return;
      }

      animateCamera(currentTransform, target, function () {
        currentTransform = target;
      });
      currentTransform = target;
    }

    // Occlusion: nur Fotos, die die aktive Station vom Z-Level her
    // überlappend verdecken würden, werden ausgeblendet - alle anderen
    // (auch Hintergrund und nicht überlappende Fotos) bleiben sichtbar.
    function updateOcclusion() {
      var active = steps[currentIdx];
      if (!active || active.overview) {
        // Überblick (reiner Kamera-Haltepunkt ohne eigenes Element, zoomt
        // aufs ganze Board) - hier ergibt eine Verdeckung nach Z keinen
        // Sinn, alles bleibt sichtbar.
        Object.keys(photoRecs).forEach(function (pid) { photoRecs[pid].el.classList.remove('ic-present-occluded'); });
        return;
      }
      var activeZ = active.z || 0;
      // Alle Objekte mit höherem Z-Wert als das fokussierte Objekt/den
      // fokussierten Rahmen werden ausgeblendet - unabhängig von
      // räumlicher Überlappung. Gilt jetzt auch, wenn ein Rahmen (nicht
      // nur ein Foto) der aktuelle Schritt ist (siehe z bei buildStep).
      Object.keys(photoRecs).forEach(function (pid) {
        var rec = photoRecs[pid];
        if (rec.el === active.el) { rec.el.classList.remove('ic-present-occluded'); return; }
        rec.el.classList.toggle('ic-present-occluded', rec.z > activeZ);
      });
    }

    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-present-close', title: S.exitpresent }, ['\u2715']);
    var prevBtn = el('button', { class: 'ic-btn ic-present-nav ic-present-prev' }, ['\u2039']);
    var nextBtn = el('button', { class: 'ic-btn ic-present-nav ic-present-next' }, ['\u203A']);
    prevBtn.addEventListener('click', function () { goToStep(currentIdx - 1); });
    nextBtn.addEventListener('click', function () {
      if (currentIdx >= steps.length - 1) {
        // Letzter Schritt: zur Board-Übersicht fliegen und danach die
        // Präsentation automatisch verlassen, statt einfach stehenzubleiben.
        var overviewTarget = { scale: Math.min(window.innerWidth / BOARD_W, window.innerHeight / BOARD_H), cx: BOARD_W / 2, cy: BOARD_H / 2, rot: 0 };
        animateCamera(currentTransform, overviewTarget, function () {
          setTimeout(function () { closeBtn.click(); }, 400);
        });
        currentTransform = overviewTarget;
        return;
      }
      goToStep(currentIdx + 1);
    });
    closeBtn.addEventListener('click', function () {
      document.removeEventListener('keydown', keyNav);
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); }
      overlay.remove();
    });
    function keyNav(ev) {
      if (ev.key === 'ArrowRight' || ev.key === ' ') { goToStep(currentIdx + 1); }
      else if (ev.key === 'ArrowLeft') { goToStep(currentIdx - 1); }
      else if (ev.key === 'Escape') { closeBtn.click(); }
    }
    document.addEventListener('keydown', keyNav);
    overlay._icKeyHandler = keyNav;

    overlay.appendChild(closeBtn);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    document.body.appendChild(overlay);

    if (steps.length > 0) {
      var initialIdx = (typeof startIndex === 'number' && steps[startIndex]) ? startIndex : 0;
      if (initialIdx > 0) {
        // Direkt-Vorschau eines einzelnen Objekts (Doppelklick im Layer-/
        // Faden-Modus) - sofort dorthin springen, kein Übersichts-Effekt.
        currentIdx = initialIdx;
        var direct = targetFor(steps[initialIdx]);
        applyTransform(direct.scale, direct.cx, direct.cy, direct.rot);
        currentTransform = direct;
        updateOcclusion();
      } else {
        // Beim Start zoomt die Kamera aus einer Übersicht in die erste
        // Station hinein, statt sofort scharf gestellt zu erscheinen -
        // dieselbe Flugbahn-Logik wie zwischen zwei Stationen.
        currentIdx = 0;
        var first = targetFor(steps[0]);
        var overview = { scale: first.scale * 0.3, cx: first.cx, cy: first.cy, rot: first.rot };
        applyTransform(overview.scale, overview.cx, overview.cy, overview.rot);
        currentTransform = overview;
        requestAnimationFrame(function () {
          animateCamera(overview, first, function () {
            currentTransform = first;
            updateOcclusion();
          });
          currentTransform = first;
        });
      }
    }
    return true;
  }

  // ==================================================================
  // KLASSENANSICHT: alle eingereichten Fotos, gruppiert und untereinander
  // pro Lernender/m angezeigt. Nur mit "Alle Einreichungen ansehen"-Recht
  // erreichbar. Löschen fremder Fotos nur mit Bereinigen-Recht (manage).
  // ==================================================================
  function renderModerate(body) {
    var wrap = el('div', { class: 'ic-moderate' });

    var sortMode = state.moderateSort || 'user';
    var sortDir = state.moderateSortDir || 1;
    var filterOwn = 0;   // 0=aus, 1=nur eigene (Lernender ist Autor*in), 2=nur andere
    var filterBoard = 0; // 0=aus, 1=nur auf Pinnwand, 2=nur nicht auf Pinnwand

    // Eine einzige, fixe Werkzeugleiste über der Liste: Zurück + Sortierung
    // + Filter. Icon+Text auf größeren Bildschirmen, nur Icon auf Mobil.
    var toolbar = el('div', { class: 'ic-moderate-toolbar' });

    function toolBtn(iconName, label) {
      var b = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-iconlabel' }, [icon(iconName), el('span', { class: 'ic-btn-label' }, [label])]);
      return b;
    }

    // Zurück-Navigation übernimmt jetzt der Schließen-Button in der
    // einheitlichen Kopfzeile (siehe render()).

    var sortOptions = [['user', 'person', S.sort_user], ['year', 'calendar', S.sort_year], ['upload', 'upload', S.sort_upload]];
    var sortButtons = {};
    sortOptions.forEach(function (opt) {
      var b = toolBtn(opt[1], opt[2]);
      var span = b.querySelector('.ic-btn-label');
      function refresh() {
        span.textContent = opt[2] + (sortMode === opt[0] ? (sortDir === 1 ? ' \u2191' : ' \u2193') : '');
        b.title = span.textContent;
        b.classList.toggle('active', sortMode === opt[0]);
      }
      b.addEventListener('click', function () {
        if (sortMode === opt[0]) { sortDir = sortDir * -1; } else { sortMode = opt[0]; sortDir = 1; }
        state.moderateSort = sortMode; state.moderateSortDir = sortDir;
        sortOptions.forEach(function (o2) { sortButtons[o2[0]].refresh(); });
        renderList();
      });
      b.refresh = refresh;
      refresh();
      sortButtons[opt[0]] = b;
      toolbar.appendChild(b);
    });

    var ownBtn = toolBtn('brush', S.filter_own);
    var ownSpan = ownBtn.querySelector('.ic-btn-label');
    function refreshOwnBtn() {
      ownBtn.classList.toggle('active', filterOwn !== 0);
      ownSpan.textContent = filterOwn === 1 ? S.filter_own_mine : filterOwn === 2 ? S.filter_own_others : S.filter_own;
      ownBtn.title = ownSpan.textContent;
    }
    ownBtn.addEventListener('click', function () { filterOwn = (filterOwn + 1) % 3; refreshOwnBtn(); renderList(); });
    refreshOwnBtn();
    toolbar.appendChild(ownBtn);

    var boardBtn = toolBtn('pin', S.filter_board);
    var boardSpan = boardBtn.querySelector('.ic-btn-label');
    function refreshBoardBtn() {
      boardBtn.classList.toggle('active', filterBoard !== 0);
      boardSpan.textContent = filterBoard === 1 ? S.filter_board_on : filterBoard === 2 ? S.filter_board_off : S.filter_board;
      boardBtn.title = boardSpan.textContent;
    }
    boardBtn.addEventListener('click', function () { filterBoard = (filterBoard + 1) % 3; refreshBoardBtn(); renderList(); });
    refreshBoardBtn();
    toolbar.appendChild(boardBtn);

    body.appendChild(toolbar);

    var list = el('div', { class: 'ic-moderate-list' });
    wrap.appendChild(list);
    body.appendChild(wrap);

    var lastRes = null;
    function applyFilters(photos) {
      return photos.filter(function (p) {
        if (filterOwn === 1 && !(p.sourceauthor && p.sourceauthor === p.userfullname)) { return false; }
        if (filterOwn === 2 && (p.sourceauthor && p.sourceauthor === p.userfullname)) { return false; }
        if (filterBoard === 1 && p.hiddenfromboard) { return false; }
        if (filterBoard === 2 && !p.hiddenfromboard) { return false; }
        return true;
      });
    }
    function renderRow(container, p, canedit, candelete) {
      var row = el('div', { class: 'ic-moderate-row' + rowStateClass(p) });
      var thumbCluster = el('div', { class: 'ic-thumb-cluster' });
      var thumbWrap = el('div', { class: 'ic-moderate-thumb' });
      var img = el('img', { src: p.url, alt: '' });
      thumbWrap.appendChild(img);

      // Kompakte Overlay-Steuerung direkt auf dem Thumbnail - der Pin sitzt
      // bei unbefestigten Bildern oben rechts, bei befestigten mittig oben
      // auf dem Bild (siehe CSS .ic-thumb-btn-pin.pinned). Sowohl ein Klick
      // auf den Pin als auch auf die jeweils andere (aktuell nicht vom Pin
      // belegte) Position schaltet den Status um. Der Mülleimer (unten
      // rechts) ist nur sichtbar, wenn das Objekt gerade NICHT befestigt
      // ist - befestigte Objekte müssen erst gelöst werden, bevor sie
      // gelöscht werden können (schützt aktiv platzierte Inhalte vor
      // versehentlichem Löschen).
      var delOverlay = null;
      if (candelete) {
        delOverlay = el('button', {
          class: 'ic-thumb-btn ic-thumb-btn-del' + (state.teachercansend && !p.hiddenfromboard ? ' ic-hidden' : '')
        }, [icon('trash')]);
        delOverlay.addEventListener('click', function () {
          if (!confirm(S.deletephoto_confirm_other)) { return; }
          callAjax('mod_pinnwand_delete_photo', { cmid: cfg.cmid, photoid: p.id }).then(function () {
            row.remove();
          });
        });
        thumbWrap.appendChild(delOverlay);
      }
      if (candelete && state.teachercansend) {
        var pinOverlay = el('button', {
          class: 'ic-thumb-btn ic-thumb-btn-pin' + (p.hiddenfromboard ? '' : ' active pinned'),
          title: p.hiddenfromboard ? S.pintooltip : S.unpintooltip
        }, [icon('thumbtack')]);
        var pinOtherZone = el('div', {
          class: 'ic-thumb-pin-otherzone' + (p.hiddenfromboard ? '' : ' pinned'),
          title: p.hiddenfromboard ? S.pintooltip : S.unpintooltip
        });
        function togglePin() {
          var newHidden = !p.hiddenfromboard;
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: p.id, hidden: newHidden }).then(function () {
            p.hiddenfromboard = newHidden;
            pinOverlay.classList.toggle('active', !p.hiddenfromboard);
            pinOverlay.classList.toggle('pinned', !p.hiddenfromboard);
            pinOtherZone.classList.toggle('pinned', !p.hiddenfromboard);
            pinOverlay.title = pinOtherZone.title = p.hiddenfromboard ? S.pintooltip : S.unpintooltip;
            if (delOverlay) { delOverlay.classList.toggle('ic-hidden', !p.hiddenfromboard); }
            loadStreamPhotos();
          });
        }
        pinOverlay.addEventListener('click', togglePin);
        pinOtherZone.addEventListener('click', togglePin);
        thumbWrap.appendChild(pinOverlay);
        thumbWrap.appendChild(pinOtherZone);
      }
      thumbCluster.appendChild(thumbWrap);
      row.appendChild(thumbCluster);
      var meta = el('div', { class: 'ic-moderate-meta' });
      if (sortMode !== 'user') {
        meta.appendChild(el('div', { class: 'ic-moderate-sub' }, [p.userfullname]));
      }

      function persistSource(p) {
        callAjax('mod_pinnwand_update_source', {
          cmid: cfg.cmid, photoid: p.id,
          sourcetitle: p.sourcetitle, sourceauthor: p.sourceauthor, sourceyear: p.sourceyear,
          sourceepoch: p.sourceepoch, sourceplace: p.sourceplace, sourceorigauthor: p.sourceorigauthor
        }).catch(function () { /* bleibt lokal sichtbar, Speichern fehlgeschlagen */ });
      }
      function editField(key, labelKey, value, sizeMod) {
        var input = el('input', {
          type: 'text', value: value || '', placeholder: S[labelKey],
          class: 'ic-moderate-input' + (sizeMod === 'narrow' ? ' ic-moderate-input-narrow' : '') +
            (sizeMod === 'wide' ? ' ic-moderate-input-wide' : ''),
          disabled: canedit ? null : 'disabled'
        });
        if (canedit) {
          input.addEventListener('change', function () {
            p[key] = input.value;
            persistSource(p);
          });
        }
        return input;
      }
      // Genau zwei Zeilen: Titel/Autor*in gleich hoch, darunter die
      // kürzeren Felder Jahr/Ort schmaler als Epoche/Autor*in der Vorlage.
      var fieldsRow1 = el('div', { class: 'ic-moderate-fields' });
      var titleWrap = el('div', { class: 'ic-field-inline', style: 'flex:1 1 140px' });
      titleWrap.appendChild(editField('sourcetitle', 'sourcetitle', p.sourcetitle));
      fieldsRow1.appendChild(titleWrap);

      var authorInput = editField('sourceauthor', 'sourceauthor', p.sourceauthor);
      var authorWrap = el('div', { class: 'ic-field-inline', style: 'flex:1 1 160px' });
      authorWrap.appendChild(authorInput);
      if (canedit) {
        authorInput.disabled = !!(p.sourceauthor && p.sourceauthor === p.userfullname);
        var meLabel = el('label', { class: 'ic-me-check', title: S.student_is_author });
        var meCheck = el('input', { type: 'checkbox', 'aria-label': S.student_is_author });
        meCheck.checked = !!(p.sourceauthor && p.sourceauthor === p.userfullname);
        meCheck.addEventListener('change', function () {
          if (meCheck.checked) {
            authorInput.value = p.userfullname;
            p.sourceauthor = p.userfullname;
            authorInput.disabled = true;
          } else {
            authorInput.disabled = false;
          }
          persistSource(p);
        });
        meLabel.appendChild(meCheck);
        authorWrap.appendChild(meLabel);
      }
      fieldsRow1.appendChild(authorWrap);
      meta.appendChild(fieldsRow1);

      var fieldsRow2 = el('div', { class: 'ic-moderate-fields' });
      fieldsRow2.appendChild(editField('sourceyear', 'sourceyear', p.sourceyear, 'narrow'));
      fieldsRow2.appendChild(editField('sourceepoch', 'sourceepoch', p.sourceepoch, 'narrow'));
      fieldsRow2.appendChild(editField('sourceplace', 'sourceplace', p.sourceplace, 'wide'));
      fieldsRow2.appendChild(editField('sourceorigauthor', 'sourceorigauthor', p.sourceorigauthor));
      meta.appendChild(fieldsRow2);
      meta.appendChild(el('div', { class: 'ic-moderate-sub' }, [S.uploaded_on + ': ' + formatDate(p.timecreated)]));
      row.appendChild(meta);
      container.appendChild(row);
    }

    function renderList() {
      if (!lastRes) { return; }
      list.innerHTML = '';
      var photos = applyFilters(lastRes.photos);
      if (!photos.length) {
        list.appendChild(el('p', { class: 'ic-hint' }, [S.moderate_empty]));
        return;
      }
      if (sortMode === 'user') {
        var byUser = {}, order = [];
        photos.forEach(function (p) {
          if (!byUser[p.userid]) { byUser[p.userid] = { name: p.userfullname, photos: [] }; order.push(p.userid); }
          byUser[p.userid].photos.push(p);
        });
        if (sortDir === -1) { order.reverse(); }
        order.forEach(function (uid) {
          var group = byUser[uid];
          var section = el('div', { class: 'ic-moderate-group' });
          section.appendChild(el('h3', { class: 'ic-moderate-user' }, [group.name + ' (' + group.photos.length + ')']));
          // Innerhalb eines Nutzer-Blocks: zwei Spalten (1L 2R / 3L 4R / ...),
          // damit mehr Objekte auf eine Bildschirmseite passen. Die
          // Überschrift bleibt darüber über die volle Breite.
          var grid = el('div', { class: 'ic-moderate-usergrid' });
          group.photos.forEach(function (p) { renderRow(grid, p, lastRes.canedit, lastRes.candelete); });
          section.appendChild(grid);
          list.appendChild(section);
        });
      } else {
        var sorted = photos.slice().sort(function (a, b) {
          var cmp;
          if (sortMode === 'upload') {
            cmp = a.timecreated - b.timecreated;
          } else {
            // "year": alphanumerischer Vergleich, da freier Text (z.B. "um 1850").
            cmp = (a.sourceyear || '').localeCompare(b.sourceyear || '', undefined, { numeric: true });
          }
          return cmp * sortDir;
        });
        sorted.forEach(function (p) { renderRow(list, p, lastRes.canedit, lastRes.candelete); });
      }
    }

    callAjax('mod_pinnwand_get_all_photos', { cmid: cfg.cmid }).then(function (res) {
      lastRes = res;
      renderList();
    });

    var bar = el('div', { class: 'ic-actionbar' });
    var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.back]);
    backBtn.addEventListener('click', function () { state.step = 'home'; render(); });
    bar.appendChild(backBtn);
    body.appendChild(bar);
  }

  function formatDate(ts) {
    if (!ts) { return ''; }
    var d = new Date(ts * 1000);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function persistLayout(p) {
    callAjax('mod_pinnwand_update_layout', {
      cmid: cfg.cmid, photoid: p.id, x: p.canvasx, y: p.canvasy, w: p.canvasw, rot: p.canvasrot || 0, z: p.canvasz || 0,
      boardid: p.boardid || 0
    }).catch(function () { /* still keep local state */ });
  }

  // Lädt die eigenen Fotos vollständig neu vom Server, statt (fehleranfällig)
  // lokal ein unvollständiges Objekt zusammenzubauen - garantiert, dass alle
  // Felder (auch neuere wie boardid/backphotoid/showingback) korrekt gesetzt
  // sind und macht neu gespeicherte Fotos sofort überall sichtbar.
  function refreshPhotos() {
    return callAjax('mod_pinnwand_get_photos', { cmid: cfg.cmid }).then(function (res) {
      state.photos = res.photos;
      state.maxpictures = res.max;
    });
  }

  // ------------------------------------------------------------------
  // Hintergrund der Anordnungs-Leinwand: Farbe (Standard dunkelgrau) oder
  // eines der eigenen Fotos als Bild. Pro Nutzer*in/Aktivität gespeichert.
  // Setzt nur die Farbfläche der (unskalierten) Tapete außerhalb der
  // Zoom-Ebene - siehe renderArrange, Bugfix: die Tapete lag vorher
  // fälschlich innerhalb der gezoomten Ebene und wurde bei Zoom < 1
  // (Normalfall) kleiner als das Fenster dargestellt.
  function applyWallpaperColor(wallpaperEl) {
    var bg = state.background || { type: 'color', color: '#2b2d33' };
    wallpaperEl.style.backgroundColor = bg.color || '#2b2d33';
  }

  // ------------------------------------------------------------------
  function applyBackground(bgEl) {
    var bg = state.background || { type: 'color', color: '#2b2d33' };
    // Äußeres Element: reine Farbfläche, füllt die komplette (ggf. größere
    // als 1400x1000) sichtbare Fläche als Tapete.
    bgEl.style.backgroundImage = 'none';
    bgEl.style.backgroundColor = bg.color || '#2b2d33';
    // Zusätzlich als CSS-Variable bereitstellen - wird für den Glow-Effekt
    // der Sidebar-Umschalter-Buttons verwendet (siehe .ic-sidebar-toggle-bar).
    root.style.setProperty('--ic-board-bg-color', bg.color || '#2b2d33');

    // Inneres 1400x1000-Element trägt das eigentliche Bild - exakt auf die
    // Board-Koordinatenfläche gemappt (NICHT auf die ggf. größere äußere
    // Fläche), damit Rahmen/Fotos immer auf dieselbe Bildstelle zeigen,
    // unabhängig von Bildschirmgröße/Präsentationsmodus.
    var img = bgEl.querySelector('.ic-canvas-bg-image');
    if (!img) {
      img = document.createElement('div');
      img.className = 'ic-canvas-bg-image';
      bgEl.appendChild(img);
    }
    if ((bg.type === 'image' || bg.type === 'url' || bg.type === 'upload') && bg.url) {
      img.style.backgroundColor = bg.color || '#2b2d33';
      img.style.backgroundImage = "url('" + bg.url + "')";
      // "cover" (abschneiden): füllt die 1400x1000-Fläche komplett aus 100%
      // Breite ODER 100% Höhe, die größere Seite wird beschnitten.
      // "contain" (füllen, Standard): nie beschnitten, lässt ggf. einen
      // Rand in der gewählten Farbe.
      img.style.backgroundSize = bg.fit === 'cover' ? 'cover' : 'contain';
      img.style.backgroundRepeat = 'no-repeat';
      img.style.backgroundPosition = 'center';
    } else {
      img.style.backgroundImage = 'none';
      img.style.backgroundColor = bg.color || '#2b2d33';
    }
    var brightness = (bg.brightness != null ? bg.brightness : 100);
    var saturation = (bg.saturation != null ? bg.saturation : 100);
    img.style.filter = 'brightness(' + brightness + '%) saturate(' + saturation + '%)';
  }

  function openBackgroundPanel(body) {
    var existing = document.getElementById('ic-bg-panel');
    if (existing) { existing.remove(); return; }

    function bgLayerEl() {
      var wallpaperEl = document.querySelector('.ic-canvas-wallpaper');
      if (wallpaperEl) { applyWallpaperColor(wallpaperEl); }
      return document.querySelector('.ic-canvas-bg');
    }
    function currentBrightness() { return (state.background && state.background.brightness != null) ? state.background.brightness : 100; }
    function currentSaturation() { return (state.background && state.background.saturation != null) ? state.background.saturation : 100; }
    function currentFit() { return (state.background && state.background.fit) || 'contain'; }

    var panel = el('div', { class: 'ic-bg-panel', id: 'ic-bg-panel' });
    panel.appendChild(el('label', {}, [S.bg_color]));
    var colorInput = el('input', { type: 'color', value: (state.background && state.background.color) || '#2b2d33' });
    colorInput.addEventListener('input', function () {
      state.background = { type: 'color', color: colorInput.value, url: null, brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit() };
      applyBackground(bgLayerEl());
    });
    colorInput.addEventListener('change', function () {
      callAjax('mod_pinnwand_save_background', {
        cmid: cfg.cmid, type: 'color', color: colorInput.value, photoid: 0,
        brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
      }).then(function (res) { state.background = res.background; });
    });
    panel.appendChild(colorInput);

    if (state.photos.length > 0) {
      panel.appendChild(el('label', { style: 'margin-top:10px' }, [S.bg_image]));
      var row = el('div', { class: 'ic-bg-thumbs' });
      state.photos.forEach(function (p) {
        var t = el('img', { src: p.url, alt: '', class: 'ic-bg-thumb' });
        t.addEventListener('click', function () {
          state.background = { type: 'image', color: colorInput.value, url: p.url, brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit() };
          applyBackground(bgLayerEl());
          callAjax('mod_pinnwand_save_background', {
            cmid: cfg.cmid, type: 'image', color: colorInput.value, photoid: p.id,
            brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
          }).then(function (res) { state.background = res.background; });
        });
        row.appendChild(t);
      });
      panel.appendChild(row);
    }

    panel.appendChild(el('label', { style: 'margin-top:10px' }, [S.bg_url]));
    var urlRow = el('div', { style: 'display:flex;gap:6px' });
    var urlInput = el('input', { type: 'url', placeholder: 'https://...', style: 'flex:1' });
    if (state.background && state.background.type === 'url' && state.background.url) {
      urlInput.value = state.background.url;
    }
    var urlApply = el('button', { class: 'ic-btn ic-btn-primary', style: 'flex:0 0 auto' }, [S.bg_url_apply]);
    urlApply.addEventListener('click', function () {
      var url = urlInput.value.trim();
      if (!url) { return; }
      state.background = { type: 'url', color: colorInput.value, url: url, brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit() };
      applyBackground(bgLayerEl());
      callAjax('mod_pinnwand_save_background', {
        cmid: cfg.cmid, type: 'url', color: colorInput.value, photoid: 0, url: url,
        brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
      }).then(function (res) { state.background = res.background; });
    });
    urlRow.appendChild(urlInput); urlRow.appendChild(urlApply);
    panel.appendChild(urlRow);

    panel.appendChild(el('label', { style: 'margin-top:10px' }, [S.bg_upload]));
    var uploadInput = el('input', { type: 'file', accept: 'image/*' });
    uploadInput.addEventListener('change', function () {
      var file = uploadInput.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        callAjax('mod_pinnwand_save_background', {
          cmid: cfg.cmid, type: 'upload', color: colorInput.value, photoid: 0, url: '', imagedata: reader.result,
          brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
        }).then(function (res) {
          state.background = res.background;
          applyBackground(bgLayerEl());
        }).catch(function (e) { alert(S.error_save + ' (' + e.message + ')'); });
      };
      reader.readAsDataURL(file);
    });
    panel.appendChild(uploadInput);

    // Helligkeit/Sättigung - wirkt nur auf die Hintergrund-Ebene, damit die
    // Foto-Pins immer klar erkennbar bleiben.
    panel.appendChild(el('label', { style: 'margin-top:10px' }, [S.bg_brightness]));
    var brightnessInput = el('input', { type: 'range', min: '20', max: '180', value: currentBrightness() });
    function persistFilter() {
      callAjax('mod_pinnwand_save_background', {
        cmid: cfg.cmid,
        type: state.background.type, color: state.background.color || '#2b2d33',
        photoid: 0, url: state.background.url || '',
        brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
      }).then(function (res) { state.background = res.background; });
    }
    brightnessInput.addEventListener('input', function () {
      state.background.brightness = parseInt(brightnessInput.value, 10);
      applyBackground(bgLayerEl());
    });
    brightnessInput.addEventListener('change', persistFilter);
    panel.appendChild(brightnessInput);

    panel.appendChild(el('label', { style: 'margin-top:6px' }, [S.bg_saturation]));
    var saturationInput = el('input', { type: 'range', min: '0', max: '200', value: currentSaturation() });
    saturationInput.addEventListener('input', function () {
      state.background.saturation = parseInt(saturationInput.value, 10);
      applyBackground(bgLayerEl());
    });
    saturationInput.addEventListener('change', persistFilter);
    panel.appendChild(saturationInput);

    // Abschneiden (cover) vs. Füllen (contain) - wie das Hintergrundbild
    // die 1400x1000-Fläche ausfüllt, wenn sein Seitenverhältnis nicht
    // exakt passt.
    panel.appendChild(el('label', { style: 'margin-top:10px' }, [S.bg_fit]));
    var fitRow = el('div', { class: 'ic-seg' });
    [['contain', S.bg_fit_contain], ['cover', S.bg_fit_cover]].forEach(function (opt) {
      var fitBtn = el('button', { class: 'ic-btn ic-btn-ghost' + (currentFit() === opt[0] ? ' ic-btn-primary' : '') }, [opt[1]]);
      fitBtn.addEventListener('click', function () {
        state.background.fit = opt[0];
        applyBackground(bgLayerEl());
        persistFilter();
        panel.remove();
        openBackgroundPanel(body);
      });
      fitRow.appendChild(fitBtn);
    });
    panel.appendChild(fitRow);

    // Hintergrundbild auch aus den Uploads der Klasse wählbar - Berechtigung
    // wird server-seitig über dieselbe Regel wie die Klassenansicht geprüft
    // (mod/pinnwand:viewall oder studentclassview); ohne Berechtigung bleibt
    // dieser Abschnitt einfach weg, statt einen Fehler zu zeigen.
    callAjax('mod_pinnwand_get_all_photos', { cmid: cfg.cmid }).then(function (res) {
      var classPhotos = (res.photos || []).filter(function (p) { return !state.photos.some(function (o) { return o.id === p.id; }); });
      if (!classPhotos.length) { return; }
      var classLabel = el('label', { style: 'margin-top:10px' }, [S.bg_image_class]);
      var classRow = el('div', { class: 'ic-bg-thumbs' });
      classPhotos.forEach(function (p) {
        var t = el('img', { src: p.url, alt: '', class: 'ic-bg-thumb' });
        t.addEventListener('click', function () {
          state.background = { type: 'image', color: colorInput.value, url: p.url, brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit() };
          applyBackground(bgLayerEl());
          callAjax('mod_pinnwand_save_background', {
            cmid: cfg.cmid, type: 'image', color: colorInput.value, photoid: p.id,
            brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
          }).then(function (res2) { state.background = res2.background; });
        });
        classRow.appendChild(t);
      });
      panel.insertBefore(classRow, closeBtn);
      panel.insertBefore(classLabel, classRow);
    }).catch(function () { /* keine Berechtigung (o.ä.) - Abschnitt einfach weglassen */ });

    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost', style: 'margin-top:10px' }, [S.draw_done]);
    closeBtn.addEventListener('click', function () { panel.remove(); });
    panel.appendChild(closeBtn);

    body.appendChild(panel);

    // Schließen bei Klick außerhalb des Panels (nicht im selben Klick, der
    // es geöffnet hat - siehe setTimeout).
    setTimeout(function () {
      document.addEventListener('click', function onDocClick(ev) {
        if (!panel.contains(ev.target)) {
          panel.remove();
          document.removeEventListener('click', onDocClick);
        }
      });
    }, 0);
  }

  function makeMovable(item, container, onMove, onEnd) {
    var dragging = false, startX, startY, origX, origY, totalDelta = 0;
    function point(ev) { var t = ev.touches ? ev.touches[0] : ev; return { x: t.clientX, y: t.clientY }; }
    function down(ev) {
      if (ev.target.classList.contains('ic-resize')) { return; }
      if (ev.target.closest && ev.target.closest('.ic-pin-toggle, .ic-thread-add-toggle')) { return; }
      if (state.boardDrawMode) { return; }
      dragging = true; totalDelta = 0;
      var p = point(ev);
      startX = p.x; startY = p.y;
      origX = parseFloat(item.style.left) || 0;
      origY = parseFloat(item.style.top) || 0;
      ev.preventDefault();
    }
    function move(ev) {
      if (!dragging) { return; }
      var p = point(ev);
      var z = state.boardZoom || 1;
      var dx = (p.x - startX) / z, dy = (p.y - startY) / z;
      totalDelta += Math.abs(dx) + Math.abs(dy);
      var nx = origX + dx, ny = origY + dy;
      item.style.left = nx + 'px'; item.style.top = ny + 'px';
      onMove(nx, ny);
      ev.preventDefault();
    }
    function up() {
      if (!dragging) { return; }
      dragging = false;
      if (totalDelta < 6) { onEnd(false); } else { onEnd(true); }
    }
    item.addEventListener('mousedown', down);
    item.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  }

  function makeResizable(handle, item, onResize, onEnd) {
    var dragging = false, startX, startW;
    function point(ev) { var t = ev.touches ? ev.touches[0] : ev; return { x: t.clientX, y: t.clientY }; }
    function down(ev) {
      dragging = true;
      startX = point(ev).x;
      startW = parseFloat(item.style.width) || item.offsetWidth;
      ev.stopPropagation(); ev.preventDefault();
    }
    function move(ev) {
      if (!dragging) { return; }
      var dx = (point(ev).x - startX) / (state.boardZoom || 1);
      var w = Math.max(60, startW + dx);
      item.style.width = w + 'px';
      onResize(w);
      ev.preventDefault();
    }
    function up() { if (dragging) { dragging = false; onEnd(); } }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  }

  // Freies Rotieren eines Pins per Ziehen an einem kleinen Griff über dem
  // Bild - Winkel wird aus der Zeigerposition relativ zur Bildmitte berechnet.
  function makeRotatable(handle, item, onRotate, onEnd) {
    var dragging = false, centerX = 0, centerY = 0;
    function point(ev) { var t = ev.touches ? ev.touches[0] : ev; return { x: t.clientX, y: t.clientY }; }
    function down(ev) {
      dragging = true;
      var rect = item.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      ev.stopPropagation(); ev.preventDefault();
    }
    function move(ev) {
      if (!dragging) { return; }
      var p = point(ev);
      var deg = Math.atan2(p.y - centerY, p.x - centerX) * 180 / Math.PI + 90;
      item.style.transform = 'rotate(' + deg + 'deg)';
      onRotate(deg);
      ev.preventDefault();
    }
    function up() { if (dragging) { dragging = false; onEnd(); } }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  }
  // ==================================================================
  // LIGHTBOX / Galeriemodus: viel Bildplatz, Zoom (Pinch/Wheel/Buttons),
  // Raster-Overlay (nur hier!) und eine editierbare Zeichen-/Schreib-Ebene,
  // die exakt auf das Foto gemappt ist.
  // ==================================================================
  function openLightbox(index, startDrawing) {
    closeLightbox();
    state.lightboxIndex = index;

    var zoom = 1, panX = 0, panY = 0;
    var drawing = false;

    // Es ist immer nur eines der drei Konfigurationswerkzeuge sichtbar -
    // Raster, Daten oder Stylus schließen sich gegenseitig.
    function closeAllPanels(except) {
      if (except !== 'grid') { var gp = document.getElementById('ic-grid-panel'); if (gp) { gp.remove(); } }
      if (except !== 'data') { var dp = document.getElementById('ic-data-panel'); if (dp) { dp.remove(); } }
      if (except !== 'back') { var bp = document.getElementById('ic-back-panel'); if (bp) { bp.remove(); } }
      if (except !== 'draw' && drawing) { exitDrawing(true); }
      updateFocusMode();
    }

    // Sobald ein Panel (Raster/Daten/Rückseite) oder der Zeichenmodus aktiv
    // ist, verschwindet alles außer dem Schließen-Button - vor allem die
    // Nav-Leiste (nächstes/voriges Bild, Zoom) - damit auf kleinen
    // Bildschirmen der Bildbereich maximal groß bleibt.
    function updateFocusMode() {
      var p = state.photos[state.lightboxIndex];
      var hasGrid = !!(p && p.gridtype && p.gridtype !== 'none');
      var active = !!(hasGrid || drawing || document.getElementById('ic-grid-panel') ||
        document.getElementById('ic-data-panel') || document.getElementById('ic-back-panel'));
      lb.classList.toggle('ic-lb-focus', active);
      sizeLightboxImage();
    }

    var lb = el('div', { class: 'ic-lightbox' });
    var leftDock = el('div', { class: 'ic-lb-left-dock' });
    var gridBtn = el('button', { class: 'ic-fab', title: S.gridtoggle }, [icon('grid')]);
    gridBtn.addEventListener('click', function () { closeAllPanels('grid'); toggleGridPanel(); });
    var dataBtn = el('button', { class: 'ic-fab', title: S.databtn }, [icon('info')]);
    dataBtn.addEventListener('click', function () { closeAllPanels('data'); toggleDataPanel(); });
    var editBtn = el('button', { class: 'ic-fab', title: S.editphoto }, [icon('scissors')]);
    editBtn.addEventListener('click', function () {
      var p = state.photos[state.lightboxIndex];
      exitDrawing(true);
      closeLightbox();
      if (p.wordfielddata) {
        // Wortfeld: strukturierte Daten wiederherstellen und den
        // Wortfeld-Editor öffnen statt den Bild-Editor mit dem
        // gerenderten SVG als vermeintlichem "Foto".
        try {
          state.textFrame = JSON.parse(p.wordfielddata);
        } catch (e) {
          state.textFrame = null;
        }
        state.editingPhotoId = p.id;
        state.step = 'textframe';
        render();
        return;
      }
      var img = new Image();
      img.onload = function () {
        state.editingPhotoId = p.id;
        loadCapturedImage(img);
      };
      img.onerror = function () { alert(S.url_load_error); };
      img.src = p.url;
    });
    var backsideBtn = el('button', { class: 'ic-fab', title: S.backside }, [icon('rotate')]);
    backsideBtn.addEventListener('click', function () { closeAllPanels('back'); toggleBackPanel(); });
    leftDock.appendChild(gridBtn); leftDock.appendChild(dataBtn); leftDock.appendChild(editBtn); leftDock.appendChild(backsideBtn);

    // Zusätzlicher, immer sichtbarer (sehr transparenter) Raster-Button oben
    // links - bleibt auch im Fokus-Modus erreichbar (der reguläre gridBtn im
    // leftDock verschwindet dort, siehe updateFocusMode), damit ein bereits
    // gesetztes Raster nachträglich bearbeitet werden kann.
    var gridFab = el('button', { class: 'ic-lb-grid-fab', title: S.gridtoggle }, [icon('grid')]);
    gridFab.addEventListener('click', function () { closeAllPanels('grid'); toggleGridPanel(); });
    lb.appendChild(gridFab);

    // Stylus-Knopf unten links: einziger Schalter für die Zeichenwerkzeuge
    // (senkrecht am linken Rand gestapelt, siehe enterDrawing()).
    var stylusBtn = el('button', { class: 'ic-stylus-btn' }, ['\u270E']);

    var viewport = el('div', { class: 'ic-lb-viewport' });
    var transform = el('div', { class: 'ic-lb-transform' });
    var imgbox = el('div', { class: 'ic-imgbox' });
    var img = el('img', { src: state.photos[index].url, alt: '' });
    imgbox.appendChild(img);
    transform.appendChild(imgbox);
    viewport.appendChild(transform);

    var caption = el('div', { class: 'ic-caption' }, [captionText(state.photos[index])]);
    var close = el('button', { class: 'ic-btn ic-btn-ghost ic-lb-close' }, ['\u2715']);
    close.addEventListener('click', function () { exitDrawing(true); closeLightbox(); });

    var nav = el('div', { class: 'ic-lb-nav' });
    var prev = el('button', { class: 'ic-btn' }, ['\u2039']);
    var zoomOut = el('button', { class: 'ic-btn' }, ['\u2212']);
    var zoomReset = el('button', { class: 'ic-btn' }, ['1:1']);
    var zoomIn = el('button', { class: 'ic-btn' }, ['+']);
    var next = el('button', { class: 'ic-btn' }, ['\u203A']);

    function applyTransform() {
      transform.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    }
    function setZoom(z, cx, cy) {
      z = Math.max(1, Math.min(4, z));
      if (z === zoom) { return; }
      zoom = z;
      if (zoom === 1) { panX = 0; panY = 0; }
      applyTransform();
    }
    zoomIn.addEventListener('click', function () { setZoom(zoom + 0.5); });
    zoomOut.addEventListener('click', function () { setZoom(zoom - 0.5); });
    zoomReset.addEventListener('click', function () { setZoom(1); });
    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });

    function refreshOverlays() {
      imgbox.querySelectorAll('.ic-grid-overlay').forEach(function (o) { o.remove(); });
      var p = state.photos[state.lightboxIndex];
      addGridOverlay(imgbox, img, p);
      renderStaticAnnotation(p);
    }

    // ---- Raster definieren (nur hier in der Galerie möglich) ----
    function toggleGridPanel() {
      var existing = document.getElementById('ic-grid-panel');
      if (existing) { existing.remove(); updateFocusMode(); return; }

      var p = state.photos[state.lightboxIndex];
      var panel = el('div', { class: 'ic-bg-panel', id: 'ic-grid-panel' });
      var seg = el('div', { class: 'ic-seg' });
      var options = [['none', S.grid_none], ['square', S.grid_square], ['fixed', S.grid_fixed]];
      var buttons = {};
      var valueRow = el('div', { class: 'ic-row' });
      var valueLabel = el('label', {}, ['']);
      var valueInput = el('input', { type: 'range' });

      function refreshValueRow() {
        var show = p.gridtype !== 'none';
        valueRow.style.display = show ? 'flex' : 'none';
        if (!show) { return; }
        valueLabel.textContent = p.gridtype === 'square' ? S.gridsize : S.gridcount;
        valueInput.min = p.gridtype === 'square' ? 10 : 2;
        valueInput.max = p.gridtype === 'square' ? 200 : 20;
        valueInput.value = p.gridvalue || (p.gridtype === 'square' ? 40 : 8);
      }

      options.forEach(function (opt) {
        var b = el('button', { class: p.gridtype === opt[0] ? 'active' : '' }, [opt[1]]);
        b.addEventListener('click', function () {
          p.gridtype = opt[0];
          if (p.gridtype !== 'none' && !p.gridvalue) { p.gridvalue = p.gridtype === 'square' ? 40 : 8; }
          Object.keys(buttons).forEach(function (k) { buttons[k].classList.toggle('active', k === opt[0]); });
          refreshValueRow();
          refreshOverlays();
          persistGrid(p);
        });
        buttons[opt[0]] = b;
        seg.appendChild(b);
      });
      panel.appendChild(seg);

      valueInput.addEventListener('input', function () {
        p.gridvalue = parseInt(valueInput.value, 10);
        refreshOverlays();
      });
      valueInput.addEventListener('change', function () { persistGrid(p); });
      valueRow.appendChild(valueLabel); valueRow.appendChild(valueInput);
      panel.appendChild(valueRow);
      refreshValueRow();

      var colorRow = el('div', { class: 'ic-row' });
      colorRow.appendChild(el('label', {}, [S.gridcolor]));
      var colorInput = el('input', { type: 'color', value: p.gridcolor || '#ff3c3c' });
      colorInput.addEventListener('input', function () {
        p.gridcolor = colorInput.value;
        refreshOverlays();
      });
      colorInput.addEventListener('change', function () { persistGrid(p); });
      colorRow.appendChild(colorInput);
      panel.appendChild(colorRow);

      var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost', style: 'margin-top:10px' }, [S.draw_done]);
      closeBtn.addEventListener('click', function () { panel.remove(); updateFocusMode(); });
      panel.appendChild(closeBtn);

      lb.appendChild(panel);
      updateFocusMode();
    }

    function persistGrid(p) {
      callAjax('mod_pinnwand_update_grid', {
        cmid: cfg.cmid, photoid: p.id, gridtype: p.gridtype, gridvalue: p.gridvalue || 0,
        gridcolor: p.gridcolor || '#ff3c3c'
      }).catch(function () { /* Auswahl bleibt lokal sichtbar, Speichern fehlgeschlagen */ });
    }

    // ---- Daten: Quellenangaben direkt in der Galerie bearbeiten ----
    function toggleDataPanel() {
      var existing = document.getElementById('ic-data-panel');
      if (existing) { existing.remove(); updateFocusMode(); return; }

      var p = state.photos[state.lightboxIndex];
      var panel = el('div', { class: 'ic-bg-panel', id: 'ic-data-panel' });

      function persist() {
        callAjax('mod_pinnwand_update_source', {
          cmid: cfg.cmid, photoid: p.id,
          sourcetitle: p.sourcetitle, sourceauthor: p.sourceauthor, sourceyear: p.sourceyear,
          sourceepoch: p.sourceepoch, sourceplace: p.sourceplace, sourceorigauthor: p.sourceorigauthor
        }).then(function () { caption.textContent = captionText(p); })
          .catch(function () { /* bleibt lokal sichtbar, Speichern fehlgeschlagen */ });
      }
      function field(key, labelKey) {
        var wrap = el('div', { class: 'ic-field' });
        wrap.appendChild(el('label', {}, [S[labelKey]]));
        var input = el('input', { type: 'text', value: p[key] || '' });
        input.addEventListener('change', function () { p[key] = input.value; persist(); });
        wrap.appendChild(input);
        panel.appendChild(wrap);
      }
      field('sourcetitle', 'sourcetitle');
      field('sourceauthor', 'sourceauthor');
      field('sourceyear', 'sourceyear');
      field('sourceepoch', 'sourceepoch');
      field('sourceplace', 'sourceplace');
      field('sourceorigauthor', 'sourceorigauthor');

      var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost', style: 'margin-top:10px' }, [S.draw_done]);
      closeBtn.addEventListener('click', function () { panel.remove(); updateFocusMode(); });
      panel.appendChild(closeBtn);

      lb.appendChild(panel);
      updateFocusMode();
    }

    function toggleBackPanel() {
      var existing = document.getElementById('ic-back-panel');
      if (existing) { existing.remove(); updateFocusMode(); return; }

      var p = state.photos[state.lightboxIndex];
      var panel = el('div', { class: 'ic-bg-panel', id: 'ic-back-panel' });
      panel.appendChild(el('p', { class: 'ic-hint' }, [S.backside_hint]));

      var thumbs = el('div', { class: 'ic-bg-thumbs' });
      state.photos.forEach(function (other) {
        if (other.id === p.id) { return; }
        var thumb = el('img', {
          class: 'ic-bg-thumb' + (p.backphotoid === other.id ? ' active' : ''), src: other.url, alt: ''
        });
        thumb.addEventListener('click', function () {
          callAjax('mod_pinnwand_set_backside', { cmid: cfg.cmid, photoid: p.id, backphotoid: other.id }).then(function () {
            p.backphotoid = other.id; p.showingback = false;
            panel.remove(); toggleBackPanel();
          });
        });
        thumbs.appendChild(thumb);
      });
      panel.appendChild(thumbs);

      if (p.backphotoid) {
        var unlinkBtn = el('button', { class: 'ic-btn ic-btn-ghost', style: 'margin-top:8px' }, [S.unlinkbackside]);
        unlinkBtn.addEventListener('click', function () {
          callAjax('mod_pinnwand_set_backside', { cmid: cfg.cmid, photoid: p.id, backphotoid: 0 }).then(function () {
            p.backphotoid = 0; p.showingback = false;
            panel.remove(); toggleBackPanel();
          });
        });
        panel.appendChild(unlinkBtn);
      }

      var closeBtn2 = el('button', { class: 'ic-btn ic-btn-ghost', style: 'margin-top:10px' }, [S.draw_done]);
      closeBtn2.addEventListener('click', function () { panel.remove(); updateFocusMode(); });
      panel.appendChild(closeBtn2);

      lb.appendChild(panel);
      updateFocusMode();
    }

    function renderStaticAnnotation(p) {
      var old = imgbox.querySelector('.ic-annot-layer');
      if (old) { old.remove(); }
      if (!drawing) { buildInkDisplay(imgbox, p); }
    }

    function step(dir) {
      exitDrawing(true);
      var gridPanel = document.getElementById('ic-grid-panel');
      if (gridPanel) { gridPanel.remove(); }
      var dataPanel = document.getElementById('ic-data-panel');
      if (dataPanel) { dataPanel.remove(); }
      var n = state.photos.length;
      state.lightboxIndex = (state.lightboxIndex + dir + n) % n;
      var p = state.photos[state.lightboxIndex];
      img.src = p.url;
      setZoom(1);
      sizeLightboxImage();
      refreshOverlays();
      caption.textContent = captionText(p);
      updateFocusMode();
    }

    // ---- Zeichnen/Schreiben: Striche als Vektordaten (Punkte, Farbe, Breite,
    // Radierer-Flag), analog zum Ink-Werkzeug aus present.ts. Doppelklick mit
    // aktivem Radierer löscht einen ganzen Strich statt nur Pixel zu radieren. ----
    var inkCanvas = null, inkCtx = null, inkTool = 'pen', inkColor = INK_COLORS[0], inkSize = INK_SIZES[1];
    var currentStroke = null, strokes = [];

    function redraw() { redrawInk(inkCanvas, inkCtx, strokes); }

    function enterDrawing() {
      drawing = true;
      stylusBtn.classList.add('active');
      updateFocusMode();
      var old = imgbox.querySelector('.ic-annot-layer');
      if (old) { old.remove(); }

      var p = state.photos[state.lightboxIndex];
      strokes = parseStrokes(p);
      // Eigene Kopie der Farbpalette für diese Zeichensitzung - eine per
      // Doppelklick neu definierte Farbe (siehe unten) wirkt dadurch nur
      // für das aktuell bearbeitete Foto, nicht global/dauerhaft.
      var sessionColors = INK_COLORS.slice();
      inkCanvas = document.createElement('canvas');
      inkCanvas.className = 'ic-annot-layer ic-annot-editing';
      imgbox.appendChild(inkCanvas);
      inkCtx = inkCanvas.getContext('2d');
      function sizeCanvas() {
        var r = imgbox.getBoundingClientRect();
        inkCanvas.width = Math.max(1, Math.round(r.width));
        inkCanvas.height = Math.max(1, Math.round(r.height));
        redraw();
      }
      sizeCanvas();
      inkCanvas._icResizeHandler = sizeCanvas;
      window.addEventListener('resize', sizeCanvas);

      var toolbar = el('div', { class: 'ic-ink-dock' });
      // Scheren- (Bearbeiten) und Info-Button (Bild-Informationen) auch
      // hier oben im Annotations-Werkzeug sichtbar, nicht nur im
      // leftDock, der während des Zeichnens ausgeblendet ist (siehe
      // .ic-lb-focus) - ruft die dortige, bereits vorhandene Logik per
      // click() auf, statt sie zu duplizieren.
      var annotTopRow = el('div', { class: 'ic-ink-dock-row' });
      var annotEditBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.editphoto }, [icon('scissors')]);
      annotEditBtn.addEventListener('click', function () { editBtn.click(); });
      var annotInfoBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.databtn }, [icon('info')]);
      annotInfoBtn.addEventListener('click', function () { dataBtn.click(); });
      annotTopRow.appendChild(annotEditBtn); annotTopRow.appendChild(annotInfoBtn);
      toolbar.appendChild(annotTopRow);
      var penBtn = el('button', { class: 'ic-btn ic-btn-primary', title: S.draw_pen }, [icon('pen')]);
      var eraserBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.draw_eraser }, [icon('eraser')]);
      var textBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.draw_text }, [icon('text')]);
      function selectTool(t, activeBtn) {
        inkTool = t;
        [penBtn, eraserBtn, textBtn].forEach(function (b) { b.classList.remove('ic-btn-primary'); b.classList.add('ic-btn-ghost'); });
        activeBtn.classList.remove('ic-btn-ghost'); activeBtn.classList.add('ic-btn-primary');
      }
      penBtn.addEventListener('click', function () { selectTool('pen', penBtn); });
      eraserBtn.addEventListener('click', function () { selectTool('eraser', eraserBtn); });
      textBtn.addEventListener('click', function () { selectTool('text', textBtn); });
      toolbar.appendChild(penBtn); toolbar.appendChild(eraserBtn); toolbar.appendChild(textBtn);

      var colorRow = el('div', { class: 'ic-ink-dock-row' });
      // Freie Farbwahl zusätzlich zur festen Palette - direkter Zugriff
      // statt nur per Doppelklick auf ein bestehendes Farbfeld.
      var customColorInput = el('input', { type: 'color', value: inkColor, class: 'ic-textframe-custom-color' });
      customColorInput.addEventListener('input', function () {
        inkColor = customColorInput.value;
        colorRow.querySelectorAll('.ic-ink-swatch').forEach(function (s) { s.classList.remove('active'); });
        updateToolColor();
      });
      // Stift, Text-Werkzeug und Größen-Punkte übernehmen die gewählte Farbe,
      // damit auf einen Blick klar ist, mit welcher Farbe gerade gezeichnet wird.
      function updateToolColor() {
        penBtn.style.color = inkColor;
        textBtn.style.color = inkColor;
        toolbar.querySelectorAll('.ic-ink-size span').forEach(function (dot) { dot.style.background = inkColor; });
      }
      INK_COLORS.forEach(function (c, colorIdx) {
        var sw = el('button', {
          class: 'ic-ink-swatch' + (sessionColors[colorIdx] === inkColor ? ' active' : ''), style: 'background:' + sessionColors[colorIdx]
        });
        sw.addEventListener('click', function () {
          inkColor = sessionColors[colorIdx];
          colorRow.querySelectorAll('.ic-ink-swatch').forEach(function (s) { s.classList.remove('active'); });
          sw.classList.add('active');
          updateToolColor();
        });
        // Doppelklick: diese Palettenfarbe neu definieren - gilt nur für
        // die aktuelle Zeichensitzung/dieses Foto (sessionColors), nicht
        // global für alle Fotos.
        sw.addEventListener('dblclick', function (ev) {
          ev.stopPropagation();
          var picker = el('input', { type: 'color', value: sessionColors[colorIdx], style: 'position:absolute;opacity:0;pointer-events:none' });
          document.body.appendChild(picker);
          picker.addEventListener('input', function () {
            sessionColors[colorIdx] = picker.value;
            sw.style.background = picker.value;
            if (inkColor === sw._icPrevColor) { inkColor = picker.value; updateToolColor(); }
          });
          picker.addEventListener('change', function () { picker.remove(); });
          sw._icPrevColor = sessionColors[colorIdx];
          picker.click();
        });
        colorRow.appendChild(sw);
      });
      colorRow.appendChild(customColorInput);
      toolbar.appendChild(colorRow);

      var sizeRow = el('div', { class: 'ic-ink-dock-row' });
      // Ein Regler statt fester Größen-Stufen - steuert sowohl die
      // Pinsel-/Radiergummi-Dicke als auch die Größe von Textobjekten
      // (inkSize wird für beides verwendet, siehe unten bei "text").
      var sizeSlider = el('input', {
        type: 'range', min: '2', max: '40', step: '1', value: String(inkSize), class: 'ic-ink-size-slider'
      });
      sizeSlider.addEventListener('input', function () { inkSize = parseFloat(sizeSlider.value); });
      sizeRow.appendChild(sizeSlider);
      toolbar.appendChild(sizeRow);
      updateToolColor();

      var clearBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.draw_clear }, [icon('trash')]);
      clearBtn.addEventListener('click', function () {
        if (strokes.length && !confirm(S.confirmdelete)) { return; }
        strokes = [];
        redraw();
      });
      toolbar.appendChild(clearBtn);

      // Steuert, ob diese Zeichen-/Schreib-Ebene auch auf der Pinnwand
      // sichtbar ist (unabhängig von der Galerie-Anzeige).
      var p0 = state.photos[state.lightboxIndex];
      var onboardBtn = el('button', {
        class: 'ic-btn ' + (p0.annotationonboard !== false ? 'ic-btn-primary' : 'ic-btn-ghost'),
        title: S.overlay_onboard
      }, [icon('thumbtack')]);
      onboardBtn.addEventListener('click', function () {
        var newState = !(p0.annotationonboard !== false);
        callAjax('mod_pinnwand_set_annotation_onboard', { cmid: cfg.cmid, photoid: p0.id, onboard: newState }).then(function (res) {
          p0.annotationonboard = res.annotationonboard;
          onboardBtn.className = 'ic-btn ' + (p0.annotationonboard !== false ? 'ic-btn-primary' : 'ic-btn-ghost');
        });
      });
      toolbar.appendChild(onboardBtn);

      toolbar.id = 'ic-draw-toolbar';
      lb.appendChild(toolbar);

      function toNorm(ev) {
        var r = inkCanvas.getBoundingClientRect();
        var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
        return { x: (t.clientX - r.left) / r.width, y: (t.clientY - r.top) / r.height };
      }

      // ---- Text-Werkzeug: Tippen platziert ein editierbares Textfeld an
      // dieser Stelle, das beim Verlassen/Enter als Text-Element übernommen
      // wird (kein Freihand-Strich, sondern eigener Element-Typ). ----
      var pendingTextEl = null;
      function placeTextInput(pt) {
        if (pendingTextEl) { return; }
        var ta = el('textarea', { class: 'ic-text-input', rows: '1' });
        ta.style.left = (pt.x * 100) + '%';
        ta.style.top = (pt.y * 100) + '%';
        ta.style.color = inkColor;
        ta.style.fontSize = Math.max(10, inkSize * (inkCanvas.height / 900) * 1.6) + 'px';
        imgbox.appendChild(ta);
        pendingTextEl = ta;
        ta.focus();
        function commit() {
          var text = ta.value.trim();
          ta.remove();
          pendingTextEl = null;
          if (text) {
            strokes.push({
              id: 's' + Date.now() + Math.random().toString(36).slice(2, 7), type: 'text',
              x: pt.x, y: pt.y, text: text, color: inkColor, size: inkSize
            });
            redraw();
          }
        }
        ta.addEventListener('blur', commit);
        ta.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); }
          if (ev.key === 'Escape') { ta.value = ''; ta.blur(); }
        });
      }

      function down(ev) {
        var pt = toNorm(ev);
        if (inkTool === 'text') {
          placeTextInput(pt);
          ev.preventDefault(); ev.stopPropagation();
          return;
        }
        currentStroke = { id: 's' + Date.now() + Math.random().toString(36).slice(2, 7), points: [pt],
          color: inkColor, width: inkSize / (inkCanvas.height || 1), erase: inkTool === 'eraser' };
        strokes.push(currentStroke);
        redraw();
        ev.preventDefault(); ev.stopPropagation();
      }
      function moveEv(ev) {
        if (!currentStroke) { return; }
        currentStroke.points.push(toNorm(ev));
        redraw();
        ev.preventDefault(); ev.stopPropagation();
      }
      function up() { currentStroke = null; }
      function dblclick(ev) {
        if (inkTool !== 'eraser') { return; }
        var pt = toNorm(ev);
        var idx = findStrokeAt(strokes, inkCanvas.width, inkCanvas.height, pt);
        if (idx >= 0) { strokes.splice(idx, 1); redraw(); ev.preventDefault(); }
      }
      inkCanvas._icUpHandler = up;
      inkCanvas.addEventListener('mousedown', down);
      inkCanvas.addEventListener('touchstart', down, { passive: false });
      inkCanvas.addEventListener('mousemove', moveEv);
      inkCanvas.addEventListener('touchmove', moveEv, { passive: false });
      inkCanvas.addEventListener('dblclick', dblclick);
      window.addEventListener('mouseup', up);
      inkCanvas.addEventListener('touchend', up);

      stylusBtn.onclick = function () { exitDrawing(true); };
    }

    function exitDrawing(save) {
      if (!drawing) { return; }
      var toolbar = document.getElementById('ic-draw-toolbar');
      if (toolbar) { toolbar.remove(); }
      var p = state.photos[state.lightboxIndex];
      if (save) {
        p.annotationdata = JSON.stringify(strokes);
        callAjax('mod_pinnwand_save_annotation', { cmid: cfg.cmid, photoid: p.id, strokes: p.annotationdata })
          .then(function (res) { p.annotationdata = res.annotationdata; })
          .catch(function () { /* Zeichnung bleibt lokal sichtbar, Speichern fehlgeschlagen */ });
      }
      if (inkCanvas) {
        if (inkCanvas._icUpHandler) { window.removeEventListener('mouseup', inkCanvas._icUpHandler); }
        if (inkCanvas._icResizeHandler) { window.removeEventListener('resize', inkCanvas._icResizeHandler); }
        inkCanvas.remove(); inkCanvas = null; inkCtx = null;
      }
      currentStroke = null;
      drawing = false;
      stylusBtn.classList.remove('active');
      stylusBtn.onclick = function () { closeAllPanels('draw'); enterDrawing(); };
      renderStaticAnnotation(p);
      updateFocusMode();
    }
    stylusBtn.onclick = function () { closeAllPanels('draw'); enterDrawing(); };

    // ---- Zoom per Mausrad, Pinch, Doppeltipp; Pan bei zoom>1 ----
    viewport.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      setZoom(zoom + (ev.deltaY < 0 ? 0.3 : -0.3));
    }, { passive: false });

    var pointers = {};
    var pinchStartDist = 0, pinchStartZoom = 1;
    var panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
    var lastTap = 0;

    viewport.addEventListener('pointerdown', function (ev) {
      if (drawing) { return; }
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        pinchStartDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        pinchStartZoom = zoom;
      } else if (ids.length === 1) {
        panning = zoom > 1;
        panStartX = ev.clientX; panStartY = ev.clientY;
        panOrigX = panX; panOrigY = panY;
        var now = Date.now();
        if (now - lastTap < 300) { setZoom(zoom > 1 ? 1 : 2); }
        lastTap = now;
      }
    });
    viewport.addEventListener('pointermove', function (ev) {
      if (drawing || !pointers[ev.pointerId]) { return; }
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        var dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (pinchStartDist > 0) { setZoom(pinchStartZoom * (dist / pinchStartDist)); }
      } else if (panning) {
        panX = panOrigX + (ev.clientX - panStartX);
        panY = panOrigY + (ev.clientY - panStartY);
        applyTransform();
      }
    });
    function releasePointer(ev) {
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) { pinchStartDist = 0; }
      panning = false;
    }
    viewport.addEventListener('pointerup', releasePointer);
    viewport.addEventListener('pointercancel', releasePointer);

    viewport.addEventListener('click', function (ev) {
      if (ev.target === viewport && zoom <= 1 && !drawing) { closeLightbox(); }
    });

    nav.appendChild(prev); nav.appendChild(zoomOut); nav.appendChild(zoomReset);
    nav.appendChild(zoomIn); nav.appendChild(next);
    lb.appendChild(leftDock); lb.appendChild(close); lb.appendChild(stylusBtn);
    lb.appendChild(viewport); lb.appendChild(caption); lb.appendChild(nav);
    document.body.appendChild(lb);

    // Bild soll die verfügbare Fläche voll ausnutzen: je nach Seitenverhältnis
    // wird die Breite ODER die Höhe zu 100% ausgereizt (schmaler Bildschirm ->
    // Breite bindend, Hochkant-/breiter Bildschirm -> Höhe bindend). Per JS
    // gemessen statt fixer vw/vh-Werte, damit das Raster-Overlay exakt am
    // tatsächlich gerenderten Bild ausgerichtet bleibt (imgbox bleibt eng
    // um das Bild geschrumpft).
    function sizeLightboxImage() {
      var r = viewport.getBoundingClientRect();
      img.style.maxWidth = Math.round(r.width) + 'px';
      img.style.maxHeight = Math.round(r.height) + 'px';
    }
    sizeLightboxImage();
    window.addEventListener('resize', sizeLightboxImage);
    lb._icResizeHandler = sizeLightboxImage;

    refreshOverlays();
    if (startDrawing) { closeAllPanels('draw'); enterDrawing(); } else { updateFocusMode(); }
  }

  function captionText(p) {
    var parts = [p.sourcetitle, p.sourceauthor, p.sourceyear, p.sourceepoch, p.sourceplace].filter(Boolean);
    var text = parts.join(' · ');
    if (p.sourceorigauthor) {
      text += (text ? ' — ' : '') + S.sourceorigauthor + ': ' + p.sourceorigauthor;
    }
    return text;
  }

  // Kompakte Bildunterschrift für die Anordnungs-Leinwand ("Daten anzeigen"):
  // Hochgeladen, Titel, Jahr, Ort.
  // Kompakte Bildunterschrift für die Anordnungs-Leinwand ("Daten anzeigen"):
  // Titel, Autor*in, Entstehungsjahr, Epoche, Ort - kein Upload-Datum (die
  // eigene Leinwand zeigt ohnehin nur eigene Fotos).
  function itemCaptionText(p) {
    var lines = [];
    var top = [p.sourcetitle, p.sourceauthor].filter(Boolean).join(' — ');
    if (p.userfullname && p.userfullname !== p.sourceauthor) { top = (top ? top + ' ' : '') + '(' + p.userfullname + ')'; }
    if (top) { lines.push(top); }
    var rest = [p.sourceyear, p.sourceepoch, p.sourceplace].filter(Boolean).join(' · ');
    if (rest) { lines.push(rest); }
    return lines.join(' / ') || S.sourcetitle + ': –';
  }

  function closeLightbox() {
    var existing = document.querySelector('.ic-lightbox');
    if (existing) {
      if (existing._icResizeHandler) { window.removeEventListener('resize', existing._icResizeHandler); }
      existing.remove();
    }
  }

  // ==================================================================
  // Start: eigene Fotos laden, dann Home rendern
  // ==================================================================
  callAjax('mod_pinnwand_get_photos', { cmid: cfg.cmid }).then(function (res) {
    state.photos = res.photos;
    state.maxpictures = res.max;
    state.background = res.background || { type: 'color', color: '#2b2d33', url: null, brightness: 100, saturation: 100 };
    state.candelete = !!res.candelete;
    state.canmoderate = !!res.canmoderate;
    state.studentcansend = !!res.studentcansend;
    state.teachercansend = !!res.teachercansend;
    state.canusepoststream = state.canmoderate || !!cfg.studentpoststream;
    state.canuselayers = state.canmoderate || !!cfg.studentlayers;

    // Auf großen Bildschirmen startet die Aktivität für ALLE Rollen direkt
    // in der Pinnwand-Ansicht. Auf kleinen Bildschirmen landet nur die
    // Lehrkraft automatisch in der Klassenansicht (Lernende bleiben in
    // "Meine Bilder"). Im Kurs-Bearbeiten-Modus bleibt es beim normalen
    // Menü, damit die Aktivitätseinstellungen weiterhin erreichbar sind.
    if (!cfg.isediting) {
      if (window.innerWidth >= 900) { state.step = 'arrange'; }
      else if (state.canmoderate) { state.step = 'moderate'; }
    }
    render();
    callAjax('mod_pinnwand_get_threads', { cmid: cfg.cmid }).then(function (res) {
      state.threads = res.threads || [];
      state.canusethreads = !!res.canuse;
      if (state.step === 'arrange') { render(); }
    }).catch(function () { /* Fäden bleiben leer, Board funktioniert trotzdem */ });
    loadStreamPhotos();
    callAjax('mod_pinnwand_get_board_names', { cmid: cfg.cmid }).then(function (res) {
      state.boardNames = {};
      (res.names || []).forEach(function (n) { state.boardNames[n.boardid] = n.name; });
      if (state.step === 'arrange') { render(); }
    }).catch(function () { /* Standardtitel bleiben in Kraft */ });
  }).catch(function () {
    render();
  });

})();
