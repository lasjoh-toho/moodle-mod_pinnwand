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
  // Notizen (Stift-Werkzeug) speichern - jede Änderung wird zugleich ein
  // Schritt für Rückgängig/Wiederholen (dieselben Knöpfe wie für Objekte).
  function commitBoardInk() {
    var boardId = state.currentBoard;
    var after = JSON.stringify(state.boardInkStrokes || []);
    var before = state.boardInkSnapshot != null ? state.boardInkSnapshot : '[]';
    state.boardInkSnapshot = after;
    callAjax('mod_pinnwand_save_board_ink', { cmid: cfg.cmid, boardid: boardId, strokes: after });
    if (before === after) { return; }
    function restore(json) {
      if (state.currentBoard !== boardId) { return; }
      state.boardInkStrokes = JSON.parse(json);
      state.boardInkSnapshot = json;
      state.inkSelection = [];
      callAjax('mod_pinnwand_save_board_ink', { cmid: cfg.cmid, boardid: boardId, strokes: json });
    }
    pushUndo({ undo: function () { restore(before); }, redo: function () { restore(after); } });
  }

  // Entf/Rücktaste löscht ausgewählte Notizen (Stift-Werkzeug, Auswahl).
  var inkSelectionDelete = null;
  var inkShapeKeyHandler = null;
  document.addEventListener('keydown', function (ev) {
    if (inkShapeKeyHandler && state.boardDrawMode && (ev.key === 'Enter' || ev.key === 'Escape')) {
      var tk = ev.target;
      if (tk && (tk.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tk.tagName))) { return; }
      if (inkShapeKeyHandler(ev.key)) { ev.preventDefault(); }
    }
  });
  function selectAllInk() {
    state.boardDrawTool = 'select';
    state.boardDrawErase = false;
    state.inkSelection = (state.boardInkStrokes || []).map(function (st) { return st.id; }).filter(Boolean);
    render();
  }
  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'a' || ev.key === 'A') && state.boardDrawMode && state.step === 'arrange') {
      var t0 = ev.target;
      if (t0 && (t0.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t0.tagName))) { return; }
      ev.preventDefault();
      selectAllInk();
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.boardDrawMode && (state.inkSelection || []).length && inkSelectionDelete) {
      var tgt = ev.target;
      if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) { return; }
      ev.preventDefault();
      inkSelectionDelete();
    }
  });
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
    boardDrawPx: 6,        // Stift-Stärke auf der Pinnwand in Bildschirm-Pixeln (zoomunabhängig)
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
      case 'cutout': renderCutout(body); break;
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
    color: S.step_color, cutout: S.step_cutout, source: S.step_source, textframe: S.textframe_title
  };
  // Diese Schritte gehören zum Hinzufügen-Assistenten - der "Hinzufügen"-
  // Navigationsbutton gilt hier ebenfalls als aktiv.
  var ADD_WIZARD_STEPS = { capture: 1, perspective: 1, crop: 1, color: 1, cutout: 1, source: 1, textframe: 1 };

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
    var labels = [S.step_capture, S.step_perspective, S.step_crop, S.step_color, S.step_cutout, S.step_source];
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

  function openWordfieldEditorDirectly(p, fallback) {
    // Wortfeld: direkt in den Editor springen statt erst die Lightbox-
    // Galerie zu öffnen - ein Klick weniger für den häufigen Fall
    // "Textfeld/WordArt bearbeiten".
    try {
      state.textFrame = JSON.parse(p.wordfielddata);
      var tfLoadedDirect = state.textFrame;
      state.wordArtMode = tfLoadedDirect.isWordArt != null
        ? !!tfLoadedDirect.isWordArt
        : tfLoadedDirect.texts.some(function (t) { return (t.wordartStyle && t.wordartStyle !== 'none') || (t.arcStyle && t.arcStyle !== 'none'); });
      resetTfHistory();
      state.editingPhotoId = p.id;
      state.step = 'textframe';
      render();
    } catch (e) {
      fallback();
    }
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
      // Wortfelder (Zettel/WordArt) laufen über dieselbe Live-Darstellung
      // wie auf der Pinnwand, als Ganzes in die Thumbnail-Box eingepasst
      // (buildWordfieldFit) - vorher quoll WordArt über die Box hinaus bzw.
      // wurde vom Box-Schatten als dunkler "Rahmen" hinterlegt, Zettel
      // wurden unten abgeschnitten.
      var thumbTf = null;
      if (p.wordfielddata) {
        try { thumbTf = JSON.parse(p.wordfielddata); } catch (parseErr) { thumbTf = null; }
      }
      var imgWrap = el('div', { class: 'ic-thumb-img-wrap' + (thumbTf ? ' ic-thumb-img-wrap-wordfield' : '') });
      var thumbLiveRendered = false;
      if (thumbTf) {
        try {
          imgWrap.appendChild(buildWordfieldFit(thumbTf));
          thumbLiveRendered = true;
        } catch (thumbErr) {
          console.error('Live-Darstellung in Meine Bilder fehlgeschlagen, Rückfall auf gespeichertes Bild:', thumbErr);
        }
      }
      if (!thumbLiveRendered) { imgWrap.appendChild(el('img', { src: p.url, alt: '' })); }
      imgWrap.addEventListener('click', function () {
        if (p.wordfielddata) {
          openWordfieldEditorDirectly(p, function () { openLightbox(idx); });
        } else {
          openLightbox(idx);
        }
      });
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
      closeAndGo('textframe', function () { state.textFrame = null; resetTfHistory(); state.wordArtMode = false; state.slidePlacement = null; });
    });
    var wordArtBtn = el('button', { class: 'ic-choice-btn' }, [icon('text'), el('span', {}, [S.addwordart])]);
    wordArtBtn.addEventListener('click', function () {
      closeAndGo('textframe', function () { state.textFrame = null; resetTfHistory(); state.wordArtMode = true; state.slidePlacement = null; });
    });
    // Folie: durchsichtiger Rahmen mit mehreren Textfeldern/Objekten über
    // dem sichtbaren Pinnwand-Hintergrund, mit Animationsschritten für die
    // Präsentation. Wird direkt an der gerade sichtbaren Stelle der
    // Pinnwand angelegt, damit der Editor den passenden Hintergrund zeigt.
    // Folie = Rahmen im Roten Faden (wie "Rahmen setzen" im Faden-Menü)
    // mit eigenem Inhalt - entsteht an der gerade sichtbaren Stelle.
    var slideBtn = el('button', { class: 'ic-choice-btn' }, [icon('frameicon'), el('span', {}, [S.addslide])]);
    slideBtn.addEventListener('click', function () {
      var placement = currentSlidePlacement() || { canvasx: 400, canvasy: 300, canvasw: 600, canvasz: 1, boardid: state.currentBoard || 0 };
      var fw = placement.canvasw, fh = Math.round(placement.canvasw * 9 / 16);
      slideBtn.disabled = true;
      callAjax('mod_pinnwand_add_thread_item', {
        cmid: cfg.cmid, itemtype: 'frame', boardid: placement.boardid,
        framex: placement.canvasx, framey: placement.canvasy, framew: fw, frameh: fh, framelabel: ''
      }).then(function (res) {
        replaceOwnThread(res);
        var it = res.items[res.items.length - 1];
        it.framez = placement.canvasz;
        callAjax('mod_pinnwand_update_thread_frame', {
          cmid: cfg.cmid, itemid: it.id, framex: it.framex, framey: it.framey, framew: it.framew, frameh: it.frameh,
          framerot: 0, framez: it.framez
        });
        overlay.remove();
        openFrameSlideEditor(it);
      }).catch(function (e) { slideBtn.disabled = false; alert(S.error_save + ' (' + e.message + ')'); });
    });
    gridText.appendChild(textFrameBtn);
    gridText.appendChild(wordArtBtn);
    if (state.canusethreads) { gridText.appendChild(slideBtn); }
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
    imgResetPipeline();
    state.cutoutUndo = [];
    state.step = 'perspective';
    render();
  }

  // ==================================================================
  // BILDEDITOR: freie Schritte (Entzerren, Drehen, Farbe, Freistellen,
  // Angaben) als Reiter in einer Leiste unten - jeder Schritt per Klick
  // erreichbar. Die Zwischenergebnisse werden bei Bedarf aus der Quelle neu
  // berechnet (imgWork/imgColored/imgFinal); das Freistellen ist eine Maske,
  // die spätere Änderungen an Zuschnitt/Farbe übersteht. Werkzeuge liegen in
  // verschiebbaren Popups (auf dem Handy fest über der Leiste).
  // ==================================================================
  var IMG_STEPS = ['perspective', 'crop', 'color', 'cutout', 'source'];

  function imgResetPipeline() {
    state.imgOrigStored = false;
    state.cornersSrc = null;
    state.imgGeo = { rot: 0, mirror: false };
    state.colorSettings = { brightness: 0, contrast: 0, saturation: 0, grayscale: false };
    state.imgMask = null;
    state.imgCache = {};
    state.imgHistory = [];
    state.imgLeave = null;
  }
  function imgInvalidate(level) {
    state.imgCache = state.imgCache || {};
    if (level === 'work') { state.imgCache.work = null; }
    state.imgCache.colored = null;
  }
  function imgFullCorners() {
    var src = state.sourceCanvas;
    return [{ x: 0, y: 0 }, { x: src.width, y: 0 }, { x: src.width, y: src.height }, { x: 0, y: src.height }];
  }
  function imgCornersAreFull(c) {
    var f = imgFullCorners();
    return c.every(function (p, i) { return Math.abs(p.x - f[i].x) < 1 && Math.abs(p.y - f[i].y) < 1; });
  }
  function imgCopy(c) {
    var o = document.createElement('canvas');
    o.width = c.width; o.height = c.height;
    o.getContext('2d').drawImage(c, 0, 0);
    return o;
  }
  // Entzerrt + gedreht/gespiegelt.
  function imgWork() {
    state.imgCache = state.imgCache || {};
    if (state.imgCache.work) { return state.imgCache.work; }
    var corners = state.cornersSrc || imgFullCorners();
    var c = imgCornersAreFull(corners) ? imgCopy(state.sourceCanvas) : applyPerspectiveCorrection(state.sourceCanvas, corners);
    var geo = state.imgGeo || { rot: 0, mirror: false };
    for (var r = 0; r < geo.rot; r++) { c = rotateCanvas90(c); }
    if (geo.mirror) { c = mirrorCanvas(c); }
    state.imgCache.work = c;
    return c;
  }
  function imgColorNeutral(f) {
    return !f || (!f.brightness && !f.contrast && !f.saturation && !f.grayscale);
  }
  function imgColored() {
    state.imgCache = state.imgCache || {};
    if (state.imgCache.colored) { return state.imgCache.colored; }
    var work = imgWork();
    var out;
    if (imgColorNeutral(state.colorSettings)) {
      out = work;
    } else {
      out = document.createElement('canvas');
      out.width = work.width; out.height = work.height;
      var ctx = out.getContext('2d');
      var src = work.getContext('2d').getImageData(0, 0, work.width, work.height);
      var dst = ctx.createImageData(work.width, work.height);
      applyColorAdjust(src, dst, state.colorSettings);
      ctx.putImageData(dst, 0, 0);
    }
    state.imgCache.colored = out;
    return out;
  }
  function imgMaskFor(c) {
    if (state.imgMask && (state.imgMask.width !== c.width || state.imgMask.height !== c.height)) { state.imgMask = null; }
    return state.imgMask;
  }
  function imgFinal() {
    var colored = imgColored();
    var mask = imgMaskFor(colored);
    var out = imgCopy(colored);
    if (mask) {
      var ctx = out.getContext('2d');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0);
    }
    return out;
  }

  // PNG, sobald das Bild (z. B. nach dem Freistellen) durchsichtige Pixel
  // hat - sonst JPEG (deutlich kleiner).
  function canvasHasAlpha(c) {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (var i = 3; i < d.length; i += 4) { if (d[i] < 255) { return true; } }
    return false;
  }
  function canvasDataUrl(c, quality) {
    return canvasHasAlpha(c) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality || 0.88);
  }

  // Nicht-destruktiv: Original, Maske und Einstellungen werden mit dem
  // fertigen Bild gespeichert - erneutes Bearbeiten startet vom Original.
  function imgEditPayload(forExisting) {
    var mask = state.imgMask;
    var maskData = mask && canvasHasAlpha(mask) ? mask.toDataURL('image/png') : (forExisting ? 'none' : '');
    return {
      origdata: state.imgOrigStored ? '' : canvasDataUrl(state.sourceCanvas, 0.92),
      maskdata: maskData,
      editdata: JSON.stringify({ v: 1, corners: state.cornersSrc || null, geo: state.imgGeo || { rot: 0, mirror: false }, color: state.colorSettings || null })
    };
  }
  function loadImageEl(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = reject;
      im.src = url;
    });
  }
  function loadPhotoForEditing(p) {
    state.editingPhotoId = p.id;
    if (!p.origurl) {
      // Älteres Foto ohne Original: das aktuelle Bild wird zum Original.
      loadImageEl(p.url).then(function (im) { loadCapturedImage(im); state.imgOrigStored = false; })
        .catch(function () { alert(S.url_load_error); });
      return;
    }
    Promise.all([loadImageEl(p.origurl), p.maskurl ? loadImageEl(p.maskurl) : Promise.resolve(null)]).then(function (res) {
      var im = res[0];
      var c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      state.sourceCanvas = c;
      state.corners = null;
      imgResetPipeline();
      state.cutoutUndo = [];
      var ed = null;
      try { ed = p.editdata ? JSON.parse(p.editdata) : null; } catch (e) { ed = null; }
      if (ed) {
        if (ed.corners && ed.corners.length === 4) { state.cornersSrc = ed.corners; }
        if (ed.geo) { state.imgGeo = { rot: (ed.geo.rot || 0) % 4, mirror: !!ed.geo.mirror }; }
        if (ed.color) { state.colorSettings = ed.color; }
      }
      if (res[1]) {
        var m = document.createElement('canvas');
        m.width = res[1].naturalWidth; m.height = res[1].naturalHeight;
        m.getContext('2d').drawImage(res[1], 0, 0);
        state.imgMask = m;
      }
      state.imgOrigStored = true;
      state.step = 'perspective';
      render();
    }).catch(function () { alert(S.url_load_error); });
  }

  function goImgStep(step, noHistory) {
    if (state.imgLeave) { try { state.imgLeave(); } catch (e) { /* ignore */ } state.imgLeave = null; }
    if (!noHistory && state.step !== step) { (state.imgHistory = state.imgHistory || []).push(state.step); }
    state.step = step;
    render();
  }

  function imgSaveExisting(btn) {
    if (state.imgLeave) { state.imgLeave(); state.imgLeave = null; }
    var photoId = state.editingPhotoId;
    btn.disabled = true;
    var payload = imgEditPayload(true);
    callAjax('mod_pinnwand_update_photo', {
      cmid: cfg.cmid, photoid: photoId, imagedata: canvasDataUrl(imgFinal(), 0.88),
      origdata: payload.origdata, maskdata: payload.maskdata, editdata: payload.editdata
    }).then(function (res) {
      refreshPhotos();
      var existing = state.photos.filter(function (p) { return p.id === photoId; })[0];
      if (existing) { existing.url = res.url; }
      resetCaptureState();
      state.step = 'home';
      render();
    }).catch(function (e) {
      alert(S.error_save + ' (' + e.message + ')');
      btn.disabled = false;
    });
  }

  // Leiste unten: Abbrechen, Zurück, Schritt-Reiter, Speichern.
  function imgDock(body, current, onSave) {
    var dock = el('div', { class: 'ic-img-dock' });
    var cancelBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-img-dock-btn', type: 'button', title: S.cancel }, ['✕', el('span', {}, [S.cancel])]);
    cancelBtn.addEventListener('click', function () { resetCaptureState(); state.step = 'home'; render(); });
    var hist = state.imgHistory || [];
    var backBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-img-dock-btn', type: 'button', title: S.back }, [icon('arrowleft'), el('span', {}, [S.back])]);
    backBtn.disabled = !hist.length && IMG_STEPS.indexOf(current) <= 0;
    backBtn.addEventListener('click', function () {
      var h = state.imgHistory || [];
      var prev = h.length ? h.pop() : IMG_STEPS[Math.max(0, IMG_STEPS.indexOf(current) - 1)];
      goImgStep(prev, true);
    });
    dock.appendChild(cancelBtn);
    dock.appendChild(backBtn);
    var tabs = el('div', { class: 'ic-img-tabs' });
    var labels = { perspective: S.step_perspective, crop: S.img_tab_rotate, color: S.step_color, cutout: S.step_cutout, source: S.step_source };
    var icons = { perspective: 'scissors', crop: 'rotate', color: 'fillicon', cutout: 'eraser', source: 'info' };
    IMG_STEPS.forEach(function (st) {
      if (st === 'source' && state.editingPhotoId) { return; }
      var b = el('button', { class: 'ic-img-tab' + (st === current ? ' active' : ''), type: 'button' }, [icon(icons[st]), el('span', {}, [labels[st]])]);
      b.addEventListener('click', function () { if (st !== current) { goImgStep(st); } });
      tabs.appendChild(b);
    });
    dock.appendChild(tabs);
    var saveBtn = el('button', { class: 'ic-btn ic-btn-primary ic-img-dock-btn ic-img-save', type: 'button', title: S.savephoto }, [icon('check'), el('span', {}, [S.savephoto])]);
    saveBtn.addEventListener('click', function () {
      if (state.editingPhotoId) { imgSaveExisting(saveBtn); return; }
      if (current !== 'source') { goImgStep('source'); return; }
      if (onSave) { onSave(saveBtn); }
    });
    dock.appendChild(saveBtn);
    body.appendChild(dock);
    return dock;
  }

  // Verschiebbares Werkzeug-Popup über der Arbeitsfläche; Lage je Popup in
  // state.floatPos. Auf dem Handy (CSS) fest über der Leiste.
  function floatPanel(body, key, title, content) {
    var panel = el('div', { class: 'ic-float-panel', 'data-float': key });
    var head = el('div', { class: 'ic-float-head' }, [el('span', { class: 'ic-float-grip' }, ['☰']), el('span', {}, [title])]);
    var collapsed = !!(state.floatCollapsed || {})[key];
    var minBtn = el('button', { class: 'ic-float-min', type: 'button', title: collapsed ? S.tf_panels_expand : S.tf_panels_collapse }, [collapsed ? '+' : '−']);
    head.appendChild(minBtn);
    panel.appendChild(head);
    var inner = el('div', { class: 'ic-float-body' });
    if (collapsed) { inner.style.display = 'none'; }
    inner.appendChild(content);
    panel.appendChild(inner);
    minBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      state.floatCollapsed = state.floatCollapsed || {};
      state.floatCollapsed[key] = !state.floatCollapsed[key];
      inner.style.display = state.floatCollapsed[key] ? 'none' : '';
      minBtn.textContent = state.floatCollapsed[key] ? '+' : '−';
    });
    body.appendChild(panel);
    state.floatPos = state.floatPos || {};
    function place() {
      var pos = state.floatPos[key];
      var bw = body.clientWidth, bh = body.clientHeight;
      // Standard: oben mittig unter der Kopfzeile - verdeckt so keine der
      // Bildecken (Entzerren startet mit den Ecken am Bildrand).
      if (!pos) { pos = { x: Math.max(8, (bw - panel.offsetWidth) / 2), y: 60 }; }
      pos.x = Math.max(0, Math.min(bw - 60, pos.x));
      pos.y = Math.max(48, Math.min(Math.max(48, bh - 40), pos.y));
      panel.style.left = pos.x + 'px';
      panel.style.top = pos.y + 'px';
    }
    setTimeout(place, 0);
    var drag = null;
    head.addEventListener('pointerdown', function (ev) {
      if (ev.target === minBtn || window.matchMedia('(max-width: 640px)').matches) { return; }
      drag = { sx: ev.clientX, sy: ev.clientY, x: panel.offsetLeft, y: panel.offsetTop };
      try { head.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
    });
    head.addEventListener('pointermove', function (ev) {
      if (!drag) { return; }
      state.floatPos[key] = { x: drag.x + ev.clientX - drag.sx, y: drag.y + ev.clientY - drag.sy };
      place();
    });
    head.addEventListener('pointerup', function () { drag = null; });
    head.addEventListener('pointercancel', function () { drag = null; });
    return panel;
  }

  // ---------------- ENTZERREN: vier Ecken (Start: ganzes Bild) ----------
  function renderPerspective(body) {
    body.classList.add('ic-img-editor');
    var dock = imgDock(body, 'perspective');
    var stage = el('div', { class: 'ic-stage' });
    var canvas = el('canvas', { class: 'ic-view' });
    stage.appendChild(canvas);
    body.insertBefore(stage, dock);
    var src = state.sourceCanvas;
    var fitScale = fitImageToStage(canvas, stage, src.width, src.height);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    var cs = state.cornersSrc || imgFullCorners();
    var points = cs.map(function (p) { return { x: p.x * fitScale, y: p.y * fitScale }; });
    makeDragOverlay(stage, canvas, points, true);
    state.imgLeave = function () {
      var next = points.map(function (p) {
        return { x: Math.max(0, Math.min(src.width, p.x / fitScale)), y: Math.max(0, Math.min(src.height, p.y / fitScale)) };
      });
      var prev = state.cornersSrc || imgFullCorners();
      var changed = next.some(function (p, i) { return Math.abs(p.x - prev[i].x) > 0.5 || Math.abs(p.y - prev[i].y) > 0.5; });
      if (changed) { state.cornersSrc = next; imgInvalidate('work'); }
    };
    var tools = el('div', { class: 'ic-float-tools' });
    tools.appendChild(el('p', { class: 'ic-hint' }, [S.perspective_hint]));
    var resetBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button' }, [S.img_corners_reset]);
    resetBtn.addEventListener('click', function () {
      state.imgLeave = null;
      state.cornersSrc = null;
      imgInvalidate('work');
      render();
    });
    tools.appendChild(resetBtn);
    floatPanel(body, 'perspective', S.step_perspective, tools);
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
        outData.data[di + 2] = px[2]; outData.data[di + 3] = px[3];
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
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    }
    var p00 = px(x0, y0), p10 = px(x1, y0), p01 = px(x0, y1), p11 = px(x1, y1);
    var out = [0, 0, 0, 255];
    for (var c = 0; c < 4; c++) {
      var top = p00[c] * (1 - fx) + p10[c] * fx;
      var bot = p01[c] * (1 - fx) + p11[c] * fx;
      out[c] = Math.round(top * (1 - fy) + bot * fy);
    }
    return out;
  }

  // Zeigt einen Canvas eingepasst auf der Bühne (Anzeige-Canvas im Bildraster).
  function imgShowOnStage(body, srcCanvas, extraClass) {
    var stage = el('div', { class: 'ic-stage' });
    var view = el('canvas', { class: 'ic-view ic-checker-bg' + (extraClass ? ' ' + extraClass : '') });
    view.width = srcCanvas.width; view.height = srcCanvas.height;
    view.getContext('2d').drawImage(srcCanvas, 0, 0);
    stage.appendChild(view);
    body.insertBefore(stage, body.querySelector('.ic-img-dock'));
    var probe = document.createElement('canvas');
    var scale = fitImageToStage(probe, stage, srcCanvas.width, srcCanvas.height);
    view.style.width = probe.style.width;
    view.style.height = probe.style.height;
    return { stage: stage, view: view, scale: scale };
  }

  // ---------------- DREHEN / SPIEGELN -----------------------------------
  function renderCrop(body) {
    body.classList.add('ic-img-editor');
    imgDock(body, 'crop');
    imgShowOnStage(body, imgFinal());
    var tools = el('div', { class: 'ic-float-tools ic-float-row' });
    var rotateBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button' }, [icon('rotate'), el('span', {}, [S.rotate90])]);
    var mirrorBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button' }, [icon('mirror'), el('span', {}, [S.mirror])]);
    rotateBtn.addEventListener('click', function () {
      state.imgGeo.rot = (state.imgGeo.rot + 1) % 4;
      if (state.imgMask) { state.imgMask = rotateCanvas90(state.imgMask); }
      imgInvalidate('work');
      render();
    });
    mirrorBtn.addEventListener('click', function () {
      state.imgGeo.mirror = !state.imgGeo.mirror;
      if (state.imgMask) { state.imgMask = mirrorCanvas(state.imgMask); }
      imgInvalidate('work');
      render();
    });
    tools.appendChild(rotateBtn);
    tools.appendChild(mirrorBtn);
    floatPanel(body, 'crop', S.img_tab_rotate, tools);
  }

  // ---------------- FARBE ------------------------------------------------
  function renderColor(body) {
    body.classList.add('ic-img-editor');
    imgDock(body, 'color');
    var work = imgWork();
    var shown = imgShowOnStage(body, work);
    var view = shown.view, vctx = view.getContext('2d');
    var baseData = work.getContext('2d').getImageData(0, 0, work.width, work.height);
    function draw() {
      var out = vctx.createImageData(work.width, work.height);
      applyColorAdjust(baseData, out, state.colorSettings);
      vctx.putImageData(out, 0, 0);
      var mask = imgMaskFor(work);
      if (mask) {
        vctx.save(); vctx.globalCompositeOperation = 'destination-in'; vctx.drawImage(mask, 0, 0); vctx.restore();
      }
    }
    draw();
    var panel = el('div', { class: 'ic-float-tools' });
    function slider(labelKey, key, min, max) {
      var row = el('div', { class: 'ic-row' });
      row.appendChild(el('label', {}, [S[labelKey]]));
      var input = el('input', { type: 'range', min: min, max: max, value: state.colorSettings[key] });
      input.addEventListener('input', function () {
        state.colorSettings[key] = parseInt(input.value, 10);
        imgInvalidate('color');
        draw();
      });
      row.appendChild(input);
      panel.appendChild(row);
    }
    slider('brightness', 'brightness', -100, 100);
    slider('contrast', 'contrast', -100, 100);
    slider('saturation', 'saturation', -100, 100);
    var grayRow = el('div', { class: 'ic-row' });
    var grayInput = el('input', { type: 'checkbox' });
    grayInput.checked = state.colorSettings.grayscale;
    grayInput.addEventListener('change', function () {
      state.colorSettings.grayscale = grayInput.checked;
      imgInvalidate('color');
      draw();
    });
    grayRow.appendChild(el('label', {}, [S.grayscale]));
    grayRow.appendChild(grayInput);
    panel.appendChild(grayRow);
    var resetBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button' }, [S.cutout_reset]);
    resetBtn.addEventListener('click', function () {
      state.colorSettings = { brightness: 0, contrast: 0, saturation: 0, grayscale: false };
      imgInvalidate('color');
      render();
    });
    panel.appendChild(resetBtn);
    // Überlagerung mit dem Hintergrund (nur für schon gespeicherte Bilder).
    var blendPhoto = state.editingPhotoId ? state.photos.filter(function (o) { return o.id === state.editingPhotoId; })[0] : null;
    if (blendPhoto) {
      var blendRow = el('div', { class: 'ic-row' });
      blendRow.appendChild(el('label', {}, [S.blend_mode_short]));
      blendRow.appendChild(blendModePicker(function () { return blendPhoto; }, null));
      panel.appendChild(blendRow);
    }
    floatPanel(body, 'color', S.step_color, panel);
  }

  // Auswahl nach Farbähnlichkeit (wie "Sofort-Alpha" in der Vorschau von
  // macOS): vom angeklickten Punkt aus werden Pixel gewählt, deren Farbe
  // höchstens "tol" vom Startfarbton abweicht - zusammenhängend (Zauberstab,
  // Flutfüllung über die 4 Nachbarn) oder im ganzen Bild (Farbbereich).
  // Ergebnis: 0/1 je Pixel.
  function colorSelect(data, w, h, sx, sy, tol, contiguous) {
    var d = data, sel = new Uint8Array(w * h);
    sx = Math.max(0, Math.min(w - 1, Math.round(sx))); sy = Math.max(0, Math.min(h - 1, Math.round(sy)));
    // Startfarbe als Mittel eines 3x3-Felds (robuster bei Bildrauschen).
    var r0 = 0, g0 = 0, b0 = 0, cnt = 0;
    for (var yy = Math.max(0, sy - 1); yy <= Math.min(h - 1, sy + 1); yy++) {
      for (var xx = Math.max(0, sx - 1); xx <= Math.min(w - 1, sx + 1); xx++) {
        var k = (yy * w + xx) * 4; r0 += d[k]; g0 += d[k + 1]; b0 += d[k + 2]; cnt++;
      }
    }
    r0 /= cnt; g0 /= cnt; b0 /= cnt;
    var t2 = tol * tol * 3;
    function near(i) {
      var k = i * 4, dr = d[k] - r0, dg = d[k + 1] - g0, db = d[k + 2] - b0;
      // Gewichtung grob nach Helligkeitswahrnehmung.
      return (dr * dr * 1.2 + dg * dg * 1.6 + db * db * 0.8) / 1.2 <= t2;
    }
    if (!contiguous) {
      for (var i = 0; i < w * h; i++) { if (near(i)) { sel[i] = 1; } }
      return sel;
    }
    var stack = new Int32Array(w * h), sp = 0, seen = new Uint8Array(w * h);
    var start = sy * w + sx;
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      var p = stack[--sp];
      if (!near(p)) { continue; }
      sel[p] = 1;
      var x = p % w;
      if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (p >= w && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (p < w * (h - 1) && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    return sel;
  }
  // Auswahl als Canvas (weiß = gewählt), leicht weichgezeichnet für eine
  // saubere Kante statt Treppenstufen.
  function selectionCanvas(sel, w, h, feather) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h), o = img.data;
    for (var i = 0; i < sel.length; i++) { if (sel[i]) { var k = i * 4; o[k] = o[k + 1] = o[k + 2] = o[k + 3] = 255; } }
    ctx.putImageData(img, 0, 0);
    if (!feather) { return c; }
    var f = document.createElement('canvas');
    f.width = w; f.height = h;
    var fctx = f.getContext('2d');
    fctx.filter = 'blur(' + feather + 'px)';
    fctx.drawImage(c, 0, 0);
    return f;
  }

  // ---------------- FREISTELLEN (Maske) ----------------------------------
  function renderCutout(body) {
    body.classList.add('ic-img-editor');
    imgDock(body, 'cutout');
    var colored = imgColored();
    var mask = imgMaskFor(colored);
    if (!mask) {
      mask = document.createElement('canvas');
      mask.width = colored.width; mask.height = colored.height;
      var mctx0 = mask.getContext('2d');
      mctx0.fillStyle = '#fff';
      mctx0.fillRect(0, 0, mask.width, mask.height);
      state.imgMask = mask;
    }
    var mctx = mask.getContext('2d');
    state.cutoutUndo = state.cutoutUndo || [];
    if (!state.cutoutTool) { state.cutoutTool = 'erase'; }
    if (!state.cutoutSize) { state.cutoutSize = 30; }

    var shown = imgShowOnStage(body, colored, 'ic-cutout-view');
    var view = shown.view, vctx = view.getContext('2d'), dispScale = shown.scale;
    var preview = null, wandOverlay = null, wandSel = null, colorData = null;
    if (!state.cutoutTol) { state.cutoutTol = 28; }
    function getColorData() {
      if (!colorData) { colorData = colored.getContext('2d').getImageData(0, 0, colored.width, colored.height).data; }
      return colorData;
    }
    // Markierung der aktuellen Auswahl (Magenta) für die Live-Vorschau.
    function buildWandOverlay(sel) {
      var c = document.createElement('canvas');
      c.width = colored.width; c.height = colored.height;
      var ctx = c.getContext('2d'), img = ctx.createImageData(c.width, c.height), o = img.data;
      for (var i = 0; i < sel.length; i++) { if (sel[i]) { var k = i * 4; o[k] = 255; o[k + 1] = 0; o[k + 2] = 200; o[k + 3] = 255; } }
      ctx.putImageData(img, 0, 0);
      return c;
    }
    var wandFrame = null;
    function updateWand() {
      wandFrame = null;
      if (!drag || !drag.wand) { return; }
      var tol = Math.max(0, Math.min(255, state.cutoutTol + drag.extra));
      wandSel = colorSelect(getColorData(), colored.width, colored.height, drag.seed.x, drag.seed.y, tol, drag.contiguous);
      wandOverlay = buildWandOverlay(wandSel);
      redraw();
    }
    function shapePath(ctx, r) {
      var x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
      var w = Math.abs(r.x2 - r.x1), h = Math.abs(r.y2 - r.y1);
      ctx.beginPath();
      if (r.kind === 'ellipse') {
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
      } else {
        ctx.rect(x, y, w, h);
      }
    }
    function redraw() {
      vctx.save();
      vctx.globalCompositeOperation = 'copy';
      vctx.drawImage(colored, 0, 0);
      vctx.restore();
      vctx.save();
      vctx.globalCompositeOperation = 'destination-in';
      vctx.drawImage(mask, 0, 0);
      vctx.restore();
      if (wandOverlay) {
        vctx.save();
        vctx.globalAlpha = 0.55;
        vctx.drawImage(wandOverlay, 0, 0);
        vctx.restore();
      }
      if (preview) {
        vctx.save();
        vctx.lineWidth = 2 / dispScale;
        vctx.setLineDash([8 / dispScale, 6 / dispScale]);
        vctx.strokeStyle = '#fff';
        shapePath(vctx, preview);
        vctx.stroke();
        vctx.strokeStyle = '#000';
        vctx.lineDashOffset = 7 / dispScale;
        vctx.stroke();
        vctx.restore();
      }
    }
    function pushUndo() {
      state.cutoutUndo.push(imgCopy(mask));
      if (state.cutoutUndo.length > 20) { state.cutoutUndo.shift(); }
    }
    function stamp(x, y, r, restore) {
      mctx.save();
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      if (restore) { mctx.fillStyle = '#fff'; } else { mctx.globalCompositeOperation = 'destination-out'; }
      mctx.fill();
      mctx.restore();
    }
    function toImg(ev) {
      var rc = view.getBoundingClientRect();
      return { x: (ev.clientX - rc.left) / rc.width * view.width, y: (ev.clientY - rc.top) / rc.height * view.height };
    }
    var drag = null;
    view.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      try { view.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      var pt = toImg(ev);
      pushUndo();
      var tool = state.cutoutTool;
      if (tool === 'wand' || tool === 'color') {
        // Klicken = Auswahl mit eingestellter Toleranz; Ziehen nach rechts/
        // unten erweitert, nach links/oben verkleinert sie (live sichtbar).
        drag = { wand: true, contiguous: tool === 'wand', seed: pt, sx: ev.clientX, sy: ev.clientY, extra: 0,
          show: (state.cutoutWandMode === 'show') !== !!ev.altKey };
        updateWand();
        return;
      }
      if (tool === 'erase' || tool === 'restore') {
        var r = state.cutoutSize / 2 / dispScale;
        drag = { brush: true, restore: tool === 'restore', last: pt, r: r };
        stamp(pt.x, pt.y, r, drag.restore);
      } else {
        drag = { brush: false };
        preview = { kind: tool, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      }
      redraw();
    });
    view.addEventListener('pointermove', function (ev) {
      if (!drag) { return; }
      if (drag.wand) {
        drag.extra = Math.round(((ev.clientX - drag.sx) + (ev.clientY - drag.sy)) / 3);
        if (!wandFrame) { wandFrame = requestAnimationFrame(updateWand); }
        return;
      }
      var pt = toImg(ev);
      if (drag.brush) {
        var dx = pt.x - drag.last.x, dy = pt.y - drag.last.y;
        var n = Math.ceil(Math.sqrt(dx * dx + dy * dy) / Math.max(1, drag.r / 3));
        for (var i = 1; i <= n; i++) { stamp(drag.last.x + dx * i / n, drag.last.y + dy * i / n, drag.r, drag.restore); }
        drag.last = pt;
      } else {
        preview.x2 = pt.x; preview.y2 = pt.y;
        if (ev.shiftKey) {
          var side = Math.max(Math.abs(pt.x - preview.x1), Math.abs(pt.y - preview.y1));
          preview.x2 = preview.x1 + (pt.x < preview.x1 ? -side : side);
          preview.y2 = preview.y1 + (pt.y < preview.y1 ? -side : side);
        }
      }
      redraw();
    });
    function endDrag() {
      if (!drag) { return; }
      if (drag.wand) {
        if (wandFrame) { cancelAnimationFrame(wandFrame); wandFrame = null; updateWand(); }
        if (wandSel) {
          var selC = selectionCanvas(wandSel, colored.width, colored.height, 1);
          mctx.save();
          // Entfernen: Auswahl aus der Maske stanzen; Zeigen: wieder deckend.
          mctx.globalCompositeOperation = drag.show ? 'source-over' : 'destination-out';
          mctx.drawImage(selC, 0, 0);
          mctx.restore();
          state.cutoutTol = Math.max(0, Math.min(255, state.cutoutTol + drag.extra));
          if (tolInput) { tolInput.value = state.cutoutTol; }
        }
        wandSel = null; wandOverlay = null; drag = null;
        redraw();
        return;
      }
      if (!drag.brush && preview) {
        if (Math.abs(preview.x2 - preview.x1) > 3 && Math.abs(preview.y2 - preview.y1) > 3) {
          mctx.save();
          mctx.globalCompositeOperation = (state.cutoutShapeMode || 'keep') === 'keep' ? 'destination-in' : 'destination-out';
          mctx.fillStyle = '#fff';
          shapePath(mctx, preview);
          mctx.fill();
          mctx.restore();
        } else {
          state.cutoutUndo.pop();
        }
        preview = null;
      }
      drag = null;
      redraw();
    }
    view.addEventListener('pointerup', endDrag);
    view.addEventListener('pointercancel', endDrag);
    redraw();

    var tools = el('div', { class: 'ic-float-tools ic-cutout-tools' });
    var toolRow = el('div', { class: 'ic-float-row' });
    var toolBtns = {};
    [
      { key: 'erase', icon: 'eraser', label: S.cutout_erase },
      { key: 'restore', icon: 'brush', label: S.cutout_restore },
      { key: 'rect', icon: 'rectsel', label: S.cutout_rect },
      { key: 'ellipse', icon: 'ellipsesel', label: S.cutout_ellipse },
      { key: 'wand', icon: 'wand', label: S.cutout_wand },
      { key: 'color', icon: 'fillicon', label: S.cutout_colorrange }
    ].forEach(function (t) {
      var b = el('button', { class: 'ic-btn ic-btn-ghost' + (state.cutoutTool === t.key ? ' active' : ''), type: 'button', title: t.label },
        [icon(t.icon), el('span', {}, [t.label])]);
      b.addEventListener('click', function () {
        state.cutoutTool = t.key;
        Object.keys(toolBtns).forEach(function (k) { toolBtns[k].classList.toggle('active', k === t.key); });
        syncOptions();
      });
      toolBtns[t.key] = b;
      toolRow.appendChild(b);
    });
    tools.appendChild(toolRow);
    var sizeWrap = el('label', { class: 'ic-cutout-size' }, [S.cutout_size]);
    var sizeInput = el('input', { type: 'range', min: 4, max: 120, value: state.cutoutSize });
    sizeInput.addEventListener('input', function () { state.cutoutSize = parseInt(sizeInput.value, 10); });
    sizeWrap.appendChild(sizeInput);
    tools.appendChild(sizeWrap);
    var modeSel = el('select', { class: 'ic-cutout-mode', title: S.cutout_shape_mode });
    [['keep', S.cutout_keep], ['remove', S.cutout_remove]].forEach(function (o) {
      var opt = el('option', { value: o[0] }, [o[1]]);
      if ((state.cutoutShapeMode || 'keep') === o[0]) { opt.selected = true; }
      modeSel.appendChild(opt);
    });
    modeSel.addEventListener('change', function () { state.cutoutShapeMode = modeSel.value; });
    tools.appendChild(modeSel);
    // Zauberstab/Farbbereich: Toleranz + Entfernen/Wieder zeigen.
    var wandBox = el('div', { class: 'ic-float-tools' });
    var tolWrap = el('label', { class: 'ic-cutout-size' }, [S.cutout_tolerance]);
    var tolInput = el('input', { type: 'range', min: 0, max: 160, value: state.cutoutTol });
    tolInput.addEventListener('input', function () { state.cutoutTol = parseInt(tolInput.value, 10); });
    tolWrap.appendChild(tolInput);
    wandBox.appendChild(tolWrap);
    var wandModeRow = el('div', { class: 'ic-float-row' });
    [['remove', S.cutout_wand_remove], ['show', S.cutout_wand_show]].forEach(function (m) {
      var mb = el('button', { class: 'ic-btn ic-btn-ghost' + ((state.cutoutWandMode || 'remove') === m[0] ? ' active' : ''), type: 'button' }, [m[1]]);
      mb.addEventListener('click', function () {
        state.cutoutWandMode = m[0];
        wandModeRow.querySelectorAll('.ic-btn').forEach(function (b2) { b2.classList.toggle('active', b2 === mb); });
      });
      wandModeRow.appendChild(mb);
    });
    wandBox.appendChild(wandModeRow);
    wandBox.appendChild(el('p', { class: 'ic-hint' }, [S.cutout_wand_hint]));
    tools.appendChild(wandBox);
    function syncOptions() {
      var brush = state.cutoutTool === 'erase' || state.cutoutTool === 'restore';
      var wand = state.cutoutTool === 'wand' || state.cutoutTool === 'color';
      sizeWrap.style.display = brush ? '' : 'none';
      modeSel.style.display = (brush || wand) ? 'none' : '';
      wandBox.style.display = wand ? '' : 'none';
    }
    syncOptions();
    var actRow = el('div', { class: 'ic-float-row' });
    var undoBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button', title: S.cutout_undo }, [icon('undo'), el('span', {}, [S.cutout_undo])]);
    var resetBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button', title: S.cutout_reset }, [S.cutout_reset]);
    undoBtn.addEventListener('click', function () {
      var prev = state.cutoutUndo.pop();
      if (!prev) { return; }
      mctx.save(); mctx.globalCompositeOperation = 'copy'; mctx.drawImage(prev, 0, 0); mctx.restore();
      redraw();
    });
    resetBtn.addEventListener('click', function () {
      pushUndo();
      mctx.save(); mctx.globalCompositeOperation = 'copy'; mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, mask.width, mask.height); mctx.restore();
      redraw();
    });
    actRow.appendChild(undoBtn);
    actRow.appendChild(resetBtn);
    tools.appendChild(actRow);
    var generalHint = el('p', { class: 'ic-hint' }, [S.cutout_hint]);
    tools.appendChild(generalHint);
    generalHint.style.display = (state.cutoutTool === 'wand' || state.cutoutTool === 'color') ? 'none' : '';
    toolRow.addEventListener('click', function () {
      generalHint.style.display = (state.cutoutTool === 'wand' || state.cutoutTool === 'color') ? 'none' : '';
    });
    floatPanel(body, 'cutout', S.step_cutout, tools);
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
      o[i] = clamp255(r); o[i + 1] = clamp255(g); o[i + 2] = clamp255(b); o[i + 3] = d[i + 3];
    }
  }
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  // ==================================================================
  // ANGABEN: Quellenangaben (optional) + Einwilligung, dann Speichern.
  // Das Raster wird NICHT hier festgelegt - es wird erst später in der
  // Galerieansicht (Lightbox) pro Foto definiert (siehe openLightbox()).
  // ==================================================================
  function renderSource(body) {
    body.classList.add('ic-img-editor', 'ic-img-source');
    var finalCanvas = imgFinal();

    var preview = el('div', { class: 'ic-stage', style: 'flex:0 0 34%' });
    var img = el('img', { class: 'ic-checker-bg', src: canvasDataUrl(finalCanvas, 0.7), style: 'max-width:100%;max-height:100%' });
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

    // Speichern über die Leiste unten (Haken).
    imgDock(body, 'source', function (saveBtn) {
      saveBtn.disabled = true;
      // Das Raster wird hier bewusst noch NICHT festgelegt - das passiert
      // erst später pro Foto in der Galerieansicht (Lightbox).
      var dataUrl = canvasDataUrl(finalCanvas, 0.88);
      var editPayload = imgEditPayload(false);
      callAjax('mod_pinnwand_save_photo', {
        cmid: cfg.cmid,
        imagedata: dataUrl,
        origdata: editPayload.origdata,
        maskdata: editPayload.maskdata,
        editdata: editPayload.editdata,
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
  }

  function resetCaptureState() {
    imgResetPipeline();
    state.sourceCanvas = null;
    state.corners = null;
    state.workCanvas = null;
    state.cropRect = null;
    state.finalCanvas = null;
    state.colorBase = null;
    state.cutoutCanvas = null;
    state.cutoutUndo = null;
    state.sourceCanvasOut = null;
    state.editingPhotoId = null;
    state.textFrame = null;
    state.slidePlacement = null;
    state.slideBlendPending = '';
    state.editingFrameItemId = null;
    state.slideScale = null;
    state.slideShift = null;
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
      // Folien werden aus der Pinnwand heraus bearbeitet - dorthin zurück.
      var back = state.editingFrameItemId ? 'arrange' : 'home';
      resetCaptureState();
      state.step = back;
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
    { id: 'serif', label: 'Serif', css: "Georgia, 'Times New Roman', serif" },
    { id: 'mono', label: 'Mono', css: "'Courier New', monospace" },
    { id: 'hand', label: 'Handschrift', css: "'Caveat', cursive", webfont: 'Caveat:wght@600' }
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
    var size = 260, cx = size / 2, cy = size / 2, outerR = size / 2 - 5, innerR = outerR - 26;
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
        ctx.arc(cx, cy, (outerR + innerR) / 2, (deg - 90 - 1.2) * Math.PI / 180, (deg - 90 + 1.2) * Math.PI / 180);
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
    'Open Sans': "'Open Sans', sans-serif", 'Courier New': "'Courier New', monospace",
    'Arial Narrow': "'Arial Narrow', Arial, sans-serif", 'Century Gothic': "'Century Gothic', sans-serif",
    'Georgia': 'Georgia, serif', 'Times New Roman': "'Times New Roman', serif", 'Palatino': 'Palatino, serif'
  };
  // "Font Name" -> "Font+Name" für die Google-Fonts-CSS2-API.
  function googleFontParam(name) { return name.replace(/ /g, '+'); }
  // Liefert die einsetzbare font-family-CSS-Deklaration für einen
  // WordArt-Katalogeintrag und lädt bei Bedarf die Google-Fonts-Datei nach.
  // WICHTIG: einfache statt doppelte Anführungszeichen um Namen mit
  // Leerzeichen - dieser Wert landet auch als SVG-XML-Attribut
  // (font-family="..."), das selbst schon doppelt-quotiert ist. Doppelte
  // Anführungszeichen hier würden das SVG ungültig machen und komplett
  // zum Verschwinden bringen.
  function wordartFontCss(name) {
    if (WORDART_WEBSAFE_FONTS[name]) { return WORDART_WEBSAFE_FONTS[name]; }
    ensureWebfont(googleFontParam(name));
    return "'" + name + "', sans-serif";
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
  // Grundformen (Rechteck/Kreis/...) - global statt nur im Editor, weil
  // auch die Live-Darstellung (Pinnwand, Vorschau, gespeichertes SVG) sie
  // auflösen muss (vorher "BASIC_SHAPES is not defined" beim Speichern).
  var BASIC_SHAPES = [
    { id: 'rect', label: S.tf_shape_rect, d: 'M5 5 L95 5 L95 95 L5 95 Z' },
    { id: 'rounded', label: S.tf_shape_rounded, d: 'M25 5 L75 5 A20 20 0 0 1 95 25 L95 75 A20 20 0 0 1 75 95 L25 95 A20 20 0 0 1 5 75 L5 25 A20 20 0 0 1 25 5 Z' },
    { id: 'circle', label: S.tf_shape_circle, d: 'M50 5 A45 45 0 1 1 49.9 5 Z' },
    { id: 'ellipse', label: S.tf_shape_ellipse, d: 'M50 20 A45 30 0 1 1 49.9 20 Z' }
  ];
  // Parametrische Vektorformen: Stern (Zackenzahl, Innenradius) und
  // Sprechblase (Rund/Eckig/Gedanke, Richtung und Länge der Spitze) - der
  // Pfad wird aus den Parametern der jeweiligen Form berechnet, bleibt also
  // bei jeder Größe scharf und nachträglich einstellbar.
  var PARAM_SHAPES = [
    { id: 'star', label: 'Stern', defaults: { points: 5, inner: 0.45 } },
    { id: 'star8', base: 'star', label: 'Stern (8 Zacken)', defaults: { points: 8, inner: 0.6 } },
    { id: 'starburst', base: 'star', label: 'Explosion', defaults: { points: 14, inner: 0.72 } },
    { id: 'bubble', label: 'Sprechblase', defaults: { bubble: 'round', tailAngle: 125, tailLen: 0.35 } },
    { id: 'bubblerect', base: 'bubble', label: 'Sprechblase eckig', defaults: { bubble: 'rect', tailAngle: 125, tailLen: 0.35 } },
    { id: 'thought', base: 'bubble', label: 'Gedankenblase', defaults: { bubble: 'thought', tailAngle: 125, tailLen: 0.4 } }
  ];
  function r2(v) { return Math.round(v * 100) / 100; }
  function starPathD(points, inner) {
    points = Math.max(3, Math.min(24, Math.round(points || 5)));
    inner = Math.max(0.1, Math.min(0.95, inner != null ? inner : 0.45));
    var d = '', n = points * 2;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + i * Math.PI / points;
      var r = i % 2 ? 45 * inner : 45;
      d += (i ? ' L' : 'M') + r2(50 + r * Math.cos(a)) + ' ' + r2(50 + r * Math.sin(a));
    }
    return d + ' Z';
  }
  // Sprechblase als EIN geschlossener Umriss (Körper + Spitze), damit eine
  // Kontur sauber außen herum läuft statt quer über den Ansatz der Spitze.
  // Körper: Superellipse (n=2 Ellipse, n=5 fast Rechteck mit runden Ecken),
  // die Spitze ersetzt einen kleinen Bogenabschnitt in Richtung tailAngle.
  function bubblePathD(style, tailAngle, tailLen) {
    var cx = 50, cy = 50, a = 44, b = 30;
    var ta = ((tailAngle != null ? tailAngle : 125) % 360) * Math.PI / 180;
    var len = Math.max(0, Math.min(1, tailLen != null ? tailLen : 0.35));
    function body(phi, n) {
      var c = Math.cos(phi), sn = Math.sin(phi);
      return [cx + a * (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), 2 / n), cy + b * (sn < 0 ? -1 : 1) * Math.pow(Math.abs(sn), 2 / n)];
    }
    function tipPoint() {
      var edge = body(ta, style === 'rect' ? 5 : 2);
      var dx = edge[0] - cx, dy = edge[1] - cy, dl = Math.sqrt(dx * dx + dy * dy) || 1;
      var ext = 6 + len * 40;
      return [Math.max(1, Math.min(99, edge[0] + dx / dl * ext)), Math.max(1, Math.min(99, edge[1] + dy / dl * ext))];
    }
    if (style === 'thought') {
      // Wolkiger Körper (Bögen auf einer Ellipse) plus zwei kleine Kreise
      // in Richtung der Spitze.
      var bumps = 11, d = '';
      for (var i = 0; i <= bumps; i++) {
        var p = body(i / bumps * Math.PI * 2, 2);
        p = [cx + (p[0] - cx) * 0.86, cy + (p[1] - cy) * 0.82];
        d += (i ? ' A9 9 0 0 1 ' : 'M') + r2(p[0]) + ' ' + r2(p[1]);
      }
      d += ' Z';
      var tip = tipPoint(), e = body(ta, 2);
      [[0.45, 5.5], [0.85, 3.5]].forEach(function (c) {
        var x = e[0] + (tip[0] - e[0]) * c[0], y = e[1] + (tip[1] - e[1]) * c[0], r = c[1];
        d += ' M' + r2(x - r) + ' ' + r2(y) + ' A' + r + ' ' + r + ' 0 1 0 ' + r2(x + r) + ' ' + r2(y) +
          ' A' + r + ' ' + r + ' 0 1 0 ' + r2(x - r) + ' ' + r2(y) + ' Z';
      });
      return d;
    }
    var n = style === 'rect' ? 5 : 2, steps = 96, half = 0.2, out = '', started = false;
    for (var k = 0; k <= steps; k++) {
      var phi = ta + half + (k / steps) * (Math.PI * 2 - 2 * half);
      var q = body(phi, n);
      out += (started ? ' L' : 'M') + r2(q[0]) + ' ' + r2(q[1]);
      started = true;
    }
    var t2 = tipPoint();
    out += ' L' + r2(t2[0]) + ' ' + r2(t2[1]);
    return out + ' Z';
  }
  function paramShapeInfo(type) {
    var def = PARAM_SHAPES.filter(function (p) { return p.id === type; })[0];
    return def ? { base: def.base || def.id, def: def } : null;
  }
  // EINE Stelle, die für eine Form (tf.shapes-Eintrag) ihren Pfad liefert -
  // gemeinsam für Editor, Pinnwand/Vorschau und gespeichertes SVG.
  function shapeDefFor(s) {
    if (!s || !s.type || s.type === 'none') { return null; }
    if (s.type === 'custom' && s.customPoints) {
      return { d: s.customPoints.map(function (p, i) { return (i === 0 ? 'M' : 'L') + (p[0] * 100) + ' ' + (p[1] * 100); }).join(' ') + ' Z' };
    }
    var pinfo = paramShapeInfo(s.type);
    if (pinfo) {
      var dfl = pinfo.def.defaults;
      if (pinfo.base === 'star') {
        return { d: starPathD(s.points != null ? s.points : dfl.points, s.inner != null ? s.inner : dfl.inner) };
      }
      return { d: bubblePathD(s.bubble || dfl.bubble, s.tailAngle != null ? s.tailAngle : dfl.tailAngle, s.tailLen != null ? s.tailLen : dfl.tailLen) };
    }
    return [].concat.apply([], Object.keys(FG_SHAPE_CATEGORIES).map(function (c) { return FG_SHAPE_CATEGORIES[c]; }))
      .concat(BASIC_SHAPES).filter(function (d) { return d.id === s.type; })[0] || null;
  }
  // Maße einer Form in tf-Koordinaten: Höhe = Anteil an der kürzeren
  // Kartenseite (wie im Editor), Breite = Höhe x Seitenverhältnis (aspect,
  // Standard 1) - dadurch lässt sich eine Form auch breit um einen Text
  // herum legen (z.B. Sprechblase/Banner um ein Wort).
  function shapeBox(tf, s) {
    var h = Math.min(tf.w, tf.h) * (s.size || 0.4);
    return { w: h * (s.aspect || 1), h: h };
  }

  var FG_SHAPE_CATEGORY_LABELS = { grundformen: 'Grundformen', symbolformen: 'Symbolformen', blockpfeile: 'Blockpfeile' };
  var fgShapeGradientCounter = 0;
  // Rechnet einen Verlauf-Winkel (gleiche Konvention wie der drehbare
  // Pfeil/die Live-Textdarstellung) in x1/y1/x2/y2 für ein SVG
  // <linearGradient> um (objectBoundingBox, 0..1), statt einer festen
  // Diagonale.
  // Verlauf-Stufen vereinheitlichen: sowohl das alte, einfache 2-Farben-
  // Format (['#a','#b']) als auch das neue Mehrstufen-Format
  // ([{color,pos}, ...]) werden hier auf Letzteres normalisiert -
  // Rückwärtskompatibilität für bereits gespeicherte Zettel.
  var gradientStopIdCounter = 1;
  // Mischt zwei Hex-Farben (t = 0..1) - für neue Verlaufsmarker.
  function mixHexColors(a, b, t) {
    function hx(c) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null; }
    var ca = hx(a), cb = hx(b);
    if (!ca || !cb) { return a; }
    return '#' + [0, 1, 2].map(function (i) { return ('0' + Math.round(ca[i] + (cb[i] - ca[i]) * t).toString(16)).slice(-2); }).join('');
  }
  function normalizeGradientStops(g) {
    if (!g || !g.length) { return null; }
    if (typeof g[0] === 'string') {
      return g.map(function (c, i) { return { color: c, pos: g.length > 1 ? i / (g.length - 1) : 0, sid: gradientStopIdCounter++ }; });
    }
    var out = g.slice().sort(function (a, b) { return a.pos - b.pos; });
    out.forEach(function (s) { if (s.sid == null) { s.sid = gradientStopIdCounter++; } });
    return out;
  }
  function gradientCssStops(g) {
    var stops = normalizeGradientStops(g);
    return stops.map(function (s) { return s.color + ' ' + Math.round(s.pos * 100) + '%'; }).join(',');
  }
  function gradientSvgVector(angle) {
    var rad = ((angle != null ? angle : 135) + 90) * Math.PI / 180;
    var dx = Math.cos(rad) * 0.5, dy = Math.sin(rad) * 0.5;
    return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
  }
  // Verlauf (linear oder radial, fillGradientType) als CSS bzw. SVG - EINE
  // Stelle für Text, Karte und Formen in Editor, Pinnwand und SVG.
  function cssGradientFor(o) {
    var stops = gradientCssStops(o.fillGradient);
    if (o.fillGradientType === 'radial') { return 'radial-gradient(circle at 50% 50%,' + stops + ')'; }
    return 'linear-gradient(' + ((o.fillGradientAngle != null ? o.fillGradientAngle : 135) + 90) + 'deg,' + stops + ')';
  }
  function svgGradientTag(id, o, esc) {
    var stopsXml = normalizeGradientStops(o.fillGradient).map(function (st) {
      return '<stop offset="' + st.pos + '" stop-color="' + (esc ? escapeXml(st.color) : st.color) + '"/>';
    }).join('');
    if (o.fillGradientType === 'radial') {
      return '<radialGradient id="' + id + '" cx="0.5" cy="0.5" r="0.5">' + stopsXml + '</radialGradient>';
    }
    var gv = gradientSvgVector(o.fillGradientAngle);
    return '<linearGradient id="' + id + '" x1="' + gv.x1 + '" y1="' + gv.y1 + '" x2="' + gv.x2 + '" y2="' + gv.y2 + '">' + stopsXml + '</linearGradient>';
  }
  function fgShapeSvgDataUri(shape, style) {
    // Rückwärtskompatibel: reiner Farb-String (z.B. für Rastervorschauen)
    // wird als einfache Fläche ohne Kontur/Effekte behandelt.
    if (typeof style === 'string') { style = { fillColor: style }; }
    var defs = '', fillAttr = 'fill="' + (style.fillColor || '#e0503f') + '"';
    if (style.fillGradient && style.fillGradient.length >= 2) {
      var gid = 'fgshapegrad' + (fgShapeGradientCounter++);
      defs += svgGradientTag(gid, style, false);
      fillAttr = 'fill="url(#' + gid + ')"';
    }
    var filterAttr = '';
    if (style.shadowOn) {
      var fid = 'fgshapeshadow' + (fgShapeGradientCounter++);
      var shAngle2 = (style.shadowAngle != null ? style.shadowAngle : 45) * Math.PI / 180;
      var shDist2 = style.shadowDistance != null ? style.shadowDistance : 3;
      defs += '<filter id="' + fid + '" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feDropShadow dx="' + (Math.cos(shAngle2) * shDist2).toFixed(1) + '" dy="' + (Math.sin(shAngle2) * shDist2).toFixed(1) +
        '" stdDeviation="' + ((style.shadowBlur || 4) / 4) +
        '" flood-color="' + (style.shadowColor || '#000') + '"/></filter>';
      filterAttr = ' filter="url(#' + fid + ')"';
    } else if (style.glowOn) {
      var gfid = 'fgshapeglow' + (fgShapeGradientCounter++);
      defs += '<filter id="' + gfid + '" x="-60%" y="-60%" width="220%" height="220%">' +
        '<feFlood flood-color="' + (style.glowColor || '#fff') + '" result="gc"/>' +
        '<feComposite in="gc" in2="SourceAlpha" operator="in" result="go"/>' +
        '<feGaussianBlur in="go" stdDeviation="' + ((style.glowWidth || 8) / 3) + '" result="gb"/>' +
        '<feMerge><feMergeNode in="gb"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
      filterAttr = ' filter="url(#' + gfid + ')"';
    }
    var strokeAttr = style.outlineWidth ? ' stroke="' + (style.outlineColor || '#000') + '" stroke-width="' + style.outlineWidth + '"' : '';
    var attrs = fillAttr + strokeAttr + filterAttr + (shape.fillRule ? ' fill-rule="' + shape.fillRule + '"' : '');
    // Klammern/Apostrophe zusätzlich kodieren: encodeURIComponent lässt sie
    // stehen, das "url(#verlauf)" im SVG beendete sonst das umgebende CSS
    // url(...) vorzeitig - Formen mit Verlauf blieben dadurch unsichtbar.
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + (defs ? '<defs>' + defs + '</defs>' : '') +
      '<path d="' + shape.d + '" ' + attrs + (strokeAttr ? ' vector-effect="non-scaling-stroke"' : '') + '/></svg>'
    ).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27');
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
      // Bei Verlauf-WordArt (SVG-basiert) ist die Schrift ein natives
      // SVG-Attribut, kein vererbtes CSS - ein einfaches
      // objEl.style.fontFamily hätte dort KEINE Wirkung, da die SVG-
      // Zeichenkette schon fertig generiert vorliegt. Komplett neu
      // rendern, damit das SVG mit der neuen Schrift neu erzeugt wird.
      overlay.remove();
      render();
    }

    function showCategories() {
      body2.innerHTML = '';
      var catGrid = el('div', { class: 'ic-wordart-cat-grid' });
      Object.keys(WORDART_FONT_CATEGORIES).forEach(function (cat) {
        var fonts = WORDART_FONT_CATEGORIES[cat];
        var sampleFont = fonts[Math.floor(fonts.length / 2)] || fonts[0];
        var catBtn = el('button', { class: 'ic-wordart-cat-tile' }, [
          el('div', { class: 'ic-wordart-cat-tile-sample', style: 'font-family:' + resolveFontCss(sampleFont) }, [S.wordart_sample_word]),
          el('div', { class: 'ic-wordart-cat-tile-label' }, [(WORDART_CATEGORY_LABELS[cat] || cat) + ' (' + fonts.length + ')'])
        ]);
        catBtn.addEventListener('click', function () { showFonts(cat); });
        catGrid.appendChild(catBtn);
      });
      body2.appendChild(catGrid);
    }
    function showFonts(cat) {
      body2.innerHTML = '';
      var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, ['\u2039 ' + (WORDART_CATEGORY_LABELS[cat] || cat)]);
      backBtn.addEventListener('click', showCategories);
      body2.appendChild(backBtn);
      var grid = el('div', { class: 'ic-wordart-font-grid' });
      WORDART_FONT_CATEGORIES[cat].forEach(function (name) {
        var fb = el('button', { class: 'ic-wordart-font-tile' }, [
          el('div', { class: 'ic-wordart-font-tile-sample', style: 'font-family:' + resolveFontCss(name) }, [S.wordart_sample_word]),
          el('div', { class: 'ic-wordart-font-tile-label' }, [name])
        ]);
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

  // Folie = Faden-Rahmen mit Inhalt (it.framedata, Wortfeld-JSON).
  var frameTfCache = {};
  function frameSlideTf(it) {
    if (!it || it.itemtype !== 'frame' || !it.framedata) { return null; }
    if (!frameTfCache[it.framedata]) {
      try { frameTfCache[it.framedata] = JSON.parse(it.framedata); } catch (e) { return null; }
    }
    return frameTfCache[it.framedata];
  }
  // Inhalt eines Folien-Rahmens als eigenes Element an der Rahmenposition
  // (gedreht, Ebene, Mischmodus) - auf der Pinnwand und in der Präsentation.
  function buildFrameSlideEl(it, tf, cls) {
    var wrap = el('div', {
      class: cls,
      style: 'position:absolute;left:' + it.framex + 'px;top:' + it.framey + 'px;width:' + it.framew + 'px;height:' + it.frameh + 'px;' +
        'transform:rotate(' + (it.framerot || 0) + 'deg);'
    });
    wrap.style.zIndex = it.framez || 0;
    if (tf.blend) { wrap.style.mixBlendMode = tf.blend; }
    applySlideBg(wrap, tf);
    var live = buildTextFrameLiveDom(tf, { noGuide: true });
    live.style.height = '100%';
    wrap.appendChild(live);
    return wrap;
  }
  // Kleiner Bearbeiten-Knopf (nur Symbol, Text als Tooltip) für Rahmen -
  // im Roten Faden, in der Schichtung und am Rahmen auf der Pinnwand.
  function frameEditButton(it, extraClass) {
    var b = el('button', { class: 'ic-frame-edit-icon' + (extraClass ? ' ' + extraClass : ''), type: 'button', title: S.slide_edit, 'aria-label': S.slide_edit }, [icon('imageedit')]);
    b.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    b.addEventListener('touchstart', function (ev) { ev.stopPropagation(); }, { passive: true });
    b.addEventListener('click', function (ev) { ev.stopPropagation(); openFrameSlideEditor(it); });
    return b;
  }
  // Folien-Hintergrund: Farbe mit Deckkraft und optionaler Weichzeichnung
  // dessen, was dahinter liegt (Milchglas).
  function slideBgCss(tf) {
    var bg = tf && tf.slideBg;
    if (!bg || (!bg.opacity && !bg.blur)) { return null; }
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg.color || '#000000') || [0, '00', '00', '00'];
    return {
      background: 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + ((bg.opacity || 0) / 100) + ')',
      filter: bg.blur ? 'blur(' + bg.blur + 'px)' : ''
    };
  }
  function applySlideBg(elm, tf) {
    var css = slideBgCss(tf);
    elm.style.background = css ? css.background : '';
    elm.style.backdropFilter = css ? css.filter : '';
    elm.style.webkitBackdropFilter = css ? css.filter : '';
  }
  // Höhe eines Objekts auf der Pinnwand: Wortfelder über ihr Seitenverhältnis,
  // Bilder über das beim Anzeigen gemerkte Seitenverhältnis (sonst 4:3).
  function photoBoardHeight(p) {
    if (p.wordfielddata) {
      try { var wtf = JSON.parse(p.wordfielddata); return p.canvasw * wtf.h / wtf.w; } catch (e) { /* weiter unten */ }
    }
    return p.canvasw * (p._ratio || 0.75);
  }
  function openFrameSlideEditor(it) {
    var tf = null;
    if (it.framedata) { try { tf = JSON.parse(it.framedata); } catch (e) { tf = null; } }
    if (!tf) {
      tf = newSlideFrame();
      tf.h = Math.max(80, Math.round(tf.w * it.frameh / Math.max(1, it.framew)));
    }
    tf.isSlide = true; tf.isWordArt = true;
    state.textFrame = tf;
    state.wordArtMode = true;
    state.editingPhotoId = null;
    state.editingFrameItemId = it.id;
    state.slideScale = tf.w / Math.max(1, it.framew);
    state.slideShift = { dx: 0, dy: 0 };
    state.tfPan = null;
    resetTfHistory();
    state.step = 'textframe';
    render();
  }
  // Aktuelle Board-Geometrie des bearbeiteten Rahmens: Ausgangsrahmen plus
  // im Editor verschobene Kanten (slideShift, Editor-Pixel) und neue Größe,
  // alles in Rahmenachsen und um den Mittelpunkt gedreht.
  function currentFrameGeom(it, tf) {
    var k = state.slideScale || 1;
    var w1 = tf.w / k, h1 = tf.h / k, w0 = it.framew, h0 = it.frameh;
    var sh = state.slideShift || { dx: 0, dy: 0 };
    var lx = sh.dx / k + w1 / 2 - w0 / 2, ly = sh.dy / k + h1 / 2 - h0 / 2;
    var rad = (it.framerot || 0) * Math.PI / 180;
    var cx = it.framex + w0 / 2 + lx * Math.cos(rad) - ly * Math.sin(rad);
    var cy = it.framey + h0 / 2 + lx * Math.sin(rad) + ly * Math.cos(rad);
    return { x: cx - w1 / 2, y: cy - h1 / 2, w: w1, h: h1, rot: it.framerot || 0 };
  }
  function editingFrameItem() {
    if (!state.editingFrameItemId) { return null; }
    var ot = ownThread();
    return ot ? ot.items.filter(function (o) { return o.itemtype === 'frame' && o.id === state.editingFrameItemId; })[0] || null : null;
  }

  function newSlideFrame() {
    return {
      w: 640, h: 360, preset: 'none', isWordArt: true, isSlide: true, anim: [],
      texts: [
        { id: 1, text: '', font: 'sans', size: 40, x: 0.5, y: 0.2 }
      ]
    };
  }

  // Board-Position für eine neue Folie: Mitte des gerade sichtbaren
  // Pinnwand-Ausschnitts, halb so breit wie dieser, ganz oben im Stapel.
  function currentSlidePlacement() {
    var wrapEl = root.querySelector('.ic-canvas-wrap');
    if (!wrapEl || state.step !== 'arrange') { return null; }
    var r = wrapEl.getBoundingClientRect();
    var z = state.boardZoom || 1;
    var cx = (r.width / 2 - (state.boardPanX || 0)) / z;
    var cy = (r.height / 2 - (state.boardPanY || 0)) / z;
    var w = Math.max(240, Math.min(900, r.width / z * 0.5));
    var maxZ = 0;
    state.photos.forEach(function (p) {
      if (p.boardplaced && (p.boardid || 0) === (state.currentBoard || 0)) { maxZ = Math.max(maxZ, p.canvasz || 0); }
    });
    var otz = ownThread();
    (otz ? otz.items : []).forEach(function (o) {
      if (o.itemtype === 'frame' && (o.boardid || 0) === (state.currentBoard || 0)) { maxZ = Math.max(maxZ, o.framez || 0); }
    });
    return {
      canvasx: Math.round(cx - w / 2), canvasy: Math.round(cy - w * 9 / 32), canvasw: Math.round(w),
      canvasrot: 0, canvasz: maxZ + 1, boardid: state.currentBoard || 0
    };
  }

  // Animationsschritte einer Folie: tf.anim ist die Reihenfolge
  // [{key:'t<id>'|'s<id>', withPrev}] - jedes Objekt erscheint in seinem
  // Schritt (withPrev = zusammen mit dem vorherigen). Nicht aufgeführte
  // Objekte sind von Anfang an sichtbar.
  function slideAnimMap(tf) {
    var exists = {};
    (tf.texts || []).forEach(function (t) { exists['t' + t.id] = true; });
    (tf.shapes || []).forEach(function (sh) { if (!sh.main) { exists['s' + sh.id] = true; } });
    var map = {}, step = 0;
    (tf.anim || []).forEach(function (a) {
      if (!a || !exists[a.key] || map[a.key]) { return; }
      if (!(a.withPrev && step > 0)) { step++; }
      map[a.key] = step;
    });
    return { map: map, count: step };
  }

  function newTextFrame(wordArtMode) {
    return {
      w: wordArtMode ? 320 : 220, h: wordArtMode ? 220 : 320, preset: wordArtMode ? 'none' : 'paper',
      isWordArt: !!wordArtMode,
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

  // Teilformatierungen speichern Schriftgröße/Laufweite als feste Pixel
  // (<span style="font-size:40px">). Auf der Pinnwand wird die Karte aber
  // verkleinert/vergrößert dargestellt und der Haupttext ggf. eingepasst -
  // feste Pixel machten beides nicht mit, der Text ragte über die Karte.
  // Deshalb relativ zur Grundschrift des Textobjekts (em) umrechnen.
  function relativizeTextHtml(html, baseSize) {
    if (!html || !baseSize) { return html; }
    // Früher mitgespeicherte Editor-Griffe entfernen.
    html = String(html).replace(/<div[^>]*ic-textframe-(size|move|width)-handle[^>]*>[^<]*<\/div>/g, '');
    return String(html).replace(/(font-size|letter-spacing)\s*:\s*(-?[\d.]+)px/gi, function (m, prop, num) {
      return prop + ': ' + (Math.round(parseFloat(num) / baseSize * 1000) / 1000) + 'em';
    });
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
  // WordArt-Vorlagen-Bibliothek - übernommen aus dem vom Nutzer
  // bereitgestellten Prototyp (wordart_editor_final.html). Jede Vorlage
  // bündelt Fläche (Farbe/Verlauf), Kontur, vertikale Streckung sowie
  // Extrusions-Farbe/-Tiefe für den 3D-Effekt.
  var WORDART_STYLES = [
    { id: 'chrome-ultra', label: 'Chrom High-Gloss', fillGradient: 'linear-gradient(180deg,#2b4756 0%,#8baac1 20%,#ffffff 48%,#161d26 50%,#3d2c1d 53%,#a47c50 78%,#f3e5c8 100%)', stroke: '#1e293b', strokeWidth: 0.5, font: "'Times New Roman',serif", scaleY: 1.4, extrudeColor: '#0f172a', extrudeSteps: 14 },
    { id: 'silver-metal', label: 'Silber Metallik', fillGradient: 'linear-gradient(180deg,#9ca3af 0%,#e5e7eb 25%,#ffffff 49%,#4b5563 50%,#d1d5db 75%,#6b7280 100%)', stroke: '#2b2b2b', strokeWidth: 0.6, font: 'Impact,sans-serif', scaleY: 1.3, extrudeColor: '#475569', extrudeSteps: 10 },
    { id: 'gold-extrude', label: 'Gold Metallik', fillGradient: 'linear-gradient(180deg,#fef08a 0%,#facc15 30%,#ffffff 49%,#854d0e 50%,#eab308 80%,#713f12 100%)', stroke: '#3a2500', strokeWidth: 0.5, font: 'Impact,sans-serif', scaleY: 1.3, extrudeColor: '#422006', extrudeSteps: 12 },
    { id: 'sunset-metal', label: 'Sunset Metallic', fillGradient: 'linear-gradient(180deg,#7dd3fc 0%,#ffffff 48%,#be123c 50%,#fb7185 75%,#fde047 100%)', stroke: '#000', strokeWidth: 0.5, scaleY: 1.5, extrudeColor: '#18181b', extrudeSteps: 14 },
    { id: 'rainbow', label: 'Regenbogen', fillGradient: 'linear-gradient(90deg,#ff0000 0%,#ff7f00 20%,#ffff00 40%,#00ff00 60%,#0000ff 80%,#8b00ff 100%)', stroke: '#fff', strokeWidth: 0.5, font: 'Impact,sans-serif', scaleY: 1.5, extrudeColor: '#334155', extrudeSteps: 8 },
    { id: 'classic-blue', label: 'Klassisch Blau', fillGradient: 'linear-gradient(180deg,#0099ff,#003399)', stroke: '#99ccff', strokeWidth: 0.8, font: 'Impact,sans-serif', scaleY: 1.3, extrudeColor: '#002245', extrudeSteps: 10 },
    { id: 'synthwave', label: 'Synthwave', fillGradient: 'linear-gradient(180deg,#ff007f 0%,#7928ca 50%,#00f0ff 100%)', stroke: '#ff007f', strokeWidth: 1.2, font: 'Impact,sans-serif', scaleY: 1.3, skewY: -5, extrudeColor: '#240046', extrudeSteps: 12 },
    { id: 'offset90s', label: '90s Offset', fillColor: '#33ccff', stroke: '#000099', strokeWidth: 1.5, font: 'Impact,sans-serif', scaleY: 1.2, extrudeColor: '#000099', extrudeSteps: 6 },
    { id: 'outline', label: 'Classic Outline', fillColor: '#fff', stroke: '#000', strokeWidth: 2, scaleY: 1.25, extrudeColor: '#000', extrudeSteps: 0 },
    { id: 'black-skew', label: 'Black Skew', fillColor: '#000', scaleY: 1.65, skewY: -10, rotate: -3, extrudeColor: '#000', extrudeSteps: 0 },
    { id: 'soft-shadow', label: 'Soft Shadow', fillColor: '#fff', stroke: '#000', strokeWidth: 1, scaleY: 1.65, extrudeColor: '#999', extrudeSteps: 4 },
    { id: 'times-blue', label: 'Times Blue', fillColor: '#369', font: "'Times New Roman',serif", extrudeColor: '#c1c1c1', extrudeSteps: 3 },
    { id: 'offset-blue', label: 'Offset Blue', fillColor: '#d8d8d8', stroke: '#33c', strokeWidth: 1, scaleY: 1.25, extrudeColor: '#99f', extrudeSteps: 6 },
    { id: 'silver-gradient', label: 'Silver Gradient', fillGradient: 'linear-gradient(180deg,#adadad,#fff)', extrudeColor: '#717171', extrudeSteps: 5 },
    { id: 'impact-red', label: 'Impact Red', fillColor: '#06c', stroke: '#9cf', strokeWidth: 0.5, font: 'Impact,sans-serif', scaleY: 1.25, extrudeColor: '#900', extrudeSteps: 6 },
    { id: 'sunburst-yellow', label: 'Sunburst Yellow', fillGradient: 'radial-gradient(circle,#fff812 0%,#ff9a32 100%)', font: 'Impact,sans-serif', scaleY: 1.25, extrudeColor: '#cdcdcd', extrudeSteps: 6 },
    { id: 'purple-skew', label: 'Purple Skew', fillGradient: 'linear-gradient(180deg,#6900cc,#cb00cc)', stroke: '#d2a2fe', strokeWidth: 0.5, font: 'Impact,sans-serif', scaleY: 1.65, rotate: -3, skewY: -3, extrudeColor: '#adadff', extrudeSteps: 6 },
    { id: 'forest-times', label: 'Forest Times', fillColor: '#1a4b28', stroke: '#080', strokeWidth: 1.5, font: "'Times New Roman',serif", scaleY: 1.25, extrudeColor: '#d2e5dc', extrudeSteps: 8 },
    { id: 'rainbow-spectrum', label: 'Rainbow Spectrum', fillGradient: 'linear-gradient(270deg,#a104ad 0%,#0b2be0 16%,#329941 33%,#f7f658 50%,#f16412 66%,#e92153 83%,#aa04a7 100%)', stroke: '#eaeaea', strokeWidth: 0.5, scaleY: 1.65, extrudeColor: '#cdcdcd', extrudeSteps: 8 },
    { id: 'cyan-gradient', label: 'Cyan Gradient', fillGradient: 'linear-gradient(180deg,#999cfc,#1b999c)', font: "'Times New Roman',serif", extrudeColor: '#cdcdcd', extrudeSteps: 4 },
    { id: 'heavy-extrude', label: 'Heavy Extrude', fillColor: '#896640', scaleY: 1.65, extrudeColor: '#1b0d00', extrudeSteps: 12 },
    { id: 'soft-red-extrude', label: 'Soft Red Extrude', fillGradient: 'linear-gradient(180deg,#fffecb,#ff9999)', font: "'Times New Roman',serif", scaleY: 1.3, extrudeColor: '#002245', extrudeSteps: 8 },
    { id: 'flame-gradient', label: 'Flame Gradient', fillGradient: 'linear-gradient(180deg,#551700,#fecb00)', stroke: '#b2b2b2', strokeWidth: 1, scaleY: 1.65, extrudeColor: '#ab8d56', extrudeSteps: 8 },
    { id: 'blue-shadow', label: 'Blue Shadow', fillColor: '#3cf', stroke: '#009', strokeWidth: 1.25, font: 'Impact,sans-serif', scaleY: 1.2, extrudeColor: '#009', extrudeSteps: 6 },
    { id: 'pattern-yellow', label: 'Pattern Yellow', fillColor: '#ff0', stroke: '#000', strokeWidth: 1, scaleY: 1.25, extrudeColor: '#999', extrudeSteps: 4 },
    { id: 'dark-green-extrude', label: 'Dark Green Extrude', fillColor: '#0f3a1a', scaleY: 1.75, rotate: -7, extrudeColor: '#000800', extrudeSteps: 14 },
    { id: 'deep-3d-shadow', label: 'Deep 3D Shadow', fillColor: '#fff', font: 'Impact,sans-serif', scaleY: 1.25, skewY: 15, rotate: -3, extrudeColor: '#2c2d23', extrudeSteps: 18 },
    { id: 'fire-extrude', label: 'Fire Extrude', fillGradient: 'linear-gradient(135deg,#fee601 0%,#fe4201 100%)', font: 'Impact,sans-serif', scaleY: 1.5, skewY: -8, rotate: -3, extrudeColor: '#813300', extrudeSteps: 12 }
  ];
  // Baut CSS für eine WordArt-Vorlage bzw. individuell eingestellte
  // Werte (t.rotate/skewY/scaleY/extrudeSteps/extrudeColor/wordartGlow*)
  // - Extrusion (3D-Tiefe) über gestapelte text-shadow-Schichten
  // (dieselbe Technik wie das Original-Prototyp, nur ohne echte
  // zusätzliche DOM-Elemente - funktioniert live UND im SVG-Export
  // identisch, da beide über HTML/CSS via foreignObject laufen).
  // Bögen (Text folgt einem Pfad) - natives SVG <textPath>, funktioniert
  // dadurch identisch live und im Export (kein CSS-Trick nötig, da echte
  // Pfad-Geometrie). Vier Varianten, Krümmungsstärke einstellbar.
  function arcSvgPathD(style, amount, w, h) {
    var midY = h * 0.55, amt = ((amount != null ? amount : 50) / 100) * h * 0.45;
    if (style === 'up') { return 'M 5,' + (midY + amt) + ' Q ' + (w / 2) + ',' + (midY - amt) + ' ' + (w - 5) + ',' + (midY + amt); }
    if (style === 'down') { return 'M 5,' + (midY - amt) + ' Q ' + (w / 2) + ',' + (midY + amt) + ' ' + (w - 5) + ',' + (midY - amt); }
    if (style === 'wave') {
      return 'M 5,' + midY + ' Q ' + (w * 0.25) + ',' + (midY - amt) + ' ' + (w / 2) + ',' + midY +
        ' Q ' + (w * 0.75) + ',' + (midY + amt) + ' ' + (w - 5) + ',' + midY;
    }
    if (style === 'circle') {
      var r = Math.min(w, h) * 0.42;
      return 'M ' + (w / 2 - r) + ',' + (h / 2) + ' A ' + r + ',' + r + ' 0 1,1 ' + (w / 2 + r) + ',' + (h / 2) +
        ' A ' + r + ',' + r + ' 0 1,1 ' + (w / 2 - r) + ',' + (h / 2);
    }
    return null;
  }
  var arcIdCounter = 0;
  // Native SVG-Text-Darstellung für Verlauf-WordArt-Vorlagen (Chrom,
  // Silber, Gold etc.) - CSS-Verläufe via background-clip:text strecken
  // sich über die GESAMTE Textbox inkl. Zeilenhöhe-Puffer, was den
  // "Glanzstreifen" bei metallischen Verläufen an der falschen Stelle
  // zeigt. SVG-Text mit objectBoundingBox-Verlauf (SVG-Standard)
  // orientiert sich exakt an den sichtbaren Buchstaben, genau wie im
  // Original-Prototyp - deshalb hier natives SVG statt CSS.
  // Berechnet die exakte halbe Ausdehnung (halfW/halfH) eines WordArt-
  // Textobjekts NACH Extrusion (asymmetrische Schatten-Kopien nur unten-
  // rechts) UND der vollständigen Transformationskette (skewY, scaleX,
  // scaleY, rotate) - eine einzige, gemeinsam genutzte Berechnung für
  // buildWordartGradientParts() (Board/Editor/Export-SVG) UND
  // computeAutoExportBounds() (Nicht-Verlauf-Stile), damit beide
  // garantiert übereinstimmen statt getrennt (und potenziell
  // unterschiedlich ungenau) zu schätzen.
  //
  // WICHTIG zur Transformations-Reihenfolge: sowohl das CSS
  // "transform: skewY(A) scaleX(B) scaleY(C) rotate(D)" als auch das
  // äquivalente SVG-<g transform="...">-Pendant wenden die Funktionen
  // von RECHTS nach LINKS auf einen Punkt an - rotate wirkt also ZUERST
  // (innen), skewY ZULETZT (außen). Das ist der Reihenfolge im Text
  // entgegengesetzt und war die Ursache dafür, dass frühere Rand-
  // Schätzungen bei rotierten UND extrudierten/gestreckten Stilen nicht
  // ausreichten ("am Ende des Wortes fehlt oben ein Stück").
  //
  // Ergebnis ist bewusst symmetrisch (max(|min|,max) je Achse) statt der
  // tatsächlich asymmetrischen Kontur, damit die aufrufenden Stellen
  // weiterhin von einer am Anker zentrierten Box ausgehen können
  // (translate(-50%,-50%) bzw. Box-Mitte bei w/2,h/2) - etwas
  // großzügiger als nötig, aber ohne jede Konsumentenstelle auf eine
  // asymmetrische Verankerung umbauen zu müssen.
  function wordartHalfExtent(halfW, halfH, extrudeOffset, rotateDeg, scaleXVal, scaleYVal, skewYDeg) {
    var rad = rotateDeg * Math.PI / 180;
    var tanSkew = Math.tan(skewYDeg * Math.PI / 180);
    var corners = [
      [-halfW, -halfH], [halfW + extrudeOffset, -halfH],
      [-halfW, halfH + extrudeOffset], [halfW + extrudeOffset, halfH + extrudeOffset]
    ];
    var maxAbsX = 0, maxAbsY = 0;
    corners.forEach(function (c) {
      var x = c[0], y = c[1];
      var rx = x * Math.cos(rad) - y * Math.sin(rad);
      var ry = x * Math.sin(rad) + y * Math.cos(rad);
      ry *= scaleYVal;
      rx *= scaleXVal;
      ry += rx * tanSkew;
      maxAbsX = Math.max(maxAbsX, Math.abs(rx));
      maxAbsY = Math.max(maxAbsY, Math.abs(ry));
    });
    return { halfW: maxAbsX, halfH: maxAbsY };
  }

  function buildWordartGradientParts(t, plainText, fontCss) {
    if (!t.wordartStyle || t.wordartStyle === 'none') { return null; }
    var style = WORDART_STYLES.filter(function (w) { return w.id === t.wordartStyle; })[0];
    if (!style || !style.fillGradient) { return null; }
    var extrudeSteps = t.extrudeSteps != null ? t.extrudeSteps : (style.extrudeSteps || 0);
    var extrudeColor = t.extrudeColor || style.extrudeColor || '#000';
    var scaleY = t.scaleY != null ? t.scaleY : (style.scaleY || 1);
    var skewY = t.skewY != null ? t.skewY : (style.skewY || 0);
    var rotate = t.rotate != null ? t.rotate : (style.rotate || 0);
    var rotY = t.rotY || 0;
    var scaleX = Math.cos(rotY * Math.PI / 180);
    var skewFromRotY = Math.sin(rotY * Math.PI / 180) * 12;
    var fontFamily = fontCss;
    var fontSize = t.size;
    fitCtx.font = fontFamily === fontCss ? (fontSize + 'px ' + fontCss) : ('700 ' + fontSize + 'px ' + fontFamily);
    var textWidth = Math.max(10, fitCtx.measureText(plainText || '').width);
    var extrudeOffset = extrudeSteps * 0.8;
    // Exakte Ausdehnung inkl. Extrusion+Rotation+Skalierung+Schrägstellung
    // statt der früheren Näherung, die "rotate" komplett ausließ - die
    // <g>-Transformationskette unten (translate/skewY/scale/rotate/
    // translate) wendet die Funktionen in genau der Reihenfolge an, die
    // wordartHalfExtent() nachbildet.
    var ext = wordartHalfExtent(textWidth / 2, fontSize * 1.5 / 2, extrudeOffset, rotate, scaleX, scaleY, skewY + skewFromRotY);
    var edgePad = fontSize * 0.15 + 4;
    var w = ext.halfW * 2 + edgePad * 2, h = ext.halfH * 2 + edgePad * 2;
    var gid = 'wagrad' + (arcIdCounter++);
    var gStops = (WORDART_GRADIENT_SVG_STOPS[t.wordartStyle] || []).map(function (s) {
      return '<stop offset="' + s.offset + '" stop-color="' + s.color + '"/>';
    }).join('');
    var gradTag = (WORDART_GRADIENT_SVG_RADIAL[t.wordartStyle]
      ? '<radialGradient id="' + gid + '" cx="50%" cy="50%" r="50%">' + gStops + '</radialGradient>'
      : '<linearGradient id="' + gid + '" x1="0" y1="0" x2="' + (WORDART_GRADIENT_SVG_HORIZ[t.wordartStyle] ? '1' : '0') + '" y2="' + (WORDART_GRADIENT_SVG_HORIZ[t.wordartStyle] ? '0' : '1') + '">' + gStops + '</linearGradient>');
    var strokeAttr = style.stroke ? ' stroke="' + style.stroke + '" stroke-width="' + (style.strokeWidth || 1) + '"' : '';
    var extrudeText = '';
    for (var i = extrudeSteps; i >= 1; i--) {
      extrudeText += '<text x="' + (w / 2 + i * 0.8) + '" y="' + (h / 2 + i * 0.8) + '" font-family="' + fontFamily +
        '" font-size="' + fontSize + '" font-weight="800" fill="' + extrudeColor + '" text-anchor="middle" dominant-baseline="central">' +
        escapeXml(plainText || '') + '</text>';
    }
    var inner = '<defs>' + gradTag + '</defs>' +
      '<g transform="translate(' + (w / 2) + ',' + (h / 2) + ') skewY(' + (skewY + skewFromRotY).toFixed(2) + ') scale(' + scaleX.toFixed(3) + ',' + scaleY + ') rotate(' + rotate + ') translate(' + (-w / 2) + ',' + (-h / 2) + ')">' +
      extrudeText +
      '<text x="' + (w / 2) + '" y="' + (h / 2) + '" font-family="' + fontFamily + '" font-size="' + fontSize +
      '" font-weight="800" fill="url(#' + gid + ')"' + strokeAttr + ' paint-order="stroke fill" text-anchor="middle" dominant-baseline="central">' +
      escapeXml(plainText || '') + '</text></g>';
    return { inner: inner, w: w, h: h };
  }
  function buildWordartGradientSvg(t, plainText, fontCss, isPrimary) {
    var parts = buildWordartGradientParts(t, plainText, fontCss);
    if (!parts) { return null; }
    var svg = '<svg viewBox="0 0 ' + parts.w + ' ' + parts.h + '" width="100%" height="100%" style="overflow:visible;display:' +
      (isPrimary ? 'block' : 'inline-block') + '">' + parts.inner + '</svg>';
    return { svg: svg, w: parts.w, h: parts.h };
  }
  // Direkt aus der Originaldatei übernommene Verlauf-Definitionen (Stopps
  // exakt wie dort), getrennt von WORDART_STYLES gehalten, da CSS- und
  // SVG-Verlaufsyntax unterschiedliche Notation brauchen.
  var WORDART_GRADIENT_SVG_STOPS = {
    'chrome-ultra': [{ offset: '0%', color: '#2b4756' }, { offset: '20%', color: '#8baac1' }, { offset: '48%', color: '#ffffff' }, { offset: '50%', color: '#161d26' }, { offset: '53%', color: '#3d2c1d' }, { offset: '78%', color: '#a47c50' }, { offset: '100%', color: '#f3e5c8' }],
    'silver-metal': [{ offset: '0%', color: '#9ca3af' }, { offset: '25%', color: '#e5e7eb' }, { offset: '49%', color: '#ffffff' }, { offset: '50%', color: '#4b5563' }, { offset: '75%', color: '#d1d5db' }, { offset: '100%', color: '#6b7280' }],
    'gold-extrude': [{ offset: '0%', color: '#fef08a' }, { offset: '30%', color: '#facc15' }, { offset: '49%', color: '#ffffff' }, { offset: '50%', color: '#854d0e' }, { offset: '80%', color: '#eab308' }, { offset: '100%', color: '#713f12' }],
    'sunset-metal': [{ offset: '0%', color: '#7dd3fc' }, { offset: '48%', color: '#ffffff' }, { offset: '50%', color: '#be123c' }, { offset: '75%', color: '#fb7185' }, { offset: '100%', color: '#fde047' }],
    'rainbow': [{ offset: '0%', color: '#ff0000' }, { offset: '20%', color: '#ff7f00' }, { offset: '40%', color: '#ffff00' }, { offset: '60%', color: '#00ff00' }, { offset: '80%', color: '#0000ff' }, { offset: '100%', color: '#8b00ff' }],
    'classic-blue': [{ offset: '0%', color: '#0099ff' }, { offset: '100%', color: '#003399' }],
    'synthwave': [{ offset: '0%', color: '#ff007f' }, { offset: '50%', color: '#7928ca' }, { offset: '100%', color: '#00f0ff' }],
    'silver-gradient': [{ offset: '0%', color: '#adadad' }, { offset: '100%', color: '#ffffff' }],
    'sunburst-yellow': [{ offset: '0%', color: '#fff812' }, { offset: '100%', color: '#ff9a32' }],
    'purple-skew': [{ offset: '0%', color: '#6900cc' }, { offset: '100%', color: '#cb00cc' }],
    'rainbow-spectrum': [{ offset: '0%', color: '#a104ad' }, { offset: '16%', color: '#0b2be0' }, { offset: '33%', color: '#329941' }, { offset: '50%', color: '#f7f658' }, { offset: '66%', color: '#f16412' }, { offset: '83%', color: '#e92153' }, { offset: '100%', color: '#aa04a7' }],
    'cyan-gradient': [{ offset: '0%', color: '#999cfc' }, { offset: '100%', color: '#1b999c' }],
    'soft-red-extrude': [{ offset: '0%', color: '#fffecb' }, { offset: '100%', color: '#ff9999' }],
    'flame-gradient': [{ offset: '0%', color: '#551700' }, { offset: '100%', color: '#fecb00' }],
    'fire-extrude': [{ offset: '0%', color: '#fee601' }, { offset: '100%', color: '#fe4201' }]
  };
  var WORDART_GRADIENT_SVG_RADIAL = { 'sunburst-yellow': true };
  var WORDART_GRADIENT_SVG_HORIZ = { 'rainbow': true, 'rainbow-spectrum': true };

  function buildArcTextSvg(t, plainText, fontCss, color) {
    var d = arcSvgPathD(t.arcStyle, t.arcAmount, 300, 120);
    if (!d) { return null; }
    var pid = 'arcpath' + (arcIdCounter++);
    return '<svg viewBox="0 0 300 120" width="100%" height="100%" style="overflow:visible;display:block">' +
      '<path id="' + pid + '" d="' + d + '" fill="none" stroke="none"/>' +
      '<text font-family="' + fontCss + '" font-size="' + Math.round(t.size * 0.55) + '" font-weight="' + (t.fontWeight || 700) +
      '" fill="' + color + '" text-anchor="middle"><textPath href="#' + pid + '" startOffset="50%">' +
      escapeXml(plainText || '') + '</textPath></text></svg>';
  }

  function wordartCssFor(t, fallbackColor, isPrimary, cqwPerPx) {
    if (!t.wordartStyle || t.wordartStyle === 'none') { return ''; }
    var style = WORDART_STYLES.filter(function (w) { return w.id === t.wordartStyle; })[0];
    if (!style) { return ''; }
    var unit = function (px) { return cqwPerPx ? (px * cqwPerPx).toFixed(3) + 'cqw' : px + 'px'; };
    var extrudeSteps = t.extrudeSteps != null ? t.extrudeSteps : (style.extrudeSteps || 0);
    var extrudeColor = t.extrudeColor || style.extrudeColor || '#000';
    var scaleY = t.scaleY != null ? t.scaleY : (style.scaleY || 1);
    var skewY = t.skewY != null ? t.skewY : (style.skewY || 0);
    var rotate = t.rotate != null ? t.rotate : (style.rotate || 0);
    var rotY = t.rotY || 0;
    var radY = rotY * Math.PI / 180;
    var scaleX = Math.cos(radY);
    var skewFromRotY = Math.sin(radY) * 12; // Grad-Näherung der Y-Rotations-Scherung
    var css = 'display:inline-block;transform:' + (isPrimary ? '' : 'translate(-50%,-50%) ') +
      'skewY(' + (skewY + skewFromRotY).toFixed(2) + 'deg) scaleX(' + scaleX.toFixed(3) + ') scaleY(' + scaleY + ') rotate(' + rotate + 'deg);';
    if (style.fillGradient) {
      css += 'background-image:' + style.fillGradient + ';-webkit-background-clip:text;background-clip:text;color:transparent;';
    } else {
      css += 'color:' + (style.fillColor || fallbackColor) + ';';
    }
    if (style.stroke) { css += '-webkit-text-stroke:' + unit(style.strokeWidth || 1) + ' ' + style.stroke + ';paint-order:stroke fill;'; }
    var shadows = [];
    for (var i = extrudeSteps; i >= 1; i--) { shadows.push(unit(i * 0.8) + ' ' + unit(i * 0.8) + ' 0 ' + extrudeColor); }
    if (t.wordartGlow) { shadows.push('0 0 ' + unit(t.wordartGlow) + ' ' + (t.wordartGlowColor || '#fff'), '0 0 ' + unit(t.wordartGlow / 2) + ' ' + (t.wordartGlowColor || '#fff')); }
    if (shadows.length) { css += 'text-shadow:' + shadows.join(',') + ';'; }
    return css;
  }

  // Block "Farben und Formen": Fill (Vollfarbe oder Verlauf), Kontur
  // (Umriss mit eigener Dicke) und Effekte (Schatten/Glow, jeweils mit
  // eigener Dicke/Unschärfe) - eine gemeinsame Funktion für Live-Vorschau
  // UND SVG-Export, damit beide garantiert übereinstimmen.
  function computeStyle1Css(t, fallbackColor) {
    var css = '';
    if (t.fillGradient && t.fillGradient.length >= 2) {
      css += 'background-image:' + cssGradientFor(t) + ';' +
        '-webkit-background-clip:text;background-clip:text;color:transparent;';
    } else {
      css += 'color:' + (t.fillColor || fallbackColor) + ';';
    }
    if (t.outlineWidth > 0) {
      css += '-webkit-text-stroke:' + t.outlineWidth + 'px ' + (t.outlineColor || '#000') + ';paint-order:stroke fill;';
    }
    var shadows = [];
    if (t.shadowOn) {
      var shAngle = (t.shadowAngle != null ? t.shadowAngle : 45) * Math.PI / 180;
      var shDist = t.shadowDistance != null ? t.shadowDistance : 3;
      var shDx = (Math.cos(shAngle) * shDist).toFixed(1), shDy = (Math.sin(shAngle) * shDist).toFixed(1);
      shadows.push(shDx + 'px ' + shDy + 'px ' + (t.shadowBlur || 4) + 'px ' + (t.shadowColor || '#000'));
    }
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
  // Berechnet die Umfluss-Zeilen für EIN Textobjekt anhand der
  // blockierenden Formen in der Nähe - eine Zeile je Durchlauf, Breite je
  // Zeile abhängig davon, was in diesem Zeilen-Band blockiert ist. Läuft
  // komplett in der virtuellen tf.w x tf.h-Koordinatenfläche (dieselbe
  // Fläche, die auch der SVG-Export nutzt), keine echten Pixel-Messungen
  // am DOM nötig.
  function computeWrapLines(pretext, text, fontCss, fontSizePx, letterSpacing, boxLeft, boxTop, boxWidth, lineHeightPx, obstacles) {
    var prepared = pretext.prepareWithSegments(text, Math.round(fontSizePx) + 'px ' + fontCss, { letterSpacing: letterSpacing || 0 });
    var lines = [];
    var cursor = { segmentIndex: 0, graphemeIndex: 0 };
    var y = boxTop;
    var guard = 0;
    while (guard++ < 300) {
      var blocked = pretext.geometry.getRectIntervalsForBand(obstacles, y, y + lineHeightPx, 6, 2);
      var slots = pretext.geometry.carveTextLineSlots({ left: boxLeft, right: boxLeft + boxWidth }, blocked);
      var slot = slots[0] || { left: boxLeft, right: boxLeft + boxWidth };
      var width = Math.max(24, slot.right - slot.left);
      var range = pretext.layoutNextLineRange(prepared, cursor, width);
      if (range === null) { break; }
      var line = pretext.materializeLineRange(prepared, range);
      lines.push({ text: line.text, x: slot.left, y: y, width: width });
      cursor = range.end;
      y += lineHeightPx;
    }
    return lines;
  }

  // Prüft für ein Textobjekt, ob Formen mit Umfluss-Modus in der Nähe
  // liegen, und ersetzt bei Bedarf dessen Live-Darstellung durch
  // zeilenweise, per Pretext berechnete Zeilen statt einfachem Fließtext.
  // Läuft asynchron (Pretext wird erst bei tatsächlichem Bedarf
  // nachgeladen), ersetzt den Inhalt nachträglich, sobald berechnet.
  function applyTextWrapLive(tf, textElByIdx, inner) {
    var wrapShapes = (tf.shapes || []).filter(function (s) { return s.wrapMode === 'wrap'; });
    if (!wrapShapes.length) { return; }
    loadPretext().then(function (pretext) {
      var obstaclesAll = wrapShapes.map(function (s) {
        var g = resolveShapeGeom(tf, s);
        return { x: g.x - g.w / 2, y: g.y - g.h / 2, width: g.w, height: g.h };
      });
      tf.texts.forEach(function (t, idx) {
        var plainText = (t.text || '').replace(/<[^>]+>/g, '');
        if (!plainText) { return; }
        var fontCss = resolveFontCss(t.font);
        var boxLeft = t.x * tf.w, boxWidth = Math.max(60, tf.w * 0.94 - boxLeft);
        var lineHeightPx = t.size * (t.lineHeight || 1.2);
        // Nur relevant, wenn sich Textbereich und mindestens eine
        // Umfluss-Form überhaupt überschneiden könnten (grobe Prüfung
        // über den vertikalen Bereich, spart unnötige Berechnung).
        var relevant = obstaclesAll.filter(function (o) {
          return o.x < boxLeft + boxWidth && o.x + o.width > boxLeft;
        });
        if (!relevant.length) { return; }
        var lines = computeWrapLines(pretext, plainText, fontCss, t.size, t.letterSpacing || 0, boxLeft, t.y * tf.h, boxWidth, lineHeightPx, relevant);
        if (!lines.length) { return; }
        var wrapWrap = el('div', { class: 'ic-tf-live-text-wrap', style: 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1;' });
        lines.forEach(function (line) {
          wrapWrap.appendChild(el('div', {
            style: 'position:absolute;left:' + (line.x / tf.w * 100) + '%;top:' + (line.y / tf.h * 100) + '%;' +
              'width:' + (line.width / tf.w * 100) + '%;font-family:' + fontCss + ';font-size:' + (t.size / tf.w * 100) + 'cqw;' +
              'font-weight:' + (t.fontWeight || 700) + ';letter-spacing:' + (t.letterSpacing || 0) + 'px;' +
              'color:' + (t.fillColor || t.color || '#f2f3f5') + ';white-space:nowrap;'
          }, [line.text]));
        });
        var oldEl = textElByIdx[idx];
        if (oldEl && oldEl.parentNode) { oldEl.parentNode.replaceChild(wrapWrap, oldEl); textElByIdx[idx] = wrapWrap; }
      });
    }).catch(function () { /* Umfluss bleibt aus, normale Darstellung bleibt bestehen */ });
  }

  // opts.noGuide: die gestrichelte Hilfslinie um transparente Rahmen
  // weglassen - sie ist auf der Pinnwand nur eine Bearbeitungshilfe (zeigt,
  // wo man anfassen kann), gehört aber nicht zum Inhalt selbst und wird
  // deshalb in Meine Dateien, Klassenübersicht, Präsentation und im
  // gespeicherten SVG nicht gezeichnet.
  // Alle Maße sind relativ zu tf.w (Prozent bzw. cqw) und box-sizing ist
  // explizit gesetzt, damit die Darstellung bei JEDER Anzeigegröße und in
  // JEDEM Umfeld (Pinnwand innerhalb .pinnwand-app, Präsentations-Overlay
  // direkt im <body>, foreignObject im gespeicherten SVG) exakt dieselbe
  // bleibt wie im Editor (dort 1:1 in Pixeln).
  function buildTextFrameLiveDom(tf, opts) {
    opts = opts || {};
    var preset = TEXTFRAME_PRESETS.filter(function (p) { return p.id === tf.preset; })[0] || TEXTFRAME_PRESETS[0];
    // Nur WordArt-Rahmen bleiben unbeschnitten (damit Effekte wie
    // Extrusion/Schrägstellung nicht abgeschnitten werden) - normale
    // Textrahmen bekommen wieder eine Begrenzung auf die Kartengröße,
    // wie im Editor. Sonst könnte normaler Text unvorhersehbar über den
    // Rahmen hinausgehen.
    var hasWordart = wordfieldHasWordart(tf);
    // Zettel mit Hauptform: die Form IST die Karte - kein rechteckiger
    // Kartenhintergrund/-schatten, der Schatten sitzt auf der Form selbst.
    var cardShape = !opts.noShapes && !wordfieldIsWordart(tf) ? mainShapeOf(tf) : null;
    var animMap = tf.isSlide ? slideAnimMap(tf).map : {};
    var outer = el('div', {
      class: 'ic-tf-live', style: 'position:relative;box-sizing:border-box;width:100%;aspect-ratio:' + tf.w + '/' + tf.h + ';container-type:inline-size;' +
        (hasWordart || cardShape ? '' : (tf.isSlide ? 'overflow:hidden;' : 'overflow:hidden;border-radius:16px;')) +
        (preset.shadow && !cardShape ? 'box-shadow:0 8px 24px rgba(0,0,0,.4);' : '') +
        (preset.bg || opts.noGuide || cardShape ? '' : 'border:2px dashed rgba(255,255,255,.3);')
    });
    var cardStyle = tf.cardStyle || {};
    var cardBg = cardShape ? 'background:transparent;' : cardStyle.fillGradient
      ? 'background-image:' + cssGradientFor(cardStyle) + ';'
      : (cardStyle.fillColor ? 'background:' + cardStyle.fillColor + ';' : (preset.bg ? 'background:' + preset.bg + ';' : 'background:transparent;'));
    var cardBorder = !cardShape && cardStyle.outlineWidth ? 'box-shadow:inset 0 0 0 ' + cardStyle.outlineWidth + 'px ' + (cardStyle.outlineColor || '#000') + ';' : '';
    var inner = el('div', {
      class: 'ic-tf-live-inner', style: 'position:relative;box-sizing:border-box;width:100%;height:100%;overflow:hidden;border-radius:16px;z-index:0;' + cardBg + cardBorder
    });
    outer.appendChild(inner);
    (opts.noShapes ? [] : (tf.shapes || [])).forEach(function (s) {
      var shapeDef = shapeDefFor(s);
      if (!shapeDef) { return; }
      // Lage wie im Editor (resolveShapeGeom: Hauptform = Karte bzw. an den
      // Text gebunden, sonst frei; Höhe relativ zur kürzeren Kartenseite).
      var g = resolveShapeGeom(tf, s);
      var shapeEl = el('div', {
        class: 'ic-tf-live-shape',
        style: 'position:absolute;left:' + (g.x / tf.w * 100) + '%;top:' + (g.y / tf.h * 100) + '%;width:' + (g.w / tf.w * 100) + '%;' +
          'height:' + (g.h / tf.h * 100) + '%;transform:translate(-50%,-50%) rotate(' + (s.main ? 0 : (s.rotation || 0)) + 'deg);' +
          (s === cardShape && preset.shadow ? 'filter:drop-shadow(0 6px 10px rgba(0,0,0,.35));' : '') +
          'background-image:url(' + fgShapeSvgDataUri(shapeDef, s) + ');background-repeat:no-repeat;' +
          'background-position:center;background-size:100% 100%;' + (s.wrapMode === 'front' ? 'z-index:2;' : 'z-index:0;')
      });
      if (animMap['s' + s.id]) { shapeEl.setAttribute('data-pwp-build', String(animMap['s' + s.id])); }
      if (tf.isSlide && tf.exit && tf.exit['s' + s.id]) { shapeEl.setAttribute('data-pwp-exit', '1'); }
      outer.appendChild(shapeEl);
    });
    var textElByIdx = [];
    tf.texts.forEach(function (t, idx) {
      var fontCss = resolveFontCss(t.font);
      var textEl2;
      var wordartSvg = (t.arcStyle && t.arcStyle !== 'none') ? null : buildWordartGradientSvg(t, t.text, fontCss, idx === 0);
      if (t.arcStyle && t.arcStyle !== 'none') {
        // Breite relativ zu tf.w (im Editor dieselbe Zahl in Pixeln bei
        // 1:1-Maßstab) - vorher feste Pixel, dadurch war der Bogentext auf
        // einer verkleinerten/vergrößerten Karte und in Vorschaubildern
        // unterschiedlich groß im Verhältnis zum Rest.
        textEl2 = el('div', {
          class: 'ic-tf-live-text',
          style: 'position:absolute;box-sizing:border-box;left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;transform:translate(-50%,-50%);' +
            'width:' + (Math.max(120, t.size * 6) / tf.w * 100) + '%;z-index:1;'
        });
        textEl2.innerHTML = buildArcTextSvg(t, t.text, fontCss, (t.fillColor || preset.text)) || '';
      } else if (wordartSvg) {
        textEl2 = el('div', {
          class: 'ic-tf-live-text',
          style: 'position:absolute;box-sizing:border-box;left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;transform:translate(-50%,-50%);' +
            'width:' + (wordartSvg.w / tf.w * 100) + '%;aspect-ratio:' + wordartSvg.w + '/' + wordartSvg.h + ';z-index:1;'
        });
        textEl2.innerHTML = wordartSvg.svg;
      } else {
        var html = t.html ? relativizeTextHtml(t.html, t.size) : (t.text ? escapeXml(t.text) : '');
        // Haupttext eines normalen Zettels füllt wie im Editor die ganze
        // Karte (Innenabstand 12, senkrecht mittig) - vorher frei
        // positioniert bei left:50%, wodurch der Browser ihm nur die halbe
        // Kartenbreite zum Umbrechen ließ (viel mehr Zeilen als im Editor).
        var fillCard = idx === 0 && !hasWordart && !tf.isWordArt;
        // Haupttext passt sich in den Textbereich ein (Karte bzw. Innenbereich
        // der Hauptform) und schrumpft, falls er sonst überlaufen würde.
        var tbox = fillCard ? primaryTextBox(tf) : null;
        var fitSize = fillCard ? fitTextSize(t, tbox, fontCss) : t.size;
        textEl2 = el('div', {
          class: 'ic-tf-live-text', html: html,
          style: (fillCard
            ? 'position:absolute;box-sizing:border-box;left:' + (tbox.x / tf.w * 100) + '%;top:' + (tbox.y / tf.h * 100) + '%;' +
              'width:' + (tbox.w / tf.w * 100) + '%;height:' + (tbox.h / tf.h * 100) + '%;padding:' + (tbox.pad / tf.w * 100) + 'cqw;' +
              'display:flex;flex-direction:column;justify-content:center;overflow:hidden;'
            : 'position:absolute;box-sizing:border-box;left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;transform:translate(-50%,-50%);' +
              'padding:' + (4 / tf.w * 100) + 'cqw ' + (8 / tf.w * 100) + 'cqw;' + (t.boxW ? 'width:' + (t.boxW * 100) + '%;' : 'width:max-content;max-width:94%;')) + 'white-space:pre-wrap;text-align:center;z-index:1;' +
            'font-family:' + fontCss + ';font-size:' + (fitSize / tf.w * 100) + 'cqw;font-weight:' + (t.fontWeight || 700) +
            ';line-height:' + (t.lineHeight || 1.2) + ';letter-spacing:' + ((t.letterSpacing || 0) / tf.w * 100) + 'cqw;' +
            (wordartCssFor(t, preset.text, false, 100 / tf.w) || computeStyle1Css(t, preset.text))
        });
      }
      if (animMap['t' + t.id]) { textEl2.setAttribute('data-pwp-build', String(animMap['t' + t.id])); }
      if (tf.isSlide && tf.exit && tf.exit['t' + t.id]) { textEl2.setAttribute('data-pwp-exit', '1'); }
      outer.appendChild(textEl2);
      textElByIdx[idx] = textEl2;
    });
    applyTextWrapLive(tf, textElByIdx, inner);
    return outer;
  }

  function wordfieldHasWordart(tf) {
    return (tf.texts || []).some(function (t) { return t.wordartStyle && t.wordartStyle !== 'none'; });
  }
  // WordArt-Rahmen im weiteren Sinn: im WordArt-Modus angelegt ODER
  // mindestens ein Text mit WordArt-Stil - genau die Rahmen, deren Inhalt
  // über die tf.w x tf.h-Box hinausragen darf.
  function wordfieldIsWordart(tf) {
    return !!tf.isWordArt || wordfieldHasWordart(tf);
  }

  // Zusätzlicher Rand für Effekte, die getBoundingClientRect() NICHT
  // erfasst (text-shadow für Extrusion/Schatten/Glow, Textkontur).
  function wordfieldEffectPad(tf) {
    var pad = 4;
    (tf.texts || []).forEach(function (t) {
      var st = WORDART_STYLES.filter(function (w) { return w.id === t.wordartStyle; })[0] || {};
      var extrude = (t.wordartStyle && t.wordartStyle !== 'none')
        ? (t.extrudeSteps != null ? t.extrudeSteps : (st.extrudeSteps || 0)) * 0.8 : 0;
      var glow = t.wordartGlow ? t.wordartGlow * 1.5 : 0;
      var shadow = t.shadowOn ? (t.shadowDistance != null ? t.shadowDistance : 3) + (t.shadowBlur || 4) * 1.5 : 0;
      var glow2 = t.glowOn ? (t.glowWidth || 8) * 1.5 : 0;
      pad = Math.max(pad, 4 + extrude + glow + shadow + glow2 + (t.outlineWidth || 0) + (st.strokeWidth || 0));
    });
    return pad;
  }

  // Tatsächlich sichtbarer Bereich eines Wortfelds in tf-Koordinaten
  // (0..tf.w / 0..tf.h = die Karte selbst, WordArt darf darüber hinaus
  // ragen). Statt einer Schätzung über measureText (einzeilig, kennt
  // weder Zeilenumbruch noch die Transformationskette zuverlässig) wird
  // die Live-Darstellung - exakt dieselbe wie auf der Pinnwand - kurz
  // unsichtbar in voller Größe aufgebaut und ausgemessen.
  // getBoundingClientRect() berücksichtigt dabei alle CSS-Transforms
  // (skewY/scaleY/rotate der WordArt), nur text-shadow nicht (siehe
  // wordfieldEffectPad). Gemeinsame Grundlage für Vorschaubilder,
  // Präsentations-Zoom und das gespeicherte SVG, damit alle drei denselben
  // Ausschnitt zeigen.
  var wordfieldBoundsCache = {};
  var fontRerenderTimer = null;
  if (document.fonts && document.fonts.addEventListener) {
    // Später nachgeladene Schriften ändern die Textbreite - Messungen
    // danach neu durchführen statt veraltete Werte weiterzuverwenden.
    document.fonts.addEventListener('loadingdone', function () {
      wordfieldBoundsCache = {}; textBoundsCache = {}; textFitCache = {};
      // Schrift kam erst nach dem ersten Darstellen: Ansichten mit Zetteln
      // neu aufbauen, damit Einpassung und Größen zur echten Schrift passen
      // (nicht im Editor - dort würde ein Neuaufbau den Cursor verlieren).
      clearTimeout(fontRerenderTimer);
      fontRerenderTimer = setTimeout(function () {
        if (state.step === 'arrange' || state.step === 'home' || state.step === 'moderate') { render(); }
      }, 120);
    });
  }
  function measureWordfieldBounds(tf) {
    // Folie: der Rahmen selbst ist die Ausdehnung (Inhalt wird beschnitten).
    if (tf.isSlide) { return { x1: 0, y1: 0, x2: tf.w, y2: tf.h }; }
    var key = JSON.stringify(tf);
    var cached = wordfieldBoundsCache[key];
    if (cached) { return { x1: cached.x1, y1: cached.y1, x2: cached.x2, y2: cached.y2 }; }
    var preset = TEXTFRAME_PRESETS.filter(function (p) { return p.id === tf.preset; })[0] || TEXTFRAME_PRESETS[0];
    var cardStyle = tf.cardStyle || {};
    var cardVisible = !!(preset.bg || cardStyle.fillColor || cardStyle.fillGradient || cardStyle.outlineWidth);
    var b = null;
    function union(x1, y1, x2, y2) {
      if (!b) { b = { x1: x1, y1: y1, x2: x2, y2: y2 }; return; }
      b.x1 = Math.min(b.x1, x1); b.y1 = Math.min(b.y1, y1);
      b.x2 = Math.max(b.x2, x2); b.y2 = Math.max(b.y2, y2);
    }
    if (!wordfieldIsWordart(tf)) {
      // Normale Zettel beschneiden ihren Inhalt an der Karte selbst.
      union(0, 0, tf.w, tf.h);
    } else {
      var host = null;
      try {
        host = el('div', {
          style: 'position:fixed;left:-100000px;top:0;width:' + tf.w + 'px;visibility:hidden;pointer-events:none;'
        });
        var live = buildTextFrameLiveDom(tf, { noGuide: true });
        host.appendChild(live);
        document.body.appendChild(host);
        var base = live.getBoundingClientRect();
        if (base.width > 0) {
          var k = tf.w / base.width;
          if (cardVisible) { union(0, 0, tf.w, tf.h); }
          live.querySelectorAll('.ic-tf-live-text, .ic-tf-live-text-wrap > div, .ic-tf-live-shape').forEach(function (n) {
            var r = n.getBoundingClientRect();
            if (r.width <= 0 && r.height <= 0) { return; }
            union((r.left - base.left) * k, (r.top - base.top) * k, (r.right - base.left) * k, (r.bottom - base.top) * k);
          });
        }
      } catch (e) {
        b = null;
      }
      if (host && host.parentNode) { host.parentNode.removeChild(host); }
      if (!b) {
        // Rückfall (z.B. leerer Rahmen): die bisherige, rein rechnerische
        // Schätzung ohne ihren pauschalen Sicherheitsrand.
        var est = computeAutoExportBounds(tf);
        var m = Math.max(30, Math.round(Math.min(tf.w, tf.h) * 0.15));
        b = { x1: est.x1 + m, y1: est.y1 + m, x2: est.x2 - m, y2: est.y2 - m };
      }
    }
    var pad = wordfieldEffectPad(tf) + (preset.shadow ? 20 : 0);
    b.x1 -= pad; b.y1 -= pad; b.x2 += pad; b.y2 += pad;
    wordfieldBoundsCache[key] = b;
    return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
  }

  // Sichtbarer Bereich EINES Textobjekts in tf-Koordinaten, gemessen an
  // der Live-Darstellung (wie Pinnwand/gespeichertes Bild) - Grundlage für
  // "Form um den Text legen". Das Eingabefeld im Editor bricht Text anders
  // um als die fertige WordArt und taugt deshalb nicht als Maß.
  var textBoundsCache = {};
  function measureTextObjectBounds(tf, idx) {
    var ckey = JSON.stringify({ w: tf.w, h: tf.h, t: tf.texts, p: tf.preset, i: idx });
    if (textBoundsCache[ckey]) { return textBoundsCache[ckey]; }
    var host = el('div', { style: 'position:fixed;left:-100000px;top:0;width:' + tf.w + 'px;visibility:hidden;pointer-events:none;' });
    var result = null;
    try {
      var live = buildTextFrameLiveDom(tf, { noGuide: true, noShapes: true });
      host.appendChild(live);
      document.body.appendChild(host);
      var base = live.getBoundingClientRect();
      var textEls = live.querySelectorAll('.ic-tf-live-text');
      var tEl = textEls[idx];
      if (tEl && base.width > 0) {
        var ink = tEl.querySelector('svg g') || tEl.querySelector('svg text') || tEl;
        var r = ink.getBoundingClientRect();
        var k = tf.w / base.width;
        result = { x1: (r.left - base.left) * k, y1: (r.top - base.top) * k, x2: (r.right - base.left) * k, y2: (r.bottom - base.top) * k };
      }
    } catch (e) { result = null; }
    if (host.parentNode) { host.parentNode.removeChild(host); }
    if (result) { textBoundsCache[ckey] = result; }
    return result;
  }

  // ------------------------------------------------------------------
  // Hauptform: die erste Form eines Wortfelds (s.main). Auf einem Zettel ist
  // sie die Karte selbst (füllt den Rahmen, der Text passt sich in ihren
  // Innenbereich ein), bei WordArt ist sie an den Text gebunden (liegt
  // immer passend hinter und um ihn herum, auch nach Textänderungen) -
  // statt einer lose platzierten Form, die man mühsam mit dem Text in
  // Deckung bringen muss. Weitere Formen bleiben freie Dekoration.
  // ------------------------------------------------------------------
  // Innenbereich je Form (Anteile der Formbox, cx/cy = Mittelpunkt), in
  // den Text passt, ohne über den Umriss zu ragen.
  var SHAPE_SAFE = {
    rect: { w: 0.9, h: 0.9 }, rounded: { w: 0.86, h: 0.86 }, circle: { w: 0.66, h: 0.66 }, ellipse: { w: 0.68, h: 0.44 },
    bubble: { w: 0.64, h: 0.44 }, bubblerect: { w: 0.74, h: 0.46 }, thought: { w: 0.58, h: 0.4 },
    heart: { w: 0.56, h: 0.4, cy: 0.42 }, cloud: { w: 0.56, h: 0.34, cy: 0.54 }, triangle: { w: 0.42, h: 0.34, cy: 0.66 },
    righttriangle: { w: 0.4, h: 0.4, cx: 0.34, cy: 0.64 }, trapezoid: { w: 0.66, h: 0.56 }, diamond: { w: 0.46, h: 0.46 },
    parallelogram: { w: 0.56, h: 0.6 }, pentagon: { w: 0.6, h: 0.5, cy: 0.56 }, hexagon: { w: 0.7, h: 0.78 },
    octagon: { w: 0.74, h: 0.74 }, cross: { w: 0.28, h: 0.28 }, arch: { w: 0.7, h: 0.5, cy: 0.66 },
    arrowright: { w: 0.5, h: 0.28, cx: 0.4 }, arrowleft: { w: 0.5, h: 0.28, cx: 0.6 },
    arrowup: { w: 0.28, h: 0.5, cy: 0.6 }, arrowdown: { w: 0.28, h: 0.5, cy: 0.4 }
  };
  function shapeSafeBox(s) {
    var pinfo = paramShapeInfo(s.type);
    var sb;
    if (pinfo && pinfo.base === 'star') {
      var inner = s.inner != null ? s.inner : pinfo.def.defaults.inner;
      var f = Math.max(0.2, Math.min(0.8, 0.9 * inner * 1.25));
      sb = { w: f, h: f };
    } else if (pinfo && pinfo.base === 'bubble') {
      var st = s.bubble || pinfo.def.defaults.bubble;
      sb = SHAPE_SAFE[st === 'rect' ? 'bubblerect' : (st === 'thought' ? 'thought' : 'bubble')];
    } else {
      sb = SHAPE_SAFE[s.type] || { w: 0.6, h: 0.6 };
    }
    return { w: sb.w, h: sb.h, cx: sb.cx != null ? sb.cx : 0.5, cy: sb.cy != null ? sb.cy : 0.5 };
  }
  function mainShapeOf(tf) {
    return (tf.shapes || []).filter(function (s) { return s.main && shapeDefFor(s); })[0] || null;
  }
  // Tatsächliche Lage einer Form in tf-Koordinaten (Mittelpunkt x/y,
  // Breite/Höhe) - für Editor, Pinnwand und SVG gleichermaßen.
  function resolveShapeGeom(tf, s) {
    if (s.main && !wordfieldIsWordart(tf)) {
      return { x: tf.w / 2, y: tf.h / 2, w: tf.w, h: tf.h };
    }
    if (s.main) {
      var ti = 0;
      tf.texts.forEach(function (t, i) { if (t.id === s.bindText) { ti = i; } });
      var b = measureTextObjectBounds(tf, ti);
      if (b && b.x2 > b.x1) {
        var sb = shapeSafeBox(s), sc = s.fitScale || 1;
        var w = (b.x2 - b.x1) / sb.w * 1.08 * sc, h = (b.y2 - b.y1) / sb.h * 1.08 * sc;
        return { x: (b.x1 + b.x2) / 2 - (sb.cx - 0.5) * w, y: (b.y1 + b.y2) / 2 - (sb.cy - 0.5) * h, w: w, h: h };
      }
    }
    var box = shapeBox(tf, s);
    return { x: s.x * tf.w, y: s.y * tf.h, w: box.w, h: box.h };
  }
  // Textbereich des Haupttexts eines Zettels (tf-Koordinaten): ohne Hauptform
  // die Karte mit Innenabstand 12 wie bisher, mit Hauptform deren Innenbereich.
  function primaryTextBox(tf) {
    var ms = mainShapeOf(tf);
    if (ms && !wordfieldIsWordart(tf)) {
      var sb = shapeSafeBox(ms);
      return { x: tf.w * (sb.cx - sb.w / 2), y: tf.h * (sb.cy - sb.h / 2), w: tf.w * sb.w, h: tf.h * sb.h, pad: 0 };
    }
    return { x: 0, y: 0, w: tf.w, h: tf.h, pad: 12 };
  }
  // Größte Schriftgröße <= t.size, bei der der Text (mit Umbruch) komplett
  // in box passt - unsichtbar ausgemessen, gecacht. Gilt dank relativer
  // Einheiten für jede Anzeigegröße, verhindert "Text sprengt den Zettel".
  var textFitCache = {};
  function fitTextSize(t, box, fontCss) {
    var html = t.html ? relativizeTextHtml(t.html, t.size) : (t.text ? escapeXml(t.text) : '');
    if (!html) { return t.size; }
    var key = [html, t.size, fontCss, t.fontWeight, t.lineHeight, t.letterSpacing, box.w, box.h, box.pad].join('|');
    if (textFitCache[key]) { return textFitCache[key]; }
    var probe = el('div', { html: html, style: 'position:fixed;left:-100000px;top:0;visibility:hidden;box-sizing:border-box;' +
      'width:' + box.w + 'px;height:' + box.h + 'px;padding:' + (box.pad || 0) + 'px;overflow:hidden;white-space:pre-wrap;word-wrap:break-word;' +
      'text-align:center;font-family:' + fontCss + ';font-weight:' + (t.fontWeight || 700) + ';line-height:' + (t.lineHeight || 1.2) + ';' +
      'letter-spacing:' + (t.letterSpacing || 0) + 'px;' });
    document.body.appendChild(probe);
    function fits(size) {
      probe.style.fontSize = size + 'px';
      return probe.scrollHeight <= probe.clientHeight + 1 && probe.scrollWidth <= probe.clientWidth + 1;
    }
    var result = t.size;
    if (!fits(t.size)) {
      var lo = 4, hi = t.size;
      for (var i = 0; i < 10; i++) { var mid = (lo + hi) / 2; if (fits(mid)) { lo = mid; } else { hi = mid; } }
      result = Math.floor(lo * 10) / 10;
    }
    probe.remove();
    textFitCache[key] = result;
    return result;
  }

  // Wortfeld als Vorschaubild (Meine Dateien, Klassenübersicht): dieselbe
  // Live-Darstellung wie auf der Pinnwand, als Ganzes (inkl. über die Karte
  // hinausragender WordArt) mittig in die umgebende Box eingepasst - statt
  // eines per object-fit:cover beschnittenen Bildes bzw. einer über die
  // Box hinausquellenden Darstellung. Die Box muss selbst eine feste Größe
  // haben (container-type:size), alles darin ist relativ, passt sich also
  // auch an responsive Thumbnail-Größen an.
  function buildWordfieldFit(tf) {
    var b = measureWordfieldBounds(tf);
    var bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    var box = el('div', { class: 'ic-wordfield-fit' });
    var view = el('div', {
      class: 'ic-wordfield-fit-view',
      style: 'aspect-ratio:' + bw + '/' + bh + ';width:min(100cqw, calc(100cqh * ' + (bw / bh).toFixed(5) + '));'
    });
    var pos = el('div', {
      style: 'position:absolute;left:' + (-b.x1 / bw * 100) + '%;top:' + (-b.y1 / bh * 100) + '%;width:' + (tf.w / bw * 100) + '%;'
    });
    pos.appendChild(buildTextFrameLiveDom(tf, { noGuide: true }));
    view.appendChild(pos);
    box.appendChild(view);
    return box;
  }

  // Gespeichertes Bild eines WordArt-Rahmens: exakt die Live-Darstellung der
  // Pinnwand (serialisiert per XMLSerializer, damit gültiges XHTML im SVG
  // landet) in einem foreignObject, viewBox = tatsächlich sichtbarer Bereich
  // (measureWordfieldBounds). Vorher baute buildTextFrameSVG() WordArt über
  // eine eigene, abweichende Logik nach (primärer Text immer mittig statt an
  // t.x/t.y, andere Umbruchbreite/Innenabstände, geschätzte Ränder) - dadurch
  // sah WordArt in der Präsentation/im Export anders aus als auf der
  // Pinnwand und wurde teils abgeschnitten.
  function buildTextFrameLiveSvg(tf) {
    var b = measureWordfieldBounds(tf);
    var bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    var xml = new XMLSerializer().serializeToString(buildTextFrameLiveDom(tf, { noGuide: true }));
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + bw + '" height="' + bh +
      '" viewBox="' + b.x1 + ' ' + b.y1 + ' ' + bw + ' ' + bh + '"><style>' +
      '.ic-frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;' +
      'font-size:.82em;line-height:1.1;margin:0 2px}' +
      '.ic-frac-num{border-bottom:1.5px solid currentColor;padding:0 3px 1px}' +
      '.ic-frac-den{padding:1px 3px 0}' +
      '</style>' +
      '<foreignObject x="' + b.x1 + '" y="' + b.y1 + '" width="' + bw + '" height="' + bh + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:' + bw + 'px;height:' + bh + 'px;margin:0;">' +
      '<div style="position:absolute;left:' + (-b.x1) + 'px;top:' + (-b.y1) + 'px;width:' + tf.w + 'px;">' +
      xml + '</div></div></foreignObject></svg>';
  }

  // Liefert die exakte, transformationsbewusste Ausdehnung EINES
  // WordArt-Textobjekts (Breite/Höhe des tatsächlich sichtbaren Bereichs
  // inkl. Extrusion/Schrägstellung/Drehung/Streckung) - gemeinsam genutzt
  // von computeAutoExportBounds() (Export-Beschneidung) UND vom Editor
  // selbst (automatische Rahmengröße, siehe renderTextFrame), damit beide
  // garantiert dieselbe Zahl liefern statt zweier separat gepflegter,
  // potenziell auseinanderlaufender Schätzungen.
  function wordartAutoExtent(t) {
    if (!t.wordartStyle || t.wordartStyle === 'none') { return null; }
    var fontCss = resolveFontCss(t.font);
    var gradParts = buildWordartGradientParts(t, t.text, fontCss);
    if (gradParts) { return { w: gradParts.w, h: gradParts.h }; }
    var wStyle = WORDART_STYLES.filter(function (w) { return w.id === t.wordartStyle; })[0] || {};
    var skewY = t.skewY != null ? t.skewY : (wStyle.skewY || 0);
    var rotate = t.rotate != null ? t.rotate : (wStyle.rotate || 0);
    var extrudeSteps = t.extrudeSteps != null ? t.extrudeSteps : (wStyle.extrudeSteps || 0);
    var scaleY = t.scaleY != null ? t.scaleY : (wStyle.scaleY || 1);
    var rotY = t.rotY || 0;
    var scaleXVal = Math.cos(rotY * Math.PI / 180);
    var skewFromRotY = Math.sin(rotY * Math.PI / 180) * 12;
    var lineH = t.size * (t.lineHeight || 1.2);
    fitCtx.font = (t.fontWeight || 700) + ' ' + t.size + 'px ' + fontCss;
    var textW = Math.max(t.size, fitCtx.measureText(t.text || '').width);
    var ext = wordartHalfExtent(textW / 2, lineH / 2, extrudeSteps * 0.8, rotate, scaleXVal, scaleY, skewY + skewFromRotY);
    var edgePad = t.size * 0.15 + 4;
    return { w: ext.halfW * 2 + edgePad * 2, h: ext.halfH * 2 + edgePad * 2 };
  }

  function computeAutoExportBounds(tf) {
    // Statt eines einzigen, symmetrischen Rands um den GANZEN Rahmen wird
    // pro Textobjekt eine echte Bounding-Box an seiner TATSÄCHLICHEN
    // Position aufaddiert - ein exzentrisch platziertes, nicht-primäres
    // WordArt-Objekt nah am Rand bekommt dadurch auf SEINER Seite genug
    // Rand, statt dass ein symmetrischer Rand auf der Rahmenmitte
    // zentriert angenommen wird.
    var eb = { x1: 0, y1: 0, x2: tf.w, y2: tf.h };
    function union(cx, cy, halfW, halfH) {
      eb.x1 = Math.min(eb.x1, cx - halfW);
      eb.y1 = Math.min(eb.y1, cy - halfH);
      eb.x2 = Math.max(eb.x2, cx + halfW);
      eb.y2 = Math.max(eb.y2, cy + halfH);
    }
    tf.texts.forEach(function (t, idx) {
      if (!t.wordartStyle || t.wordartStyle === 'none') { return; }
      var wStyle = WORDART_STYLES.filter(function (w) { return w.id === t.wordartStyle; })[0] || {};
      var cx = idx === 0 ? tf.w / 2 : t.x * tf.w;
      var cy = idx === 0 ? tf.h / 2 : t.y * tf.h;
      // Gemeinsame Funktion statt getrennter Gradient-/Nicht-Gradient-
      // Sonderfälle hier im Export - dieselbe Zahl, die auch der Editor
      // selbst für die automatische Rahmengröße nutzt (siehe
      // wordartAutoExtent(), renderTextFrame()).
      var autoExt = wordartAutoExtent(t);
      if (autoExt) { union(cx, cy, autoExt.w / 2 + 10, autoExt.h / 2 + 10); }
    });
    var margin = Math.max(30, Math.round(Math.min(tf.w, tf.h) * 0.15));
    eb.x1 -= margin; eb.y1 -= margin; eb.x2 += margin; eb.y2 += margin;
    return eb;
  }

  function buildTextFrameSVG(tf) {
    // Gespeichertes Bild = exakt die Pinnwand-Darstellung (serialisiertes
    // Live-DOM) - für WordArt UND Zettel (Hauptform als Karte, eingepasster
    // Text). Nur Zettel mit Textumfluss um Formen nutzen weiterhin den alten
    // Weg, weil der Umfluss erst asynchron berechnet wird.
    var usesWrap = (tf.shapes || []).some(function (sh) { return sh.wrapMode === 'wrap'; });
    if (wordfieldIsWordart(tf) || !usesWrap) { return buildTextFrameLiveSvg(tf); }
    var preset = TEXTFRAME_PRESETS.filter(function (p) { return p.id === tf.preset; })[0] || TEXTFRAME_PRESETS[0];
    var cardStyle = tf.cardStyle || {};
    var defs = '';
    var bgRect = '';
    var svgCardShape = mainShapeOf(tf);
    var hasCardBg = !svgCardShape && (cardStyle.fillColor || cardStyle.fillGradient || preset.bg);
    if (hasCardBg) {
      if (preset.shadow) {
        defs = '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">' +
          '<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/></filter></defs>';
      }
      var cardFillAttr = 'fill="' + escapeXml(cardStyle.fillColor || preset.bg || '#fff') + '"';
      if (cardStyle.fillGradient && cardStyle.fillGradient.length >= 2) {
        var cardGid = 'cardgrad';
        defs += '<defs>' + svgGradientTag(cardGid, cardStyle, true) + '</defs>';
        cardFillAttr = 'fill="url(#' + cardGid + ')"';
      }
      var cardStrokeAttr = cardStyle.outlineWidth ? ' stroke="' + escapeXml(cardStyle.outlineColor || '#000') + '" stroke-width="' + cardStyle.outlineWidth + '"' : '';
      bgRect = '<rect x="0" y="0" width="' + tf.w + '" height="' + tf.h + '" rx="16" ' + cardFillAttr + cardStrokeAttr +
        (preset.shadow ? ' filter="url(#shadow)"' : '') + '/>';
    }
    // Formen (Block "Farben und Formen") - jetzt echte, mehrfache Objekte
    // (tf.shapes), Reihenfolge richtet sich nach dem Umfluss-Modus:
    // "vor dem Text" liegt sichtbar über dem Text, sonst darunter.
    function renderShapeSvg(s) {
      var shapeDef = shapeDefFor(s);
      if (!shapeDef) { return ''; }
      var sg = resolveShapeGeom(tf, s);
      var sbox = { w: sg.w, h: sg.h };
      var tx = sg.x - sbox.w / 2, ty = sg.y - sbox.h / 2;
      var shapeDefs = '', fillAttr = 'fill="' + escapeXml(s.fillColor || '#e0503f') + '"';
      if (s.fillGradient && s.fillGradient.length >= 2) {
        var gid = 'shapegrad' + s.id;
        shapeDefs += svgGradientTag(gid, s, true);
        fillAttr = 'fill="url(#' + gid + ')"';
      }
      var filterAttr = '';
      if (s.shadowOn) {
        var fid = 'shapeshadow' + s.id;
        var shAngle3 = (s.shadowAngle != null ? s.shadowAngle : 45) * Math.PI / 180;
        var shDist3 = s.shadowDistance != null ? s.shadowDistance : 3;
        shapeDefs += '<filter id="' + fid + '" x="-50%" y="-50%" width="200%" height="200%">' +
          '<feDropShadow dx="' + (Math.cos(shAngle3) * shDist3).toFixed(1) + '" dy="' + (Math.sin(shAngle3) * shDist3).toFixed(1) +
          '" stdDeviation="' + ((s.shadowBlur || 4) / 4) +
          '" flood-color="' + escapeXml(s.shadowColor || '#000') + '"/></filter>';
        filterAttr = ' filter="url(#' + fid + ')"';
      } else if (s.glowOn) {
        var gfid2 = 'shapeglow' + s.id;
        shapeDefs += '<filter id="' + gfid2 + '" x="-60%" y="-60%" width="220%" height="220%">' +
          '<feFlood flood-color="' + escapeXml(s.glowColor || '#fff') + '" result="gc"/>' +
          '<feComposite in="gc" in2="SourceAlpha" operator="in" result="go"/>' +
          '<feGaussianBlur in="go" stdDeviation="' + ((s.glowWidth || 8) / 3) + '" result="gb"/>' +
          '<feMerge><feMergeNode in="gb"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
        filterAttr = ' filter="url(#' + gfid2 + ')"';
      }
      var strokeAttr = s.outlineWidth ? ' stroke="' + escapeXml(s.outlineColor || '#000') + '" stroke-width="' + s.outlineWidth + '"' : '';
      return (shapeDefs ? '<defs>' + shapeDefs + '</defs>' : '') +
        '<g transform="translate(' + (tx + sbox.w / 2) + ',' + (ty + sbox.h / 2) + ') rotate(' + (s.main ? 0 : (s.rotation || 0)) + ') translate(' + (-sbox.w / 2) + ',' + (-sbox.h / 2) + ') scale(' + (sbox.w / 100) + ',' + (sbox.h / 100) + ')">' +
        '<path d="' + shapeDef.d + '" ' + fillAttr + strokeAttr + filterAttr +
        (shapeDef.fillRule ? ' fill-rule="' + shapeDef.fillRule + '"' : '') + '/></g>';
    }
    var behindShapesEl = (tf.shapes || []).filter(function (s) { return s.wrapMode !== 'front'; }).map(renderShapeSvg).join('');
    var frontShapesEl = (tf.shapes || []).filter(function (s) { return s.wrapMode === 'front'; }).map(renderShapeSvg).join('');
    // Großzügiger äußerer Rand (siehe Kommentar bei computeAutoExportBounds)
    // MUSS jetzt schon feststehen, BEVOR die foreignObject-Boxen gebaut
    // werden - siehe idx===0-Zweig unten: die Box, die die GRÖSSE bestimmt,
    // und die Box, die tatsächlich beschneidet, müssen dieselbe sein, sonst
    // schützt der großzügige Rand am äußeren <svg> gar nichts (ein
    // foreignObject beschneidet seinen Inhalt an der EIGENEN width/height,
    // unabhängig davon, wie groß das umschließende <svg> ist).
    var eb = computeAutoExportBounds(tf);
    var ebw = eb.x2 - eb.x1, ebh = eb.y2 - eb.y1;
    // Alle Textobjekte (nicht nur das primäre) laufen über foreignObject mit
    // echtem HTML-Markup - so bleiben Fett/Kursiv/Unterstrichen/
    // Durchgestrichen/Aufzählung sowie Zeilenabstand/Laufweite erhalten
    // (SVG-<text> unterstützt weder automatischen Umbruch noch Inline-HTML).
    var textEls = tf.texts.map(function (t, idx) {
      var fontCss = resolveFontCss(t.font);
      var arcSvg = (idx !== 0 && t.arcStyle && t.arcStyle !== 'none') ? buildArcTextSvg(t, t.text, fontCss, t.fillColor || preset.text) : null;
      if (arcSvg) {
        var arcW = Math.max(120, t.size * 6), arcH = arcW * 0.4;
        return '<foreignObject x="' + (t.x * tf.w - arcW / 2) + '" y="' + (t.y * tf.h - arcH / 2) + '" width="' + arcW + '" height="' + arcH + '">' +
          '<div xmlns="http://www.w3.org/1999/xhtml">' + arcSvg + '</div></foreignObject>';
      }
      var wordartParts = buildWordartGradientParts(t, t.text, fontCss);
      if (wordartParts) {
        var wx = idx === 0 ? tf.w / 2 : t.x * tf.w, wy = idx === 0 ? tf.h / 2 : t.y * tf.h;
        return '<g transform="translate(' + (wx - wordartParts.w / 2) + ',' + (wy - wordartParts.h / 2) + ')">' + wordartParts.inner + '</g>';
      }
      var html = t.html ? relativizeTextHtml(t.html, t.size) : (t.text ? escapeXml(t.text) : '');
      if (!html) { return ''; }
      var baseStyle = 'box-sizing:border-box;font-family:' + escapeXml(fontCss) + ';font-size:' + t.size +
        'px;font-weight:' + (t.fontWeight || 700) + ';line-height:' + (t.lineHeight || 1.2) +
        ';letter-spacing:' + (t.letterSpacing || 0) + 'px;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;' +
        (wordartCssFor(t, preset.text, true) || computeStyle1Css(t, preset.text));
      if (idx === 0) {
        // Primäres Textobjekt: füllt den ganzen Rahmen (tf.w x tf.h) - ABER
        // die foreignObject-Box selbst ist jetzt genauso groß wie der
        // großzügige äußere Rand (eb/ebw/ebh), sonst beschneidet das
        // foreignObject (das IMMER an der eigenen width/height beschneidet,
        // egal wie groß das umschließende <svg> ist) über den Rahmen
        // hinausragende Effekte (WordArt-Streckung/Schrägstellung/
        // Extrusion, Kartenschatten) trotz des großzügigen äußeren Rands.
        // Die ursprüngliche tf.w x tf.h-Box mit identischer Flexbox-
        // Zentrierung sitzt als absolut positionierter innerer Wrapper an
        // exakt derselben Stelle wie vorher (Offset -eb.x1/-eb.y1) -
        // dadurch bleibt die sichtbare Position/Größe unverändert, nur der
        // Beschneidungsrahmen wächst mit. WICHTIG: baseStyle setzt selbst
        // "overflow:hidden" (für normalen Fließtext gedacht) - das MUSS
        // hier explizit NACH baseStyle auf "visible" überschrieben werden
        // (spätere Deklaration im selben style-Attribut gewinnt), sonst
        // beschneidet dieser innere tf.w x tf.h-Wrapper selbst weiterhin
        // exakt wie vorher, egal wie groß das umschließende foreignObject
        // ist - Sizing-Box und Clip-Box wären sonst zwar beim foreignObject
        // vereinheitlicht, aber durch dieses zusätzliche overflow:hidden
        // sofort wieder auseinandergerissen.
        return '<foreignObject x="' + eb.x1 + '" y="' + eb.y1 + '" width="' + ebw + '" height="' + ebh + '">' +
          '<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:100%;height:100%;overflow:visible;">' +
          '<div style="position:absolute;left:' + (-eb.x1) + 'px;top:' + (-eb.y1) + 'px;width:' + tf.w + 'px;height:' + tf.h + 'px;' +
          'box-sizing:border-box;padding:12px;' +
          'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;' + baseStyle + 'overflow:visible;">' +
          html + '</div></div></foreignObject>';
      }
      // Weitere Textobjekte: frei positioniert, Box-Größe grob aus dem
      // (Klartext-)Inhalt geschätzt (keine Live-DOM-Messung nötig).
      // Berücksichtigt Schriftgewicht und Laufweite, sonst könnte die Box
      // bei fettem Text/größerer Laufweite zu schmal geschätzt werden.
      var plain = t.text || '';
      var lines = Math.max(1, (html.match(/<div|<li|<br/gi) || []).length + (plain ? 1 : 0));
      var textW = Math.min(tf.w * 0.94, fitCtx && plain ? (function () {
        fitCtx.font = (t.fontWeight || 700) + ' ' + t.size + 'px ' + fontCss;
        return fitCtx.measureText(plain).width + Math.max(0, plain.length - 1) * (t.letterSpacing || 0) + 32;
      })() : tf.w * 0.5);
      var boxW = Math.max(60, textW);
      var boxH = lines * t.size * (t.lineHeight || 1.2) + 24;
      var boxX = t.x * tf.w - boxW / 2, boxY = t.y * tf.h - boxH / 2;
      return '<foreignObject x="' + boxX + '" y="' + boxY + '" width="' + boxW + '" height="' + boxH + '">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;' + baseStyle + 'overflow:visible;">' +
        html + '</div></foreignObject>';
    }).join('');
    // eb/ebw/ebh (großzügiger äußerer Rand) wurden schon VOR textEls oben
    // berechnet, siehe Kommentar dort - hier nur noch fürs äußere <svg>
    // selbst verwendet. SVGs beschneiden standardmäßig am eigenen
    // Viewport - ohne diesen Rand würden über den Kartenrand hinausragende
    // Effekte (WordArt-Streckung/Schrägstellung/Extrusion, Kartenschatten)
    // abgeschnitten, sobald das Ergebnis als <img> angezeigt wird (betraf
    // "Meine Dateien" und die Klassenübersicht). Rand berücksichtigt die
    // tatsächlich verwendeten Schrägstellungs-/Rotations-/Extrusions-Werte,
    // statt eines pauschalen Prozentsatzes - bei starker diagonaler
    // Verzerrung reichte ein fester Rand nicht aus (Ursache für Abschneiden
    // in der Präsentation bei skew-lastigen WordArt-Stilen). Der Nutzer
    // kann den Rahmen selbst über die beiden Größengriffe (unten-rechts,
    // oben-links) erweitern, falls mehr Platz als dieses automatische
    // Sicherheitsnetz nötig ist.
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + ebw + '" height="' + ebh +
      '" viewBox="' + eb.x1 + ' ' + eb.y1 + ' ' + ebw + ' ' + ebh + '"><style>' +
      '.ic-frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;' +
      'font-size:.82em;line-height:1.1;margin:0 2px}' +
      '.ic-frac-num{border-bottom:1.5px solid currentColor;padding:0 3px 1px}' +
      '.ic-frac-den{padding:1px 3px 0}' +
      '</style>' +
      defs + bgRect + behindShapesEl + textEls + frontShapesEl + '</svg>';
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
    tf.texts.forEach(function (t) { if (t.html || t.text) { usedFontIds[t.font] = true; } });
    // Feste 4-Font-Liste (webfont-Eigenschaft = fester Google-Fonts-
    // Parameter) UND die große WordArt-Schriftbibliothek (Präfix
    // "google:", Fontname direkt im Wert) gemeinsam einbetten - sonst
    // verweist das gespeicherte SVG auf eine nicht eingebettete Schrift
    // und fällt in der Präsentation/Meine Dateien auf die Standardschrift
    // zurück, obwohl Editor und Pinnwand (live, mit Zugriff auf die im
    // Dokument geladene Schrift) korrekt aussehen.
    var toEmbed = [];
    TEXTFRAME_FONTS.forEach(function (f) { if (f.webfont && usedFontIds[f.id]) { toEmbed.push({ id: f.id, webfont: f.webfont, css: f.css }); } });
    Object.keys(usedFontIds).forEach(function (fontVal) {
      if (fontVal && fontVal.indexOf('google:') === 0) {
        var name = fontVal.slice(7);
        if (!WORDART_WEBSAFE_FONTS[name]) {
          toEmbed.push({ id: fontVal, webfont: googleFontParam(name), css: "'" + name + "', sans-serif" });
        }
      }
    });
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
  // Folie (Faden-Rahmen): Inhalt + gerendertes SVG speichern, Rahmenlage
  // nachführen (im Editor verschobene Kanten/geänderte Größe).
  function saveFrameSlide(tf, saveBtn) {
    var it = editingFrameItem();
    if (!it) { return; }
    saveBtn.disabled = true;
    var svg;
    try { svg = buildTextFrameSVG(tf); } catch (e) { alert(S.error_save + ' (' + e.message + ')'); saveBtn.disabled = false; return; }
    var fg = currentFrameGeom(it, tf);
    var data = JSON.stringify(tf);
    embedFontsInSVG(svg, tf).then(function (finalSvg) {
      return callAjax('mod_pinnwand_set_frame_content', { cmid: cfg.cmid, itemid: it.id, framedata: data, framesvg: finalSvg });
    }).then(function () {
      it.framedata = data;
      var moved = Math.abs(fg.x - it.framex) > 0.01 || Math.abs(fg.y - it.framey) > 0.01 ||
        Math.abs(fg.w - it.framew) > 0.01 || Math.abs(fg.h - it.frameh) > 0.01;
      if (!moved) { return null; }
      it.framex = fg.x; it.framey = fg.y; it.framew = fg.w; it.frameh = fg.h;
      return callAjax('mod_pinnwand_update_thread_frame', {
        cmid: cfg.cmid, itemid: it.id, framex: it.framex, framey: it.framey, framew: it.framew, frameh: it.frameh,
        framerot: it.framerot || 0, framez: it.framez || 0
      });
    }).then(function () {
      resetCaptureState();
      state.step = 'arrange';
      render();
    }).catch(function (e) {
      alert(S.error_save + ' (' + e.message + ')');
      saveBtn.disabled = false;
    });
  }

  function saveTextFrame(tf, saveBtn, sendDirect) {
    if (state.editingFrameItemId) { saveFrameSlide(tf, saveBtn); return; }
    saveBtn.disabled = true;
    var svg, label, wordfielddata, isEditingExisting;
    try {
      svg = buildTextFrameSVG(tf);
      label = tf.texts.map(function (t) { return t.text; }).filter(Boolean).join(' ');
      wordfielddata = JSON.stringify(tf);
      isEditingExisting = !!state.editingPhotoId;
    } catch (e) {
      alert(S.error_save + ' (' + e.message + ')');
      saveBtn.disabled = false;
      return;
    }

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
        var photoid = isEditingExisting ? state.editingPhotoId : res.photoid;
        var afterSave = function () {
          refreshPhotos().then(function () {
            resetCaptureState();
            if (sendDirect) {
              // Direkt zur Board-Ansicht mit geöffnetem Post-Stream-Panel,
              // damit sofort sichtbar ist, dass das Objekt tatsächlich im
              // gemeinsamen Warteraum angekommen ist (statt bei "Meine
              // Bilder" zu landen, wo das nicht zu sehen war).
              state.step = 'arrange';
              state.streamPanelOpen = true;
              loadStreamPhotos();
            } else {
              state.step = isEditingExisting ? 'arrange' : (maxreached ? 'arrange' : 'home');
            }
            render();
          });
        };
        var slidePlace = !isEditingExisting && tf.isSlide ? state.slidePlacement : null;
        if (slidePlace && photoid && !sendDirect) {
          // Neue Folie: gleich an der geplanten Stelle auf die Pinnwand legen
          // und danach dorthin zurückkehren.
          // Erst sichtbar schalten (setzt boardplaced zurück), dann platzieren.
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: photoid, hidden: false }).then(function () {
            return callAjax('mod_pinnwand_update_layout', {
              cmid: cfg.cmid, photoid: photoid, x: slidePlace.canvasx, y: slidePlace.canvasy, w: slidePlace.canvasw,
              rot: 0, z: slidePlace.canvasz, boardid: slidePlace.boardid
            });
          }).then(function () {
            if (!state.slideBlendPending) { return null; }
            return callAjax('mod_pinnwand_set_blendmode', { cmid: cfg.cmid, photoid: photoid, mode: state.slideBlendPending });
          }).catch(function () { return null; }).then(function () {
            refreshPhotos().then(function () {
              resetCaptureState();
              state.step = 'arrange';
              render();
            });
          });
        } else if (sendDirect && photoid) {
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: photoid, hidden: false })
            .then(afterSave).catch(afterSave);
        } else {
          afterSave();
        }
      }).catch(function (e) {
        alert(S.error_save + ' (' + e.message + ')');
        saveBtn.disabled = false;
      });
    }).catch(function (e) {
      alert(S.error_save + ' (' + e.message + ')');
      saveBtn.disabled = false;
    });
  }

  function resetTfHistory() {
    state.tfUndoStack = []; state.tfRedoStack = []; state.tfLastSnapshot = null; state.tfSuppressSnapshot = false;
  }

  function renderTextFrame(body) {
    if (!state.textFrame) { state.textFrame = newTextFrame(state.wordArtMode); }
    var tf = state.textFrame;
    TEXTFRAME_FONTS.forEach(function (f) { if (f.webfont) { ensureWebfont(f.webfont); } });

    // Zurückgenommen (Wunsch des Nutzers, Phase 130): der automatische
    // tf.w/tf.h-Rahmen aus wordartAutoExtent() bei JEDEM Rendern im
    // WordArt-Modus (eingeführt Phase 123) schätzte die Breite über
    // fitCtx.measureText() als EINE ungebrochene Zeile - bei mehrzeilig
    // umbrochenem Text ergab das einen viel zu schmalen Rahmen, der beim
    // nächsten Rendern (z.B. nach Verlassen des Textfelds) den Text in
    // immer mehr kurze Zeilen zwang ("zwei Buchstaben pro Zeile", unten
    // abgeschnitten) und das Tippen selbst kaum mehr möglich machte.
    // wordartAutoExtent()/wordartHalfExtent() bleiben unverändert bestehen
    // - sie werden weiterhin von computeAutoExportBounds() für den
    // Export-Beschneidungsrand gebraucht (Phase 121-129) - nur der
    // EDITOR erzwingt tf.w/tf.h damit nicht mehr bei jedem Rendern; der
    // Rahmen ist wieder manuell ziehbar wie vor Phase 123 (siehe
    // attachFrameResizeHandle-Aufrufe unten).

    // Undo/Redo: erkennt Zustandsänderungen zentral bei jedem Rendern
    // (statt jeden der vielen Änderungs-Punkte im Editor einzeln
    // verdrahten zu müssen) - jede tatsächliche Änderung an tf wird
    // automatisch zu einem Undo-Punkt.
    var tfJson = JSON.stringify(tf);
    if (state.tfLastSnapshot && state.tfLastSnapshot !== tfJson && !state.tfSuppressSnapshot) {
      state.tfUndoStack = (state.tfUndoStack || []).concat([state.tfLastSnapshot]).slice(-50);
      state.tfRedoStack = [];
    }
    state.tfLastSnapshot = tfJson;
    state.tfSuppressSnapshot = false;
    function tfUndo() {
      if (!state.tfUndoStack || !state.tfUndoStack.length) { return; }
      var prev = state.tfUndoStack.pop();
      state.tfRedoStack = (state.tfRedoStack || []).concat([state.tfLastSnapshot]);
      state.tfSuppressSnapshot = true;
      state.textFrame = JSON.parse(prev);
      render();
    }
    function tfRedo() {
      if (!state.tfRedoStack || !state.tfRedoStack.length) { return; }
      var next = state.tfRedoStack.pop();
      state.tfUndoStack = (state.tfUndoStack || []).concat([state.tfLastSnapshot]);
      state.tfSuppressSnapshot = true;
      state.textFrame = JSON.parse(next);
      render();
    }

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
    // Werkzeuge liegen jetzt immer in einem schmalen Menüband unter der
    // Arbeitsfläche (Popups), daher stets die gestapelte Anordnung.
    var tfOrientation = 'ic-tf-landscape';
    var layout = el('div', { class: 'ic-textframe-layout ' + tfOrientation });
    var tfShowBg = state.tfShowBoardBg !== false; // Standardmäßig aktiv, außer der Nutzer hat es explizit ausgeschaltet
    var stage = el('div', { class: 'ic-stage ic-tf-stage' + (tfShowBg ? ' ic-tf-stage-boardbg' : '') });
    var editingRec = state.editingPhotoId ? state.photos.filter(function (p) { return p.id === state.editingPhotoId; })[0] : null;
    var isSlide = !!tf.isSlide;
    // Neue Folie: geplante Board-Position (siehe currentSlidePlacement) -
    // so zeigt auch der Editor einer noch nicht gespeicherten Folie den
    // Hintergrund genau an der Stelle, an der sie auf der Pinnwand landet.
    if (!editingRec && isSlide && state.slidePlacement) {
      editingRec = { id: -1, canvasx: state.slidePlacement.canvasx, canvasy: state.slidePlacement.canvasy, canvasw: state.slidePlacement.canvasw,
        canvasz: state.slidePlacement.canvasz, boardid: state.slidePlacement.boardid };
    }
    // Folie = Faden-Rahmen: Lage aus dem Rahmen (inkl. im Editor
    // verschobener Kanten), fester Maßstab für die ganze Sitzung.
    var editFrameIt = isSlide ? editingFrameItem() : null;
    if (editFrameIt) {
      var efg = currentFrameGeom(editFrameIt, tf);
      // Gedrehter Rahmen: die Pinnwand dreht sich im Editor um einen FESTEN
      // Punkt (Rahmenmitte beim Öffnen) entgegen - so bleibt sie beim
      // Verschieben der Kanten exakt stehen. Die Lage des (gerade
      // dargestellten) Rahmens folgt daraus.
      var rcx = editFrameIt.framex + editFrameIt.framew / 2, rcy = editFrameIt.framey + editFrameIt.frameh / 2;
      var erad = -(efg.rot || 0) * Math.PI / 180;
      var ecx = efg.x + efg.w / 2 - rcx, ecy = efg.y + efg.h / 2 - rcy;
      var edx = rcx + ecx * Math.cos(erad) - ecy * Math.sin(erad), edy = rcy + ecx * Math.sin(erad) + ecy * Math.cos(erad);
      editingRec = { id: -1, canvasx: edx - efg.w / 2, canvasy: edy - efg.h / 2, canvasw: efg.w, canvasz: editFrameIt.framez || 0,
        boardid: editFrameIt.boardid || 0, rot: efg.rot, frameId: editFrameIt.id, rotCx: rcx, rotCy: rcy, fg: efg };
    }
    if (isSlide) { stage.classList.add('ic-tf-stage-slide'); }
    var hasBoardPos = editingRec && editingRec.canvasw;
    var bgScale = hasBoardPos ? (tf.w / editingRec.canvasw) : 1;
    if (tfShowBg) {
      var bbg = state.background || { type: 'color', color: '#2b2d33' };
      stage.style.backgroundColor = bbg.color || '#2b2d33';
      if ((bbg.type === 'image' || bbg.type === 'url' || bbg.type === 'upload') && bbg.url && !hasBoardPos) {
        // Keine Board-Position bekannt (neues, noch nicht platziertes
        // Objekt) - einfache Vollbild-Notlösung ohne genauen Bezug.
        stage.style.backgroundImage = 'url(' + bbg.url + ')'; stage.style.backgroundSize = 'cover'; stage.style.backgroundPosition = 'center';
      }
      // Nachbarobjekte zeigen, mit denen dieses Textfeld auf der Pinnwand
      // interagieren soll - genau die, die auch bei Fokus in der
      // Präsentation sichtbar bleiben (gleiche oder niedrigere Ebene,
      // siehe Verdeckungs-Logik dort: rec.z > activeZ wird ausgeblendet).
      // Nur möglich, wenn ein bereits platziertes Objekt bearbeitet wird -
      // ein neues, noch nicht platziertes Objekt hat keine Board-Position.
      if (hasBoardPos) {
        var thisZ = editingRec.canvasz || 0;
        // Folie: Hintergrund und Nachbarn auch RUND UM den Rahmen (ganze
        // Pinnwand im selben Maßstab), damit die Folie im Zusammenhang
        // gestaltet werden kann. Sonst nur innerhalb des Rahmens.
        // Alle Editoren: Pinnwand-Hintergrund und darunterliegende Ebenen
        // rund um das Objekt - wie in der Präsentation.
        var nOffX = editingRec.canvasx * bgScale, nOffY = editingRec.canvasy * bgScale;
        // Gedrehtes Objekt/Rahmen: die Pinnwand dreht sich im Editor entgegen.
        var edRot = editingRec.rot != null ? editingRec.rot : (editingRec.canvasrot || 0);
        var neighborsLayer = el('div', {
          class: 'ic-tf-neighbors-layer ic-tf-neighbors-wide',
          style: 'left:' + (-nOffX) + 'px;top:' + (-nOffY) + 'px;width:' + (BOARD_W * bgScale) + 'px;height:' + (BOARD_H * bgScale) + 'px;' +
            // Gedrehter Rahmen: die Pinnwand dreht sich im Editor entgegen,
            // die Folie selbst steht gerade (wie die Kamera der Präsentation).
            (edRot ? 'transform-origin:' + (editingRec.rotCx != null ? editingRec.rotCx * bgScale : nOffX + tf.w / 2) + 'px ' +
              (editingRec.rotCy != null ? editingRec.rotCy * bgScale : nOffY + tf.h / 2) + 'px;transform:rotate(' + (-edRot) + 'deg);' : '') +
            (((bbg.type === 'image' || bbg.type === 'url' || bbg.type === 'upload') && bbg.url)
            // Hintergrundbild an der TATSÄCHLICH richtigen Stelle: das Bild
            // wird so groß wie das ganze Board dargestellt (BOARD_W/H
            // skaliert), dann so verschoben, dass genau der Ausschnitt an
            // der Kartenposition zu sehen ist - statt einer beliebigen
            // "cover/zentriert"-Notlösung ohne Bezug zur echten Position.
            ? ('background-image:url(' + bbg.url + ');background-repeat:no-repeat;' +
              'background-size:' + (BOARD_W * bgScale) + 'px ' + (BOARD_H * bgScale) + 'px;' +
              'background-position:' + (-editingRec.canvasx * bgScale + nOffX) + 'px ' + (-editingRec.canvasy * bgScale + nOffY) + 'px;')
            : '')
        });
        state.photos.filter(function (p) {
          return p.id !== editingRec.id && !p.hiddenfromboard && p.boardplaced &&
            (p.boardid || 0) === (editingRec.boardid || 0) && (p.canvasz || 0) <= thisZ;
        }).forEach(function (p) {
          var nx = (p.canvasx - editingRec.canvasx) * bgScale + nOffX, ny = (p.canvasy - editingRec.canvasy) * bgScale + nOffY;
          var nw = p.canvasw * bgScale;
          // Wortfelder live (wie auf der Pinnwand), Bilder als Bild; Folien
          // zeigen die Nachbarn deckend und mit ihrem Mischmodus.
          var nEl = null;
          if (p.wordfielddata) {
            try { nEl = buildTextFrameLiveDom(JSON.parse(p.wordfielddata), { noGuide: true }); } catch (eN) { nEl = null; }
          }
          var nWrap = el('div', {
            style: 'position:absolute;left:' + nx + 'px;top:' + ny + 'px;width:' + nw + 'px;' +
              'transform:rotate(' + (p.canvasrot || 0) + 'deg);pointer-events:none;' +
              (p.blendmode ? 'mix-blend-mode:' + p.blendmode + ';' : '')
          }, [nEl || el('img', { src: p.url, alt: '', style: 'width:100%;display:block;' })]);
          neighborsLayer.appendChild(nWrap);
        });
        // Andere Folien des eigenen Fadens (bis zur eigenen Ebene) ebenfalls.
        var nThread = ownThread();
        (nThread ? nThread.items : []).forEach(function (o) {
          if (o.itemtype !== 'frame' || o.id === editingRec.frameId || (o.boardid || 0) !== (editingRec.boardid || 0) || (o.framez || 0) > thisZ) { return; }
          var otf = frameSlideTf(o);
          if (!otf) { return; }
          var oEl = buildFrameSlideEl(o, otf, 'ic-tf-neighbor-slide');
          oEl.style.left = (o.framex * bgScale) + 'px'; oEl.style.top = (o.framey * bgScale) + 'px';
          oEl.style.width = (o.framew * bgScale) + 'px'; oEl.style.height = (o.frameh * bgScale) + 'px';
          oEl.style.zIndex = '';
          oEl.style.pointerEvents = 'none';
          neighborsLayer.appendChild(oEl);
        });
      }
    }
    var preset = TEXTFRAME_PRESETS.filter(function (p) { return p.id === tf.preset; })[0];
    tf.shapes = tf.shapes || [];
    // Zettel mit Hauptform: die Form ist die Karte (kein rechteckiger
    // Hintergrund/Schatten mehr, nur eine dünne Hilfslinie für den Rahmen).
    var editorCardShape = !state.wordArtMode ? mainShapeOf(tf) : null;
    var frame = el('div', {
      class: 'ic-textframe-preview',
      style: 'width:' + tf.w + 'px;height:' + tf.h + 'px;' +
        (preset.shadow && !editorCardShape ? 'box-shadow:0 8px 24px rgba(0,0,0,.4);' : '') +
        (preset.bg && !editorCardShape ? '' : 'border:2px dashed rgba(255,255,255,.3);')
    });
    if (typeof neighborsLayer !== 'undefined' && neighborsLayer) { frame.appendChild(neighborsLayer); }
    // Innerer Container trägt Hintergrundfarbe UND die Formbeschneidung
    // (Kreis/Oval/Rundung) - overflow:hidden bleibt bewusst HIER und nicht
    // auf frame selbst, sonst würde der leicht außerhalb liegende
    // Größenänderungs-Griff (siehe unten) unsichtbar/unklickbar.
    var cardStyle = tf.cardStyle || {};
    var cardBg = editorCardShape ? 'background:transparent;' : cardStyle.fillGradient
      ? 'background-image:' + cssGradientFor(cardStyle) + ';'
      : (cardStyle.fillColor ? 'background:' + cardStyle.fillColor + ';' : (preset.bg ? 'background:' + preset.bg + ';' : 'background:transparent;'));
    var cardBorder = !editorCardShape && cardStyle.outlineWidth ? 'box-shadow:inset 0 0 0 ' + cardStyle.outlineWidth + 'px ' + (cardStyle.outlineColor || '#000') + ';' : '';
    var frameInner = el('div', {
      class: 'ic-textframe-inner',
      style: cardBg + cardBorder
    });
    frame.appendChild(frameInner);
    if (isSlide) { applySlideBg(frameInner, tf); }
    // Mit der Folie verknüpfte Objekte, die eigentlich darüber liegen: im
    // Editor über der Folie zeigen (wie später in der Präsentation).
    if (isSlide && hasBoardPos && tfShowBg && (tf.linked || []).length) {
      var aboveLayer = el('div', {
        class: 'ic-tf-neighbors-layer ic-tf-neighbors-wide ic-tf-above-layer',
        style: neighborsLayer ? neighborsLayer.getAttribute('style').replace(/background-image:[^;]*;|background-repeat:[^;]*;|background-size:[^;]*;|background-position:[^;]*;/g, '') : ''
      });
      state.photos.filter(function (p) { return tf.linked.indexOf(p.id) !== -1; }).forEach(function (p) {
        var lEl = null;
        if (p.wordfielddata) { try { lEl = buildTextFrameLiveDom(JSON.parse(p.wordfielddata), { noGuide: true }); } catch (eL) { lEl = null; } }
        aboveLayer.appendChild(el('div', {
          style: 'position:absolute;left:' + (p.canvasx * bgScale) + 'px;top:' + (p.canvasy * bgScale) + 'px;width:' + (p.canvasw * bgScale) + 'px;' +
            'transform:rotate(' + (p.canvasrot || 0) + 'deg);pointer-events:none;' + (p.blendmode ? 'mix-blend-mode:' + p.blendmode + ';' : '')
        }, [lEl || el('img', { src: p.url, alt: '', style: 'width:100%;display:block;' })]));
      });
      frame.appendChild(aboveLayer);
    }

    // Klickbarer Rahmen um den Zettel zur Auswahl der Kartenfläche selbst
    // (Kontur/Hintergrund/Effekte werden dann bearbeitbar) - liegt als
    // "Rahmen mit Loch" (clip-path) über allem, reagiert aber NUR am
    // Rand selbst auf Klicks, die Mitte bleibt für Text/Formen frei.
    var cardFrameHit = el('div', {
      class: 'ic-textframe-card-hit' + (state.activeShapeId === '__card__' ? ' active' : ''),
      title: S.tf_target_card
    });
    cardFrameHit.addEventListener('click', function (ev) {
      ev.stopPropagation();
      // Mit Hauptform ist die Form die Karte - Rand-Klick wählt sie.
      state.activeShapeId = editorCardShape ? editorCardShape.id : '__card__';
      state.styleTargetMode = 'shape';
      render();
    });
    frame.appendChild(cardFrameHit);
    stage.appendChild(frame);
    // Folie: die Pinnwand steht fest, der Rahmen liegt an seiner echten
    // Stelle darauf. Kanten ändern nur die Rahmengröße (der Inhalt der
    // Pinnwand wandert nicht mit); Ziehen auf freier Fläche verschiebt die
    // Ansicht.
    if (editFrameIt && hasBoardPos) {
      var worldK = bgScale;
      if (!state.tfPan) {
        state.tfPan = {
          x: window.innerWidth / 2 - (editingRec.canvasx * worldK + tf.w / 2),
          y: (window.innerHeight - 60) / 2 - (editingRec.canvasy * worldK + tf.h / 2)
        };
      }
      frame.classList.add('ic-slide-world-frame');
      var placeWorldFrame = function () {
        frame.style.left = (editingRec.canvasx * worldK + state.tfPan.x) + 'px';
        frame.style.top = (editingRec.canvasy * worldK + state.tfPan.y) + 'px';
      };
      placeWorldFrame();
      var panDrag = null;
      stage.addEventListener('pointerdown', function (ev) {
        if (ev.target !== stage) { return; }
        panDrag = { sx: ev.clientX, sy: ev.clientY, px: state.tfPan.x, py: state.tfPan.y };
        try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        stage.classList.add('ic-panning');
      });
      stage.addEventListener('pointermove', function (ev) {
        if (!panDrag) { return; }
        state.tfPan.x = panDrag.px + ev.clientX - panDrag.sx;
        state.tfPan.y = panDrag.py + ev.clientY - panDrag.sy;
        placeWorldFrame();
      });
      var endPan = function () { panDrag = null; stage.classList.remove('ic-panning'); };
      stage.addEventListener('pointerup', endPan);
      stage.addEventListener('pointercancel', endPan);
    }
    layout.appendChild(stage);
    body.appendChild(layout);

    // Hauptrahmen-Griff unten-rechts: erweitert den Rahmen OHNE dass
    // sich Text/WordArt dabei bewegt oder mitskaliert - die absolute
    // Pixelposition jedes Objekts bleibt erhalten (normalisierte
    // Koordinaten werden nachgerechnet). Wieder für BEIDE Modi aktiv
    // (Phase 130 - siehe Kommentar oben zur Rücknahme der automatischen
    // WordArt-Rahmengröße).
    var frameResizeHandle = el('div', { class: 'ic-resize' });
    frame.appendChild(frameResizeHandle);
    function attachFrameResizeHandle(handle, cornerX, cornerY, listenerKey) {
      var dragging = false, startX = 0, startY = 0, startW = 0, startH = 0;
      var startMarginLeft = 0, startMarginTop = 0;
      function pt(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
      function down(ev) {
        dragging = true; var p = pt(ev);
        startX = p.x; startY = p.y; startW = tf.w; startH = tf.h;
        // Rahmen steht zentriert (margin:auto) - für die Dauer des Ziehens
        // die tatsächlichen Abstände festhalten, damit die gegenüberliegende
        // Kante stehen bleibt.
        var fcs = getComputedStyle(frame);
        startMarginLeft = parseFloat(fcs.marginLeft) || 0;
        startMarginTop = parseFloat(fcs.marginTop) || 0;
        frame.style.marginLeft = startMarginLeft + 'px';
        frame.style.marginTop = startMarginTop + 'px';
        frame.style.marginRight = '0'; frame.style.marginBottom = '0';
        ev.stopPropagation(); ev.preventDefault();
      }
      function move(ev) {
        if (!dragging) { return; }
        var p = pt(ev);
        var dx = (p.x - startX) * cornerX, dy = (p.y - startY) * cornerY;
        var newW = cornerX ? Math.max(120, startW + dx) : startW;
        var newH = (state.tfAspectLocked && cornerX && cornerY) ? Math.max(80, Math.round(newW * (startH / startW))) : (cornerY ? Math.max(80, startH + dy) : startH);
        tf.w = newW; tf.h = newH;
        frame.style.width = tf.w + 'px'; frame.style.height = tf.h + 'px';
        // Bei den negativen Ecken (oben-links) wächst der Rahmen zusätzlich
        // per Margin-Verschiebung visuell von dort aus, wo tatsächlich
        // gezogen wird, statt stur an der oben-links-Position fixiert zu
        // bleiben und nur unten-rechts zu wachsen.
        if (cornerX < 0) { frame.style.marginLeft = (startMarginLeft - (tf.w - startW)) + 'px'; }
        if (cornerY < 0) { frame.style.marginTop = (startMarginTop - (tf.h - startH)) + 'px'; }
        ev.preventDefault();
      }
      function up() {
        if (!dragging) { return; }
        dragging = false;
        // Absolute Pixelposition jedes Objekts erhalten: da tf.w/tf.h
        // die Bezugsgröße für die normalisierten Koordinaten sind,
        // müssen diese beim Ändern von tf.w/tf.h entsprechend
        // nachgerechnet werden, damit sich nichts sichtbar verschiebt.
        // Erst beim Loslassen statt bei jedem Mausschritt, damit das
        // Ziehen selbst flüssig bleibt.
        // Linke/obere Kante: der Rand selbst wandert, der Inhalt bleibt an
        // seiner Stelle (vorher rutschte alles mit dem Rand mit, sodass sich
        // der linke Rand praktisch nicht verschieben ließ).
        var offX = cornerX < 0 ? tf.w - startW : 0, offY = cornerY < 0 ? tf.h - startH : 0;
        tf.texts.forEach(function (t) { t.x = (t.x * startW + offX) / tf.w; t.y = (t.y * startH + offY) / tf.h; });
        var sizeK = Math.min(startW, startH) / Math.min(tf.w, tf.h);
        (tf.shapes || []).forEach(function (sh) {
          if (sh.main) { return; }
          sh.x = ((sh.x != null ? sh.x : 0.5) * startW + offX) / tf.w;
          sh.y = ((sh.y != null ? sh.y : 0.5) * startH + offY) / tf.h;
          sh.size = (sh.size || 0.4) * sizeK;
        });
        if (tf.isSlide) {
          // Folie = Rahmen auf der Pinnwand: dessen Ursprung wandert mit.
          state.slideShift = state.slideShift || { dx: 0, dy: 0 };
          state.slideShift.dx -= offX; state.slideShift.dy -= offY;
        }
        if (!state.wordArtMode) {
          // Normale Textfelder: automatische Schriftgrößen-Anpassung
          // bleibt erhalten (dort gibt es nur diesen einen Griff).
          var primaryEl = tf.texts[0] && frame.querySelector('[data-textid="' + tf.texts[0].id + '"]');
          if (primaryEl) { autoFitPrimaryText(primaryEl, tf.texts[0], tf.h); }
        }
        render();
      }
      // Vorherige Render-Runde: alte window-Listener entfernen, bevor
      // neue hinzugefügt werden - sonst sammeln sich bei jedem
      // Neu-Rendern (das bei jeder Steuerelement-Änderung passiert)
      // immer mehr veraltete Listener mit toten Referenzen an, was das
      // Ziehen irgendwann unzuverlässig bis unmöglich macht.
      if (state[listenerKey]) {
        window.removeEventListener('mousemove', state[listenerKey].move);
        window.removeEventListener('touchmove', state[listenerKey].move);
        window.removeEventListener('mouseup', state[listenerKey].up);
        window.removeEventListener('touchend', state[listenerKey].up);
      }
      state[listenerKey] = { move: move, up: up };
      handle.addEventListener('mousedown', down);
      handle.addEventListener('touchstart', down, { passive: false });
      window.addEventListener('mousemove', move);
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('mouseup', up);
      window.addEventListener('touchend', up);
    }
    if (frameResizeHandle) { attachFrameResizeHandle(frameResizeHandle, 1, 1, 'tfResizeListeners'); }
    // Kantengriffe (alle Editoren): jede Kante einzeln verschiebbar - auch
    // die linke und obere, ohne dass der Inhalt mitwandert.
    [['l', -1, 0], ['r', 1, 0], ['t', 0, -1], ['b', 0, 1]].forEach(function (eg) {
      var edgeHandle = el('div', { class: 'ic-resize-edge ic-resize-edge-' + eg[0] });
      frame.appendChild(edgeHandle);
      attachFrameResizeHandle(edgeHandle, eg[1], eg[2], 'tfResizeEdge' + eg[0] + 'Listeners');
    });

    // Zweiter Griff oben-links: dieselbe "Rahmen erweitern ohne Text zu
    // bewegen"-Logik, nur von der linken oberen Ecke aus (cornerX/Y=-1,
    // also entgegengesetztes Vorzeichen der Mausbewegung). Wieder aktiv
    // im WordArt-Modus (Phase 130 - siehe Kommentar oben).
    if (state.wordArtMode) {
      var frameResizeHandleTL = el('div', { class: 'ic-resize ic-resize-tl' });
      frame.appendChild(frameResizeHandleTL);
      attachFrameResizeHandle(frameResizeHandleTL, -1, -1, 'tfResizeTlListeners');

      // Dritter Griff oben-rechts (rot): das ist der einzige Griff, der
      // die Schrift TATSÄCHLICH größer/kleiner macht (automatische
      // Schriftgrößen-Anpassung) - bewusst von den beiden blauen Griffen
      // getrennt, die NUR den Rahmen erweitern sollen.
      var frameResizeHandleTR = el('div', { class: 'ic-resize ic-resize-tr' + (tf.isSlide ? ' ic-hidden-handle' : '') });
      frame.appendChild(frameResizeHandleTR);
      (function () {
        var draggingTr = false, startXtr = 0, startYtr = 0, startWtr = 0, startHtr = 0;
        function ptTr(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
        function downTr(ev) {
          draggingTr = true; var p = ptTr(ev);
          startXtr = p.x; startYtr = p.y; startWtr = tf.w; startHtr = tf.h;
          ev.stopPropagation(); ev.preventDefault();
        }
        function moveTr(ev) {
          if (!draggingTr) { return; }
          var p = ptTr(ev);
          tf.w = Math.max(120, startWtr + (p.x - startXtr));
          tf.h = state.tfAspectLocked ? Math.max(80, Math.round(tf.w * (startHtr / startWtr))) : Math.max(80, startHtr - (p.y - startYtr));
          frame.style.width = tf.w + 'px'; frame.style.height = tf.h + 'px';
          ev.preventDefault();
        }
        function upTr() {
          if (!draggingTr) { return; }
          draggingTr = false;
          var primaryEl = tf.texts[0] && frame.querySelector('[data-textid="' + tf.texts[0].id + '"]');
          if (primaryEl) { autoFitPrimaryText(primaryEl, tf.texts[0], tf.h); }
          render();
        }
        if (state.tfResizeTrListeners) {
          window.removeEventListener('mousemove', state.tfResizeTrListeners.move);
          window.removeEventListener('touchmove', state.tfResizeTrListeners.move);
          window.removeEventListener('mouseup', state.tfResizeTrListeners.up);
          window.removeEventListener('touchend', state.tfResizeTrListeners.up);
        }
        state.tfResizeTrListeners = { move: moveTr, up: upTr };
        frameResizeHandleTR.addEventListener('mousedown', downTr);
        frameResizeHandleTR.addEventListener('touchstart', downTr, { passive: false });
        window.addEventListener('mousemove', moveTr);
        window.addEventListener('touchmove', moveTr, { passive: false });
        window.addEventListener('mouseup', upTr);
        window.addEventListener('touchend', upTr);
      })();
    } else {
      // Alte, jetzt ungenutzte Fenster-Listener aus einer vorherigen
      // Render-Runde vorsorglich entfernen, damit keine toten Referenzen
      // übrig bleiben, falls zwischen WordArt- und normalem Modus
      // gewechselt wird.
      if (state.tfResizeTlListeners) {
        window.removeEventListener('mousemove', state.tfResizeTlListeners.move);
        window.removeEventListener('touchmove', state.tfResizeTlListeners.move);
        window.removeEventListener('mouseup', state.tfResizeTlListeners.up);
        window.removeEventListener('touchend', state.tfResizeTlListeners.up);
        state.tfResizeTlListeners = null;
      }
      if (state.tfResizeTrListeners) {
        window.removeEventListener('mousemove', state.tfResizeTrListeners.move);
        window.removeEventListener('touchmove', state.tfResizeTrListeners.move);
        window.removeEventListener('mouseup', state.tfResizeTrListeners.up);
        window.removeEventListener('touchend', state.tfResizeTrListeners.up);
        state.tfResizeTrListeners = null;
      }
    }
    var activeId = null;
    function selectText(id) {
      activeId = id;
      if (id != null) { state.tfLastTextId = id; state.styleTargetMode = 'text'; }
      frame.querySelectorAll('.ic-textframe-obj').forEach(function (o) {
        o.classList.toggle('active', o.dataset.textid === String(id));
      });
      refreshControls();
    }

    function textEl(t, idx) {
      var isPrimary = idx === 0;
      // Nur für normale (Nicht-WordArt) Textfelder soll das primäre Objekt
      // automatisch den ganzen Rahmen ausfüllen und zentrieren
      // (inset:0+table-cell+vertical-align:middle) - bei WordArt würde das
      // die t.x/t.y-Positionierung und damit die Kompensation beim
      // Rahmen-Resize (Griffe) komplett umgehen ("Text rutscht mit").
      // WordArt nutzt deshalb dieselbe positionsbasierte Darstellung wie
      // nicht-primäre Objekte - entspricht auch der Darstellung auf der
      // Pinnwand (buildTextFrameLiveDom), die niemals inset:0 nutzt.
      var useFillCentering = isPrimary && !state.wordArtMode;
      t.lineHeight = t.lineHeight || 1.2;
      t.letterSpacing = t.letterSpacing || 0;
      t.fontWeight = t.fontWeight || 700;
      var fontCss = resolveFontCss(t.font);
      // Zettel-Haupttext: im Textbereich (Karte bzw. Innenbereich der
      // Hauptform), Schrift ggf. verkleinert, damit nichts überläuft -
      // dieselbe Berechnung wie auf der Pinnwand.
      var edBox = useFillCentering ? primaryTextBox(tf) : null;
      var edSize = useFillCentering ? fitTextSize(t, edBox, fontCss) : t.size;
      var elStyle = (useFillCentering
        ? (edBox.pad ? '' : 'inset:auto;left:' + edBox.x + 'px;top:' + edBox.y + 'px;width:' + edBox.w + 'px;height:' + edBox.h + 'px;padding:0;')
        : 'left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;' + (t.boxW ? 'width:' + (t.boxW * 100) + '%;max-width:none;' : 'width:max-content;max-width:94%;')) +
        'font-family:' + fontCss + ';font-size:' + edSize + 'px;font-weight:' + t.fontWeight +
        ';line-height:' + t.lineHeight + ';letter-spacing:' + t.letterSpacing + 'px;' +
        (wordartCssFor(t, preset.text, useFillCentering) || computeStyle1Css(t, preset.text));
      var el2 = el('div', {
        class: 'ic-textframe-obj' + (useFillCentering ? ' primary' : '') + (t.id === activeId ? ' active' : ''),
        'data-textid': String(t.id),
        contenteditable: 'true',
        style: elStyle
      });
      // innerHTML statt textContent: so bleiben Fett/Kursiv/Unterstrichen/
      // Durchgestrichen/Aufzählungen (siehe Formatierungswerkzeuge) beim
      // Zwischenspeichern erhalten statt auf reinen Text reduziert zu werden.
      // Abwärtskompatibel: ältere gespeicherte Wortfelder haben nur t.text
      // (kein t.html) - dann als Klartext übernehmen statt leer zu bleiben.
      if (t.html) { el2.innerHTML = relativizeTextHtml(t.html, t.size); } else if (t.text) { el2.textContent = t.text; }
      if (!t.html && !t.text) { el2.setAttribute('data-placeholder', S.textframe_placeholder); el2.classList.add('ic-tf-empty'); }
      el2.addEventListener('input', function () { el2.classList.toggle('ic-tf-empty', !objTextWithoutHandles(el2).trim()); });
      // Wichtig: hier KEIN render() aufrufen - das würde das gerade fokussierte
      // contenteditable-Element sofort zerstören und den Cursor verlieren,
      // noch bevor überhaupt etwas eingegeben werden kann. Stattdessen wird
      // nur die aktive Markierung + das Steuerelemente-Panel isoliert
      // aktualisiert (siehe selectText/refreshControls).
      // Während der Bearbeitung (Fokus) wird bei WordArt die CSS-Transform
      // (skewY/scaleX/scaleY/rotate aus wordartCssFor) vorübergehend
      // entfernt: Klicken/Ziehen zum Markieren einzelner Buchstaben in
      // einem contenteditable-Element ist mit aktiver Transform (v.a.
      // skewY+scaleY kombiniert) browserübergreifend sehr unzuverlässig -
      // der Browser bildet Mausposition und Zeichen-Trefferbereich dann
      // nicht mehr präzise aufeinander ab. Farbe/Kontur/Schatten bleiben
      // unverändert, nur die Verzerrung/Drehung wird kurz ausgesetzt; beim
      // Verlassen des Felds (blur) wird exakt der ursprüngliche Stil
      // wiederhergestellt.
      el2.addEventListener('focus', function () {
        selectText(t.id);
        // Nur Verzerrung/Drehung aussetzen - die Zentrierung (translate)
        // muss bleiben, sonst springt der Text um die halbe Größe.
        if (t.wordartStyle && t.wordartStyle !== 'none') { el2.style.transform = useFillCentering ? 'none' : 'translate(-50%, -50%)'; }
      });
      el2.addEventListener('blur', function () {
        if (activeId === t.id) {
          activeId = null;
          el2.classList.remove('active');
        }
        if (t.wordartStyle && t.wordartStyle !== 'none') { el2.style.cssText = elStyle; }
      });
      if (useFillCentering) {
        // Primäres Textobjekt (nur normale Textfelder): füllt den ganzen
        // Rahmen, bricht automatisch um und passt seine Schriftgröße live
        // an (2D-Fit: Breite + Höhe), statt eines kleinen, frei
        // positionierten einzeiligen Labels.
        el2.addEventListener('input', function () {
          t.html = el2.innerHTML; t.text = el2.textContent;
          autoFitPrimaryText(el2, t, edBox.h);
        });
      } else {
        el2.addEventListener('input', function () { t.html = objHtmlWithoutHandles(el2); t.text = objTextWithoutHandles(el2); });
        // Alle frei positionierten Texte (auch der erste bei WordArt und in
        // Folien) lassen sich verschieben: über den Griff oben links oder -
        // solange nicht gerade getippt wird - direkt am Text.
        if (!isPrimary || state.wordArtMode) {
          var sizeHandle = el('div', { class: 'ic-textframe-size-handle ic-tf-handle', title: S.fontsize, contenteditable: 'false' });
          var moveHandle = el('div', { class: 'ic-textframe-move-handle ic-tf-handle', title: S.tf_move_text, contenteditable: 'false' }, ['\u2725']);
          el2.appendChild(sizeHandle);
          el2.appendChild(moveHandle);
          var widthHandle = null;
          if (tf.isSlide) {
            widthHandle = el('div', { class: 'ic-textframe-width-handle ic-tf-handle', title: S.tf_text_width, contenteditable: 'false' });
            el2.appendChild(widthHandle);
          }
          makeTextObjectMovable(el2, frame, t, sizeHandle, moveHandle, widthHandle);
          sizeHandle.addEventListener('mousedown', function () { selectText(t.id); });
        }
      }
      if (!isPrimary && t.arcStyle && t.arcStyle !== 'none' && t.id !== activeId) {
        // Bogen-Ansicht: SVG mit pfadfolgendem Text statt des editierbaren
        // Feldes, solange NICHT gerade bearbeitet wird (Bearbeitung selbst
        // bleibt einfacher Text - siehe Klick unten, der wieder zurück auf
        // den normalen editierbaren Zustand wechselt).
        var arcWrap = el('div', {
          class: 'ic-textframe-obj ic-textframe-arc-obj', 'data-previewid': String(t.id),
          style: 'left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;width:' + Math.max(120, t.size * 6) + 'px;'
        });
        arcWrap.innerHTML = buildArcTextSvg(t, t.text, fontCss, (t.fillColor || preset.text)) || '';
        arcWrap.addEventListener('click', function (ev) {
          ev.stopPropagation(); selectText(t.id); render();
          var freshEl = body.querySelector('[data-textid="' + t.id + '"]');
          if (freshEl) { freshEl.focus(); }
        });
        return arcWrap;
      }
      var wordartSvgPreview = (t.id !== activeId && t.text) ? buildWordartGradientSvg(t, t.text, fontCss, isPrimary) : null;
      if (wordartSvgPreview) {
        // Verlauf-Vorschau: dieselbe echte SVG-Darstellung wie auf der
        // Pinnwand/im Export, solange NICHT gerade bearbeitet wird - beim
        // Fokussieren erscheint wieder die normale editierbare Ansicht.
        var waWrap = el('div', {
          class: 'ic-textframe-obj' + (useFillCentering ? ' primary' : ''), 'data-previewid': String(t.id),
          style: useFillCentering ? 'display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:text;' :
            ('left:' + (t.x * 100) + '%;top:' + (t.y * 100) + '%;width:' + (wordartSvgPreview.w) + 'px;cursor:text;')
        });
        waWrap.innerHTML = wordartSvgPreview.svg;
        waWrap.addEventListener('click', function (ev) {
          ev.stopPropagation(); selectText(t.id); render();
          var freshEl = body.querySelector('[data-textid="' + t.id + '"]');
          if (freshEl) { freshEl.focus(); }
        });
        return waWrap;
      }
      return el2;
    }
    tf.texts.forEach(function (t, idx) { frame.appendChild(textEl(t, idx)); });

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
    // Menüband: jeder Block ist ein schmaler Reiter, sein Inhalt öffnet sich
    // als Popup darüber (state.tfOpenBlock übersteht das Neu-Rendern). Der
    // Einklapp-Schalter sitzt direkt über dem Band.
    var blocksWrap = el('div', { class: 'ic-textframe-blocks ic-tf-ribbon' });
    var tfDock = el('div', { class: 'ic-tf-dock' + (state.tfPanelsCollapsed ? ' ic-tf-collapsed' : '') });
    var dockToggle = el('button', {
      class: 'ic-tf-dock-toggle', type: 'button',
      title: state.tfPanelsCollapsed ? S.tf_panels_expand : S.tf_panels_collapse
    }, [icon(state.tfPanelsCollapsed ? 'chevronup' : 'chevrondown')]);
    dockToggle.addEventListener('click', function () { state.tfPanelsCollapsed = !state.tfPanelsCollapsed; render(); });
    tfDock.appendChild(dockToggle);
    tfDock.appendChild(blocksWrap);
    var BLOCK_ICONS = {};
    BLOCK_ICONS[S.tfblock_colors] = 'fillicon';
    BLOCK_ICONS[S.tfblock_shapes] = 'starfg';
    BLOCK_ICONS[S.tfblock_fonts] = 'fonts';
    BLOCK_ICONS[S.tfblock_form] = 'effecticon';
    BLOCK_ICONS[S.tfblock_formulas] = 'code';
    BLOCK_ICONS[S.tfblock_slide] = 'frameicon';
    // Akkordeon: Überschrift antippen klappt den jeweiligen Block ein/aus -
    // auf dem Handy starten alle Blöcke eingeklappt (siehe CSS), auf
    // größeren Bildschirmen bleiben sie offen.
    // Mehrere Popups dürfen gleichzeitig offen sein; jedes lässt sich an
    // seiner Kopfzeile frei über die Arbeitsfläche ziehen (Lage in
    // state.tfPopupPos, übersteht das Neu-Rendern). Auf dem Handy fest.
    state.tfOpenBlocks = state.tfOpenBlocks || {};
    state.tfPopupPos = state.tfPopupPos || {};
    function applyPopupPos(contentEl, key) {
      var pos = state.tfPopupPos[key];
      if (!pos || window.matchMedia('(max-width: 640px)').matches) { return; }
      var x = Math.max(0, Math.min(window.innerWidth - 80, pos.x)), y = Math.max(48, Math.min(window.innerHeight - 40, pos.y));
      contentEl.style.position = 'fixed';
      contentEl.style.left = x + 'px'; contentEl.style.top = y + 'px';
      contentEl.style.bottom = 'auto'; contentEl.style.transform = 'none';
    }
    function makeAccordionBlock(titleText) {
      var blockEl = el('div', { class: 'ic-textframe-block' + (state.tfOpenBlocks[titleText] ? ' ic-tf-open' : '') });
      var titleEl = el('button', { class: 'ic-textframe-block-title ic-tf-tab', type: 'button' },
        [icon(BLOCK_ICONS[titleText] || 'grid'), el('span', {}, [titleText])]);
      var contentEl = el('div', { class: 'ic-textframe-block-content ic-tf-popup' });
      var popHead = el('div', { class: 'ic-tf-popup-head' }, [el('span', { class: 'ic-float-grip' }, ['\u2630']), el('span', {}, [titleText])]);
      var popClose = el('button', { class: 'ic-float-min', type: 'button', title: S.cancel }, ['\u2715']);
      popHead.appendChild(popClose);
      contentEl.appendChild(popHead);
      applyPopupPos(contentEl, titleText);
      function setOpen(open) {
        blockEl.classList.toggle('ic-tf-open', open);
        if (open) { state.tfOpenBlocks[titleText] = true; } else { delete state.tfOpenBlocks[titleText]; }
      }
      popClose.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      popClose.addEventListener('click', function () { setOpen(false); });
      var pdrag = null;
      popHead.addEventListener('pointerdown', function (ev) {
        if (ev.target === popClose || window.matchMedia('(max-width: 640px)').matches) { return; }
        var r = contentEl.getBoundingClientRect();
        pdrag = { sx: ev.clientX, sy: ev.clientY, x: r.left, y: r.top };
        try { popHead.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        ev.preventDefault();
      });
      popHead.addEventListener('pointermove', function (ev) {
        if (!pdrag) { return; }
        state.tfPopupPos[titleText] = { x: pdrag.x + ev.clientX - pdrag.sx, y: pdrag.y + ev.clientY - pdrag.sy };
        applyPopupPos(contentEl, titleText);
      });
      popHead.addEventListener('pointerup', function () { pdrag = null; });
      popHead.addEventListener('pointercancel', function () { pdrag = null; });
      titleEl.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      titleEl.addEventListener('click', function () { setOpen(!blockEl.classList.contains('ic-tf-open')); });
      blockEl.appendChild(titleEl);
      blockEl.appendChild(contentEl);
      blockEl.content = contentEl;
      return blockEl;
    }
    var blockTemplates = makeAccordionBlock(S.tfblock_colors);
    var blockShapes = makeAccordionBlock(S.tfblock_shapes);
    var blockFonts = makeAccordionBlock(S.tfblock_fonts);
    var blockForm = makeAccordionBlock(state.wordArtMode && !tf.isSlide ? S.tfblock_form : S.tfblock_formulas);
    blocksWrap.appendChild(blockShapes);
    blocksWrap.appendChild(blockTemplates);
    blocksWrap.appendChild(blockFonts);
    blocksWrap.appendChild(blockForm);
    layout.appendChild(tfDock);

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
            tf.shapes.push({ id: nextId, type: 'custom', customPoints: points, x: 0.5, y: 0.5, size: 0.4, fillColor: '#e0503f' });
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
      var paramCells = PARAM_SHAPES.map(function (p) { return { id: p.id, label: p.label, d: shapeDefFor({ type: p.id }).d }; });
      var allCats = Object.assign({ grundformen_basic: BASIC_SHAPES, sterne_blasen: paramCells }, FG_SHAPE_CATEGORIES);
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

    // Vorlagen-Auswahl (Papier/Dunkel/Hell/Kein Hintergrund) VOR dem
    // großen Formen/Farben-Bereich - erst grobe Kartenoptik wählen,
    // dann ins Detail gehen. War vorher unterhalb, was die Spalte
    // unnötig hoch wirken ließ, bevor man überhaupt zur Vorlage kam.
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
    var columnsWrap = el('div', { class: 'ic-cf-columns' });
    blockTemplates.content.appendChild(columnsWrap);

    // Linke Spalte: Formen, inline in einem scrollbaren Feld (kein Modal
    // mehr) - Grundformen oben, dann die Kategorien, dann das
    // Polygon-Werkzeug. Jede Wahl erzeugt eine NEUE Form (keine
    // Übertragung auf eine bereits ausgewählte mehr) - die neue Form
    // lässt sich danach frei über die anderen ziehen und skalieren.
    var shapesCol = el('div', { class: 'ic-cf-shapes-col' });
    shapesCol.appendChild(presetRow);
    // Eigenes Popup "Formen" (getrennt von "Farbe").
    blockShapes.content.appendChild(shapesCol);

    // Legt eine Form passend UM ein Textobjekt herum (hinter den Text):
    // Mittelpunkt = Textmitte, Breite/Höhe aus dem tatsächlich sichtbaren
    // Text (inkl. WordArt-Verzerrung), je nach Formtyp mit dem Rand, den
    // der Körper der Form braucht (Sprechblase: Spitze, Stern: Innenkreis).
    function fitShapeAroundText(shape, t) {
      var w, h, cx, cy;
      var mb = measureTextObjectBounds(tf, Math.max(0, tf.texts.indexOf(t)));
      if (mb) {
        w = mb.x2 - mb.x1; h = mb.y2 - mb.y1; cx = (mb.x1 + mb.x2) / 2; cy = (mb.y1 + mb.y2) / 2;
      } else {
        w = tf.w * 0.6; h = tf.h * 0.4; cx = t.x * tf.w; cy = t.y * tf.h;
      }
      w = Math.max(w, 30); h = Math.max(h, 24);
      var pinfo = paramShapeInfo(shape.type);
      var base = pinfo ? pinfo.base : shape.type;
      var fx = 1.25, fy = 1.35;
      if (base === 'bubble') { fx = 1.2 / 0.88; fy = 1.25 / 0.6; }
      else if (base === 'star') {
        var inner = shape.inner != null ? shape.inner : pinfo.def.defaults.inner;
        fx = fy = 1.05 / (0.9 * inner);
      } else if (base === 'circle' || base === 'ellipse' || base === 'heart' || base === 'cloud') { fx = 1.5; fy = 1.6; }
      var sw = w * fx, sh = h * fy;
      var minSide = Math.min(tf.w, tf.h);
      shape.x = cx / tf.w; shape.y = cy / tf.h;
      shape.size = Math.max(0.05, sh / minSide);
      shape.aspect = Math.max(0.1, Math.min(10, sw / sh));
      shape.rotation = 0;
      shape.wrapMode = 'behind';
    }
    // Zuletzt bearbeitetes Textobjekt (der Fokus ist beim Klick auf einen
    // Knopf im Bedienfeld schon weg).
    function activeTextObj() {
      return tf.texts.filter(function (t) { return t.id === state.tfLastTextId; })[0] || tf.texts[0];
    }
    // Neue Form anlegen. Die erste wird die Hauptform (Zettel: Kartenform,
    // WordArt: an den Text gebunden), jede weitere ist freie Dekoration.
    function newShapeOf(id, asMain) {
      var nextId = (Math.max.apply(null, tf.shapes.map(function (s) { return s.id; }).concat([0])) || 0) + 1;
      var shape = { id: nextId, type: id, x: 0.5, y: 0.5, size: 0.4, fillColor: '#e0503f' };
      var pinfo = paramShapeInfo(id);
      if (pinfo) { Object.keys(pinfo.def.defaults).forEach(function (k) { shape[k] = pinfo.def.defaults[k]; }); }
      if (pinfo && pinfo.base === 'bubble') { shape.fillColor = '#ffffff'; shape.outlineWidth = 2; shape.outlineColor = '#111111'; }
      if (asMain) {
        shape.main = true;
        if (!state.wordArtMode) {
          // Kartenform übernimmt die bisherige Kartenfarbe.
          var cs = tf.cardStyle || {};
          shape.fillColor = cs.fillColor || preset.bg || '#ffffff';
          if (cs.fillGradient) { shape.fillGradient = cs.fillGradient; shape.fillGradientAngle = cs.fillGradientAngle; shape.fillGradientType = cs.fillGradientType; }
          if (!(pinfo && pinfo.base === 'bubble')) { shape.outlineWidth = 0; }
        } else {
          shape.bindText = activeTextObj().id;
        }
      } else if (state.wordArtMode && tf.texts.length) {
        fitShapeAroundText(shape, activeTextObj());
      }
      return shape;
    }
    // Zielform des Hauptknopfs: die ausgewählte Form, sonst die Hauptform.
    var targetShape = tf.shapes.filter(function (s) { return s.id === state.activeShapeId; })[0] || mainShapeOf(tf);
    function pickShapeType(id, addExtra) {
      if (id === '__custom__') { startCustomShapeDraw(addExtra ? null : targetShape); return; }
      state.lastShapeType = id;
      state.styleTargetMode = 'shape';
      if (id === 'none') {
        if (targetShape) { tf.shapes = tf.shapes.filter(function (s2) { return s2 !== targetShape; }); }
        state.activeShapeId = null;
        render();
        return;
      }
      if (targetShape && !addExtra) {
        // Form ÄNDERN: Typ wechseln, Farben/Kontur/Lage bleiben erhalten.
        var pinfo = paramShapeInfo(id);
        targetShape.type = id;
        delete targetShape.customPoints;
        if (pinfo) { Object.keys(pinfo.def.defaults).forEach(function (k) { if (targetShape[k] == null) { targetShape[k] = pinfo.def.defaults[k]; } }); }
        state.activeShapeId = targetShape.id;
        render();
        return;
      }
      var shape = newShapeOf(id, !mainShapeOf(tf));
      tf.shapes.push(shape);
      state.activeShapeId = shape.id;
      render();
    }

    // Hauptknopf wie der WordArt-Vorlagen-Wähler: zeigt die aktuelle Form;
    // ohne Form "Form wählen", sonst "Form ändern" (meist braucht man nur
    // eine). Der kleine "+"-Knopf daneben fügt eine weitere Form hinzu.
    var pickerRow = el('div', { class: 'ic-compact-row ic-shape-picker-row' });
    var shapePickerBtn = el('button', { class: 'ic-shape-picker-btn', title: targetShape ? S.tf_change_shape : S.tf_pick_shape });
    var shownDef = targetShape ? shapeDefFor(targetShape) : shapeDefFor({ type: state.lastShapeType || 'rounded' });
    if (shownDef) {
      shapePickerBtn.appendChild(el('span', {
        class: 'ic-shape-picker-preview', style: 'background-image:url(' + fgShapeSvgDataUri(shownDef, targetShape ? targetShape : '#cfd2d8') + ')'
      }));
    }
    shapePickerBtn.appendChild(el('span', {}, [targetShape ? S.tf_change_shape : S.tf_pick_shape]));
    shapePickerBtn.addEventListener('click', function () {
      openDraggableModal(targetShape ? S.tf_change_shape : S.tf_pick_shape, shapePickerBtn, function (content) {
        buildShapeGrid(content, targetShape ? targetShape.type : null, function (id) { closeDraggableModal(); pickShapeType(id, false); }, !!targetShape);
      });
    });
    pickerRow.appendChild(shapePickerBtn);
    if (targetShape) {
      var addShapeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', title: S.tf_add_shape }, ['+']);
      addShapeBtn.addEventListener('click', function () {
        openDraggableModal(S.tf_add_shape, addShapeBtn, function (content) {
          buildShapeGrid(content, null, function (id) { closeDraggableModal(); pickShapeType(id, true); }, false);
        });
      });
      pickerRow.appendChild(addShapeBtn);
    }
    shapesCol.appendChild(pickerRow);

    // Einstellungen der gerade ausgewählten Form: Lage zum Text, um den
    // Text legen, Parameter von Stern/Sprechblase, löschen.
    var selShape = targetShape;
    if (selShape) {
      var shapeSettings = el('div', { class: 'ic-shape-settings' });
      var shapeRow1 = el('div', { class: 'ic-compact-row' });
      (selShape.main ? [] : [
        ['behind', 'wrapbehind', S.tf_wrap_behind], ['front', 'wrapfront', S.tf_wrap_front],
        ['wrap', 'wraparound', S.tf_wrap_around]
      ]).forEach(function (w) {
        var wb = el('button', {
          class: 'ic-btn ic-btn-ghost ic-mini-btn' + ((selShape.wrapMode || 'behind') === w[0] ? ' active' : ''), title: w[2]
        }, [icon(w[1])]);
        wb.addEventListener('click', function () { selShape.wrapMode = w[0]; render(); });
        shapeRow1.appendChild(wb);
      });
      var fitBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn ic-mini-btn-text', title: S.tf_shape_fit_text || 'Um den Text legen' },
        ['⬚ ' + (S.tf_shape_fit_text_short || 'Um Text')]);
      fitBtn.addEventListener('click', function () { fitShapeAroundText(selShape, activeTextObj()); render(); });
      if (!selShape.main) { shapeRow1.appendChild(fitBtn); }
      if (selShape.main && state.wordArtMode) {
        // An den Text gebunden: nur der Abstand zum Text ist einstellbar.
        var gapCell = el('div', { class: 'ic-measure', title: S.tf_shape_padding }, [el('span', { class: 'ic-measure-symbol' }, ['\u2B1A'])]);
        gapCell.appendChild(numberStepper(selShape.fitScale || 1, 0.6, 3, 0.05, 2, function (v) { selShape.fitScale = v; render(); }));
        shapeRow1.appendChild(gapCell);
      }
      var delShapeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', title: S.tf_shape_delete || 'Form löschen' }, [icon('trash')]);
      delShapeBtn.addEventListener('click', function () {
        tf.shapes = tf.shapes.filter(function (s2) { return s2 !== selShape; });
        state.activeShapeId = null;
        render();
      });
      shapeRow1.appendChild(delShapeBtn);
      shapeSettings.appendChild(shapeRow1);

      var selInfo = paramShapeInfo(selShape.type);
      if (selInfo) {
        var dfl = selInfo.def.defaults;
        var paramRow = el('div', { class: 'ic-compact-row ic-measure-row' });
        function paramStepper(symbol, label, key, min, max, step, decimals) {
          var cell = el('label', { class: 'ic-measure', title: label }, [el('span', { class: 'ic-measure-symbol' }, [symbol])]);
          cell.appendChild(numberStepper(selShape[key] != null ? selShape[key] : dfl[key], min, max, step, decimals, function (v) {
            selShape[key] = v; render();
          }));
          paramRow.appendChild(cell);
        }
        if (selInfo.base === 'star') {
          paramStepper('✶', S.tf_star_points || 'Zacken', 'points', 3, 24, 1, 0);
          paramStepper('◎', S.tf_star_inner || 'Innenradius', 'inner', 0.1, 0.95, 0.05, 2);
        } else {
          var styleSel = el('select', { class: 'ic-mini-select', title: S.tf_bubble_style || 'Blasenform' });
          [['round', S.tf_bubble_round || 'Rund'], ['rect', S.tf_bubble_rect || 'Eckig'], ['thought', S.tf_bubble_thought || 'Gedanke']].forEach(function (o) {
            var opt = el('option', { value: o[0] }, [o[1]]);
            if ((selShape.bubble || dfl.bubble) === o[0]) { opt.selected = true; }
            styleSel.appendChild(opt);
          });
          styleSel.addEventListener('change', function () { selShape.bubble = styleSel.value; render(); });
          paramRow.appendChild(styleSel);
          paramStepper('↗', S.tf_bubble_tail_angle || 'Richtung der Spitze (Grad)', 'tailAngle', 0, 345, 15, 0);
          paramStepper('↕', S.tf_bubble_tail_len || 'Länge der Spitze', 'tailLen', 0, 1, 0.05, 2);
        }
        shapeSettings.appendChild(paramRow);
      }
      shapesCol.appendChild(shapeSettings);
    }

    // Formen als echte Objekte auf dem Zettel - anklickbar zum Auswählen,
    // frei verschiebbar und über den Eck-Griff skalierbar (auch über
    // andere Formen hinweg).
    // Reihenfolge wie auf der Pinnwand: spätere Formen liegen VOR früheren,
    // alle "hinter dem Text"-Formen hinter dem Text.
    // Reihenfolge im Editor: Kartenfläche -> Formen (hinter dem Text) -> Text.
    var behindAnchor = frame.querySelector('.ic-textframe-obj') || null;
    tf.shapes.forEach(function (s) {
      var shapeDef = shapeDefFor(s);
      if (!shapeDef) { return; }
      // Lage wie auf der Pinnwand (resolveShapeGeom). Die Hauptform liegt
      // fest: auf dem Zettel = Karte, bei WordArt am Text ausgerichtet (der
      // Griff ändert dort nur den Abstand zum Text).
      var sG = resolveShapeGeom(tf, s);
      var shapeEl = el('div', {
        class: 'ic-textframe-shapeobj' + (state.activeShapeId === s.id ? ' active' : '') + (s.main ? ' ic-shape-main' : ''),
        'data-shapeid': String(s.id),
        style: 'left:' + sG.x + 'px;top:' + sG.y + 'px;width:' + sG.w + 'px;height:' + sG.h + 'px;' +
          'transform:translate(-50%,-50%) rotate(' + (s.main ? 0 : (s.rotation || 0)) + 'deg);' +
          (s === editorCardShape && preset.shadow ? 'filter:drop-shadow(0 6px 10px rgba(0,0,0,.35));' : '') +
          'background-image:url(' + fgShapeSvgDataUri(shapeDef, s) + ')'
      });
      var shapeSizeHandle = el('div', { class: 'ic-resize ic-textframe-shape-resize' });
      var shapeRotateHandle = el('div', { class: 'ic-textframe-shape-rotate' });
      if (!(s.main && !state.wordArtMode)) { shapeEl.appendChild(shapeSizeHandle); }
      if (!s.main) { shapeEl.appendChild(shapeRotateHandle); }
      makeShapeMovable(shapeEl, frame, s, shapeSizeHandle, shapeRotateHandle, { fixed: !!s.main, scaleOnly: !!s.main && state.wordArtMode });
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
        shapeEl.style.zIndex = '2';
        frame.appendChild(shapeEl);
      } else {
        shapeEl.style.zIndex = '1';
        frame.insertBefore(shapeEl, behindAnchor);
      }
    });

    // Rechte Spalte: Fläche/Kontur/Effekte, Transparenz-Slider, Tabs
    // (Raster/Rad).
    var colorsCol = el('div', { class: 'ic-cf-colors-col' });
    columnsWrap.appendChild(colorsCol);
    var combinedRow = el('div', { class: 'ic-cf-combined-row' });
    state.styleTargetMode = state.styleTargetMode || 'text';
    var targetGroup = el('div', { class: 'ic-btn-group' });
    var textTargetBtn = el('button', { class: 'ic-btn ic-btn-ghost' + (state.styleTargetMode === 'text' ? ' active' : ''), title: S.tf_target_text }, [icon('texttargeticon')]);
    var shapeTargetBtn = el('button', { class: 'ic-btn ic-btn-ghost' + (state.styleTargetMode === 'shape' ? ' active' : ''), title: S.tf_target_shape }, [icon('frameicon')]);
    textTargetBtn.addEventListener('click', function () { state.styleTargetMode = 'text'; render(); });
    shapeTargetBtn.addEventListener('click', function () {
      state.styleTargetMode = 'shape';
      // Noch keine Form ausgewählt: automatisch die Hauptform (bzw. die
      // einzige Form, sonst die Karte) - damit die Form im Farbenwähler
      // direkt wählbar ist, auch wenn sie hinter dem Text liegt.
      var hasSel = state.activeShapeId === '__card__' || tf.shapes.some(function (s2) { return s2.id === state.activeShapeId; });
      if (!hasSel) {
        var ms = mainShapeOf(tf) || tf.shapes[0];
        state.activeShapeId = ms ? ms.id : '__card__';
      }
      render();
    });
    targetGroup.appendChild(textTargetBtn); targetGroup.appendChild(shapeTargetBtn);
    combinedRow.appendChild(targetGroup);

    if (state.styleTab === undefined) { state.styleTab = 'fill'; }
    var styleGroup = el('div', { class: 'ic-btn-group' });
    var fillBtn = el('button', { class: 'ic-btn ic-btn-ghost' + (state.styleTab === 'fill' ? ' active' : ''), title: S.tf_fill }, [icon('fillicon')]);
    var outlineBtn = el('button', { class: 'ic-btn ic-btn-ghost' + (state.styleTab === 'outline' ? ' active' : ''), title: S.tf_outline }, [icon('outlineicon')]);
    var effectsBtn = el('button', { class: 'ic-btn ic-btn-ghost' + (state.styleTab === 'effects' ? ' active' : ''), title: S.tf_effects }, [icon('effecticon')]);
    fillBtn.addEventListener('click', function () { state.styleTab = state.styleTab === 'fill' ? null : 'fill'; render(); });
    outlineBtn.addEventListener('click', function () { state.styleTab = state.styleTab === 'outline' ? null : 'outline'; render(); });
    effectsBtn.addEventListener('click', function () { state.styleTab = state.styleTab === 'effects' ? null : 'effects'; render(); });
    styleGroup.appendChild(fillBtn); styleGroup.appendChild(outlineBtn); styleGroup.appendChild(effectsBtn);
    combinedRow.appendChild(styleGroup);
    colorsCol.appendChild(combinedRow);
    var opacitySliderRow = el('div', { class: 'ic-textframe-edit' });
    colorsCol.appendChild(opacitySliderRow);
    // Immer sichtbare Verlauf-Zeile (nur im Fläche-Tab) - liegt bewusst
    // ÜBER den Palette-Tabs. Ungecheckt: Balken zeigt die aktuelle
    // Vollfarbe. Gecheckt: derselbe Balken wird zum Verlaufsband mit
    // Markern.
    var gradientBarRow = el('div', { class: 'ic-gradient-toggle-row' + (state.styleTab !== 'fill' ? ' ic-hidden' : '') });
    colorsCol.appendChild(gradientBarRow);
    if (state.colorTab === undefined) { state.colorTab = 'grid'; }
    var colorTabsRow = el('div', { class: 'ic-cf-tabs' + (state.styleTab !== 'fill' ? ' ic-hidden' : '') });
    var tabRaster = el('button', { class: 'ic-cf-tab' + (state.colorTab === 'grid' ? ' active' : '') }, [S.tf_tab_grid]);
    var tabWheel = el('button', { class: 'ic-cf-tab' + (state.colorTab === 'wheel' ? ' active' : '') }, [S.tf_tab_wheel]);
    tabRaster.addEventListener('click', function () { state.colorTab = state.colorTab === 'grid' ? null : 'grid'; render(); });
    tabWheel.addEventListener('click', function () { state.colorTab = state.colorTab === 'wheel' ? null : 'wheel'; render(); });
    colorTabsRow.appendChild(tabRaster); colorTabsRow.appendChild(tabWheel);
    colorsCol.appendChild(colorTabsRow);
    var bigPaletteContainer = el('div', { class: 'ic-bigpalette-container' });
    colorsCol.appendChild(bigPaletteContainer);

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
      var active = tf.texts.filter(function (t) { return t.id === activeId; })[0] || tf.texts[0];
      if (!active) { return; }

      // Fill/Kontur/Effekte (Block 1) wirken auf DIESES aktive Textobjekt -
      // Handler werden bei jedem refreshControls() neu gesetzt (überschreibt
      // die vorherige Zuordnung), damit sie immer das gerade gewählte
      // Textobjekt treffen.
      function applyStyle1() {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        var isPrimaryActive = tf.texts[0] && tf.texts[0].id === active.id;
        var fontCssActive = resolveFontCss(active.font);
        // Kompletten Stil neu aufbauen (nicht anhängen) - sonst würde sich
        // bei wiederholten Änderungen immer mehr, teils widersprüchliches
        // CSS ansammeln. Für WordArt MUSS wordartCssFor() genutzt werden,
        // nicht computeStyle1Css() - sonst wird die WordArt-Darstellung
        // durch die falsche (einfache) Verlauf-Logik überschrieben.
        objEl.style.cssText = (isPrimaryActive ? '' : 'left:' + (active.x * 100) + '%;top:' + (active.y * 100) + '%;') +
          'font-family:' + fontCssActive + ';font-size:' + active.size + 'px;font-weight:' + active.fontWeight +
          ';line-height:' + active.lineHeight + ';letter-spacing:' + active.letterSpacing + 'px;' +
          (wordartCssFor(active, preset.text, isPrimaryActive) || computeStyle1Css(active, preset.text));
      }
      // Fläche/Kontur/Effekte wirken auf Text ODER die gerade ausgewählte
      // Form - je nachdem, was im T/Rechteck-Umschalter oben gewählt ist
      // (state.styleTargetMode), nicht mehr implizit erraten.
      tf.cardStyle = tf.cardStyle || {};
      var styleActiveShape = state.activeShapeId === '__card__' ? tf.cardStyle
        : tf.shapes.filter(function (s) { return s.id === state.activeShapeId; })[0];
      var isShapeTarget = state.styleTargetMode === 'shape';
      var styleTarget = isShapeTarget ? styleActiveShape : active;
      var styleTargetMissing = isShapeTarget && !styleTarget;
      function applyShapeOrTextChange() {
        if (isShapeTarget) { render(); } else { applyStyle1(); }
      }
      function openStyle1Popup(anchorBtn, title, buildRows) {
        openDraggableModal(title, anchorBtn, function (content) { buildRows(content); });
      }
      // Zuletzt gewählte Einzelfarbe je Ziel - erscheint sofort im Feld hinter
      // der Verlauf-Checkbox (auch wenn sie nur auf eine Textauswahl wirkte).
      function solidColorShown() {
        var lc = state.lastSolidColor;
        if (lc && lc.target === styleTarget) { return lc.color; }
        return styleTarget.fillColor || preset.text;
      }
      function applyFillColor(color) {
        state.lastSolidColor = { target: styleTarget, color: color };
        noteRecentColor(color);
        if (isShapeTarget) {
          styleTarget.fillColor = color; styleTarget.fillGradient = null;
          render();
          return;
        }
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        applyStyleToSelectionOrWhole(objEl, 'color:' + color + ';', function () {
          active.fillColor = active.color = color;
          active.fillGradient = null;
          applyStyle1();
        }, active);
        refreshControls();
      }
      opacitySliderRow.innerHTML = '';
      bigPaletteContainer.innerHTML = '';
      if (styleTargetMissing) {
        bigPaletteContainer.appendChild(el('p', { class: 'ic-hint' }, [S.tf_no_shape_selected]));
      } else {
      opacitySliderRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_opacity]));
      var opacitySlider = el('input', {
        type: 'range', min: '0', max: '100', step: '5', value: String(Math.round((styleTarget.opacity != null ? styleTarget.opacity : 1) * 100)),
        class: 'ic-textframe-range'
      });
      opacitySlider.addEventListener('input', function () {
        styleTarget.opacity = parseInt(opacitySlider.value, 10) / 100;
        if (isShapeTarget) { render(); return; }
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (objEl) { objEl.style.opacity = styleTarget.opacity; }
      });
      opacitySliderRow.appendChild(opacitySlider);

      if (state.styleTab === 'outline') {
        var outlineSwatch = el('button', { class: 'ic-effect-swatch', style: 'background:' + (styleTarget.outlineColor || '#000000') });
        outlineSwatch.addEventListener('click', function () {
          state.effectsPickerKey = state.effectsPickerKey === 'outlineColor' ? null : 'outlineColor';
          refreshControls();
        });
        var outlineRow = el('div', { class: 'ic-textframe-edit' });
        outlineRow.appendChild(outlineSwatch);
        outlineRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_width]));
        outlineRow.appendChild(numberStepper(styleTarget.outlineWidth || 0, 0, 6, 0.5, 1, function (v) { styleTarget.outlineWidth = v; applyShapeOrTextChange(); }));
        bigPaletteContainer.appendChild(outlineRow);
        if (state.effectsPickerKey === 'outlineColor') {
          function applyOutlineColor(color) { styleTarget.outlineColor = color; noteRecentColor(color); applyShapeOrTextChange(); }
          if (state.colorTab === 'wheel') {
            buildColorWheel(bigPaletteContainer, styleTarget.outlineColor || '#000000', applyOutlineColor);
          } else if (state.colorTab === 'grid') {
            buildBigColorPalette(bigPaletteContainer, styleTarget.outlineColor || '#000000', null, applyOutlineColor, null);
          }
        }
      } else if (state.styleTab === 'effects') {
        function buildEffectColorSwatch(colorKey, defColor) {
          var swatch = el('button', {
            class: 'ic-effect-swatch', style: 'background:' + (styleTarget[colorKey] || defColor),
            title: S.tf_fill
          });
          swatch.addEventListener('click', function () {
            state.effectsPickerKey = state.effectsPickerKey === colorKey ? null : colorKey;
            refreshControls();
          });
          return swatch;
        }
        // Schatten/Glow als Radiobuttons - nur eins von beiden kann
        // gleichzeitig aktiv sein (statt zwei unabhängiger Checkboxen).
        var effectMode = styleTarget.shadowOn ? 'shadow' : (styleTarget.glowOn ? 'glow' : 'none');
        var effectGroup = el('div', { class: 'ic-btn-group' });
        var effectModes = [['none', S.tf_effect_none], ['shadow', S.tf_shadow], ['glow', S.tf_glow]];
        effectModes.forEach(function (m) {
          var btn = el('button', { class: 'ic-btn ic-btn-ghost' + (effectMode === m[0] ? ' active' : '') }, [m[1]]);
          btn.addEventListener('click', function () {
            // Klick auf die bereits aktive Option schaltet sie wieder aus
            // (wie eine Checkbox) - es kann aber weiterhin nur eine
            // gleichzeitig aktiv sein (wie ein Radiobutton).
            var newMode = effectMode === m[0] ? 'none' : m[0];
            styleTarget.shadowOn = newMode === 'shadow';
            styleTarget.glowOn = newMode === 'glow';
            applyShapeOrTextChange();
          });
          effectGroup.appendChild(btn);
        });
        bigPaletteContainer.appendChild(effectGroup);

        if (effectMode === 'shadow') {
          var shadowColorRow = el('div', { class: 'ic-textframe-edit' });
          shadowColorRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_fill]));
          shadowColorRow.appendChild(buildEffectColorSwatch('shadowColor', '#000000'));
          bigPaletteContainer.appendChild(shadowColorRow);
          var shadowSlidersRow = el('div', { class: 'ic-textframe-edit ic-effect-sliders-row' });
          var angleStepper = numberStepper(styleTarget.shadowAngle != null ? styleTarget.shadowAngle : 45, 0, 360, 15, 0, function (v) { styleTarget.shadowAngle = v; applyShapeOrTextChange(); });
          angleStepper.title = S.tf_shadow_angle;
          shadowSlidersRow.appendChild(angleStepper);
          var distStepper = numberStepper(styleTarget.shadowDistance != null ? styleTarget.shadowDistance : 3, 0, 20, 1, 0, function (v) { styleTarget.shadowDistance = v; applyShapeOrTextChange(); });
          distStepper.title = S.tf_shadow_distance;
          shadowSlidersRow.appendChild(distStepper);
          var blurStepper = numberStepper(styleTarget.shadowBlur || 4, 0, 20, 1, 0, function (v) { styleTarget.shadowBlur = v; applyShapeOrTextChange(); });
          blurStepper.title = S.tf_width;
          shadowSlidersRow.appendChild(blurStepper);
          bigPaletteContainer.appendChild(shadowSlidersRow);
        } else if (effectMode === 'glow') {
          var glowColorRow = el('div', { class: 'ic-textframe-edit' });
          glowColorRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_fill]));
          glowColorRow.appendChild(buildEffectColorSwatch('glowColor', '#ffffff'));
          glowColorRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.tf_width]));
          glowColorRow.appendChild(numberStepper(styleTarget.glowWidth || 8, 0, 20, 1, 0, function (v) { styleTarget.glowWidth = v; applyShapeOrTextChange(); }));
          bigPaletteContainer.appendChild(glowColorRow);
        }
        // Wird eine Farbe gerade gewählt (Schatten/Glow), erscheint dieselbe
        // große Palette wie bei Fläche darunter.
        if (state.effectsPickerKey) {
          var pickerKey = state.effectsPickerKey;
          function applyEffectColor(color) {
            styleTarget[pickerKey] = color;
            noteRecentColor(color);
            applyShapeOrTextChange();
          }
          if (state.colorTab === 'wheel') {
            buildColorWheel(bigPaletteContainer, styleTarget[pickerKey], applyEffectColor);
          } else if (state.colorTab === 'grid') {
            buildBigColorPalette(bigPaletteContainer, styleTarget[pickerKey], null, applyEffectColor, null);
          }
        }
      } else if (state.styleTab === 'fill') {
        gradientBarRow.innerHTML = '';
        var gradCheck = el('input', { type: 'checkbox' });
        gradCheck.checked = !!styleTarget.fillGradient;
        gradCheck.addEventListener('change', function () {
          styleTarget.fillGradient = gradCheck.checked ? [solidColorShown() || '#e0503f', '#4f8cff'] : null;
          styleTarget.fillGradientAngle = styleTarget.fillGradientAngle || 135;
          if (isShapeTarget) { render(); } else { applyStyle1(); refreshControls(); }
        });
        gradientBarRow.appendChild(gradCheck);

        if (styleTarget.fillGradient) {
          // Verlauf-Band mit beliebig vielen ziehbaren Markern (Position
          // UND Farbe je Stufe einstellbar) + drehbarem Richtungspfeil.
          // Hinweis zur Bedienung ist ein Tooltip (title), kein
          // permanenter Text mehr.
          var stops = normalizeGradientStops(styleTarget.fillGradient);
          var angle = styleTarget.fillGradientAngle != null ? styleTarget.fillGradientAngle : 135;
          var band = el('div', {
            class: 'ic-gradient-band', title: S.tf_gradient_hint,
            style: 'background:linear-gradient(90deg,' + gradientCssStops(stops) + ')'
          });
          function commitStops(newStops) {
            newStops.sort(function (a, b) { return a.pos - b.pos; });
            styleTarget.fillGradient = newStops;
          }
          var markerBySid = {};
          stops.forEach(function (stop, stopIdx) {
            var marker = el('div', {
              class: 'ic-gradient-stop' + (state.gradientStopSid === stop.sid ? ' active' : ''),
              style: 'left:' + (stop.pos * 100) + '%;background:' + stop.color
            });
            markerBySid[stop.sid] = marker;
            // Pointer-Events mit Pointer-Capture statt window-Listenern: der
            // Marker verliert das Ziehen nie (auch nicht über Popups/Iframes)
            // und es sammeln sich keine Listener bei jedem Neuaufbau an.
            var markerDragging = false, markerMoved = false, markerStartX = 0;
            marker.addEventListener('pointerdown', function (ev) {
              if (ev.button !== undefined && ev.button !== 0) { return; }
              markerDragging = true; markerMoved = false; markerStartX = ev.clientX;
              try { marker.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
              ev.stopPropagation(); ev.preventDefault();
            });
            marker.addEventListener('pointermove', function (ev) {
              if (!markerDragging) { return; }
              if (!markerMoved && Math.abs(ev.clientX - markerStartX) < 3) { return; }
              markerMoved = true;
              var rect = band.getBoundingClientRect();
              stop.pos = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
              marker.style.left = (stop.pos * 100) + '%';
              band.style.background = 'linear-gradient(90deg,' + gradientCssStops(stops) + ')';
              ev.preventDefault();
            });
            function markerEnd(ev) {
              if (!markerDragging) { return; }
              markerDragging = false;
              try { marker.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
              if (markerMoved) {
                state.gradientStopSid = stop.sid;
                commitStops(stops); applyShapeOrTextChange();
                if (!isShapeTarget) { refreshControls(); }
              } else {
                state.gradientStopSid = stop.sid;
                refreshControls();
              }
            }
            marker.addEventListener('pointerup', markerEnd);
            marker.addEventListener('pointercancel', markerEnd);
            marker.addEventListener('dblclick', function (ev) {
              ev.stopPropagation();
              if (stops.length <= 2) { return; } // mindestens 2 Stufen bleiben erhalten
              var without = stops.filter(function (s2) { return s2 !== stop; });
              commitStops(without);
              state.gradientStopSid = null;
              applyShapeOrTextChange();
              if (!isShapeTarget) { refreshControls(); }
            });
            band.appendChild(marker);
          });
          band.addEventListener('dblclick', function (ev) {
            if (ev.target !== band) { return; } // nicht auf einem Marker
            var rect = band.getBoundingClientRect();
            var pos = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            // Farbe an der neuen Stelle aus den Nachbarn mischen - so ist der
            // neue Marker sofort als Teil des Verlaufs sichtbar.
            var before = stops.filter(function (s2) { return s2.pos <= pos; }).pop() || stops[0];
            var after = stops.filter(function (s2) { return s2.pos >= pos; })[0] || stops[stops.length - 1];
            var mixT = after.pos > before.pos ? (pos - before.pos) / (after.pos - before.pos) : 0;
            var newStop = { color: mixHexColors(before.color, after.color, mixT), pos: pos, sid: gradientStopIdCounter++ };
            commitStops(stops.concat([newStop]));
            state.gradientStopSid = newStop.sid;
            applyShapeOrTextChange();
            if (!isShapeTarget) { refreshControls(); }
          });
          gradientBarRow.appendChild(band);
          var angleKnob = el('div', { class: 'ic-gradient-angle', style: '--angle:' + angle + 'deg;' + (styleTarget.fillGradientType === 'radial' ? 'display:none;' : ''), title: S.tf_gradient_angle });
          var angleDragging = false;
          function angleFromEvent(ev) {
            var rect = angleKnob.getBoundingClientRect();
            var cx2 = rect.left + rect.width / 2, cy2 = rect.top + rect.height / 2;
            var p = ev.touches ? ev.touches[0] : ev;
            var deg = Math.atan2(p.clientY - cy2, p.clientX - cx2) * 180 / Math.PI;
            return (deg + 360) % 360;
          }
          function onAngleMove(ev) {
            if (!angleDragging) { return; }
            styleTarget.fillGradientAngle = Math.round(angleFromEvent(ev));
            angleKnob.style.setProperty('--angle', styleTarget.fillGradientAngle + 'deg');
            band.style.background = 'linear-gradient(90deg,' + gradientCssStops(stops) + ')';
            ev.preventDefault();
          }
          angleKnob.addEventListener('pointerdown', function (ev) {
            angleDragging = true;
            try { angleKnob.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
            ev.preventDefault();
          });
          angleKnob.addEventListener('pointermove', onAngleMove);
          function angleEnd() { if (angleDragging) { angleDragging = false; applyShapeOrTextChange(); } }
          angleKnob.addEventListener('pointerup', angleEnd);
          angleKnob.addEventListener('pointercancel', angleEnd);
          gradientBarRow.appendChild(angleKnob);
          // Kleiner Umschalter linear <-> radial (Verlauf von der Mitte aus).
          var radialBtn = el('button', {
            class: 'ic-gradient-radial-btn' + (styleTarget.fillGradientType === 'radial' ? ' active' : ''),
            title: S.tf_gradient_radial, type: 'button'
          });
          radialBtn.addEventListener('click', function () {
            styleTarget.fillGradientType = styleTarget.fillGradientType === 'radial' ? null : 'radial';
            if (isShapeTarget) { render(); } else { applyStyle1(); refreshControls(); }
          });
          gradientBarRow.appendChild(radialBtn);

          var stopSel = stops.filter(function (s2) { return s2.sid === state.gradientStopSid; })[0] || stops[0];
          if (stopSel) {
            // Palette/Farbrad färben den aktiven Marker. Dieselben Stufen-
            // Objekte bleiben erhalten (sid), Marker und Band werden sofort
            // nachgeführt - vorher blieb der Marker in der alten Farbe.
            function applyGradStopColor(color) {
              stopSel.color = color;
              commitStops(stops);
              noteRecentColor(color);
              if (markerBySid[stopSel.sid]) { markerBySid[stopSel.sid].style.background = color; }
              band.style.background = 'linear-gradient(90deg,' + gradientCssStops(stops) + ')';
              applyShapeOrTextChange();
            }
            if (state.colorTab === 'wheel') {
              buildColorWheel(bigPaletteContainer, stopSel.color, applyGradStopColor);
            } else if (state.colorTab === 'grid') {
              buildBigColorPalette(bigPaletteContainer, stopSel.color, null, applyGradStopColor, null);
            }
          } else {
            bigPaletteContainer.appendChild(el('p', { class: 'ic-hint' }, [S.tf_gradient_pick_stop_hint]));
          }
        } else {
          // Ungecheckt: Balken zeigt die aktuelle Vollfarbe, Klick öffnet
          // dieselbe Palette darunter wie gewohnt.
          var soloBar = el('div', { class: 'ic-gradient-band ic-gradient-band-solid', style: 'background:' + solidColorShown() });
          gradientBarRow.appendChild(soloBar);
          if (state.colorTab === 'wheel') {
            buildColorWheel(bigPaletteContainer, solidColorShown(), applyFillColor);
          } else if (state.colorTab === 'grid') {
            buildBigColorPalette(bigPaletteContainer, solidColorShown(), null, applyFillColor, null);
          }
        }
      }
      }

      // Zeile 1: Schrift + Zeichenformat (Fett/Kursiv/Unterstrichen/
      // Durchgestrichen) + Ausrichtung und Hoch-/Tiefstellung als kompakte
      // Aufklapp-Menüs. Alle Knöpfe verhindern per mousedown den
      // Fokuswechsel, damit die Zeichen-Auswahl im Text erhalten bleibt.
      var fmtRow = el('div', { class: 'ic-compact-row ic-fmt-row' });
      fontsBox.appendChild(fmtRow);
      function syncActiveHtml() {
        // t.html/t.text explizit synchronisieren statt sich allein auf das
        // 'input'-Event zu verlassen (feuert nach execCommand nicht immer).
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (objEl) { active.html = objHtmlWithoutHandles(objEl); active.text = objTextWithoutHandles(objEl); }
      }
      // WordArt: kuratierte Schriftbibliothek; Zettel: einfache Auswahl -
      // jeweils ein Knopf, der die aktuelle Schrift in sich selbst zeigt.
      if (state.wordArtMode) {
        var fontsBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn ic-mini-btn-text', title: S.wordart_fonts }, [icon('fonts'), el('span', {}, [S.wordart_fonts])]);
        fontsBtn.addEventListener('click', function () { openWordartFontBrowser(active, frame); });
        fmtRow.appendChild(fontsBtn);
      } else {
        var currentFontDef = function () { return TEXTFRAME_FONTS.filter(function (f) { return f.id === active.font; })[0] || TEXTFRAME_FONTS[0]; };
        var applyFontChoice = function (fontId) {
          var css = (TEXTFRAME_FONTS.filter(function (f) { return f.id === fontId; })[0] || TEXTFRAME_FONTS[0]).css;
          var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
          if (!objEl) { return; }
          applyStyleToSelectionOrWhole(objEl, 'font-family:' + css + ';', function () {
            active.font = fontId;
            objEl.style.fontFamily = css;
          }, active);
        };
        var fontBtn = el('button', {
          class: 'ic-btn ic-btn-ghost ic-mini-btn ic-mini-btn-text ic-typo-font-btn', title: S.tf_choose_font,
          style: 'font-family:' + currentFontDef().css + ';'
        }, [currentFontDef().label]);
        fontBtn.addEventListener('click', function () {
          openDraggableModal(S.tf_choose_font, fontBtn, function (content) {
            var grid = el('div', { class: 'ic-typo-font-grid' });
            TEXTFRAME_FONTS.forEach(function (f) {
              var tile = el('button', {
                class: 'ic-typo-font-tile' + (f.id === active.font ? ' active' : ''),
                style: 'font-family:' + f.css + ';'
              }, [f.label]);
              tile.addEventListener('click', function () {
                applyFontChoice(f.id);
                fontBtn.textContent = f.label;
                fontBtn.style.fontFamily = f.css;
              });
              grid.appendChild(tile);
            });
            content.appendChild(grid);
          });
        });
        fmtRow.appendChild(fontBtn);
      }
      [
        ['bold', 'boldicon', S.format_bold], ['italic', 'italicicon', S.format_italic],
        ['underline', 'underlineicon', S.format_underline], ['strikeThrough', 'strikeicon', S.format_strike]
      ].forEach(function (cmd) {
        var fb = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn ic-textframe-fmt-btn', title: cmd[2] }, [icon(cmd[1])]);
        fb.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        fb.addEventListener('click', function () { document.execCommand(cmd[0], false, null); syncActiveHtml(); });
        fmtRow.appendChild(fb);
      });
      var alignItems = [
        { value: 'justifyLeft', icon: 'alignleft', label: S.align_left },
        { value: 'justifyCenter', icon: 'aligncenter', label: S.align_center },
        { value: 'justifyRight', icon: 'alignright', label: S.align_right },
        { value: 'justifyFull', icon: 'alignjustify', label: S.align_justify }
      ];
      fmtRow.appendChild(iconDropdown(alignItems, state.tfLastAlign || 'justifyCenter', S.align_center, function (v) {
        document.execCommand(v, false, null);
        state.tfLastAlign = v;
        syncActiveHtml();
      }));
      var posItems = [
        { value: 'normal', text: 'x', label: S.format_normal || 'Normal' },
        { value: 'superscript', icon: 'supicon', label: S.format_superscript },
        { value: 'subscript', icon: 'subicon', label: S.format_subscript }
      ];
      fmtRow.appendChild(iconDropdown(posItems, 'normal', S.format_superscript + ' / ' + S.format_subscript, function (v) {
        var isSup = document.queryCommandState('superscript'), isSub = document.queryCommandState('subscript');
        if (v === 'normal') {
          if (isSup) { document.execCommand('superscript', false, null); }
          if (isSub) { document.execCommand('subscript', false, null); }
        } else if (!document.queryCommandState(v)) {
          document.execCommand(v, false, null);
        }
        syncActiveHtml();
      }));
      // Aufzählung - nur im Zettel-Modus.
      if (!state.wordArtMode) {
        var bulletBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn ic-textframe-fmt-btn', title: S.format_bullets }, [icon('bulleticon')]);
        bulletBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        bulletBtn.addEventListener('click', function () { document.execCommand('insertUnorderedList', false, null); syncActiveHtml(); });
        fmtRow.appendChild(bulletBtn);
      }

      // Zeile 2: alle Maße in EINER Zeile - Größe, Laufweite, Stärke und
      // Zeilenabstand am Ende. Größe/Laufweite/Stärke wirken auf die
      // Zeichen-Auswahl (falls vorhanden), sonst aufs ganze Textobjekt.
      var measureRow = el('div', { class: 'ic-compact-row ic-measure-row' });
      fontsBox.appendChild(measureRow);
      function measureCell(symbol, title, control) {
        var cell = el('div', { class: 'ic-measure', title: title }, [el('span', { class: 'ic-measure-symbol' }, [symbol])]);
        cell.appendChild(control);
        measureRow.appendChild(cell);
      }
      measureCell('A', S.fontsize, numberStepper(active.size, 6, 400, 1, 0, function (v) {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { active.size = v; render(); return; }
        applyStyleToSelectionOrWhole(objEl, 'font-size:' + v + 'px;', function () {
          active.size = v;
          objEl.style.fontSize = v + 'px';
        }, active);
      }));
      measureCell('↔', S.letterspacing, numberStepper(active.letterSpacing || 0, -2, 20, 0.5, 1, function (v) {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { active.letterSpacing = v; render(); return; }
        applyStyleToSelectionOrWhole(objEl, 'letter-spacing:' + v + 'px;', function () {
          active.letterSpacing = v;
          objEl.style.letterSpacing = v + 'px';
        }, active);
      }));
      measureCell('⚖', S.fontweight, numberStepper(active.fontWeight || 700, 300, 900, 100, 0, function (v) {
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { active.fontWeight = v; render(); return; }
        applyStyleToSelectionOrWhole(objEl, 'font-weight:' + v + ';', function () {
          active.fontWeight = v;
          objEl.style.fontWeight = v;
        }, active);
      }));
      measureCell('↨', S.lineheight, numberStepper(active.lineHeight || 1.2, 0.9, 2.2, 0.1, 1, function (v) {
        active.lineHeight = v;
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (objEl) { objEl.style.lineHeight = v; } else { render(); }
      }));


      // Wendet Farbe UND (falls gesetzt) den WordArt-Stil gemeinsam neu auf
      // das Live-Element an - ein WordArt-Stil kann "color" durch eine
      // Verlaufsfüllung (background-clip:text) ersetzen, ein reines
      // objEl.style.color reicht dafür nicht aus.
      function reapplyTextStyle() {
        // Bei Verlauf-WordArt (SVG-basiert) reicht ein einfaches
        // objEl.style.cssText-Update NICHT aus - die Darstellung ist
        // dort natives SVG, keine reine CSS-Eigenschaft. Nur ein
        // komplettes Neu-Rendern erzeugt das SVG mit den aktuellen
        // Werten (z.B. neuer Schriftart) neu.
        var activeStyleDef = WORDART_STYLES.filter(function (w) { return w.id === active.wordartStyle; })[0];
        if (activeStyleDef && activeStyleDef.fillGradient) {
          render();
          return;
        }
        var objEl = frame.querySelector('[data-textid="' + active.id + '"]');
        if (!objEl) { return; }
        var isActivePrimary = tf.texts[0] && tf.texts[0].id === active.id;
        objEl.style.cssText += ';' + (wordartCssFor(active, preset.text, isActivePrimary) || ('color:' + (active.color || preset.text) + ';'));
        if (isActivePrimary && !state.wordArtMode) { autoFitPrimaryText(objEl, active, tf.h); }
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
      if (!state.wordArtMode || tf.isSlide) {
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

      // WordArt-Vorlagen (Fläche/Rand/Extrusion) - nur im WordArt-Modus.
      // Jeder Button zeigt seinen eigenen Namen bereits im jeweiligen Stil -
      // dient dadurch gleichzeitig als Live-Vorschau ohne separate Tabs.
      if (state.wordArtMode && !tf.isSlide) {
        var currentWStyle = WORDART_STYLES.filter(function (w) { return w.id === active.wordartStyle; })[0];
        var pickerRow = el('div', { class: 'ic-textframe-wordart-picker-row' });
        var currentPreviewSvg = currentWStyle ? buildWordartGradientSvg({ wordartStyle: currentWStyle.id, size: 28 }, currentWStyle.label, resolveFontCss('sans'), true) : null;
        var currentBtn = el('button', { class: 'ic-wordart-current-btn' });
        if (currentPreviewSvg) {
          currentBtn.appendChild(el('div', { class: 'ic-wordart-preset-preview', html: currentPreviewSvg.svg }));
        } else {
          currentBtn.appendChild(document.createTextNode(S.wordart_pick_template));
        }
        function openWordartPicker() {
          openDraggableModal(S.wordart_pick_template, currentBtn, function (content) {
            var wordartRow = el('div', { class: 'ic-textframe-wordart-row' });
            WORDART_STYLES.forEach(function (w) {
              var previewSvg = buildWordartGradientSvg({ wordartStyle: w.id, size: 28 }, w.label, resolveFontCss('sans'), true);
              var wb = el('button', {
                class: 'ic-wordart-preset-btn' + ((active.wordartStyle || 'none') === w.id ? ' active' : ''),
                style: previewSvg ? '' : wordartCssFor({ wordartStyle: w.id }, preset.text, true)
              });
              if (previewSvg) {
                wb.appendChild(el('div', { class: 'ic-wordart-preset-preview', html: previewSvg.svg }));
              } else {
                wb.appendChild(document.createTextNode(w.label));
              }
              wb.addEventListener('click', function () {
                active.wordartStyle = w.id;
                // Individuelle Regler zurücksetzen, damit die Vorlage sauber
                // greift (Regler unten passen sie danach bei Bedarf an).
                active.extrudeSteps = active.extrudeColor = active.scaleY = active.skewY = active.rotate = active.rotY = null;
                // Vorlage übernimmt einen vorgeschlagenen Font als
                // sinnvollen Startwert - danach über die Schriftbibliothek
                // jederzeit änderbar.
                if (w.font) {
                  var suggestedFont = w.font.split(',')[0].replace(/['"]/g, '').trim();
                  active.font = suggestedFont;
                }
                reapplyTextStyle();
                refreshControls();
              });
              wordartRow.appendChild(wb);
            });
            content.appendChild(wordartRow);
          });
        }
        currentBtn.addEventListener('click', openWordartPicker);
        pickerRow.appendChild(currentBtn);
        formBox.appendChild(pickerRow);

        if (active.wordartStyle && active.wordartStyle !== 'none') {
          var activeWStyle = WORDART_STYLES.filter(function (w) { return w.id === active.wordartStyle; })[0] || {};
          formBox.appendChild(el('div', { class: 'ic-textframe-label' }, [S.wordart_3d_title]));
          // Jeder Regler mit einem kleinen Bild, das zeigt, WAS gedreht/
          // verändert wird, plus Kurzbeschriftung - vorher standen dort nur
          // unbeschriftete Zahlen.
          var W3D_ICONS = {
            rotY: '<svg viewBox="0 0 24 24"><path d="M7 5 L17 7 L17 17 L7 19 Z" fill="currentColor" opacity=".35"/><path d="M12 2 V22" stroke="currentColor" stroke-dasharray="2 2"/><path d="M4 12 C4 8 20 8 20 12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M18 9.5 L20.5 12 L17.5 13" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
            extrudeSteps: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" fill="currentColor" opacity=".3"/><rect x="6.5" y="6.5" width="11" height="11" fill="currentColor" opacity=".5"/><rect x="5" y="5" width="11" height="11" fill="currentColor"/></svg>',
            rotate: '<svg viewBox="0 0 24 24"><rect x="7" y="9" width="10" height="6" transform="rotate(-20 12 12)" fill="currentColor" opacity=".45"/><path d="M5 12 A7 7 0 1 1 8 17.7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 15.5 L8 17.7 L9.5 14.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
            skewY: '<svg viewBox="0 0 24 24"><path d="M5 9 L19 5 L19 15 L5 19 Z" fill="currentColor" opacity=".55"/><path d="M5 12 H19" stroke="currentColor" stroke-dasharray="2 2"/></svg>',
            scaleY: '<svg viewBox="0 0 24 24"><rect x="8" y="6" width="8" height="12" fill="currentColor" opacity=".45"/><path d="M12 1.5 V22.5 M9.5 4 L12 1.5 L14.5 4 M9.5 20 L12 22.5 L14.5 20" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
            wordartGlow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="1.6"/></svg>'
          };
          var w3dGrid = el('div', { class: 'ic-w3d-grid' });
          formBox.appendChild(w3dGrid);
          function wSlider(label, shortLabel, key, min, max, step, def) {
            var cell = el('div', { class: 'ic-w3d-cell', title: label });
            var head = el('div', { class: 'ic-w3d-head' });
            head.appendChild(el('span', { class: 'ic-w3d-icon', html: W3D_ICONS[key] || '' }));
            head.appendChild(el('span', { class: 'ic-w3d-caption' }, [shortLabel]));
            cell.appendChild(head);
            var stepper = numberStepper(active[key] != null ? active[key] : (activeWStyle[key] != null ? activeWStyle[key] : def), min, max, step, step < 1 ? 2 : 0, function (v) {
              active[key] = v; reapplyTextStyle();
            });
            cell.appendChild(stepper);
            w3dGrid.appendChild(cell);
            return cell;
          }
          wSlider(S.wordart_roty, S.wordart_roty_short || 'Y-Drehung', 'rotY', -90, 90, 5, 0);
          var depthCell = wSlider(S.wordart_extrude, S.wordart_extrude_short || 'Tiefe', 'extrudeSteps', 0, 20, 1, 0);
          wSlider(S.wordart_rotate, S.wordart_rotate_short || 'Drehung', 'rotate', -45, 45, 1, 0);
          wSlider(S.wordart_skew, S.wordart_skew_short || 'Neigung', 'skewY', -30, 30, 1, 0);
          wSlider(S.wordart_scaley, S.wordart_scaley_short || 'Höhe', 'scaleY', 0.5, 2, 0.05, 1);
          wSlider(S.wordart_glow, S.wordart_glow_short || 'Leuchten', 'wordartGlow', 0, 30, 1, 0);
          // Farbe der Extrusion direkt beim Tiefe-Regler.
          var extrudeColorSwatch = el('button', {
            class: 'ic-effect-swatch ic-w3d-swatch', title: S.wordart_extrude_color,
            style: 'background:' + (active.extrudeColor || activeWStyle.extrudeColor || '#000')
          });
          extrudeColorSwatch.addEventListener('click', function () {
            state.effectsPickerKey = state.effectsPickerKey === 'extrudeColor' ? null : 'extrudeColor';
            refreshControls();
          });
          depthCell.querySelector('.ic-w3d-head').appendChild(extrudeColorSwatch);
          if (state.effectsPickerKey === 'extrudeColor') {
            var extrudeColorContainer = el('div', {});
            formBox.appendChild(extrudeColorContainer);
            function applyExtrudeColor(color) { active.extrudeColor = color; noteRecentColor(color); reapplyTextStyle(); }
            if (state.colorTab === 'wheel') { buildColorWheel(extrudeColorContainer, active.extrudeColor || activeWStyle.extrudeColor, applyExtrudeColor); }
            else { buildBigColorPalette(extrudeColorContainer, active.extrudeColor || activeWStyle.extrudeColor, null, applyExtrudeColor, null); }
          }
        }

        // Bögen: Text folgt einem Pfad - unabhängig von der Fläche-Vorlage
        // oben, da ein eigenständiges Konzept.
        formBox.appendChild(el('div', { class: 'ic-textframe-label' }, [S.wordart_arc_title]));
        var arcRow = el('div', { class: 'ic-wordart-arc-row' });
        [
          ['none', S.wordart_arc_none], ['up', S.wordart_arc_up],
          ['down', S.wordart_arc_down], ['wave', S.wordart_arc_wave], ['circle', S.wordart_arc_circle]
        ].forEach(function (arc) {
          var tile = el('button', {
            class: 'ic-wordart-arc-tile' + ((active.arcStyle || 'none') === arc[0] ? ' active' : ''), title: arc[1]
          });
          if (arc[0] !== 'none') {
            var previewD = arcSvgPathD(arc[0], 50, 100, 60);
            tile.innerHTML = '<svg viewBox="0 0 100 60" width="100%" height="100%"><path d="' + previewD +
              '" fill="none" stroke="currentColor" stroke-width="4"/></svg>';
          } else {
            tile.textContent = '\u2014';
          }
          tile.addEventListener('click', function () { active.arcStyle = arc[0] === 'none' ? null : arc[0]; render(); });
          arcRow.appendChild(tile);
        });
        formBox.appendChild(arcRow);
        if (active.arcStyle && active.arcStyle !== 'none') {
          var arcAmountRow = el('div', { class: 'ic-textframe-edit' });
          arcAmountRow.appendChild(el('span', { class: 'ic-textframe-label' }, [S.wordart_arc_amount]));
          arcAmountRow.appendChild(numberStepper(active.arcAmount != null ? active.arcAmount : 50, 5, 100, 5, 0, function (v) {
            active.arcAmount = v; render();
          }));
          formBox.appendChild(arcAmountRow);
        }
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

    // Folie: Plus an freien Stellen im Rahmen -> Menü (Überschrift, Textfeld,
    // Aufzählung, Form) legt das Objekt genau dort an.
    if (isSlide) {
      var plusEl = el('button', { class: 'ic-slide-plus', type: 'button', title: S.slide_add }, ['+']);
      plusEl.style.display = 'none';
      frame.appendChild(plusEl);
      var plusPos = null;
      var isFreeSpot = function (target) {
        return target === frame || target === frameInner || (target.classList && target.classList.contains('ic-tf-neighbors-layer'));
      };
      frame.addEventListener('mousemove', function (ev) {
        if (ev.target === plusEl) { return; }
        if (!isFreeSpot(ev.target) || document.querySelector('.ic-slide-add-menu')) { plusEl.style.display = 'none'; return; }
        var fr = frame.getBoundingClientRect();
        plusPos = { x: (ev.clientX - fr.left) / fr.width, y: (ev.clientY - fr.top) / fr.height };
        plusEl.style.left = (ev.clientX - fr.left) + 'px';
        plusEl.style.top = (ev.clientY - fr.top) + 'px';
        plusEl.style.display = '';
      });
      frame.addEventListener('mouseleave', function () { plusEl.style.display = 'none'; });
      plusEl.addEventListener('mousedown', function (ev) { ev.stopPropagation(); ev.preventDefault(); });
      plusEl.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!plusPos) { return; }
        var at = plusPos;
        var menu = el('div', { class: 'ic-slide-add-menu', style: 'left:' + ev.clientX + 'px;top:' + ev.clientY + 'px;' });
        function addText(size, weight, html, boxW) {
          var nid = Math.max.apply(null, [0].concat(tf.texts.map(function (t) { return t.id; }))) + 1;
          var nt = { id: nid, text: '', font: 'sans', size: size, x: at.x, y: at.y, fontWeight: weight };
          if (html) { nt.html = html; nt.text = ''; }
          if (boxW) { nt.boxW = boxW; }
          tf.texts.push(nt);
          state.tfFocusTextId = nid;
          menu.remove();
          render();
        }
        [
          [S.slide_add_title, function () { addText(40, 700, '', 0); }],
          [S.slide_add_text, function () { addText(24, 400, '', 0.4); }],
          [S.slide_add_list, function () { addText(24, 400, '<ul><li><br></li></ul>', 0.4); }],
          [S.slide_add_shape, function () { menu.remove(); state.tfOpenBlocks = state.tfOpenBlocks || {}; state.tfOpenBlocks[S.tfblock_shapes] = true; render(); }]
        ].forEach(function (o) {
          var b = el('button', { class: 'ic-slide-add-item', type: 'button' }, [o[0]]);
          b.addEventListener('click', o[1]);
          menu.appendChild(b);
        });
        root.appendChild(menu);
        setTimeout(function () {
          document.addEventListener('mousedown', function closeMenu(e2) {
            if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('mousedown', closeMenu); }
          });
        }, 0);
      });
      // Neu angelegtes Textfeld direkt zum Tippen fokussieren.
      if (state.tfFocusTextId) {
        var focusId = state.tfFocusTextId;
        state.tfFocusTextId = null;
        setTimeout(function () {
          var fe = frame.querySelector('[data-textid="' + focusId + '"]');
          if (fe) { fe.focus(); }
        }, 0);
      }
    }

    // Folie: Block "Folie & Animation" - weitere Textfelder anlegen und die
    // Objekte in Animationsschritte sortieren (Reihenfolge, "mit
    // vorherigem"). Die Schrittnummer erscheint als Marke am Objekt.
    if (isSlide) {
      tf.anim = tf.anim || [];
      var blockAnim = makeAccordionBlock(S.tfblock_slide);
      blocksWrap.insertBefore(blockAnim, blocksWrap.firstChild);
      var addTextBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button' }, ['+ ' + S.slide_addtext]);
      addTextBtn.addEventListener('click', function () {
        var nid = Math.max.apply(null, [0].concat(tf.texts.map(function (t) { return t.id; }))) + 1;
        tf.texts.push({ id: nid, text: '', font: 'sans', size: 24, x: 0.5, y: Math.min(0.9, 0.3 + 0.12 * (tf.texts.length % 6)), fontWeight: 400 });
        render();
      });
      // Zwei Spalten (großer Bildschirm): links Folie/Hintergrund/Objekte,
      // rechts die Animationsschritte.
      var slideCols = el('div', { class: 'ic-slide-cols' });
      var slideColL = el('div', { class: 'ic-slide-col' });
      var slideColR = el('div', { class: 'ic-slide-col' });
      slideCols.appendChild(slideColL); slideCols.appendChild(slideColR);
      blockAnim.content.appendChild(slideCols);
      var slideTopRow = el('div', { class: 'ic-anim-toprow' });
      slideTopRow.appendChild(addTextBtn);
      // Mischmodus der ganzen Folie mit dem Hintergrund - im Editor direkt
      // als Vorschau über dem abgebildeten Pinnwand-Ausschnitt.
      var slidePhoto = state.editingPhotoId ? state.photos.filter(function (p) { return p.id === state.editingPhotoId; })[0] : null;
      var curBlend = state.editingFrameItemId ? (tf.blend || '') : slidePhoto ? (slidePhoto.blendmode || '') : (state.slideBlendPending || '');
      var applyEditorBlend = function (mode) {
        frame.querySelectorAll('.ic-textframe-obj, .ic-textframe-shapeobj').forEach(function (o) { o.style.mixBlendMode = mode || ''; });
      };
      slideTopRow.appendChild(el('span', { class: 'ic-anim-blend-label' }, [S.blend_mode]));
      slideTopRow.appendChild(iconDropdown(BLEND_MODES(), curBlend, S.blend_mode, function (mode) {
        applyEditorBlend(mode);
        if (state.editingFrameItemId) {
          // Folien-Rahmen: Mischmodus gehört zum Folieninhalt.
          tf.blend = mode || '';
        } else if (slidePhoto) {
          callAjax('mod_pinnwand_set_blendmode', { cmid: cfg.cmid, photoid: slidePhoto.id, mode: mode }).then(function (res) {
            slidePhoto.blendmode = res.blendmode || '';
          });
        } else {
          state.slideBlendPending = mode;
        }
      }));
      setTimeout(function () { applyEditorBlend(curBlend); }, 0);
      slideColL.appendChild(slideTopRow);

      // Hintergrund der Folie: Farbe, Deckkraft, Weichzeichnung (Milchglas).
      tf.slideBg = tf.slideBg || { color: '#000000', opacity: 0, blur: 0 };
      var bgRow = el('div', { class: 'ic-slide-bg-row' });
      bgRow.appendChild(el('span', { class: 'ic-anim-blend-label' }, [S.slide_bg]));
      var bgColor = el('input', { type: 'color', value: tf.slideBg.color || '#000000', title: S.slide_bg });
      bgColor.addEventListener('input', function () { tf.slideBg.color = bgColor.value; applySlideBg(frameInner, tf); });
      bgRow.appendChild(bgColor);
      function bgSlider(label, key, max) {
        var lab = el('label', { class: 'ic-slide-bg-slider' }, [label]);
        var r = el('input', { type: 'range', min: '0', max: String(max), value: String(tf.slideBg[key] || 0) });
        r.addEventListener('input', function () { tf.slideBg[key] = parseInt(r.value, 10); applySlideBg(frameInner, tf); });
        lab.appendChild(r);
        bgRow.appendChild(lab);
      }
      bgSlider(S.slide_bg_opacity, 'opacity', 100);
      bgSlider(S.slide_bg_blur, 'blur', 30);
      // Standard: Farbe/Weichzeichnen verschwinden beim Weiterblättern.
      var keepLab = el('label', { class: 'ic-slide-bg-slider' });
      var keepCb = el('input', { type: 'checkbox' });
      keepCb.checked = !!tf.bgPersist;
      keepCb.addEventListener('change', function () { tf.bgPersist = keepCb.checked; });
      keepLab.appendChild(keepCb);
      keepLab.appendChild(document.createTextNode(' ' + S.slide_bg_persist));
      bgRow.appendChild(keepLab);
      // Standard: vor dem Erreichen der Folie ist der Hintergrund unsichtbar.
      var beforeLab = el('label', { class: 'ic-slide-bg-slider' });
      var beforeCb = el('input', { type: 'checkbox' });
      beforeCb.checked = !tf.bgShowBefore;
      beforeCb.addEventListener('change', function () { tf.bgShowBefore = !beforeCb.checked; });
      beforeLab.appendChild(beforeCb);
      beforeLab.appendChild(document.createTextNode(' ' + S.slide_bg_hide_before));
      bgRow.appendChild(beforeLab);
      slideColL.appendChild(bgRow);

      // Objekte, die über der Folie liegen, mit ihr verknüpfen: sie bleiben
      // in der Präsentation bei dieser Folie sichtbar statt ausgeblendet.
      if (editingRec && editingRec.canvasw) {
        tf.linked = tf.linked || [];
        // Nur Objekte, die in den Ebenen ÜBER der Folie liegen UND den Rahmen
        // überlappen (Rahmen ggf. gedreht: dessen umschließendes Rechteck).
        var fgx = editingRec.fg ? editingRec.fg.x : editingRec.canvasx, fgy = editingRec.fg ? editingRec.fg.y : editingRec.canvasy;
        var fgw = editingRec.canvasw, fgh = editingRec.canvasw * tf.h / tf.w;
        var frad = (editingRec.rot || 0) * Math.PI / 180, fca = Math.abs(Math.cos(frad)), fsa = Math.abs(Math.sin(frad));
        var fbw = fgw * fca + fgh * fsa, fbh = fgw * fsa + fgh * fca;
        var fbx = fgx + fgw / 2 - fbw / 2, fby = fgy + fgh / 2 - fbh / 2;
        var aboveCands = state.photos.filter(function (p) {
          if (p.hiddenfromboard || !p.boardplaced || (p.boardid || 0) !== (editingRec.boardid || 0) || (p.canvasz || 0) <= (editingRec.canvasz || 0)) { return false; }
          var ph = photoBoardHeight(p);
          return !(p.canvasx + p.canvasw < fbx || p.canvasx > fbx + fbw || p.canvasy + ph < fby || p.canvasy > fby + fbh);
        });
        if (aboveCands.length) {
          slideColL.appendChild(el('div', { class: 'ic-anim-sep' }, [S.slide_linked]));
          var linkList = el('div', { class: 'ic-slide-link-list' });
          aboveCands.forEach(function (p) {
            var lab = el('label', { class: 'ic-slide-link' + (tf.linked.indexOf(p.id) !== -1 ? ' active' : ''), title: itemCaptionText(p) });
            var cb = el('input', { type: 'checkbox' });
            cb.checked = tf.linked.indexOf(p.id) !== -1;
            cb.addEventListener('change', function () {
              tf.linked = tf.linked.filter(function (x) { return x !== p.id; });
              if (cb.checked) { tf.linked.push(p.id); }
              render();
            });
            lab.appendChild(cb);
            lab.appendChild(el('img', { src: p.url, alt: '' }));
            linkList.appendChild(lab);
          });
          slideColL.appendChild(linkList);
        }
      }
      slideColR.appendChild(el('p', { class: 'ic-hint ic-anim-hint' }, [S.slide_anim_hint]));
      var animInfo = slideAnimMap(tf);
      tf.anim = tf.anim.filter(function (a) { return animInfo.map[a.key]; });
      var objLabel = function (key) {
        var id = parseInt(key.slice(1), 10);
        if (key.charAt(0) === 't') {
          var tt = tf.texts.filter(function (t) { return t.id === id; })[0];
          var txt = tt ? String(tt.text || '').replace(/\s+/g, ' ').trim() : '';
          return txt ? (txt.length > 28 ? txt.slice(0, 27) + '\u2026' : txt) : S.slide_obj_text + ' ' + id;
        }
        var sh = (tf.shapes || []).filter(function (x) { return x.id === id; })[0];
        return S.slide_obj_shape + ' ' + (sh ? (sh.type || '') : id);
      };
      var selectKey = function (key) {
        var id = parseInt(key.slice(1), 10);
        if (key.charAt(0) === 't') { state.activeShapeId = null; selectText(id); }
        else { state.activeShapeId = id; state.styleTargetMode = 'shape'; render(); }
      };
      // "Abgang": Objekt verschwindet beim Wechsel zur nächsten Folie.
      tf.exit = tf.exit || {};
      var exitToggle = function (key) {
        var on = !!tf.exit[key];
        var b = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn ic-anim-exit' + (on ? ' active' : ''), type: 'button',
          title: S.slide_exit + ': ' + S.slide_exit_hint, 'aria-label': S.slide_exit }, [icon('exitstep')]);
        b.addEventListener('click', function () {
          if (tf.exit[key]) { delete tf.exit[key]; } else { tf.exit[key] = true; }
          b.classList.toggle('active', !!tf.exit[key]);
        });
        return b;
      };
      var animList = el('div', { class: 'ic-anim-list' });
      tf.anim.forEach(function (a, i) {
        var row = el('div', { class: 'ic-anim-row' });
        row.appendChild(el('span', { class: 'ic-anim-num' + (a.withPrev && i > 0 ? ' ic-anim-num-with' : '') }, [String(animInfo.map[a.key])]));
        var lab = el('button', { class: 'ic-anim-label', type: 'button' }, [objLabel(a.key)]);
        lab.addEventListener('click', function () { selectKey(a.key); });
        row.appendChild(lab);
        var withBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn' + (a.withPrev ? ' active' : ''), type: 'button', title: S.slide_anim_withprev }, [icon('link')]);
        withBtn.disabled = i === 0;
        withBtn.addEventListener('click', function () { a.withPrev = !a.withPrev; render(); });
        var upBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button', title: S.slide_anim_up }, [icon('chevronup')]);
        upBtn.disabled = i === 0;
        upBtn.addEventListener('click', function () { var x = tf.anim[i - 1]; tf.anim[i - 1] = a; tf.anim[i] = x; render(); });
        var downBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button', title: S.slide_anim_down }, [icon('chevrondown')]);
        downBtn.disabled = i === tf.anim.length - 1;
        downBtn.addEventListener('click', function () { var x = tf.anim[i + 1]; tf.anim[i + 1] = a; tf.anim[i] = x; render(); });
        var rmBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button', title: S.slide_anim_remove }, ['\u2715']);
        rmBtn.addEventListener('click', function () { tf.anim.splice(i, 1); render(); });
        row.appendChild(withBtn); row.appendChild(upBtn); row.appendChild(downBtn); row.appendChild(exitToggle(a.key)); row.appendChild(rmBtn);
        animList.appendChild(row);
      });
      var staticKeys = tf.texts.map(function (t) { return 't' + t.id; })
        .concat((tf.shapes || []).filter(function (x) { return !x.main; }).map(function (x) { return 's' + x.id; }))
        .filter(function (k) { return !animInfo.map[k]; });
      if (staticKeys.length) {
        animList.appendChild(el('div', { class: 'ic-anim-sep' }, [S.slide_anim_static]));
        staticKeys.forEach(function (key) {
          var row = el('div', { class: 'ic-anim-row ic-anim-row-static' });
          var lab = el('button', { class: 'ic-anim-label', type: 'button' }, [objLabel(key)]);
          lab.addEventListener('click', function () { selectKey(key); });
          var addBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button', title: S.slide_anim_add }, ['+ ' + S.slide_anim_step]);
          addBtn.addEventListener('click', function () { tf.anim.push({ key: key, withPrev: false }); render(); });
          row.appendChild(lab); row.appendChild(addBtn); row.appendChild(exitToggle(key));
          animList.appendChild(row);
        });
      }
      slideColR.appendChild(animList);
      // Schrittmarken an den Objekten im Rahmen (nach dem Layout messen).
      setTimeout(function () {
        if (!frame.isConnected) { return; }
        var fr = frame.getBoundingClientRect();
        Object.keys(animInfo.map).forEach(function (key) {
          var sel = key.charAt(0) === 't' ? '[data-textid="' + key.slice(1) + '"]' : '[data-shapeid="' + key.slice(1) + '"]';
          var target = frame.querySelector(sel);
          if (!target) { return; }
          var r = target.getBoundingClientRect();
          frame.appendChild(el('span', {
            class: 'ic-anim-badge',
            style: 'left:' + (r.left - fr.left) + 'px;top:' + (r.top - fr.top) + 'px;'
          }, [String(animInfo.map[key])]));
        });
      }, 0);
    }

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

    var tfHeader = el('div', { class: 'ic-tf-header' });
    var tfHeaderLeft = el('div', { class: 'ic-tf-header-group' });
    var undoBtn2 = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon' + ((state.tfUndoStack || []).length ? '' : ' disabled'), title: S.undo }, [icon('undo')]);
    var redoBtn2 = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon' + ((state.tfRedoStack || []).length ? '' : ' disabled'), title: S.redo }, [icon('redo')]);
    undoBtn2.addEventListener('click', tfUndo);
    redoBtn2.addEventListener('click', tfRedo);
    tfHeaderLeft.appendChild(undoBtn2); tfHeaderLeft.appendChild(redoBtn2);
    // Bedienpanels (Vorlagen/Schrift/Form) komplett einklappen - reduziert
    // sie auf eine einzige Titelzeile je Block, damit auf kleineren
    // Fenstern mehr Platz für die eigentliche Arbeitsfläche bleibt. Der
    // Zustand liegt in state (nicht nur als DOM-Klasse), damit er einen
    // Neu-Render (der bei fast jeder Formularänderung passiert) übersteht.
    var panelsToggleBtn = el('button', {
      class: 'ic-btn ic-btn-ghost ic-btn-icon' + (state.tfPanelsCollapsed ? ' active' : ''),
      title: state.tfPanelsCollapsed ? S.tf_panels_expand : S.tf_panels_collapse
    }, [icon(state.tfPanelsCollapsed ? 'chevronup' : 'chevrondown')]);
    panelsToggleBtn.addEventListener('click', function () { state.tfPanelsCollapsed = !state.tfPanelsCollapsed; render(); });
    // (Einklapp-Schalter sitzt jetzt direkt über dem Menüband.)
    tfHeader.appendChild(tfHeaderLeft);
    var tfHeaderRight = el('div', { class: 'ic-tf-header-group' });
    // Proportionen fixieren/lösen: beim Ziehen des Größenänderungs-Griffs
    // bleibt bei aktivierter Fixierung das Seitenverhältnis erhalten.
    var lockBtn = el('button', {
      class: 'ic-btn ic-btn-ghost ic-btn-icon' + (state.tfAspectLocked ? ' active' : ''),
      title: state.tfAspectLocked ? S.tf_aspect_locked : S.tf_aspect_unlocked
    }, [icon(state.tfAspectLocked ? 'lock' : 'unlock')]);
    lockBtn.addEventListener('click', function () { state.tfAspectLocked = !state.tfAspectLocked; render(); });
    tfHeaderRight.appendChild(lockBtn);
    var boardBgBtn = el('button', {
      class: 'ic-btn ic-btn-ghost ic-btn-icon' + (state.tfShowBoardBg !== false ? ' active' : ''),
      title: S.tf_show_board_bg
    }, [icon('eye')]);
    boardBgBtn.addEventListener('click', function () { state.tfShowBoardBg = state.tfShowBoardBg === false ? true : false; render(); });
    tfHeaderRight.appendChild(boardBgBtn);
    // Diagnose: öffnet das tatsächlich erzeugte SVG (inkl. viewBox/Maßen)
    // in einem neuen Tab - Werkzeug, um Darstellungsprobleme (z.B.
    // Beschneiden bei schräger WordArt) konkret nachvollziehen zu können,
    // statt zu mutmaßen. Im neuen Tab lässt sich per Rechtsklick →
    // "Element untersuchen" die genaue viewBox/Breite/Höhe ablesen.
    tfHeaderRight.appendChild(cancelWizardBtn());
    // Direkt senden: speichert UND schickt das Objekt sofort in den
    // Post-Stream der Masterpinnwand (hiddenfromboard=0), statt erst über
    // "Meine Bilder" gesendet werden zu müssen. Nur sichtbar, wenn Senden
    // überhaupt erlaubt ist (konsistent mit dem Senden-Button dort).
    if (state.studentcansend && !state.editingFrameItemId) {
      var sendDirectBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon', title: S.tf_send_direct, 'aria-label': S.tf_send_direct }, [icon('send')]);
      sendDirectBtn.addEventListener('click', function () { saveTextFrame(tf, sendDirectBtn, true); });
      tfHeaderRight.appendChild(sendDirectBtn);
    }
    var saveBtn = el('button', { class: 'ic-btn ic-btn-primary ic-btn-icon', title: S.savephoto, 'aria-label': S.savephoto }, [icon('check')]);
    saveBtn.addEventListener('click', function () { saveTextFrame(tf, saveBtn, false); });
    tfHeaderRight.appendChild(saveBtn);
    tfHeader.appendChild(tfHeaderRight);
    body.appendChild(tfHeader);
  }

  // Leichtgewichtiges Verschieben (+ per Eck-Handle skalieren der
  // Schriftgröße) eines Textobjekts innerhalb des Rahmens - normalisierte
  // 0..1-Koordinaten, damit ein späteres Skalieren des Hauptrahmens die
  // Textobjekte automatisch proportional mitverschiebt. Erst ab einer
  // Mindestbewegung wird tatsächlich verschoben, damit ein normaler Klick
  // weiterhin den Textcursor im contenteditable setzt.
  // Formen frei verschiebbar, über den Eck-Griff skalierbar UND über
  // einen zweiten Griff oberhalb drehbar (auch über andere Formen
  // hinweg) - analog zu Textobjekten, aber mit normalisierter Größe
  // (Anteil an min(Breite,Höhe) des Zettels) statt Schriftgröße.
  // WICHTIG: kein separater "click"-Handler zum Auswählen mehr (der
  // kollidierte mit dem Ziehen, da der Browser nach mousedown+mouseup
  // auf demselben Element zusätzlich ein click-Event feuert und dieses
  // bei jeder Ziehbewegung ein komplettes Neu-Rendern auslöste) - die
  // Auswahl entscheidet sich jetzt selbst anhand der Bewegungsdistanz
  // im selben Handler.
  function makeShapeMovable(el2, frame, s, sizeHandle, rotateHandle, mopts) {
    mopts = mopts || {};
    var dragging = false, startX = 0, startY = 0, totalDelta = 0;
    function point(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
    function down(ev) {
      if (ev.target === sizeHandle || ev.target === rotateHandle) { return; }
      dragging = true; totalDelta = 0;
      var p = point(ev); startX = p.x; startY = p.y;
      ev.stopPropagation();
    }
    function move(ev) {
      if (!dragging) { return; }
      var p = point(ev);
      totalDelta += Math.abs(p.x - startX) + Math.abs(p.y - startY);
      if (totalDelta < 6 || mopts.fixed) { return; }
      var rect = frame.getBoundingClientRect();
      s.x = Math.max(0.02, Math.min(0.98, (p.x - rect.left) / rect.width));
      s.y = Math.max(0.02, Math.min(0.98, (p.y - rect.top) / rect.height));
      el2.style.left = (s.x * 100) + '%'; el2.style.top = (s.y * 100) + '%';
      ev.preventDefault();
    }
    function up(ev) {
      if (!dragging) { return; }
      dragging = false;
      if (totalDelta < 6 || mopts.fixed) {
        // Kaum/keine Bewegung: als Auswahl-Klick werten statt als Zug -
        // Farben/Kontur wirken dann direkt auf diese Form.
        state.activeShapeId = s.id;
        state.styleTargetMode = 'shape';
      }
      render();
    }
    el2.addEventListener('mousedown', down);
    el2.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    // Größen-Griff: Breite und Höhe unabhängig (Form lässt sich z.B. breit
    // um ein Wort legen), mit gedrückter Umschalttaste proportional.
    var sDragging = false, sStartX = 0, sStartY = 0, sStartW = 0, sStartH = 0, sStartScale = 1;
    function sDown(ev) {
      sDragging = true;
      sStartScale = s.fitScale || 1;
      var p0 = point(ev); sStartX = p0.x; sStartY = p0.y;
      sStartW = el2.offsetWidth; sStartH = el2.offsetHeight;
      ev.stopPropagation(); ev.preventDefault();
    }
    function sMove(ev) {
      if (!sDragging) { return; }
      var p1 = point(ev);
      var k = frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth : 1;
      var dx = (p1.x - sStartX) / k * 2, dy = (p1.y - sStartY) / k * 2;
      var w = Math.max(12, sStartW + dx), h = Math.max(12, sStartH + dy);
      if (ev.shiftKey || mopts.scaleOnly) { var f = Math.max(w / sStartW, h / sStartH); w = sStartW * f; h = sStartH * f; }
      if (mopts.scaleOnly) {
        // An den Text gebundene Hauptform: nur der Abstand zum Text ändert sich.
        s.fitScale = Math.max(0.6, Math.min(3, sStartScale * (w / sStartW)));
        el2.style.width = w + 'px'; el2.style.height = h + 'px';
        ev.preventDefault();
        return;
      }
      var minSide = Math.min(frame.offsetWidth, frame.offsetHeight) || 1;
      s.size = Math.max(0.05, Math.min(3, h / minSide));
      s.aspect = Math.max(0.1, Math.min(10, w / h));
      el2.style.width = w + 'px'; el2.style.height = h + 'px';
      ev.preventDefault();
    }
    function sUp() { if (sDragging) { sDragging = false; render(); } }
    sizeHandle.addEventListener('mousedown', sDown);
    sizeHandle.addEventListener('touchstart', sDown, { passive: false });
    window.addEventListener('mousemove', sMove);
    window.addEventListener('touchmove', sMove, { passive: false });
    window.addEventListener('mouseup', sUp);
    window.addEventListener('touchend', sUp);

    // Rotations-Griff: Ziehen dreht die Form um ihren Mittelpunkt.
    var rDragging = false;
    function rMove(ev) {
      if (!rDragging) { return; }
      var rect = el2.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      var p = point(ev);
      var deg = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
      s.rotation = Math.round((deg + 360) % 360);
      el2.style.transform = 'translate(-50%,-50%) rotate(' + s.rotation + 'deg)';
      ev.preventDefault();
    }
    function rDown(ev) { rDragging = true; ev.stopPropagation(); ev.preventDefault(); }
    function rUp() { if (rDragging) { rDragging = false; render(); } }
    rotateHandle.addEventListener('mousedown', rDown);
    rotateHandle.addEventListener('touchstart', rDown, { passive: false });
    window.addEventListener('mousemove', rMove);
    window.addEventListener('touchmove', rMove, { passive: false });
    window.addEventListener('mouseup', rUp);
    window.addEventListener('touchend', rUp);
  }

  // Handles im contenteditable-Feld gehören nicht zum gespeicherten Text.
  function objHtmlWithoutHandles(el2) {
    var c = el2.cloneNode(true);
    [].slice.call(c.querySelectorAll('.ic-tf-handle')).forEach(function (h) { h.remove(); });
    return c.innerHTML;
  }
  function objTextWithoutHandles(el2) {
    var c = el2.cloneNode(true);
    [].slice.call(c.querySelectorAll('.ic-tf-handle')).forEach(function (h) { h.remove(); });
    return c.textContent;
  }

  function makeTextObjectMovable(el2, frame, t, sizeHandle, moveHandle, widthHandle) {
    var dragging = false, startX = 0, startY = 0, totalDelta = 0, startTx = 0, startTy = 0, viaHandle = false;
    function point(ev) { var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX, y: p.clientY }; }
    function down(ev) {
      if (ev.target === sizeHandle || ev.target === widthHandle) { return; }
      viaHandle = !!moveHandle && ev.target === moveHandle;
      // Während getippt wird, markiert Ziehen am Text Buchstaben - dann nur
      // über den Verschiebegriff.
      if (!viaHandle && document.activeElement === el2) { return; }
      dragging = true; totalDelta = 0;
      var p = point(ev); startX = p.x; startY = p.y; startTx = t.x; startTy = t.y;
      if (viaHandle) { ev.preventDefault(); ev.stopPropagation(); }
    }
    function move(ev) {
      if (!dragging) { return; }
      var p = point(ev);
      totalDelta = Math.abs(p.x - startX) + Math.abs(p.y - startY);
      if (!viaHandle && totalDelta < 6) { return; }
      // Relativ zur Startlage (kein Springen der Textmitte zum Zeiger).
      var rect = frame.getBoundingClientRect();
      t.x = Math.max(0, Math.min(1, startTx + (p.x - startX) / rect.width));
      t.y = Math.max(0, Math.min(1, startTy + (p.y - startY) / rect.height));
      el2.style.left = (t.x * 100) + '%'; el2.style.top = (t.y * 100) + '%';
      ev.preventDefault();
    }
    function up() { dragging = false; }
    el2.addEventListener('mousedown', down);
    el2.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    // Breitengriff (Folien): Textfeld-Breite als Anteil der Folienbreite,
    // der Text bricht darin um. Die linke Kante bleibt stehen.
    if (widthHandle) {
      var wDragging = false, wStartX = 0, wStartW = 0, wStartTx = 0;
      widthHandle.addEventListener('mousedown', function (ev) {
        var rect = frame.getBoundingClientRect();
        wDragging = true; wStartX = ev.clientX; wStartTx = t.x;
        wStartW = t.boxW || (el2.getBoundingClientRect().width / rect.width);
        ev.stopPropagation(); ev.preventDefault();
      });
      window.addEventListener('mousemove', function (ev) {
        if (!wDragging) { return; }
        var rect = frame.getBoundingClientRect();
        var nw = Math.max(0.08, Math.min(1.2, wStartW + (ev.clientX - wStartX) / rect.width));
        t.boxW = nw;
        t.x = wStartTx + (nw - wStartW) / 2;
        el2.style.width = (nw * 100) + '%'; el2.style.maxWidth = 'none';
        el2.style.left = (t.x * 100) + '%';
      });
      window.addEventListener('mouseup', function () { wDragging = false; });
    }

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
    code: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="M6 12l6 6 6-6"/><path d="M4 21h16"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
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
    highlighticon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11 3 17l1.5 3L8 19l6-6"/><path d="M12 8l4-4 4 4-4 4z"/><rect x="3" y="18" width="6" height="3" fill="currentColor" stroke="none"/></svg>',
    supicon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 18 9 8M3 8l6 10"/><path d="M15 8h5M19 8c0-1.2-1-2-2-2s-2 .6-2 1.6"/></svg>',
    subicon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8 9 18M3 18l6-10"/><path d="M15 18h5M19 18c0-1.2-1-2-2-2s-2 .6-2 1.6"/></svg>',
    bulleticon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/></svg>',
    alignleft: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>',
    aligncenter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    alignright: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>',
    alignjustify: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    fillicon: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="4" y="4" width="16" height="16" rx="2" fill="#e0503f"/></svg>',
    outlineicon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><rect x="5" y="5" width="14" height="14" rx="2" stroke="#e0503f" stroke-width="3"/></svg>',
    texttargeticon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="4" y1="5" x2="20" y2="5"/><line x1="12" y1="5" x2="12" y2="20"/></svg>',
    wrapfront: '<svg viewBox="0 0 24 24" width="26" height="26"><line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="2" y1="18" x2="22" y2="18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="2" y1="12" x2="8" y2="12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="16" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="7" fill="#e0503f" stroke="#fff" stroke-width="1.2"/></svg>',
    wrapbehind: '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="7" fill="#e0503f" opacity=".4"/><line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="2" y1="18" x2="22" y2="18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    wraparound: '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="7" fill="#e0503f" stroke="#fff" stroke-width="1.2"/><line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="2" y1="9.5" x2="6.5" y2="9.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="17.5" y1="9.5" x2="22" y2="9.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="2" y1="14.5" x2="6.5" y2="14.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="17.5" y1="14.5" x2="22" y2="14.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="2" y1="18" x2="22" y2="18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    effecticon: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="8" y="8" width="13" height="13" rx="2" fill="#e0503f"/><rect x="3" y="3" width="13" height="13" rx="2" fill="#fff"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c-3 0-5.5 2.4-5.5 5.5 0 4 5.5 10.5 5.5 10.5s5.5-6.5 5.5-10.5C17.5 4.4 15 2 12 2z"/><circle cx="12" cy="7.5" r="2"/></svg>',
    group: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6"/><circle cx="18" cy="8.5" r="2.3"/><path d="M15.5 14.2c2.7.4 4.5 2.6 4.5 5.3"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 3 6.7"/><polyline points="3 21 3 15 9 15"/></svg>',
    mirror: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M16 8l4 4-4 4"/><path d="M8 8l-4 4 4 4"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    courseback: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
    imageedit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 17l-4.5-4.5L7 21"/><path d="M18.4 2.6a1.9 1.9 0 0 1 2.7 2.7L15 11.4l-3.6.9.9-3.6z"/></svg>',
    exitstep: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h5v16h-5"/><path d="M3 12h11M10 8l4 4-4 4"/></svg>',
    blend: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6" fill="currentColor" fill-opacity=".35"/></svg>',
    wand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20L15 9"/><path d="M15 4v2M19 8h2M17.5 5.5l1.5-1.5M13 7l4 4"/><path d="M19 13v2M11 3h2"/></svg>',
    rectsel: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>',
    ellipsesel: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>',
    scissors: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="8.5" y1="8" x2="20" y2="19"/><line x1="8.5" y1="16" x2="20" y2="5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    brush: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 3 21"/><path d="M14 3c2 0 4 2 4 4 0 3-3 4-5 6l-4 4-3-3 4-4c2-2 3-5 6-5 0 0 0-2-2-2z"/></svg>',
    arrowleft: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    chevrondown: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    chevronup: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
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
  function applyStyleToSelectionOrWhole(objEl, cssText, wholeObjectFallback, t) {
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
          // t.html/t.text explizit synchronisieren - range.insertNode() ist
          // eine programmatische DOM-Änderung und löst KEIN natives
          // 'input'-Event aus (anders als echte Tastatureingaben), sonst
          // würden diese Daten veraltet bleiben und die Formatierung bei
          // einem späteren Neu-Rendern wieder verlorengehen.
          if (t) { t.html = objHtmlWithoutHandles(objEl); t.text = objTextWithoutHandles(objEl); }
          return true;
        } catch (e) { /* Auswahl reicht über Element-Grenzen - Fallback */ }
      }
    }
    wholeObjectFallback();
    return false;
  }

  // Kompakter Zahlenregler: Wert direkt eintippbar (Enter/Verlassen
  // übernimmt), daneben kleine Pfeile für Schritte.
  function numberStepper(value, min, max, step, decimals, onChange) {
    var wrap = el('div', { class: 'ic-stepper' });
    function fmt(v) { return decimals ? v.toFixed(decimals) : String(Math.round(v)); }
    var display = el('input', { class: 'ic-stepper-value', type: 'text', inputmode: 'decimal', value: fmt(value) });
    function update(v) {
      if (isNaN(v)) { display.value = fmt(value); return; }
      v = Math.max(min, Math.min(max, v));
      v = parseFloat(v.toFixed(decimals || 0));
      value = v;
      display.value = fmt(v);
      onChange(v);
    }
    display.addEventListener('change', function () { update(parseFloat(String(display.value).replace(',', '.'))); });
    display.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); display.blur(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); update(value + step); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); update(value - step); }
    });
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

  // Kleines Aufklapp-Menü mit Symbolen (z.B. Ausrichtung, Hoch-/
  // Tiefstellen): der Knopf zeigt die aktuelle Wahl, das Menü die Optionen
  // mit Symbol + Beschriftung. mousedown verhindert überall den
  // Fokuswechsel, damit eine Zeichen-Auswahl im Text erhalten bleibt.
  // Mischmodus-Auswahl als Knopf mit eigenem Symbol (statt nur "■▾") -
  // auf der Pinnwand, in der Galerie und im Bildeditor.
  function blendModePicker(getPhoto, onChanged, extraClass) {
    var cur = (getPhoto() || {}).blendmode || '';
    var dd = iconDropdown(BLEND_MODES(), cur, S.blend_mode, function (mode) {
      var ph = getPhoto();
      if (!ph) { return; }
      callAjax('mod_pinnwand_set_blendmode', { cmid: cfg.cmid, photoid: ph.id, mode: mode }).then(function (res) {
        ph.blendmode = res.blendmode || '';
        if (onChanged) { onChanged(ph.blendmode); }
      });
    });
    var btn = dd.querySelector('.ic-dropdown-btn');
    if (btn) { btn.insertBefore(icon('blend'), btn.firstChild); }
    dd.classList.add('ic-blend-picker');
    if (extraClass) { dd.classList.add(extraClass); }
    return dd;
  }

  function BLEND_MODES() {
    return [
      { value: '', text: '\u25A0', label: S.blend_normal },
      { value: 'multiply', text: '\u00D7', label: S.blend_multiply },
      { value: 'difference', text: '\u25D1', label: S.blend_difference },
      { value: 'color-burn', text: '\u2600', label: S.blend_burn }
    ];
  }

  function iconDropdown(items, currentValue, title, onPick) {
    var wrap = el('div', { class: 'ic-dropdown' });
    function face(it) { return it.icon ? icon(it.icon) : el('span', { class: 'ic-dropdown-text' }, [it.text || it.label]); }
    var cur = items.filter(function (it) { return it.value === currentValue; })[0] || items[0];
    var btn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn ic-dropdown-btn', type: 'button', title: title }, [face(cur), el('span', { class: 'ic-dropdown-caret' }, ['\u25BE'])]);
    var menu = null;
    function close() {
      if (menu) { menu.remove(); menu = null; }
      document.removeEventListener('mousedown', outside, true);
    }
    function outside(ev) { if (menu && !menu.contains(ev.target) && !btn.contains(ev.target)) { close(); } }
    btn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    btn.addEventListener('click', function () {
      if (menu) { close(); return; }
      var r = btn.getBoundingClientRect();
      menu = el('div', { class: 'ic-dropdown-menu', style: 'left:' + r.left + 'px;top:' + (r.bottom + 4) + 'px;' });
      items.forEach(function (it) {
        var mi = el('button', { class: 'ic-dropdown-item' + (it === cur ? ' active' : ''), type: 'button' }, [face(it), el('span', {}, [it.label])]);
        mi.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
        mi.addEventListener('click', function () {
          cur = it;
          btn.replaceChild(face(it), btn.firstChild);
          close();
          onPick(it.value);
        });
        menu.appendChild(mi);
      });
      document.body.appendChild(menu);
      document.addEventListener('mousedown', outside, true);
    });
    wrap.appendChild(btn);
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
    // Gemeinsame Umsetzung in js/presentation-player.js (auch vom Export
    // genutzt), damit Notizen/Annotationen überall gleich aussehen.
    window.PinnwandPresentation.drawInk(canvas, ctx, strokes);
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

  // Präsentations-Export: MUSS ein einzelnes Board benennen (siehe
  // export_presentation.php) - vorher wurde serverseitig "erraten", was
  // exportiert werden soll, was bei mehreren Boards Fotos verschiedener
  // Boards auf derselben Leinwand vermischte ("Dateien doppelt"/"Dateien,
  // die nicht auf der Pinnwand sind"). Bei genau einem eigenen Board wird
  // direkt exportiert, bei mehreren erscheint ein Wechsel-Dropdown wie
  // beim normalen Board-Wechsel auf der Pinnwand.
  function startPresentationExport() {
    var ownBoards = boardList().map(function (bid) {
      return { boardid: bid, name: state.boardNames && state.boardNames[bid] };
    });
    callAjax('mod_pinnwand_get_all_boards', { cmid: cfg.cmid }).then(function (res) {
      (res.boards || []).forEach(function (b) {
        if (b.isown && !ownBoards.some(function (o) { return o.boardid === b.boardid; })) {
          ownBoards.push({ boardid: b.boardid, name: b.name });
        }
      });
      goExportWithBoards(ownBoards);
    }).catch(function () { goExportWithBoards(ownBoards); });
  }
  // Export-Dialog: Board wählen (falls mehrere) und per Checkbox festlegen,
  // ob die Annotationen auf den Objekten und die Notizen des Stylus-
  // Werkzeugs mit exportiert werden (in der Datei dann ein-/ausblendbar).
  function goExportWithBoards(ownBoards) {
    var overlay = el('div', { class: 'ic-modal-overlay' });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) { overlay.remove(); } });
    var panel = el('div', { class: 'ic-add-modal ic-export-modal' });
    panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.export_presentation]));
    var boards = ownBoards.slice().sort(function (a, b) { return a.boardid - b.boardid; });
    var chosenBoard = boards.some(function (b) { return b.boardid === (state.currentBoard || 0); })
      ? (state.currentBoard || 0) : (boards.length ? boards[0].boardid : (state.currentBoard || 0));
    if (boards.length > 1) {
      panel.appendChild(el('div', { class: 'ic-textframe-label' }, [S.export_presentation_pickboard]));
      var list = el('div', { class: 'ic-export-boards' });
      boards.forEach(function (b) {
        var radio = el('input', { type: 'radio', name: 'ic-export-board', value: String(b.boardid) });
        radio.checked = b.boardid === chosenBoard;
        radio.addEventListener('change', function () { if (radio.checked) { chosenBoard = b.boardid; } });
        list.appendChild(el('label', { class: 'ic-export-option' }, [radio, el('span', {}, [b.name || boardDisplayName(b.boardid)])]));
      });
      panel.appendChild(list);
    }
    if (state.exportAnnot === undefined) { state.exportAnnot = true; }
    if (state.exportInk === undefined) { state.exportInk = true; }
    var annotCb = el('input', { type: 'checkbox' });
    annotCb.checked = !!state.exportAnnot;
    annotCb.addEventListener('change', function () { state.exportAnnot = annotCb.checked; });
    var inkCb = el('input', { type: 'checkbox' });
    inkCb.checked = !!state.exportInk;
    inkCb.addEventListener('change', function () { state.exportInk = inkCb.checked; });
    panel.appendChild(el('label', { class: 'ic-export-option' }, [annotCb, el('span', {}, [S.export_include_annot])]));
    panel.appendChild(el('label', { class: 'ic-export-option' }, [inkCb, el('span', {}, [S.export_include_ink])]));
    var goBtn = el('button', { class: 'ic-btn ic-btn-primary ic-export-go' }, [icon('download'), el('span', {}, [S.export_start])]);
    goBtn.addEventListener('click', function () {
      overlay.remove();
      window.location.href = cfg.exportpresentationurl + '&boardid=' + chosenBoard +
        '&annot=' + (annotCb.checked ? 1 : 0) + '&ink=' + (inkCb.checked ? 1 : 0);
    });
    panel.appendChild(goBtn);
    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-btn-icon ic-modal-close', title: S.cancel }, ['\u2715']);
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    root.appendChild(overlay);
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
        state.boardInkSnapshot = JSON.stringify(state.boardInkStrokes);
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
    // Jede Notiz bekommt eine feste ID (ältere hatten teils keine) - nötig
    // für Auswahl/Verschieben/Löschen einzelner Notizen.
    (state.boardInkStrokes || []).forEach(function (st) {
      if (!st.id) { st.id = 's' + Date.now() + Math.random().toString(36).slice(2, 9); }
    });
    state.inkSelection = (state.inkSelection || []).filter(function (id) {
      return (state.boardInkStrokes || []).some(function (st) { return st.id === id; });
    });
    function saveBoardInk() { commitBoardInk(); }
    // Ausdehnung einer Notiz in normalisierten Board-Koordinaten.
    function strokeBox(st) {
      if (st.type === 'text') {
        var fsN = Math.max(10, (st.size || 20) * (BOARD_H / 900) * 1.6) / BOARD_H;
        return { x1: st.x, y1: st.y, x2: st.x + (st.text || '').length * fsN * 0.6 * BOARD_H / BOARD_W, y2: st.y + fsN * 1.2 };
      }
      var b = null, pad = (st.width || 0) / 2 * BOARD_H / BOARD_W;
      (st.points || []).forEach(function (pt) {
        if (!b) { b = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }; return; }
        b.x1 = Math.min(b.x1, pt.x); b.y1 = Math.min(b.y1, pt.y); b.x2 = Math.max(b.x2, pt.x); b.y2 = Math.max(b.y2, pt.y);
      });
      if (!b) { return null; }
      var padY = (st.width || 0) / 2;
      return { x1: b.x1 - pad, y1: b.y1 - padY, x2: b.x2 + pad, y2: b.y2 + padY };
    }
    function selectedStrokes() {
      return (state.boardInkStrokes || []).filter(function (st) { return (state.inkSelection || []).indexOf(st.id) !== -1; });
    }
    function selectionBox() {
      var b = null;
      selectedStrokes().forEach(function (st) {
        var sb = strokeBox(st);
        if (!sb) { return; }
        if (!b) { b = { x1: sb.x1, y1: sb.y1, x2: sb.x2, y2: sb.y2 }; return; }
        b.x1 = Math.min(b.x1, sb.x1); b.y1 = Math.min(b.y1, sb.y1); b.x2 = Math.max(b.x2, sb.x2); b.y2 = Math.max(b.y2, sb.y2);
      });
      return b;
    }
    function recolorInkSelection(color) {
      var sel = selectedStrokes().filter(function (st) { return !st.erase; });
      if (!sel.length || !state.boardDrawMode) { return false; }
      sel.forEach(function (st) { st.color = color; });
      saveBoardInk();
      render();
      return true;
    }
    function deleteInkSelection() {
      var ids = state.inkSelection || [];
      if (!ids.length) { return; }
      state.boardInkStrokes = state.boardInkStrokes.filter(function (st) { return ids.indexOf(st.id) === -1; });
      state.inkSelection = [];
      saveBoardInk();
      render();
    }
    inkSelectionDelete = deleteInkSelection;

    // Notizen (Stift-Werkzeug) als SVG-Ebene in Board-Koordinaten: scharf bei
    // jedem Zoom und nicht auf die 1400x1000-Leinwand begrenzt - Striche
    // dürfen darüber hinausgehen (normalisierte Koordinaten < 0 bzw. > 1).
    var inkLayerEl = window.PinnwandPresentation.inkLayer(state.boardInkStrokes || [], BOARD_W, BOARD_H, 'boardink', 500);
    inkLayerEl.classList.add('ic-board-ink-layer');
    if (state.boardInkHidden) { inkLayerEl.classList.add('ic-hidden'); }
    canvas.appendChild(inkLayerEl);
    // Markierung der ausgewählten Notizen (gestrichelter Rahmen).
    var inkSelEl = el('div', { class: 'ic-ink-selection' });
    canvas.appendChild(inkSelEl);
    function updateInkSelection() {
      var b = state.boardDrawMode ? selectionBox() : null;
      if (!b) { inkSelEl.style.display = 'none'; return; }
      inkSelEl.style.display = 'block';
      inkSelEl.style.left = (b.x1 * BOARD_W) + 'px'; inkSelEl.style.top = (b.y1 * BOARD_H) + 'px';
      inkSelEl.style.width = ((b.x2 - b.x1) * BOARD_W) + 'px'; inkSelEl.style.height = ((b.y2 - b.y1) * BOARD_H) + 'px';
    }
    updateInkSelection();
    if (state.boardDrawMode) {
      // Erfassungsfläche über dem GANZEN sichtbaren Bereich (nicht nur der
      // Leinwand), damit auch daneben geschrieben werden kann. Mausrad-Zoom
      // funktioniert weiterhin (Ereignis läuft zur Pinnwand durch).
      var drawTool = state.boardDrawTool || (state.boardDrawErase ? 'eraser' : 'pen');
      var inkCapture = el('div', { class: 'ic-board-ink-capture ic-ink-tool-' + drawTool });
      wrap.appendChild(inkCapture);
      var curStroke = null, moveStart = null, moveOrig = null, bandStart = null, bandEl = null;
      function inkPoint(ev) {
        var r = canvas.getBoundingClientRect();
        return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
      }
      function boardZoomNow() { return canvas.getBoundingClientRect().width / BOARD_W || 1; }
      // Strichstärke in Bildschirm-Pixeln, umgerechnet über den aktuellen
      // Zoom - dadurch zeichnet der Stift bei jeder Zoomstufe gleich dick.
      function inkWidthNorm() {
        var px = (state.boardDrawPx || 6) * (drawTool === 'eraser' ? 3 : 1);
        return px / boardZoomNow() / BOARD_H;
      }
      function openInkText(ev, pt) {
        var screenPx = state.boardTextPx || 24;
        var inkColorNow = state.boardDrawColor || INK_COLORS[0];
        // Das Feld liefert nur Cursor und Tastatur; der Text erscheint bei
        // jedem Tastendruck direkt als Notiz in der Notiz-Ebene (live, in
        // derselben Darstellung wie danach).
        var inp = el('input', { type: 'text', class: 'ic-ink-text-input ic-ink-text-live' });
        inp.style.left = ev.clientX + 'px'; inp.style.top = ev.clientY + 'px';
        inp.style.fontSize = screenPx + 'px'; inp.style.caretColor = inkColorNow;
        document.body.appendChild(inp);
        setTimeout(function () { inp.focus(); }, 0);
        var boardFont = screenPx / boardZoomNow();
        var liveStroke = {
          id: 's' + Date.now() + Math.random().toString(36).slice(2, 7), type: 'text', text: '',
          x: pt.x, y: pt.y, color: inkColorNow, size: boardFont / (BOARD_H / 900 * 1.6)
        };
        inp.addEventListener('input', function () {
          liveStroke.text = inp.value;
          inkLayerEl.setStrokes(state.boardInkStrokes.concat(inp.value ? [liveStroke] : []));
        });
        var done = false;
        function commit() {
          if (done) { return; }
          done = true;
          var text = inp.value; inp.remove();
          if (!text) { inkLayerEl.setStrokes(state.boardInkStrokes); return; }
          liveStroke.text = text;
          state.boardInkStrokes.push(liveStroke);
          inkLayerEl.setStrokes(state.boardInkStrokes);
          saveBoardInk();
        }
        inp.addEventListener('keydown', function (e2) {
          e2.stopPropagation();
          if (e2.key === 'Enter') { commit(); } else if (e2.key === 'Escape') { done = true; inp.remove(); inkLayerEl.setStrokes(state.boardInkStrokes); }
        });
        inp.addEventListener('blur', commit);
      }
      inkCapture.addEventListener('pointerdown', function (ev) {
        if (ev.button !== undefined && ev.button !== 0) { return; }
        ev.preventDefault();
        var pt = inkPoint(ev);
        if (drawTool === 'text') { openInkText(ev, pt); return; }
        if (drawTool === 'shape') { shapeDown(ev, pt); return; }
        try { inkCapture.setPointerCapture(ev.pointerId); } catch (e) { /* ältere Browser */ }
        if (drawTool === 'select') {
          // Einzelne Notiz direkt anklicken: genau der Strich unter dem
          // Zeiger. Strg/Cmd/Umschalt: zur Auswahl hinzufügen/entfernen.
          // Klicken und Ziehen verschiebt sofort (auch mehrere Ausgewählte).
          var additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
          var hitId = inkHitAt(pt);
          if (hitId) {
            var curSel = state.inkSelection || [];
            if (additive) {
              state.inkSelection = curSel.indexOf(hitId) === -1 ? curSel.concat([hitId]) : curSel.filter(function (x) { return x !== hitId; });
              render();
              return;
            }
            if (curSel.indexOf(hitId) === -1) { state.inkSelection = [hitId]; updateInkSelection(); }
            moveStart = pt;
            moveOrig = selectedStrokes().map(function (st) { return JSON.parse(JSON.stringify(st)); });
            return;
          }
          var sb = selectionBox();
          if (!additive && sb && pt.x >= sb.x1 && pt.x <= sb.x2 && pt.y >= sb.y1 && pt.y <= sb.y2) {
            // Ausgewählte Notizen verschieben.
            moveStart = pt;
            moveOrig = selectedStrokes().map(function (st) { return JSON.parse(JSON.stringify(st)); });
            return;
          }
          // Auswahlrahmen aufziehen.
          bandStart = { pt: pt, x: ev.clientX, y: ev.clientY };
          bandEl = el('div', { class: 'ic-ink-band' });
          document.body.appendChild(bandEl);
          return;
        }
        curStroke = {
          id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
          points: [pt],
          color: state.boardDrawColor || INK_COLORS[0],
          width: inkWidthNorm(),
          erase: drawTool === 'eraser'
        };
        state.boardInkStrokes.push(curStroke);
        inkLayerEl.setStrokes(state.boardInkStrokes);
      });
      // Formen (Rechteck, Kreis, Linie: ziehen; Linienzug, Kurve: Punkte
      // klicken, Doppelklick/Enter beendet, Esc bricht ab). Ergebnis ist ein
      // normaler Strich (Punktfolge) - Auswahl, Verschieben, Export gelten.
      var SPL = window.PinnwandPresentation;
      var shapeKind = state.boardShapeKind || 'rect';
      var shapeDraft = null;
      function shapeStroke(firstPt) {
        var st = { id: 's' + Date.now() + Math.random().toString(36).slice(2, 7), points: [firstPt, firstPt],
          color: state.boardDrawColor || INK_COLORS[0], width: inkWidthNorm(), erase: false };
        state.boardInkStrokes.push(st);
        return st;
      }
      function shapeDown(ev, pt) {
        if (shapeKind === 'poly' || shapeKind === 'curve') {
          if (!shapeDraft) { shapeDraft = { pts: [pt], stroke: shapeStroke(pt) }; } else { shapeDraft.pts.push(pt); }
          shapeDraft.stroke.points = SPL.shapePoints(shapeKind, shapeDraft.pts.concat([pt]), BOARD_W / BOARD_H, false);
          inkLayerEl.setStrokes(state.boardInkStrokes);
          return;
        }
        try { inkCapture.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        shapeDraft = { pts: [pt], drag: true, stroke: shapeStroke(pt) };
      }
      function finishShapeDraft(cancel) {
        if (!shapeDraft) { return; }
        var d = shapeDraft;
        shapeDraft = null;
        var pts = [];
        d.pts.forEach(function (q) {
          var last = pts[pts.length - 1];
          if (!last || Math.abs(last.x - q.x) * BOARD_W * boardZoomNow() > 3 || Math.abs(last.y - q.y) * BOARD_H * boardZoomNow() > 3) { pts.push(q); }
        });
        if (cancel || pts.length < 2) {
          state.boardInkStrokes = state.boardInkStrokes.filter(function (st) { return st !== d.stroke; });
          inkLayerEl.setStrokes(state.boardInkStrokes);
          return;
        }
        d.stroke.points = SPL.shapePoints(shapeKind, pts, BOARD_W / BOARD_H, false);
        inkLayerEl.setStrokes(state.boardInkStrokes);
        saveBoardInk();
      }
      inkCapture.addEventListener('dblclick', function () { if (shapeDraft && !shapeDraft.drag) { finishShapeDraft(false); } });
      inkShapeKeyHandler = function (key) {
        if (!shapeDraft || shapeDraft.drag) { return false; }
        if (key === 'Enter') { finishShapeDraft(false); return true; }
        if (key === 'Escape') { finishShapeDraft(true); return true; }
        return false;
      };
      inkCapture.addEventListener('pointermove', function (ev) {
        if (shapeDraft) {
          var sp = inkPoint(ev);
          shapeDraft.stroke.points = shapeDraft.drag
            ? SPL.shapePoints(shapeKind, [shapeDraft.pts[0], sp], BOARD_W / BOARD_H, ev.shiftKey)
            : SPL.shapePoints(shapeKind, shapeDraft.pts.concat([sp]), BOARD_W / BOARD_H, false);
          inkLayerEl.setStrokes(state.boardInkStrokes);
          return;
        }
        if (curStroke) {
          ev.preventDefault();
          curStroke.points.push(inkPoint(ev));
          inkLayerEl.setStrokes(state.boardInkStrokes);
        } else if (moveStart) {
          var p2 = inkPoint(ev), dx = p2.x - moveStart.x, dy = p2.y - moveStart.y;
          selectedStrokes().forEach(function (st, i) {
            var o = moveOrig[i];
            if (st.type === 'text') { st.x = o.x + dx; st.y = o.y + dy; return; }
            st.points = o.points.map(function (q) { return { x: q.x + dx, y: q.y + dy }; });
          });
          inkLayerEl.setStrokes(state.boardInkStrokes);
          updateInkSelection();
        } else if (bandStart) {
          var x1 = Math.min(bandStart.x, ev.clientX), y1 = Math.min(bandStart.y, ev.clientY);
          bandEl.style.left = x1 + 'px'; bandEl.style.top = y1 + 'px';
          bandEl.style.width = Math.abs(ev.clientX - bandStart.x) + 'px'; bandEl.style.height = Math.abs(ev.clientY - bandStart.y) + 'px';
        }
      });
      // Genaue Trefferprüfung: Abstand zum Strich (nicht nur dessen Rechteck).
      function inkHitAt(pt) {
        var z = boardZoomNow();
        for (var i = state.boardInkStrokes.length - 1; i >= 0; i--) {
          var st = state.boardInkStrokes[i];
          if (st.erase) { continue; }
          if (st.type === 'text') {
            var tb = strokeBox(st);
            if (tb && pt.x >= tb.x1 && pt.x <= tb.x2 && pt.y >= tb.y1 && pt.y <= tb.y2) { return st.id; }
            continue;
          }
          var pts = st.points || [];
          var tol = Math.max(8 / z, (st.width || 0) * BOARD_H / 2 + 4 / z);
          var px = pt.x * BOARD_W, py = pt.y * BOARD_H;
          for (var j = 0; j < pts.length; j++) {
            var ax = pts[j].x * BOARD_W, ay = pts[j].y * BOARD_H;
            var bx = (pts[j + 1] || pts[j]).x * BOARD_W, by = (pts[j + 1] || pts[j]).y * BOARD_H;
            var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
            var t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
            var qx = ax + t * dx - px, qy = ay + t * dy - py;
            if (qx * qx + qy * qy <= tol * tol) { return st.id; }
          }
        }
        return null;
      }
      function inkUp(ev) {
        if (shapeDraft && shapeDraft.drag) {
          var up = ev && ev.clientX != null ? inkPoint(ev) : shapeDraft.pts[0];
          shapeDraft.stroke.points = SPL.shapePoints(shapeKind, [shapeDraft.pts[0], up], BOARD_W / BOARD_H, ev && ev.shiftKey);
          var moved = Math.abs(up.x - shapeDraft.pts[0].x) * BOARD_W * boardZoomNow() > 3 || Math.abs(up.y - shapeDraft.pts[0].y) * BOARD_H * boardZoomNow() > 3;
          var dd = shapeDraft;
          shapeDraft = null;
          if (!moved) {
            state.boardInkStrokes = state.boardInkStrokes.filter(function (st) { return st !== dd.stroke; });
            inkLayerEl.setStrokes(state.boardInkStrokes);
          } else {
            saveBoardInk();
          }
          return;
        }
        if (curStroke) { curStroke = null; saveBoardInk(); return; }
        if (moveStart) { moveStart = null; moveOrig = null; saveBoardInk(); render(); return; }
        if (bandStart) {
          var p1 = bandStart.pt, p2 = ev && ev.clientX != null ? inkPoint(ev) : p1;
          var r = { x1: Math.min(p1.x, p2.x), y1: Math.min(p1.y, p2.y), x2: Math.max(p1.x, p2.x), y2: Math.max(p1.y, p2.y) };
          var tiny = (r.x2 - r.x1) * BOARD_W * boardZoomNow() < 4 && (r.y2 - r.y1) * BOARD_H * boardZoomNow() < 4;
          var hits = [];
          for (var i = state.boardInkStrokes.length - 1; i >= 0; i--) {
            var st = state.boardInkStrokes[i];
            if (st.erase) { continue; }
            var sb = strokeBox(st);
            if (!sb) { continue; }
            var hit = tiny
              ? (p1.x >= sb.x1 && p1.x <= sb.x2 && p1.y >= sb.y1 && p1.y <= sb.y2)
              : !(sb.x2 < r.x1 || sb.x1 > r.x2 || sb.y2 < r.y1 || sb.y1 > r.y2);
            if (hit) { hits.push(st.id); if (tiny) { break; } }
          }
          var addSel = ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey);
          state.inkSelection = addSel
            ? (state.inkSelection || []).concat(hits.filter(function (h) { return (state.inkSelection || []).indexOf(h) === -1; }))
            : hits;
          bandStart = null;
          if (bandEl) { bandEl.remove(); bandEl = null; }
          render();
        }
      }
      inkCapture.addEventListener('pointerup', inkUp);
      inkCapture.addEventListener('pointercancel', inkUp);
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
      if (p.blendmode) { item.style.mixBlendMode = p.blendmode; }
      if (layerPeekHides(p.canvasz || 0)) { item.classList.add('ic-layer-peek-hidden'); }
      var backPhoto = p.backphotoid ? state.photos.filter(function (o) { return o.id === p.backphotoid; })[0] : null;
      if (p.wordfielddata && !p.showingback) {
        // Textobjekt: live rendern (echtes DOM statt eingefrorenes Bild) -
        // Grundlage für dynamischen Umfluss um Formen/Fotos in der Nähe.
        // Bei einem Rückseiten-Foto (backPhoto) oder falls die
        // gespeicherten Daten unlesbar sind, auf das eingefrorene Bild
        // zurückfallen.
        var itemBounds = null;
        try {
          var liveTf = JSON.parse(p.wordfielddata);
          // Folien: Rahmen selbst ist das Objekt (gestrichelte Hilfslinie,
          // Griffe an der Rahmenecke) - wie bei Karten.
          var liveIsWordart = wordfieldIsWordart(liveTf) && !liveTf.isSlide;
          var liveEl = buildTextFrameLiveDom(liveTf, { noGuide: liveIsWordart });
          item.appendChild(liveEl);
          if (liveIsWordart) {
            // Rahmen mit Griffen am TATSÄCHLICH sichtbaren Objekt (WordArt inkl.
            // Schrägstellung/Extrusion bzw. gebundener Form) statt an der
            // inneren Kartenbox - vorher hatte der Skalierrahmen oft wenig mit
            // dem sichtbaren Objekt zu tun. Bei Karten stimmen beide überein.
            var vb = measureWordfieldBounds(liveTf);
            itemBounds = el('div', {
              class: 'ic-obj-bounds ic-obj-bounds-guide',
              style: 'left:' + (vb.x1 / liveTf.w * 100) + '%;top:' + (vb.y1 / liveTf.h * 100) + '%;' +
                'width:' + ((vb.x2 - vb.x1) / liveTf.w * 100) + '%;height:' + ((vb.y2 - vb.y1) / liveTf.h * 100) + '%;'
            });
            liveEl.appendChild(itemBounds);
            // Griff sitzt an der sichtbaren Ecke: Mausweg auf die Kartenbreite
            // umrechnen, damit die Ecke dem Zeiger folgt.
            item._icResizeRatio = liveTf.w / Math.max(1, vb.x2 - vb.x1);
          }
        } catch (e) {
          itemBounds = null;
          item.appendChild(el('img', { src: p.url, alt: '' }));
        }
      } else {
        var img = el('img', { src: (p.showingback && backPhoto) ? backPhoto.url : p.url, alt: '' });
        img.addEventListener('load', function () { if (img.naturalWidth) { p._ratio = img.naturalHeight / img.naturalWidth; } });
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

      // Mischmodus mit dem Hintergrund (Überdecken/Multiplizieren/
      // Invertieren/Farbig nachbelichten) - wirkt gleich auf der Pinnwand,
      // in der Präsentation und im HTML-Export.
      var blendWrap = el('div', { class: 'ic-blend-toggle' });
      blendWrap.appendChild(blendModePicker(function () { return p; }, function (mode) { item.style.mixBlendMode = mode || ''; }));
      blendWrap.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      blendWrap.addEventListener('click', function (ev) { ev.stopPropagation(); });
      item.appendChild(blendWrap);

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
      var rotateHandle = el('div', { class: 'ic-rotate-handle' });
      var handleHost = (typeof itemBounds !== 'undefined' && itemBounds && p.wordfielddata && !p.showingback) ? itemBounds : item;
      handleHost.appendChild(resize);
      handleHost.appendChild(rotateHandle);
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
        if (ev.target.closest && ev.target.closest('.ic-pin-toggle, .ic-thread-add-toggle, .ic-blend-toggle')) { return; }
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
        else if (p.wordfielddata) {
          openWordfieldEditorDirectly(p, function () { openLightbox(state.photos.indexOf(p)); });
        }
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

    // Folien (Faden-Rahmen mit Inhalt) des eigenen Fadens: Inhalt immer
    // sichtbar - der Rahmen selbst nur bei offenem Faden-/Schichtungs-Panel.
    // Doppelklick öffnet den Folien-Editor.
    var frameSlideEls = {};
    var slideThread = ownThread();
    (slideThread ? slideThread.items : []).forEach(function (it) {
      if (it.itemtype !== 'frame' || (it.boardid || 0) !== state.currentBoard) { return; }
      var stf = frameSlideTf(it);
      if (!stf) { return; }
      var slideEl = buildFrameSlideEl(it, stf, 'ic-frame-slide');
      if (layerPeekHides(it.framez || 0)) { slideEl.classList.add('ic-layer-peek-hidden'); }
      slideEl.title = S.slide_edit;
      slideEl.addEventListener('dblclick', function (ev) { ev.preventDefault(); ev.stopPropagation(); openFrameSlideEditor(it); });
      canvas.appendChild(slideEl);
      frameSlideEls[it.id] = slideEl;
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
          if (layerPeekHides(it.framez || 0)) { frameEl.classList.add('ic-layer-peek-hidden'); }
          var stepNum = boardItems.indexOf(it) + 1;
          // Zahl/Beschriftung im Rahmen anklicken öffnet den Folien-Editor.
          var frameNum = el('span', { class: 'ic-frame-num', style: 'color:' + lineColor, title: S.slide_edit }, [it.framelabel || String(stepNum)]);
          frameNum.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
          frameNum.addEventListener('touchstart', function (ev) { ev.stopPropagation(); }, { passive: true });
          frameNum.addEventListener('click', function (ev) { ev.stopPropagation(); openFrameSlideEditor(it); });
          frameEl.appendChild(frameNum);
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
            if (frameSlideEls[it.id]) { frameSlideEls[it.id].style.left = x + 'px'; frameSlideEls[it.id].style.top = y + 'px'; }
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
          // Folie bearbeiten (bzw. aus dem Rahmen eine Folie machen).
          frameEl.appendChild(frameEditButton(it, 'ic-frame-edit-btn'));

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
            // Folie: Seitenverhältnis bleibt (der Inhalt ist darauf gestaltet).
            it.frameh = frameSlideTf(it) ? it.framew * frStartH / frStartW : Math.max(60, frStartH + (p.y - frStartY) / z);
            frameEl.style.width = it.framew + 'px'; frameEl.style.height = it.frameh + 'px';
            if (frameSlideEls[it.id]) { frameSlideEls[it.id].style.width = it.framew + 'px'; frameSlideEls[it.id].style.height = it.frameh + 'px'; }
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
            if (frameSlideEls[it.id]) { frameSlideEls[it.id].style.transform = 'rotate(' + deg + 'deg)'; }
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
        // Im Schichtung-Modus (ohne offenes Faden-Panel) nur die Rahmen,
        // keine Fadenlinie - dort geht es um Ebenen, nicht um die Reihenfolge.
        if (pts.length >= 2 && state.threadPanelOpen) {
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
      return !target.closest('.ic-arrange-item, .ic-thread-frame-onboard, button, input, a, .ic-board-ink-capture');
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
    // Stift-Werkzeug (Notizen auf der Pinnwand): alle Knöpfe in EINER Spalte
    // am linken Rand. Stärke (Stift) und Schriftgröße (Text) klappen beim
    // Überfahren des jeweiligen Werkzeugs als Regler nach rechts aus.
    var stylusBar = el('div', { class: 'ic-stylus-bar' });
    var stylusBtn = el('button', { class: 'ic-fab' + (state.boardDrawMode ? ' active' : ''), title: S.drawonboard }, [icon('pen')]);
    stylusBtn.addEventListener('click', function () {
      state.boardDrawMode = !state.boardDrawMode;
      state.inkSelection = [];
      render();
    });
    stylusBar.appendChild(stylusBtn);
    if (state.boardDrawMode) {
      var tool = state.boardDrawTool || 'pen';
      var stylusTools = el('div', { class: 'ic-stylus-tools' });
      function setTool(t) { state.boardDrawTool = t; state.boardDrawErase = t === 'eraser'; if (t !== 'select') { state.inkSelection = []; } render(); }
      function toolButton(t, iconEl, title, flyout) {
        var wrapT = el('div', { class: 'ic-stylus-tool' });
        var b = el('button', { class: 'ic-icon-btn' + (tool === t ? ' active' : ''), title: title }, [iconEl]);
        b.addEventListener('click', function () { setTool(t); });
        wrapT.appendChild(b);
        if (flyout) { wrapT.appendChild(flyout); }
        stylusTools.appendChild(wrapT);
      }
      function sliderFlyout(label, min, max, value, onInput) {
        var fly = el('div', { class: 'ic-stylus-flyout' });
        var val = el('span', { class: 'ic-stylus-flyout-val' }, [String(value)]);
        var range = el('input', { type: 'range', min: String(min), max: String(max), step: '1', value: String(value), class: 'ic-stylus-size', title: label });
        range.addEventListener('input', function () { val.textContent = range.value; onInput(parseInt(range.value, 10)); });
        fly.appendChild(el('span', { class: 'ic-stylus-flyout-label' }, [label]));
        fly.appendChild(range);
        fly.appendChild(val);
        return fly;
      }
      // Stärke/Schriftgröße in Bildschirm-Pixeln (bei jeder Zoomstufe gleich).
      toolButton('pen', icon('pen'), S.ink_tool_pen, sliderFlyout(S.ink_width, 2, 30, state.boardDrawPx || 6, function (v) { state.boardDrawPx = v; }));
      var textIcon = el('span', { class: 'ic-stylus-text-icon' }, ['T']);
      toolButton('text', textIcon, S.ink_tool_text, sliderFlyout(S.ink_fontsize, 10, 72, state.boardTextPx || 24, function (v) { state.boardTextPx = v; }));
      // Formen hinter EINEM Werkzeug, das beim Überfahren nach rechts
      // aufklappt (Rechteck, Kreis, Linie, Linienzug, Kurve).
      var SPV = window.PinnwandPresentation;
      var shapeFly = el('div', { class: 'ic-stylus-flyout ic-stylus-shape-fly' });
      var shapeLabels = { rect: S.ink_shape_rect, ellipse: S.ink_shape_ellipse, line: S.ink_shape_line, poly: S.ink_shape_poly, curve: S.ink_shape_curve };
      SPV.SHAPE_KINDS.forEach(function (k) {
        var kb = el('button', {
          class: 'ic-icon-btn' + (tool === 'shape' && (state.boardShapeKind || 'rect') === k ? ' active' : ''),
          type: 'button', title: shapeLabels[k], html: SPV.SHAPE_SVG[k]
        });
        kb.addEventListener('click', function () { state.boardShapeKind = k; setTool('shape'); });
        shapeFly.appendChild(kb);
      });
      toolButton('shape', el('span', { class: 'ic-stylus-svg', html: SPV.SHAPE_SVG[state.boardShapeKind || 'shapes'] }), S.ink_tool_shapes, shapeFly);
      toolButton('eraser', icon('eraser'), S.erase, null);
      // Auswählen: Rahmen aufziehen/anklicken; im Ausklapp-Feld "Alle
      // auswählen" (auch Strg/Cmd+A) - erfasst auch Notizen außerhalb des
      // sichtbaren Ausschnitts.
      var selFly = el('div', { class: 'ic-stylus-flyout' });
      var selAllBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button' }, [S.ink_select_all]);
      selAllBtn.addEventListener('click', function () { selectAllInk(); });
      selFly.appendChild(selAllBtn);
      toolButton('select', icon('boxselect'), S.ink_tool_select + ' (' + S.ink_select_all + ': Strg+A)', selFly);
      stylusTools.appendChild(el('div', { class: 'ic-stylus-sep' }));
      // Farben untereinander; wirken auch auf ausgewählte Notizen.
      INK_COLORS.forEach(function (c) {
        var sw = el('button', {
          class: 'ic-color-swatch' + (state.boardDrawColor === c && tool !== 'eraser' ? ' active' : ''), style: 'background:' + c
        });
        sw.addEventListener('click', function () {
          state.boardDrawColor = c;
          if (recolorInkSelection(c)) { return; }
          if (tool === 'eraser' || tool === 'select') { state.boardDrawTool = 'pen'; state.boardDrawErase = false; }
          render();
        });
        stylusTools.appendChild(sw);
      });
      // Palettenbutton: freie Farbwahl über den nativen Farbwähler.
      var stylusCustomColor = el('input', {
        type: 'color', value: state.boardDrawColor || INK_COLORS[0], class: 'ic-textframe-custom-color'
      });
      stylusCustomColor.addEventListener('change', function () {
        state.boardDrawColor = stylusCustomColor.value;
        if (recolorInkSelection(stylusCustomColor.value)) { return; }
        if (tool === 'eraser' || tool === 'select') { state.boardDrawTool = 'pen'; state.boardDrawErase = false; }
        render();
      });
      stylusTools.appendChild(stylusCustomColor);
      stylusTools.appendChild(el('div', { class: 'ic-stylus-sep' }));
      // Ausblenden: blendet die eigenen Notizen aus, ohne sie zu löschen.
      var hideInkBtn = el('button', {
        class: 'ic-icon-btn' + (state.boardInkHidden ? ' active' : ''), title: state.boardInkHidden ? S.showannotations : S.hideannotations
      }, [icon('eye')]);
      hideInkBtn.addEventListener('click', function () { state.boardInkHidden = !state.boardInkHidden; render(); });
      stylusTools.appendChild(hideInkBtn);
      // Löschen: mit Auswahl nur die ausgewählten Notizen, sonst (mit
      // Rückfrage) alle eigenen Notizen dieses Boards.
      var hasSel = (state.inkSelection || []).length > 0;
      var clearInkBtn = el('button', { class: 'ic-icon-btn' + (hasSel ? ' ic-danger' : ''), title: hasSel ? S.ink_delete_selection : S.clearannotations }, [icon('trash')]);
      clearInkBtn.addEventListener('click', function () {
        if (hasSel) { deleteInkSelection(); return; }
        if (!confirm(S.clearannotations_confirm)) { return; }
        state.boardInkStrokes = [];
        state.inkSelection = [];
        commitBoardInk();
        render();
      });
      stylusTools.appendChild(clearInkBtn);
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

  // Schichtung: "Ansicht ab dieser Ebene" blendet alles aus, was darüber
  // liegt (höheres z) - genau wie die Präsentation, wenn diese Ebene die
  // aktive Station ist. Gilt nur, solange das Schichtung-Panel offen ist.
  function layerPeekHides(z) {
    return state.layerPanelOpen && state.layerPeekZ != null && z > state.layerPeekZ;
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
        var layerSlideTf = frameSlideTf(entry.ref);
        if (layerSlideTf) {
          var layerMini = el('div', { class: 'ic-thread-frame-thumb ic-thread-slide-thumb' });
          layerMini.appendChild(buildTextFrameLiveDom(layerSlideTf, { noGuide: true }));
          row.appendChild(layerMini);
        } else {
          row.appendChild(el('div', { class: 'ic-thread-frame-thumb' }, ['\u2b1a']));
        }
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
        row.appendChild(frameEditButton(entry.ref, 'ic-thread-slide-btn'));
      }

      var peekActive = state.layerPeekKey === key;
      var peekBtn = el('button', {
        class: 'ic-layer-peek-btn' + (peekActive ? ' active' : ''), title: peekActive ? S.layer_peek_off : S.layer_peek
      }, [icon('eye')]);
      peekBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (peekActive) { state.layerPeekKey = null; state.layerPeekZ = null; }
        else { state.layerPeekKey = key; state.layerPeekZ = entry.z; }
        render();
      });
      row.appendChild(peekBtn);
      if (state.layerPeekZ != null && entry.z > state.layerPeekZ) { row.classList.add('ic-layer-row-hidden'); }
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
    if (item.itemtype === 'frame') { return item.framelabel || (item.framedata ? S.slide_label : S.emptyframe); }
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
      var rowSlideTf = frameSlideTf(item);
      if (photo) {
        row.appendChild(el('img', { src: photo.url, alt: '' }));
      } else if (rowSlideTf) {
        // Folie: kleine Live-Vorschau des Inhalts.
        var miniSlide = el('div', { class: 'ic-thread-frame-thumb ic-thread-slide-thumb' });
        miniSlide.appendChild(buildTextFrameLiveDom(rowSlideTf, { noGuide: true }));
        row.appendChild(miniSlide);
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
        // Bearbeiten-Knopf je Rahmen (Symbol, Tooltip): öffnet ihn als Folie.
        row.appendChild(frameEditButton(item, 'ic-thread-slide-btn'));
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
      // Knopf auf die Pinnwand ziehen: der Rahmen entsteht genau dort, wo er
      // losgelassen wird (oberste Ebene). Ein normaler Klick legt ihn wie
      // bisher oben links an.
      (function () {
        var fd = null, suppressClick = false;
        var FW = 320, FH = 180;
        addFrameBtn.addEventListener('pointerdown', function (ev) {
          if (ev.button !== undefined && ev.button !== 0) { return; }
          fd = { sx: ev.clientX, sy: ev.clientY, ghost: null };
          try { addFrameBtn.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        });
        addFrameBtn.addEventListener('pointermove', function (ev) {
          if (!fd) { return; }
          if (!fd.ghost && Math.abs(ev.clientX - fd.sx) + Math.abs(ev.clientY - fd.sy) > 6) {
            var z = state.boardZoom || 1;
            fd.ghost = el('div', { class: 'ic-frame-drag-ghost', 'data-label': S.slide_label || 'Folie', style: 'width:' + (FW * z) + 'px;height:' + (FH * z) + 'px;border-color:' + ((own && own.color) || '#e0503f') + ';' });
            document.body.appendChild(fd.ghost);
          }
          if (fd.ghost) {
            fd.ghost.style.left = (ev.clientX - fd.ghost.offsetWidth / 2) + 'px';
            fd.ghost.style.top = (ev.clientY - fd.ghost.offsetHeight / 2) + 'px';
            // Sichtbares Feedback: grün = hier wird der Rahmen abgelegt,
            // rot = ungültige Stelle (Seitenleiste/außerhalb der Pinnwand).
            var dropWrap = document.querySelector('.ic-canvas-wrap');
            var hit = document.elementFromPoint(ev.clientX, ev.clientY);
            var okDrop = !!(dropWrap && hit && dropWrap.contains(hit) && !(hit.closest && hit.closest('.ic-thread-panel')));
            fd.ghost.classList.toggle('ic-drop-ok', okDrop);
            fd.ghost.classList.toggle('ic-drop-no', !okDrop);
            if (dropWrap) { dropWrap.classList.toggle('ic-frame-drop-target', okDrop); }
          }
        });
        function endFrameDrag(ev) {
          if (!fd) { return; }
          var wasDrag = !!fd.ghost;
          if (fd.ghost) { fd.ghost.remove(); }
          var dropWrapEnd = document.querySelector('.ic-canvas-wrap');
          if (dropWrapEnd) { dropWrapEnd.classList.remove('ic-frame-drop-target'); }
          fd = null;
          if (!wasDrag) { return; }
          suppressClick = true;
          var canvasNode = document.querySelector('.ic-arrange-canvas');
          var wrapNode = document.querySelector('.ic-canvas-wrap');
          var under = document.elementFromPoint(ev.clientX, ev.clientY);
          if (!canvasNode || !wrapNode || !under || !wrapNode.contains(under) || (under.closest && under.closest('.ic-thread-panel'))) { return; }
          var rc = canvasNode.getBoundingClientRect(), z2 = rc.width / BOARD_W || 1;
          var bx = (ev.clientX - rc.left) / z2 - FW / 2, by = (ev.clientY - rc.top) / z2 - FH / 2;
          var topZ = 0;
          state.photos.forEach(function (p) { if (p.boardplaced && (p.boardid || 0) === state.currentBoard) { topZ = Math.max(topZ, p.canvasz || 0); } });
          (own ? own.items : []).forEach(function (o) { if (o.itemtype === 'frame') { topZ = Math.max(topZ, o.framez || 0); } });
          callAjax('mod_pinnwand_add_thread_item', {
            cmid: cfg.cmid, itemtype: 'frame', boardid: state.currentBoard,
            framex: bx, framey: by, framew: FW, frameh: FH, framelabel: ''
          }).then(function (res) {
            replaceOwnThread(res);
            var it = res.items[res.items.length - 1];
            it.framez = topZ + 1;
            callAjax('mod_pinnwand_update_thread_frame', {
              cmid: cfg.cmid, itemid: it.id, framex: it.framex, framey: it.framey, framew: it.framew, frameh: it.frameh,
              framerot: 0, framez: it.framez
            });
            render();
          });
        }
        addFrameBtn.addEventListener('pointerup', endFrameDrag);
        addFrameBtn.addEventListener('pointercancel', function () {
          if (fd && fd.ghost) { fd.ghost.remove(); }
          var dw = document.querySelector('.ic-canvas-wrap');
          if (dw) { dw.classList.remove('ic-frame-drop-target'); }
          fd = null;
        });
        addFrameBtn.addEventListener('click', function (ev) {
          if (suppressClick) { suppressClick = false; ev.stopImmediatePropagation(); ev.preventDefault(); }
        }, true);
      })();
      addFrameBtn.title = S.addframe_drag;
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

  // Rand (Anteil je Seite) um eine Station beim Heranzoomen, damit ein
  // Objekt nicht direkt am Bildschirmrand klebt - identisch in der
  // exportierten Datei (export_presentation.php, PRESENT_STEP_MARGIN).
  var PRESENT_STEP_MARGIN = 0.05;

  // Zoom-Ziel (Board-Koordinaten) für ein Wortfeld: der tatsächlich
  // sichtbare Bereich (measureWordfieldBounds, inkl. über die Karte
  // hinausragender WordArt) statt nur der Kartenbox - sonst wurde
  // schräggestellte/extrudierte WordArt beim Heranzoomen vom
  // Bildschirmrand abgeschnitten.
  function wordfieldStepBox(p, tf) {
    var b = measureWordfieldBounds(tf);
    var k = (p.canvasw || tf.w) / tf.w;
    var x1 = p.canvasx + b.x1 * k, y1 = p.canvasy + b.y1 * k;
    var w = (b.x2 - b.x1) * k, h = (b.y2 - b.y1) * k;
    return { cx: x1 + w / 2, cy: y1 + h / 2, w: w * (1 + 2 * PRESENT_STEP_MARGIN), h: h * (1 + 2 * PRESENT_STEP_MARGIN) };
  }

  // Präsentation innerhalb von Moodle. Navigation/Kamera/Bedienelemente
  // kommen aus js/presentation-player.js - DERSELBEN Datei, die auch in die
  // exportierte HTML-Präsentation eingebettet wird, damit sich beide exakt
  // gleich bedienen lassen (Klickzonen links/rechts, Pfeiltasten/Leertaste,
  // Zähler + Stapel, Ziehen, Mausrad, Pinch). Hier kommen nur die
  // Moodle-spezifischen Teile dazu: Schließen-Knopf/Escape, Stylus-Ebene
  // und das Anhängen noch nicht enthaltener Objekte per Klick.
  function openPresentation(thread, startIndex) {
    if (window.innerWidth < 900) { alert(S.present_smallscreen); return false; }
    if (!window.PinnwandPresentation) { return false; }
    // Start über den Play-Knopf (ganze Präsentation, kein Direkt-Sprung zu
    // einem Objekt): gleichzeitig in den Vollbildmodus - muss noch im
    // selben Klick passieren, sonst verweigert der Browser das Vollbild.
    var enteredFullscreen = false;
    if (typeof startIndex !== 'number' && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        var fsPromise = document.documentElement.requestFullscreen();
        enteredFullscreen = true;
        if (fsPromise && fsPromise.catch) { fsPromise.catch(function () { enteredFullscreen = false; }); }
      } catch (fsErr) { enteredFullscreen = false; }
    }
    var overlay = el('div', { class: 'ic-present-overlay' });
    // Die gewählte Hintergrundfarbe zusätzlich aufs Overlay selbst legen,
    // damit sie in jedem Fall sichtbar bleibt (z.B. wenn "Füllen" einen
    // Rand lässt oder beim Herauszoomen der 1400x1000-Bereich nicht die
    // ganze Bildschirmfläche ausfüllt).
    overlay.style.backgroundColor = (state.background && state.background.color) || '#2b2d33';
    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-present-close', title: S.exitpresent }, ['✕']);
    var player = window.PinnwandPresentation.create(overlay, {
      labels: {
        overview: S.present_overview, frame: S.present_frame, hint: S.present_hint,
        empty: S.present_empty, prev: S.present_prev, next: S.present_next,
        pen: S.present_pen, penDraw: S.present_pen_draw, penText: S.present_pen_text,
        penErase: S.present_pen_erase, penSize: S.present_pen_size, penClear: S.present_pen_clear,
        penShapes: S.ink_tool_shapes,
        shapes: { rect: S.ink_shape_rect, ellipse: S.ink_shape_ellipse, line: S.ink_shape_line, poly: S.ink_shape_poly, curve: S.ink_shape_curve },
        show: S.present_show, hide: S.present_hide
      },
      onEscape: function () { closeBtn.click(); }
    });
    var stageEl = player.stage;
    var canvasEl = player.canvas;
    canvasEl.classList.add('ic-present-canvas');

    var bgLayer = el('div', { class: 'ic-present-bg' + (thread.bgmoves ? ' ic-present-bg-moves' : '') });
    applyBackground(bgLayer);
    // Hintergrund bewegt sich beim Zoom mit (Checkbox im Faden-Panel): Teil
    // der gezoomten Leinwand, exakt 1400x1000 - dasselbe Koordinatensystem
    // wie Fotos/Rahmen. Sonst eine eigenständige, bildschirmfüllende Ebene
    // dahinter.
    if (thread.bgmoves) {
      canvasEl.appendChild(bgLayer);
    } else {
      // Bildschirmfüllend relativ zur Bühne (nicht in festen Pixeln), damit
      // der Hintergrund auch nach dem Wechsel in den Vollbildmodus passt.
      // Als feststehende Ebene IN der Leinwand (gegenläufig transformiert),
      // damit Objekte mit Mischmodus mit dem Hintergrund mischen können.
      player.setScreenLayer(bgLayer);
    }

    // Alle Stationen müssen vom selben Board stammen. Beim eigenen Faden ist
    // das Referenz-Board das gerade angezeigte Board, bei einem FREMDEN
    // (geteilten) Faden das Board der ersten Station.
    var firstBoardId = thread.isown
      ? (state.currentBoard || 0)
      : (thread.items.length ? (thread.items[0].boardid || 0) : 0);

    // Alle auf diesem Board platzierten Objekte zeigen (nicht nur die des
    // Fadens). Wortfelder (Zettel/WordArt) erscheinen in DERSELBEN
    // Live-Darstellung wie auf der Pinnwand (buildTextFrameLiveDom) statt
    // als gespeichertes Bild - dadurch sehen sie in der Präsentation exakt
    // so aus wie auf der Pinnwand und im Editor. Ein Klick auf ein noch
    // nicht im Faden enthaltenes Objekt hängt es direkt ans Ende an.
    var boardPhotos = state.photos.filter(function (p) {
      return !p.hiddenfromboard && p.boardplaced && (p.boardid || 0) === firstBoardId;
    });
    var photoRecs = {};
    var occludables = [];
    var hasPresentAnnot = false;
    var inThreadIds = {};
    thread.items.forEach(function (it) { if (it.itemtype === 'photo') { inThreadIds[it.photoid] = true; } });
    boardPhotos.forEach(function (p) {
      var tf = null;
      if (p.wordfielddata) {
        try { tf = JSON.parse(p.wordfielddata); } catch (e) { tf = null; }
      }
      var pEl = el('div', {
        class: 'ic-present-photo' + (p.wordfielddata ? ' ic-present-wordart' : ''),
        style: 'left:' + p.canvasx + 'px;top:' + p.canvasy + 'px;width:' + p.canvasw + 'px;' +
          'transform:rotate(' + (p.canvasrot || 0) + 'deg)'
      });
      pEl.style.zIndex = p.canvasz || 0;
      if (p.blendmode) { pEl.style.mixBlendMode = p.blendmode; }
      var live = null;
      if (tf) {
        try { live = buildTextFrameLiveDom(tf, { noGuide: true }); } catch (e2) { live = null; tf = null; }
      }
      pEl.appendChild(live || el('img', { src: p.url, alt: '' }));
      if (!inThreadIds[p.id]) {
        pEl.classList.add('ic-present-addable');
        pEl.title = S.stream_pin_hint;
        pEl.addEventListener('click', function () {
          // Während mit dem Stift geschrieben wird, kein Anhängen an den Faden.
          if (inThreadIds[p.id] || overlay.classList.contains('pwp-drawing')) { return; }
          callAjax('mod_pinnwand_add_thread_item', {
            cmid: cfg.cmid, itemtype: 'photo', photoid: p.id, boardid: firstBoardId
          }).then(function (res) {
            var newItem = res.items[res.items.length - 1];
            thread.items.push(newItem);
            inThreadIds[p.id] = true;
            pEl.classList.remove('ic-present-addable');
            pEl.removeAttribute('title');
            var newStep = buildStep(newItem);
            if (newStep) { player.addStep(newStep); }
          });
        });
      }
      canvasEl.appendChild(pEl);
      // Annotationen auf dem Objekt - wie auf der Pinnwand nur, wenn dort
      // eingeblendet (annotationonboard).
      if (p.annotationonboard !== false) {
        var annot = parseStrokes(p);
        if (annot.length) { window.PinnwandPresentation.attachInk(pEl, annot, 'annot'); hasPresentAnnot = true; }
      }
      photoRecs[p.id] = { el: pEl, z: p.canvasz || 0, photo: p, tf: tf };
      occludables.push(photoRecs[p.id]);
    });

    // Notizen des Stylus-Werkzeugs auf dem Board - über den Fotos (nicht von
    // der Verdeckung betroffen), per Schalter oben links ausblendbar wie im
    // Modul. Dieselbe Darstellung wie in der exportierten Datei.
    callAjax('mod_pinnwand_get_board_ink', { cmid: cfg.cmid, boardid: firstBoardId }).then(function (res) {
      var strokes = [];
      try { strokes = JSON.parse(res.strokedata || '[]'); } catch (e) { strokes = []; }
      if (!strokes.length) { return; }
      canvasEl.appendChild(window.PinnwandPresentation.inkLayer(strokes, BOARD_W, BOARD_H, 'ink', 600));
      player.addToggle('ink', S.present_toggle_ink);
      // Notizen außerhalb der Leinwand: Überblick entsprechend vergrößern.
      player.includeInOverview(window.PinnwandPresentation.inkBounds(strokes, BOARD_W, BOARD_H));
    });
    if (hasPresentAnnot) { player.addToggle('annot', S.present_toggle_annot); }

    function overviewStep() {
      return { el: null, cx: BOARD_W / 2, cy: BOARD_H / 2, w: BOARD_W, h: BOARD_H, rot: 0, overview: true };
    }

    // Für jede Station (Foto, Wortfeld, Leerrahmen, Überblick) den
    // Bereich festlegen, auf den die Kamera zoomt.
    function buildStep(it) {
      if (it.itemtype === 'overview') { return overviewStep(); }
      if (it.itemtype === 'frame') {
        // Unsichtbar in der Präsentation - dient nur als Zoom-Ziel. Ist der
        // Rahmen gedreht, dreht sich die Kamera ENTGEGENGESETZT mit, damit
        // der eingerahmte Bereich am Ende gerade erscheint.
        var fEl = el('div', {
          class: 'ic-present-step-frame',
          style: 'left:' + it.framex + 'px;top:' + it.framey + 'px;width:' + it.framew + 'px;height:' + it.frameh + 'px;'
        });
        canvasEl.appendChild(fEl);
        var frameStep = {
          el: fEl, cx: it.framex + it.framew / 2, cy: it.framey + it.frameh / 2,
          w: it.framew, h: it.frameh, rot: -(it.framerot || 0), z: it.framez || 0, frame: true
        };
        // Folie: Inhalt sichtbar im Rahmen (Ebene, Mischmodus, Verdeckung wie
        // Objekte), Animationsschritte bei stehender Kamera.
        var slideTf = frameSlideTf(it);
        if (slideTf) {
          var slideEl = buildFrameSlideEl(it, slideTf, 'ic-present-slide');
          canvasEl.appendChild(slideEl);
          occludables.push({ el: slideEl, z: it.framez || 0 });
          frameStep.el = slideEl;
          var slideBuilds = slideAnimMap(slideTf).count;
          if (slideBuilds) { frameStep.buildEl = slideEl; frameStep.buildCount = slideBuilds; }
          frameStep.keep = (slideTf.linked || []).map(function (pid) { return photoRecs[pid] && photoRecs[pid].el; }).filter(Boolean);
          frameStep.slideEl = slideEl;
          frameStep.slideBgHideBefore = !slideTf.bgShowBefore;
          frameStep.slideBgHideAfter = !slideTf.bgPersist;
        }
        return frameStep;
      }
      var rec = photoRecs[it.photoid];
      if (!rec) { return null; }
      var p = rec.photo;
      if (rec.tf) {
        var box = wordfieldStepBox(p, rec.tf);
        var wfStep = { el: rec.el, cx: box.cx, cy: box.cy, w: box.w, h: box.h, z: rec.z, rot: 0, previewUrl: p.url };
        // Folie mit Animationsschritten: Kamera bleibt, Objekte erscheinen
        // Schritt für Schritt (siehe expandBuildSteps im Player).
        if (rec.tf.isSlide) {
          var nBuild = slideAnimMap(rec.tf).count;
          if (nBuild) { wfStep.buildEl = rec.el; wfStep.buildCount = nBuild; }
        }
        return wfStep;
      }
      var natW = p.canvasw || 200;
      var img = rec.el.querySelector('img');
      // Echtes Seitenverhältnis, sobald das Bild geladen ist - bis dahin
      // eine grobe Näherung (4:3).
      var natH = (img.naturalWidth && img.naturalHeight) ? natW * (img.naturalHeight / img.naturalWidth) : natW * 0.75;
      var stepData = {
        el: rec.el, cx: p.canvasx + natW / 2, cy: p.canvasy + natH / 2,
        w: natW, h: natH, z: rec.z, rot: 0, previewUrl: p.url
      };
      if (!img.complete || !img.naturalWidth) {
        img.addEventListener('load', function () {
          var loadedH = natW * (img.naturalHeight / img.naturalWidth);
          stepData.h = loadedH;
          stepData.cy = p.canvasy + loadedH / 2;
          player.refreshStep(stepData);
        });
      }
      return stepData;
    }

    // Station je Faden-Eintrag merken, damit startIndex (Index in der
    // nach Board gefilterten Faden-Liste, siehe openPresentationAtItem)
    // auch dann die richtige Station trifft, wenn vorne noch der
    // automatische Überblick eingefügt wird.
    var boardItems = thread.items.filter(function (it) { return (it.boardid || 0) === firstBoardId; });
    var stepByItem = boardItems.map(buildStep);
    var steps = window.PinnwandPresentation.expandBuildSteps(stepByItem.filter(Boolean));

    // Präsentation startet immer mit einem Überblick über die ganze
    // Pinnwand (falls der Rote Faden nicht selbst schon damit beginnt).
    if (steps.length && !steps[0].overview) { steps.unshift(overviewStep()); }

    closeBtn.addEventListener('click', function () {
      player.destroy();
      overlay.remove();
      if (enteredFullscreen && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () { /* bereits verlassen */ });
      }
    });
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    var startStep = (typeof startIndex === 'number' && stepByItem[startIndex]) ? steps.indexOf(stepByItem[startIndex]) : 0;
    // Einstellung "Start der Präsentation": erste Folie statt Überblick.
    var effStart = (state.background && state.background.startmode) || cfg.startmode;
    if (typeof startIndex !== 'number' && effStart === 'slide' && steps.length > 1 && steps[0].overview) { startStep = 1; }
    player.start(steps, occludables, Math.max(0, startStep));
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

    if (cfg.exportpresentationurl) {
      var exportBtn = toolBtn('download', S.export_presentation);
      exportBtn.addEventListener('click', function () { startPresentationExport(); });
      toolbar.appendChild(exportBtn);
    }

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
      // Wortfelder wie auf der Pinnwand (Live-Darstellung, als Ganzes
      // eingepasst) statt des gespeicherten Bildes mit object-fit:cover,
      // das WordArt an den Seiten abschnitt.
      var modTf = null;
      if (p.wordfielddata) {
        try { modTf = JSON.parse(p.wordfielddata); } catch (modErr) { modTf = null; }
      }
      var modLive = null;
      if (modTf) {
        try { modLive = buildWordfieldFit(modTf); } catch (modErr2) { modLive = null; }
      }
      if (modLive) {
        var modBox = el('div', { class: 'ic-moderate-thumb-wordfield' });
        modBox.appendChild(modLive);
        thumbWrap.appendChild(modBox);
      } else {
        thumbWrap.appendChild(el('img', { src: p.url, alt: '' }));
      }

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

  // ==================================================================
  // PDF als Präsentationshintergrund: pdf.js (lokal mitgeliefert, siehe
  // js/vendor/pdfjs/) rendert die gewählten Seiten - hochkant standardmäßig
  // als Doppelseiten nebeneinander - zu EINEM Hintergrundbild auf der
  // 1400x1000-Fläche. Das PDF wird mitgespeichert, damit die Auswahl später
  // geändert werden kann.
  // ==================================================================
  var pdfJsPromise = null;
  function loadPdfJs() {
    if (pdfJsPromise) { return pdfJsPromise; }
    var base = cfg.wwwroot + '/mod/pinnwand/js/vendor/pdfjs/';
    pdfJsPromise = new Promise(function (resolve, reject) {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      var sc = document.createElement('script');
      sc.src = base + 'pdf.min.js';
      sc.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('pdf.js')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      sc.onerror = function () { pdfJsPromise = null; reject(new Error('pdf.js')); };
      document.head.appendChild(sc);
    });
    return pdfJsPromise;
  }

  function pdfSpreadsFor(numPages, dbl) {
    var out = [];
    for (var i = 1; i <= numPages; i += dbl ? 2 : 1) {
      out.push(dbl && i + 1 <= numPages ? [i, i + 1] : [i]);
    }
    return out;
  }

  // Rendert die Seiten einer (Doppel-)Seite nebeneinander in einen Canvas
  // der Höhe h (Pixel).
  function pdfRenderSpread(doc, pages, h) {
    return Promise.all(pages.map(function (n) { return doc.getPage(n); })).then(function (pgs) {
      var vps = pgs.map(function (pg) { var v = pg.getViewport({ scale: 1 }); return pg.getViewport({ scale: h / v.height }); });
      var c = document.createElement('canvas');
      c.width = Math.round(vps.reduce(function (sum, v) { return sum + v.width; }, 0));
      c.height = Math.round(h);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      var x = 0, chain = Promise.resolve();
      pgs.forEach(function (pg, i) {
        chain = chain.then(function () {
          var pc = document.createElement('canvas');
          pc.width = Math.round(vps[i].width); pc.height = Math.round(vps[i].height);
          return pg.render({ canvasContext: pc.getContext('2d'), viewport: vps[i] }).promise.then(function () {
            ctx.drawImage(pc, x, 0);
            x += pc.width;
          });
        });
      });
      return chain.then(function () { return c; });
    });
  }

  // Ordnet die gewählten (Doppel-)Seiten im besten Raster auf der
  // Board-Fläche an und rendert sie in passender Auflösung.
  function pdfComposeBackground(doc, spreads, bgColor) {
    var W = BOARD_W * 2, H = BOARD_H * 2;
    return Promise.all(spreads.map(function (sp) {
      return Promise.all(sp.map(function (n) { return doc.getPage(n); })).then(function (pgs) {
        var vs = pgs.map(function (pg) { return pg.getViewport({ scale: 1 }); });
        var ph = Math.max.apply(null, vs.map(function (v) { return v.height; }));
        return { pages: sp, aspect: vs.reduce(function (s2, v) { return s2 + v.width * ph / v.height; }, 0) / ph };
      });
    })).then(function (infos) {
      var n = infos.length, maxA = Math.max.apply(null, infos.map(function (i) { return i.aspect; }));
      var best = null;
      for (var cols = 1; cols <= n; cols++) {
        var rows = Math.ceil(n / cols);
        var cellH = Math.min(H / rows, W / cols / maxA);
        if (!best || cellH > best.cellH) { best = { cols: cols, rows: rows, cellH: cellH }; }
      }
      var gap = best.cellH * 0.04;
      var out = document.createElement('canvas');
      out.width = W; out.height = H;
      var ctx = out.getContext('2d');
      ctx.fillStyle = bgColor || '#2b2d33';
      ctx.fillRect(0, 0, W, H);
      var cellW = W / best.cols, cellHgt = H / best.rows;
      var chain = Promise.resolve();
      infos.forEach(function (info, i) {
        chain = chain.then(function () {
          var h = best.cellH - gap;
          return pdfRenderSpread(doc, info.pages, h).then(function (c) {
            var col = i % best.cols, row = Math.floor(i / best.cols);
            var x = col * cellW + (cellW - c.width) / 2, y = row * cellHgt + (cellHgt - c.height) / 2;
            ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = gap * 0.6;
            ctx.drawImage(c, x, y);
          });
        });
      });
      return chain.then(function () { return out; });
    });
  }

  function arrayBufferToBase64(buf) {
    var bytes = new Uint8Array(buf), bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  // Auswahl-Dialog: Doppelseiten an/aus, Vorschaubilder mit Häkchen.
  // opts: { buffer, isNew, spreads (String "1,3"), double (bool|null) }
  function openPdfBackgroundDialog(opts, onSaved) {
    var overlay = el('div', { class: 'ic-modal-overlay' });
    var panel = el('div', { class: 'ic-add-modal ic-pdf-modal' });
    panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.pdf_title]));
    var status = el('p', { class: 'ic-hint' }, [S.pdf_loading]);
    panel.appendChild(status);
    var controls = el('div', { class: 'ic-pdf-controls' });
    var dblLabel = el('label', { class: 'ic-pdf-double' });
    var dblInput = el('input', { type: 'checkbox' });
    dblLabel.appendChild(dblInput);
    dblLabel.appendChild(document.createTextNode(' ' + S.pdf_double));
    var allBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button' }, [S.pdf_all]);
    var noneBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button' }, [S.pdf_none]);
    controls.appendChild(dblLabel); controls.appendChild(allBtn); controls.appendChild(noneBtn);
    panel.appendChild(controls);
    var grid = el('div', { class: 'ic-pdf-grid' });
    panel.appendChild(grid);
    var bar = el('div', { class: 'ic-pdf-bar' });
    var cancelBtn = el('button', { class: 'ic-btn ic-btn-ghost', type: 'button' }, [S.cancel]);
    var applyBtn = el('button', { class: 'ic-btn ic-btn-primary', type: 'button' }, [S.pdf_apply]);
    applyBtn.disabled = true;
    bar.appendChild(cancelBtn); bar.appendChild(applyBtn);
    panel.appendChild(bar);
    overlay.appendChild(panel);
    root.appendChild(overlay);
    cancelBtn.addEventListener('click', function () { overlay.remove(); });

    var doc = null, spreads = [], selected = {}, renderToken = 0;
    function buildGrid() {
      var token = ++renderToken;
      grid.innerHTML = '';
      spreads.forEach(function (sp, i) {
        var tile = el('label', { class: 'ic-pdf-tile' + (selected[i] ? ' selected' : '') });
        var cb = el('input', { type: 'checkbox' });
        cb.checked = !!selected[i];
        cb.addEventListener('change', function () {
          if (cb.checked) { selected[i] = true; } else { delete selected[i]; }
          tile.classList.toggle('selected', cb.checked);
          applyBtn.disabled = !Object.keys(selected).length;
        });
        var thumb = el('div', { class: 'ic-pdf-thumb' });
        tile.appendChild(thumb);
        tile.appendChild(el('span', { class: 'ic-pdf-tile-label' }, [cb, document.createTextNode(' ' + S.pdf_page + ' ' + sp.join('–'))]));
        grid.appendChild(tile);
        // Vorschaubilder nacheinander (nicht alle gleichzeitig) rendern.
        thumb.dataset.idx = String(i);
      });
      var thumbs = [].slice.call(grid.querySelectorAll('.ic-pdf-thumb'));
      var chain = Promise.resolve();
      thumbs.forEach(function (th, i) {
        chain = chain.then(function () {
          if (token !== renderToken) { return null; }
          return pdfRenderSpread(doc, spreads[i], 110).then(function (c) {
            if (token !== renderToken) { return; }
            c.className = 'ic-pdf-thumb-canvas';
            th.appendChild(c);
          });
        });
      });
      applyBtn.disabled = !Object.keys(selected).length;
    }
    function setDouble(dbl, presetSel) {
      spreads = pdfSpreadsFor(doc.numPages, dbl);
      selected = {};
      if (presetSel) {
        presetSel.split(',').forEach(function (v) { var k = parseInt(v, 10) - 1; if (k >= 0 && k < spreads.length) { selected[k] = true; } });
      }
      if (!Object.keys(selected).length) {
        for (var i = 0; i < Math.min(spreads.length, 6); i++) { selected[i] = true; }
      }
      buildGrid();
    }
    allBtn.addEventListener('click', function () { spreads.forEach(function (sp, i) { selected[i] = true; }); buildGrid(); });
    noneBtn.addEventListener('click', function () { selected = {}; buildGrid(); });
    dblInput.addEventListener('change', function () { setDouble(dblInput.checked, null); });

    loadPdfJs().then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(opts.buffer.slice(0)) }).promise;
    }).then(function (d) {
      doc = d;
      return doc.getPage(1).then(function (pg) {
        var v = pg.getViewport({ scale: 1 });
        var dbl = opts.double != null ? !!opts.double : v.height > v.width;
        dblInput.checked = dbl;
        status.textContent = S.pdf_hint.replace('{$a}', String(doc.numPages));
        setDouble(dbl, opts.spreads || '');
      });
    }).catch(function () { status.textContent = S.pdf_error; });

    applyBtn.addEventListener('click', function () {
      var keys = Object.keys(selected).map(Number).sort(function (a, b) { return a - b; });
      if (!keys.length || !doc) { return; }
      applyBtn.disabled = true;
      status.textContent = S.pdf_rendering;
      var bgColor = (state.background && state.background.color) || '#2b2d33';
      pdfComposeBackground(doc, keys.map(function (k) { return spreads[k]; }), bgColor).then(function (canvas) {
        return callAjax('mod_pinnwand_save_background', {
          cmid: cfg.cmid, type: 'upload', color: bgColor, photoid: 0, url: '',
          imagedata: canvas.toDataURL('image/jpeg', 0.9),
          brightness: (state.background && state.background.brightness) || 100,
          saturation: (state.background && state.background.saturation != null) ? state.background.saturation : 100,
          fit: 'contain',
          pdfdata: opts.isNew ? 'data:application/pdf;base64,' + arrayBufferToBase64(opts.buffer) : '',
          pdfspreads: keys.map(function (k) { return k + 1; }).join(','),
          pdfdouble: dblInput.checked ? 1 : 0
        });
      }).then(function (res) {
        state.background = res.background;
        overlay.remove();
        if (onSaved) { onSaved(); }
      }).catch(function (e) {
        status.textContent = S.error_save + ' (' + (e && e.message) + ')';
        applyBtn.disabled = false;
      });
    });
  }

  function openBackgroundPanel(body) {
    var existing = document.getElementById('ic-bg-panel');
    if (existing) { existing.remove(); return; }

    function bgLayerEl() {
      var wallpaperEl = document.querySelector('.ic-canvas-wallpaper');
      if (wallpaperEl) { applyWallpaperColor(wallpaperEl); }
      return document.querySelector('.ic-canvas-bg');
    }
    function bg() { return state.background || { type: 'color', color: '#2b2d33', brightness: 100, saturation: 100, fit: 'contain' }; }
    function currentBrightness() { return bg().brightness != null ? bg().brightness : 100; }
    function currentSaturation() { return bg().saturation != null ? bg().saturation : 100; }
    function currentFit() { return bg().fit || 'contain'; }
    // Speichert die aktuellen Einstellungen, OHNE das Bild zu ändern (Farbe,
    // Helligkeit, Sättigung, Füllart) - ein gewähltes Hintergrundbild bleibt.
    function persistKeep() {
      var b = bg();
      callAjax('mod_pinnwand_save_background', {
        cmid: cfg.cmid, type: b.type || 'color', color: b.color || '#2b2d33',
        photoid: b.photoid || 0, url: b.type === 'url' ? (b.url || '') : '',
        brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
      }).then(function (res) { state.background = res.background; });
    }
    function chooseImage(p) {
      state.background = { type: 'image', color: bg().color, url: p.url, photoid: p.id, brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit() };
      applyBackground(bgLayerEl());
      callAjax('mod_pinnwand_save_background', {
        cmid: cfg.cmid, type: 'image', color: bg().color, photoid: p.id,
        brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
      }).then(function (res) { state.background = res.background; });
    }

    var panel = el('div', { class: 'ic-bg-panel ic-bg-panel-compact', id: 'ic-bg-panel' });
    var colL = el('div', { class: 'ic-bg-col' });
    var colR = el('div', { class: 'ic-bg-col' });
    panel.appendChild(colL);
    panel.appendChild(colR);

    // --- Farbe (ändert nur die Farbe, das Bild bleibt) + Bild entfernen.
    var colorRow = el('div', { class: 'ic-bg-row' });
    colorRow.appendChild(el('label', {}, [S.bg_color]));
    var colorInput = el('input', { type: 'color', value: bg().color || '#2b2d33' });
    colorInput.addEventListener('input', function () {
      state.background = state.background || {};
      state.background.color = colorInput.value;
      if (!state.background.type) { state.background.type = 'color'; }
      applyBackground(bgLayerEl());
    });
    colorInput.addEventListener('change', persistKeep);
    colorRow.appendChild(colorInput);
    if (bg().type !== 'color') {
      var noImgBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button', title: S.bg_noimage }, ['✕ ' + S.bg_noimage]);
      noImgBtn.addEventListener('click', function () {
        state.background = { type: 'color', color: colorInput.value, url: null, brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit() };
        applyBackground(bgLayerEl());
        callAjax('mod_pinnwand_save_background', {
          cmid: cfg.cmid, type: 'color', color: colorInput.value, photoid: 0,
          brightness: currentBrightness(), saturation: currentSaturation(), fit: currentFit()
        }).then(function (res) { state.background = res.background; panel.remove(); openBackgroundPanel(body); });
      });
      colorRow.appendChild(noImgBtn);
    }
    colL.appendChild(colorRow);

    // --- Eigene Bilder als Streifen.
    if (state.photos.length > 0) {
      colL.appendChild(el('label', {}, [S.bg_image]));
      var row = el('div', { class: 'ic-bg-thumbs' });
      state.photos.forEach(function (p) {
        var t = el('img', { src: p.url, alt: '', class: 'ic-bg-thumb' + (bg().photoid === p.id ? ' active' : '') });
        t.addEventListener('click', function () { chooseImage(p); });
        row.appendChild(t);
      });
      colL.appendChild(row);
    }
    var classSlot = el('div', {});
    colL.appendChild(classSlot);

    // --- Hochladen: Bild / PDF als kompakte Knöpfe, URL in einer Zeile.
    var upRow = el('div', { class: 'ic-bg-row' });
    var uploadInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    var uploadBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button' }, [icon('upload'), el('span', {}, [S.bg_upload_short])]);
    uploadBtn.addEventListener('click', function () { uploadInput.click(); });
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
    var pdfInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none' });
    var pdfBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button' }, [icon('upload'), el('span', {}, [S.bg_pdf])]);
    pdfBtn.addEventListener('click', function () { pdfInput.click(); });
    pdfInput.addEventListener('change', function () {
      var file = pdfInput.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        panel.remove();
        openPdfBackgroundDialog({ buffer: reader.result, isNew: true, spreads: '', double: null }, function () { applyBackground(bgLayerEl()); });
      };
      reader.readAsArrayBuffer(file);
    });
    upRow.appendChild(uploadBtn); upRow.appendChild(uploadInput);
    upRow.appendChild(pdfBtn); upRow.appendChild(pdfInput);
    if (bg().pdfurl) {
      var pdfPagesBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn', type: 'button' }, [S.bg_pdf_pages]);
      pdfPagesBtn.addEventListener('click', function () {
        pdfPagesBtn.disabled = true;
        fetch(bg().pdfurl, { credentials: 'same-origin' }).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
          panel.remove();
          openPdfBackgroundDialog({ buffer: buf, isNew: false, spreads: bg().pdfspreads || '', double: !!bg().pdfdouble },
            function () { applyBackground(bgLayerEl()); });
        }).catch(function () { pdfPagesBtn.disabled = false; alert(S.pdf_error); });
      });
      upRow.appendChild(pdfPagesBtn);
    }
    colR.appendChild(upRow);

    var urlRow = el('div', { class: 'ic-bg-row' });
    var urlInput = el('input', { type: 'url', placeholder: S.bg_url + ' (https://...)', style: 'flex:1;min-width:0' });
    if (bg().type === 'url' && bg().url) { urlInput.value = bg().url; }
    var urlApply = el('button', { class: 'ic-btn ic-btn-primary ic-mini-btn', type: 'button' }, [S.bg_url_apply]);
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
    colR.appendChild(urlRow);

    // --- Helligkeit / Sättigung nebeneinander, Füllart als Umschalter.
    var sliders = el('div', { class: 'ic-bg-sliders' });
    function slider(label, min, max, get, set) {
      var wrap = el('label', { class: 'ic-bg-slider' }, [label]);
      var input = el('input', { type: 'range', min: String(min), max: String(max), value: get() });
      input.addEventListener('input', function () {
        state.background = state.background || {};
        set(parseInt(input.value, 10));
        applyBackground(bgLayerEl());
      });
      input.addEventListener('change', persistKeep);
      wrap.appendChild(input);
      sliders.appendChild(wrap);
    }
    slider(S.bg_brightness, 20, 180, currentBrightness, function (v) { state.background.brightness = v; });
    slider(S.bg_saturation, 0, 200, currentSaturation, function (v) { state.background.saturation = v; });
    colR.appendChild(sliders);

    var fitRow = el('div', { class: 'ic-bg-row' });
    fitRow.appendChild(el('label', {}, [S.bg_fit]));
    [['contain', S.bg_fit_contain], ['cover', S.bg_fit_cover]].forEach(function (opt) {
      var fitBtn = el('button', { class: 'ic-btn ic-mini-btn ' + (currentFit() === opt[0] ? 'ic-btn-primary' : 'ic-btn-ghost'), type: 'button' }, [opt[1]]);
      fitBtn.addEventListener('click', function () {
        state.background = state.background || {};
        state.background.fit = opt[0];
        applyBackground(bgLayerEl());
        persistKeep();
        panel.remove();
        openBackgroundPanel(body);
      });
      fitRow.appendChild(fitBtn);
    });
    // Wie die Präsentation startet (eigene Wahl, sonst Aktivitäts-Einstellung).
    var startRow = el('div', { class: 'ic-bg-row' });
    startRow.appendChild(el('label', {}, [S.startmode]));
    var curStart = bg().startmode || cfg.startmode || 'overview';
    [['overview', S.startmode_overview], ['slide', S.startmode_slide]].forEach(function (opt) {
      var sb = el('button', { class: 'ic-btn ic-mini-btn ' + (curStart === opt[0] ? 'ic-btn-primary' : 'ic-btn-ghost'), type: 'button' }, [opt[1]]);
      sb.addEventListener('click', function () {
        var b = bg();
        callAjax('mod_pinnwand_save_background', {
          cmid: cfg.cmid, type: b.type || 'color', color: b.color || '#2b2d33', photoid: b.photoid || 0,
          url: b.type === 'url' ? (b.url || '') : '', brightness: currentBrightness(), saturation: currentSaturation(),
          fit: currentFit(), startmode: opt[0]
        }).then(function (res) { state.background = res.background; panel.remove(); openBackgroundPanel(body); });
      });
      startRow.appendChild(sb);
    });
    colR.appendChild(startRow);
    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-mini-btn ic-bg-close', type: 'button' }, [S.draw_done]);
    closeBtn.addEventListener('click', function () { panel.remove(); });
    fitRow.appendChild(closeBtn);
    colR.appendChild(fitRow);

    // Bilder aus den Uploads der Klasse (falls berechtigt).
    callAjax('mod_pinnwand_get_all_photos', { cmid: cfg.cmid }).then(function (res) {
      var classPhotos = (res.photos || []).filter(function (p) { return !state.photos.some(function (o) { return o.id === p.id; }); });
      if (!classPhotos.length) { return; }
      classSlot.appendChild(el('label', {}, [S.bg_image_class]));
      var classRow = el('div', { class: 'ic-bg-thumbs' });
      classPhotos.forEach(function (p) {
        var t = el('img', { src: p.url, alt: '', class: 'ic-bg-thumb' + (bg().photoid === p.id ? ' active' : '') });
        t.addEventListener('click', function () { chooseImage(p); });
        classRow.appendChild(t);
      });
      classSlot.appendChild(classRow);
    }).catch(function () { /* keine Berechtigung - Abschnitt weglassen */ });

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
      if (ev.target.closest && ev.target.closest('.ic-pin-toggle, .ic-thread-add-toggle, .ic-blend-toggle')) { return; }
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
      var w = Math.max(60, startW + dx * (item._icResizeRatio || 1));
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
    var editBtn = el('button', { class: 'ic-fab', title: S.editphoto }, [icon('imageedit')]);
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
          var tfLoaded = state.textFrame;
          state.wordArtMode = tfLoaded.isWordArt != null
            ? !!tfLoaded.isWordArt
            : tfLoaded.texts.some(function (t) { return (t.wordartStyle && t.wordartStyle !== 'none') || (t.arcStyle && t.arcStyle !== 'none'); });
        } catch (e) {
          state.textFrame = null;
        }
        resetTfHistory();
        state.editingPhotoId = p.id;
        state.step = 'textframe';
        render();
        return;
      }
      loadPhotoForEditing(p);
    });
    var backsideBtn = el('button', { class: 'ic-fab', title: S.backside }, [icon('rotate')]);
    backsideBtn.addEventListener('click', function () { closeAllPanels('back'); toggleBackPanel(); });
    leftDock.appendChild(gridBtn); leftDock.appendChild(dataBtn); leftDock.appendChild(editBtn); leftDock.appendChild(backsideBtn);
    // Überlagerungsmodus (Mischmodus mit dem Hintergrund) des Bildes.
    var lbBlend = blendModePicker(function () { return state.photos[state.lightboxIndex]; }, null, 'ic-blend-picker-fab');
    leftDock.appendChild(lbBlend);

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
      var lbBlendNew = blendModePicker(function () { return state.photos[state.lightboxIndex]; }, null, 'ic-blend-picker-fab');
      lbBlend.replaceWith(lbBlendNew);
      lbBlend = lbBlendNew;
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
      var annotEditBtn = el('button', { class: 'ic-btn ic-btn-ghost', title: S.editphoto }, [icon('imageedit')]);
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
