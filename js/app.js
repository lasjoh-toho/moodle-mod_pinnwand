/* mod_pinnwand – eigenständige mobiltaugliche App (kein AMD, kein Build-Schritt) */
(function () {
  'use strict';

  var cfg = window.pinnwandConfig || {};
  var S = cfg.strings || {};
  var root = document.getElementById('pinnwand-app');
  if (!root) { return; }

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
    threadPanelOpen: false // Faden-Seitenpanel ein-/ausgeblendet
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
    color: S.step_color, source: S.step_source
  };
  // Diese Schritte gehören zum Hinzufügen-Assistenten - der "Hinzufügen"-
  // Navigationsbutton gilt hier ebenfalls als aktiv.
  var ADD_WIZARD_STEPS = { capture: 1, perspective: 1, crop: 1, color: 1, source: 1 };

  function goToView(step) {
    return function () {
      if (state.step === step) { return; }
      if (ADD_WIZARD_STEPS[state.step] && !ADD_WIZARD_STEPS[step]) { resetCaptureState(); }
      state.step = step;
      render();
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

    var center = el('div', { class: 'ic-topbar-center' }, [
      el('span', { class: 'ic-topbar-title' }, [root.dataset.title || '']),
      el('span', { class: 'ic-topbar-sub' }, [VIEW_LABELS[state.step] || ''])
    ]);
    bar.appendChild(center);

    var right = el('div', { class: 'ic-topbar-right' });
    var navItems = [
      ['arrange', 'pin', S.pinboard],
      ['home', 'person', S.mygallery],
      ['capture', 'camera', S.addphoto]
    ];
    if (state.canmoderate) { navItems.push(['moderate', 'group', S.moderate_mode]); }
    navItems.forEach(function (item) {
      var isActive = state.step === item[0] || (item[0] === 'capture' && ADD_WIZARD_STEPS[state.step]);
      var b = el('button', {
        class: 'ic-icon-btn' + (isActive ? ' active' : ''), title: item[2], 'aria-label': item[2]
      }, [icon(item[1])]);
      b.addEventListener('click', goToView(item[0]));
      right.appendChild(b);
    });
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
  function renderHome(body) {
    var wrap = el('div', { class: 'ic-home' });
    var maxreached = state.maxpictures > 0 && state.photos.length >= state.maxpictures;

    if (maxreached) {
      wrap.appendChild(el('p', { class: 'ic-hint' }, [S.maxreached]));
    }

    var gallery = el('div', { class: 'ic-gallery' });
    state.photos.forEach(function (p, idx) {
      var thumb = el('div', { class: 'ic-thumb' });
      var img = el('img', { src: p.url, alt: '' });
      img.addEventListener('click', function () { openLightbox(idx); });
      thumb.appendChild(img);
      if (state.studentcansend) {
        var pin = el('button', {
          class: 'ic-pin' + (p.hiddenfromboard ? '' : ' active'),
          title: p.hiddenfromboard ? S.sendtoboard : S.removefromboard
        }, ['\u{1F4CC}']);
        pin.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var newHidden = !p.hiddenfromboard;
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: p.id, hidden: newHidden }).then(function () {
            p.hiddenfromboard = newHidden;
            render();
          });
        });
        thumb.appendChild(pin);
      }
      var del = el('button', { class: 'ic-del', html: '&times;' });
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (confirm(S.confirmdelete)) {
          callAjax('mod_pinnwand_delete_photo', { cmid: cfg.cmid, photoid: p.id }).then(function () {
            state.photos.splice(idx, 1);
            render();
          });
        }
      });
      thumb.appendChild(del);
      gallery.appendChild(thumb);
    });
    wrap.appendChild(gallery);
    body.appendChild(wrap);
  }

  // ==================================================================
  // CAPTURE: Live-Kamera (getUserMedia) mit Datei-Upload-Fallback
  // ==================================================================
  function renderCapture(body) {
    var stage = el('div', { class: 'ic-stage' });
    var video = el('video', { autoplay: 'autoplay', playsinline: 'playsinline', muted: 'muted' });
    stage.appendChild(video);
    body.appendChild(stage);

    var fileInput = el('input', {
      type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none'
    });
    fileInput.addEventListener('change', function (ev) {
      var file = ev.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () { loadCapturedImage(img); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    body.appendChild(fileInput);

    var urlRow = el('div', { class: 'ic-url-row', id: 'ic-capture-url-row' });
    var urlInput = el('input', { type: 'url', placeholder: 'https://...' });
    var urlGo = el('button', { class: 'ic-btn ic-btn-primary' }, [S.bg_url_apply]);
    urlGo.addEventListener('click', function () {
      var url = urlInput.value.trim();
      if (!url) { return; }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { loadCapturedImage(img); };
      img.onerror = function () { alert(S.url_load_error); };
      img.src = url;
    });
    urlRow.appendChild(urlInput); urlRow.appendChild(urlGo);
    body.appendChild(urlRow);

    var bar = el('div', { class: 'ic-actionbar' });
    var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.back]);
    backBtn.addEventListener('click', function () { state.step = 'home'; render(); });
    var uploadBtn = el('button', { class: 'ic-btn' }, [S.uploadphoto]);
    uploadBtn.addEventListener('click', function () { fileInput.click(); });
    var urlBtn = el('button', { class: 'ic-btn' + (urlRow.classList.contains('open') ? ' ic-btn-primary' : '') }, [S.addviaurl]);
    urlBtn.addEventListener('click', function () {
      urlRow.classList.toggle('open');
      urlBtn.classList.toggle('ic-btn-primary', urlRow.classList.contains('open'));
    });
    var shootBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [S.takephoto]);
    shootBtn.addEventListener('click', function () {
      if (!state.stream) { fileInput.click(); return; }
      var c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      var img = new Image();
      img.onload = function () { loadCapturedImage(img); };
      img.src = c.toDataURL('image/jpeg', 0.92);
    });
    bar.appendChild(backBtn); bar.appendChild(uploadBtn); bar.appendChild(urlBtn); bar.appendChild(shootBtn);
    body.appendChild(bar);

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then(function (stream) {
          state.stream = stream;
          video.srcObject = stream;
        })
        .catch(function () { /* still allow upload fallback */ });
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
    }
    makeDragOverlay(stage, canvas, state.corners, true);
    stageHint(stage, S.perspective_hint);

    var bar = el('div', { class: 'ic-actionbar' });
    var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.back]);
    backBtn.addEventListener('click', function () { state.step = 'capture'; render(); });
    var nextBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [S.next]);
    nextBtn.addEventListener('click', function () {
      var scaledCorners = state.corners.map(function (p) {
        return { x: p.x / fitScale, y: p.y / fitScale };
      });
      state.workCanvas = applyPerspectiveCorrection(src, scaledCorners);
      state.cropRect = null;
      state.step = 'crop';
      render();
    });
    bar.appendChild(backBtn); bar.appendChild(nextBtn);
    body.appendChild(bar);
  }

  // Passt eine Zielgröße (Quellbild) proportional in den verfügbaren Stage-Bereich ein.
  // Reserviert etwas Rand, damit Ecken-Greifer (r=14) nie vom Stage-Rand abgeschnitten wirken.
  function fitImageToStage(canvas, stage, iw, ih) {
    var rect = stage.getBoundingClientRect();
    var HANDLE_MARGIN = 32;
    var availW = Math.max(200, (rect.width || root.clientWidth) - HANDLE_MARGIN);
    var availH = Math.max(200, (rect.height || (root.clientHeight - 160)) - HANDLE_MARGIN);
    var scale = Math.min(availW / iw, availH / ih, 1);
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
      // Größere, unsichtbare Trefferfläche - so lässt sich der Punkt auch
      // nahe am Bildrand oder mit dem Finger präzise packen ...
      var hit = document.createElementNS(ns, 'circle');
      hit.setAttribute('r', '26');
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
    var stage = el('div', { class: 'ic-stage' });
    var canvas = el('canvas', { class: 'ic-view' });
    stage.appendChild(canvas);
    body.appendChild(stage);

    var src = state.workCanvas;
    var fitScale = fitImageToStage(canvas, stage, src.width, src.height);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);

    if (!state.cropRect) {
      var m = 0.04;
      state.cropRect = [
        { x: canvas.width * m, y: canvas.height * m },
        { x: canvas.width * (1 - m), y: canvas.height * m },
        { x: canvas.width * (1 - m), y: canvas.height * (1 - m) },
        { x: canvas.width * m, y: canvas.height * (1 - m) }
      ];
    }
    makeDragOverlay(stage, canvas, state.cropRect, true);
    stageHint(stage, S.crop_hint);

    var toolRow = el('div', { class: 'ic-crop-tools' });
    var fullBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.usefullimage]);
    fullBtn.addEventListener('click', function () {
      state.cropRect = [
        { x: 0, y: 0 }, { x: canvas.width, y: 0 },
        { x: canvas.width, y: canvas.height }, { x: 0, y: canvas.height }
      ];
      render();
    });
    var rotateBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [icon('rotate'), el('span', {}, [S.rotate90])]);
    rotateBtn.addEventListener('click', function () {
      state.workCanvas = rotateCanvas90(state.workCanvas);
      state.cropRect = null;
      render();
    });
    toolRow.appendChild(fullBtn); toolRow.appendChild(rotateBtn);
    body.appendChild(toolRow);

    var bar = el('div', { class: 'ic-actionbar' });
    var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.back]);
    backBtn.addEventListener('click', function () { state.step = 'perspective'; render(); });
    var nextBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [S.next]);
    nextBtn.addEventListener('click', function () {
      var pts = state.cropRect.map(function (p) { return { x: p.x / fitScale, y: p.y / fitScale }; });
      var minX = Math.min(pts[0].x, pts[3].x), maxX = Math.max(pts[1].x, pts[2].x);
      var minY = Math.min(pts[0].y, pts[1].y), maxY = Math.max(pts[2].y, pts[3].y);
      var w = Math.max(10, maxX - minX), h = Math.max(10, maxY - minY);
      var out = document.createElement('canvas');
      out.width = Math.round(w); out.height = Math.round(h);
      out.getContext('2d').drawImage(src, minX, minY, w, h, 0, 0, out.width, out.height);
      state.finalCanvas = out;
      state.colorSettings = { brightness: 0, contrast: 0, saturation: 0, grayscale: false };
      state.step = 'color';
      render();
    });
    bar.appendChild(backBtn); bar.appendChild(nextBtn);
    body.appendChild(bar);
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

    var bar = el('div', { class: 'ic-actionbar' });
    var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.back]);
    backBtn.addEventListener('click', function () { state.step = 'crop'; render(); });
    var isEditingExisting = !!state.editingPhotoId;
    var nextBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [isEditingExisting ? S.savephoto : S.next]);
    nextBtn.addEventListener('click', function () {
      // Ergebnis fest in finalCanvas übernehmen.
      state.finalCanvas = canvas;
      if (isEditingExisting) {
        nextBtn.disabled = true;
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
          nextBtn.disabled = false;
        });
        return;
      }
      state.step = 'source';
      render();
    });
    bar.appendChild(backBtn); bar.appendChild(nextBtn);
    body.appendChild(bar);
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
    var backBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.back]);
    backBtn.addEventListener('click', function () { state.step = 'color'; render(); });
    var saveBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [S.savephoto]);
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
        sourceorigauthor: info.sourceorigauthor
      }).then(function (res) {
        state.photos.push({
          id: res.photoid, url: res.url, gridtype: 'none', gridvalue: 0, gridcolor: '#ff3c3c',
          consent: !!consentChecked, annotationdata: '[]', hiddenfromboard: !!res.hiddenfromboard,
          annotationonboard: true,
          sourcetitle: info.sourcetitle,
          sourceauthor: info.sourceauthor, sourceyear: info.sourceyear, sourceepoch: info.sourceepoch,
          sourceplace: info.sourceplace, sourceorigauthor: info.sourceorigauthor,
          timecreated: Math.floor(Date.now() / 1000),
          canvasx: 20, canvasy: 20, canvasw: 220, canvasrot: 0, canvasz: state.photos.length
        });
        state.maxpictures = res.max;
        resetCaptureState();
        state.step = res.maxreached ? 'arrange' : 'home';
        render();
      }).catch(function (e) {
        alert(S.error_save + ' (' + e.message + ')');
        saveBtn.disabled = false;
      });
    });
    bar.appendChild(backBtn); bar.appendChild(saveBtn);
    body.appendChild(bar);
  }

  function resetCaptureState() {
    state.sourceCanvas = null;
    state.corners = null;
    state.workCanvas = null;
    state.cropRect = null;
    state.finalCanvas = null;
    state.editingPhotoId = null;
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
  var INK_COLORS = ['#ef4444', '#111111', '#2563eb', '#22c55e', '#facc15', '#ffffff'];
  var INK_SIZES = [4, 10, 20, 36];

  // Icons für die Zeichenwerkzeuge (dieselben Pfade wie im Bento-Ink-Tool,
  // damit sich das Design vertraut anfühlt). "text" bleibt bewusst ein
  // simpler Buchstabe, genau wie im Original.
  var ICON_SVG = {
    pen: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H8l-6-6a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l7 7a2 2 0 0 1 0 2.8L13 20"/><path d="M6 13l6 6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c-3 0-5.5 2.4-5.5 5.5 0 4 5.5 10.5 5.5 10.5s5.5-6.5 5.5-10.5C17.5 4.4 15 2 12 2z"/><circle cx="12" cy="7.5" r="2"/></svg>',
    group: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6"/><circle cx="18" cy="8.5" r="2.3"/><path d="M15.5 14.2c2.7.4 4.5 2.6 4.5 5.3"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 3 6.7"/><polyline points="3 21 3 15 9 15"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    courseback: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
    scissors: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="8.5" y1="8" x2="20" y2="19"/><line x1="8.5" y1="16" x2="20" y2="5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    brush: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 3 21"/><path d="M14 3c2 0 4 2 4 4 0 3-3 4-5 6l-4 4-3-3 4-4c2-2 3-5 6-5 0 0 0-2-2-2z"/></svg>',
    arrowleft: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
    thumbtack: '<svg viewBox="0 0 1502 1502" width="16" height="16" fill="currentColor"><path d="M887.379 265.37c-71.92 39.67-90.783 153.676-73.858 220.443 25.373 89.642 120.263 184.87 208.333 223.115 88.825 39.357 213.79 19.878 236.138-70.095 17.062-70.586-14.408-161.368-105.1-252.481-51.592-61.787-195.222-150.364-265.514-120.983zm230.112 132.709c146.728 158.437 175.269 364.057-102.498 170.535-34.831-24.267-35.33-25.11-63.176-61.653-180.218-260.581 36.104-234.896 165.675-108.882zm-427.136 211.52c-30.14 129.742 141.096 224.808 206.885 226.635l115.713-114.768s-15.115-7.428-22.352-9.622c-95.305-35.201-153.483-115.01-186.185-198.223zM485.279 724.858c11.704 135.014 160.179 270.964 278.146 298.044 94.23 22.034 149.97-90.424 137.659-165.743-124.499-1.779-264.574-142.482-229.575-240.563-75.865-20.138-185.011 41.747-186.23 108.261zm-183.466 469.254c-10.709 15.142 2.074 28.789 19.1 14.38l288.835-244.45c-32.143-18.286-42.019-27.02-60.405-61.83 0 0-161.602 197.241-247.53 291.9z"/></svg>',
    hand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V6a2 2 0 0 0-4 0v10"/><path d="M6 14l-1.5-1.8a1.8 1.8 0 0 0-2.7 2.3L6 21h9a4 4 0 0 0 4-4v-5a2 2 0 0 0-4 0"/></svg>',
    thread: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e0503f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="6" r="1.6" fill="#e0503f"/><circle cx="20" cy="18" r="1.6" fill="#e0503f"/><path d="M4 6c4 0 2 6 6 6s2-6 6-6 2 6 4 6"/></svg>'
  };
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

  function renderArrange(body) {
    var wrap = el('div', { class: 'ic-canvas-wrap' + (cfg.boardpannable ? ' pannable' : '') });
    var panZoomLayer = el('div', { class: 'ic-canvas-panzoom' });
    var bgLayer = el('div', { class: 'ic-canvas-bg' });
    panZoomLayer.appendChild(bgLayer);
    applyBackground(bgLayer);
    var canvas = el('div', { class: 'ic-arrange-canvas' });
    panZoomLayer.appendChild(canvas);
    wrap.appendChild(panZoomLayer);
    body.appendChild(wrap);

    function applyBoardTransform() {
      panZoomLayer.style.transform =
        'translate(' + state.boardPanX + 'px,' + state.boardPanY + 'px) scale(' + state.boardZoom + ')';
    }
    applyBoardTransform();

    // Nur Fotos zeigen, die nicht ausgeblendet sind UND zum aktuell
    // gewählten Board gehören (Mehrfach-Boards, siehe Board-Leiste unten).
    var visible = state.photos.filter(function (p) {
      return !p.hiddenfromboard && (p.boardid || 0) === state.currentBoard;
    });

    visible.forEach(function (p) {
      var item = el('div', {
        class: 'ic-arrange-item',
        style: 'left:' + p.canvasx + 'px;top:' + p.canvasy + 'px;width:' + p.canvasw + 'px;' +
          'transform:rotate(' + (p.canvasrot || 0) + 'deg)'
      });
      item.style.zIndex = p.canvasz || 0;
      var img = el('img', { src: p.url, alt: '' });
      item.appendChild(img);

      // Pin/Unpin direkt auf dem Board (Vorgabe-Icon) - von der Pinnwand
      // entfernen blendet das Foto hier sofort aus (bleibt in "Meine Bilder").
      var pinToggle = null;
      if (state.studentcansend) {
        pinToggle = el('button', { class: 'ic-pin-toggle', title: S.removefromboard }, [icon('thumbtack')]);
        pinToggle.addEventListener('click', function (ev) {
          ev.stopPropagation();
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: p.id, hidden: true }).then(function () {
            p.hiddenfromboard = true;
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
              state.threads = state.threads.filter(function (t) { return !t.isown; });
              state.threads.push({ id: res.threadid, color: res.color, isown: true, items: res.items });
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
      makeMovable(item, canvas, function (x, y) {
        p.canvasx = x; p.canvasy = y; moved = true;
      }, function () {
        if (moved) { persistLayout(p); moved = false; }
        else if (state.boardDrawMode) { openLightbox(state.photos.indexOf(p), true); }
        else { openLightbox(state.photos.indexOf(p)); }
      });
      makeResizable(resize, item, function (w) {
        p.canvasw = w;
      }, function () { persistLayout(p); });
      makeRotatable(rotateHandle, item, function (deg) {
        p.canvasrot = deg;
      }, function () { persistLayout(p); });
    });

    // ---- Board-Leiste: Umschalten zwischen mehreren Pinnwänden ----
    var boards = boardList();
    var boardIdx = boards.indexOf(state.currentBoard);
    var boardBar = el('div', { class: 'ic-board-bar' });
    var prevBoard = el('button', { class: 'ic-icon-btn', title: S.back }, ['\u2039']);
    prevBoard.disabled = boardIdx <= 0;
    prevBoard.addEventListener('click', function () { state.currentBoard = boards[boardIdx - 1]; render(); });
    var boardLabel = el('span', { class: 'ic-board-label' },
      [S.boardof.replace('{cur}', boardIdx + 1).replace('{total}', boards.length)]);
    var nextBoard = el('button', { class: 'ic-icon-btn', title: S.next }, ['\u203A']);
    nextBoard.disabled = boardIdx >= boards.length - 1;
    nextBoard.addEventListener('click', function () { state.currentBoard = boards[boardIdx + 1]; render(); });
    var addBoard = el('button', { class: 'ic-icon-btn', title: S.newboard }, ['+']);
    addBoard.addEventListener('click', function () {
      state.currentBoard = Math.max.apply(null, boards) + 1;
      render();
    });
    boardBar.appendChild(prevBoard); boardBar.appendChild(boardLabel);
    boardBar.appendChild(nextBoard); boardBar.appendChild(addBoard);
    body.appendChild(boardBar);
    if (visible.length >= BOARD_CAPACITY) {
      var fullHint = el('div', { class: 'ic-board-full-hint' }, [S.boardfull_confirm]);
      fullHint.addEventListener('click', function () {
        if (confirm(S.boardfull_confirm)) { state.currentBoard = Math.max.apply(null, boards) + 1; render(); }
      });
      body.appendChild(fullHint);
    }

    // ---- Hand-Werkzeug + Zoom-Regler (nur wenn Aktivität es erlaubt) ----
    if (cfg.boardpannable) {
      var panBar = el('div', { class: 'ic-pan-bar' });
      var handBtn = el('button', {
        class: 'ic-icon-btn' + (state.boardPanMode ? ' active' : ''), title: S.pantool
      }, [icon('hand')]);
      handBtn.addEventListener('click', function () {
        state.boardPanMode = !state.boardPanMode;
        wrap.classList.toggle('pan-active', state.boardPanMode);
        handBtn.classList.toggle('active', state.boardPanMode);
      });
      var zoomSlider = el('input', {
        type: 'range', min: '50', max: '200', step: '5', value: String(Math.round(state.boardZoom * 100)),
        class: 'ic-zoom-slider'
      });
      zoomSlider.addEventListener('input', function () {
        state.boardZoom = (parseInt(zoomSlider.value, 10) || 100) / 100;
        applyBoardTransform();
      });
      panBar.appendChild(handBtn);
      panBar.appendChild(zoomSlider);
      body.appendChild(panBar);

      // Ziehen auf leerer Fläche (nicht auf einem Foto) verschiebt die
      // Ansicht, solange das Hand-Werkzeug aktiv ist.
      var panDragging = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
      wrap.addEventListener('pointerdown', function (ev) {
        if (!state.boardPanMode) { return; }
        panDragging = true;
        panStartX = ev.clientX; panStartY = ev.clientY;
        panOrigX = state.boardPanX; panOrigY = state.boardPanY;
      });
      wrap.addEventListener('pointermove', function (ev) {
        if (!panDragging) { return; }
        state.boardPanX = panOrigX + (ev.clientX - panStartX);
        state.boardPanY = panOrigY + (ev.clientY - panStartY);
        applyBoardTransform();
      });
      window.addEventListener('pointerup', function () { panDragging = false; });
    }

    // Schwebende runde Icon-Buttons unten mittig (transparent/geblurrt,
    // siehe .ic-fab in CSS) - Overlay-Werkzeuge der Galerie (Raster/Daten/
    // Zeichnen) bleiben davon bewusst getrennt (eigene linke Dock-Leiste dort).
    var fabRow = el('div', { class: 'ic-fab-row' });

    var gearBtn = el('button', { class: 'ic-fab', title: S.options }, ['\u2699']);
    gearBtn.addEventListener('click', function () { openBackgroundPanel(body); });
    fabRow.appendChild(gearBtn);

    var dataBtn = el('button', { class: 'ic-fab' + (state.showData ? ' active' : ''), title: state.showData ? S.hidedata : S.showdata }, ['\u{1F3F7}']);
    dataBtn.addEventListener('click', function () { state.showData = !state.showData; render(); });
    fabRow.appendChild(dataBtn);

    // Zeichnen-Werkzeug direkt auf der Pinnwand: solange aktiv, öffnet ein
    // Tippen auf ein Foto direkt den Zeichenmodus (statt der normalen
    // Ansicht) - siehe openLightbox(index, startDrawing) weiter unten.
    var drawBtn = el('button', { class: 'ic-fab' + (state.boardDrawMode ? ' active' : ''), title: S.drawonboard }, [icon('pen')]);
    drawBtn.addEventListener('click', function () { state.boardDrawMode = !state.boardDrawMode; render(); });
    fabRow.appendChild(drawBtn);

    // Roter Faden: Seitenpanel rechts (siehe renderThreadPanel) ein-/ausblenden.
    if (state.canusethreads || state.threads.length > 0) {
      var threadBtn = el('button', { class: 'ic-fab' + (state.threadPanelOpen ? ' active' : ''), title: S.thread }, [icon('thread')]);
      threadBtn.addEventListener('click', function () { state.threadPanelOpen = !state.threadPanelOpen; render(); });
      fabRow.appendChild(threadBtn);
    }

    var maxreached = state.maxpictures > 0 && state.photos.length >= state.maxpictures;
    var addBtn = el('button', { class: 'ic-fab ic-fab-primary', title: S.addphoto, disabled: maxreached ? 'disabled' : null }, ['+']);
    addBtn.addEventListener('click', function () { if (!maxreached) { state.step = 'capture'; render(); } });
    fabRow.appendChild(addBtn);

    body.appendChild(fabRow);

    if (state.threadPanelOpen) { body.appendChild(renderThreadPanel()); }
  }

  // ------------------------------------------------------------------
  // ROTER FADEN: Seitenpanel mit den Stationen des eigenen Fadens
  // (Fotos + Leerrahmen), per Drag umsortierbar, plus - falls vorhanden -
  // schreibgeschützte Ansicht des Fadens der Lehrkraft.
  // ------------------------------------------------------------------
  function ownThread() {
    for (var i = 0; i < state.threads.length; i++) { if (state.threads[i].isown) { return state.threads[i]; } }
    return null;
  }
  function sharedThread() {
    for (var i = 0; i < state.threads.length; i++) { if (!state.threads[i].isown) { return state.threads[i]; } }
    return null;
  }

  function threadItemLabel(item) {
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
      var row = el('div', { class: 'ic-thread-item', draggable: editable ? 'true' : null });
      var photo = item.itemtype === 'photo'
        ? state.photos.filter(function (p) { return p.id === item.photoid; })[0] : null;
      if (photo) {
        row.appendChild(el('img', { src: photo.url, alt: '' }));
      } else {
        row.appendChild(el('div', { class: 'ic-thread-frame-thumb' }, ['\u2b1a']));
      }
      row.appendChild(el('span', { class: 'ic-thread-item-label' }, [threadItemLabel(item)]));
      if (editable) {
        var rm = el('button', { class: 'ic-thread-remove', title: S.removefromthread }, ['\u2715']);
        rm.addEventListener('click', function () {
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
          var moved = thread.items.splice(dragFromIdx, 1)[0];
          thread.items.splice(idx, 0, moved);
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

  function renderThreadPanel() {
    var panel = el('div', { class: 'ic-thread-panel' });
    var own = ownThread();
    var shared = sharedThread();

    panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.thread]));
    panel.appendChild(renderThreadList(own, true));

    if (state.canusethreads) {
      var actions = el('div', { class: 'ic-thread-actions' });
      var addFrameBtn = el('button', { class: 'ic-btn ic-btn-ghost' }, [S.addframetothread]);
      addFrameBtn.addEventListener('click', function () {
        var label = prompt(S.addframetothread, '') || '';
        callAjax('mod_pinnwand_add_thread_item', {
          cmid: cfg.cmid, itemtype: 'frame', boardid: state.currentBoard,
          framex: 40, framey: 40, framew: 240, frameh: 180, framelabel: label
        }).then(function (res) {
          state.threads = state.threads.filter(function (t) { return !t.isown; });
          state.threads.push({ id: res.threadid, color: res.color, isown: true, items: res.items });
          render();
        });
      });
      actions.appendChild(addFrameBtn);
      if (own && own.items.length > 0) {
        var presentBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [S.presentthread]);
        presentBtn.addEventListener('click', function () { openPresentation(own); });
        actions.appendChild(presentBtn);
        var delBtn = el('button', { class: 'ic-btn ic-btn-danger' }, [S.deletethread]);
        delBtn.addEventListener('click', function () {
          if (confirm(S.confirmdeletethread)) {
            callAjax('mod_pinnwand_delete_thread', { cmid: cfg.cmid }).then(function () {
              state.threads = state.threads.filter(function (t) { return !t.isown; });
              render();
            });
          }
        });
        actions.appendChild(delBtn);
      }
      panel.appendChild(actions);
    }

    if (shared) {
      panel.appendChild(el('h2', { class: 'ic-thread-panel-title' }, [S.teacherthread]));
      panel.appendChild(renderThreadList(shared, false));
      if (shared.items.length > 0) {
        var presentSharedBtn = el('button', { class: 'ic-btn ic-btn-primary' }, [S.presentthread]);
        presentSharedBtn.addEventListener('click', function () { openPresentation(shared); });
        panel.appendChild(presentSharedBtn);
      }
    }

    return panel;
  }

  // ------------------------------------------------------------------
  // PRÄSENTATION: verbundene Stationen eines Fadens als impress.js-Ablauf.
  // Bewusst einfach gehalten: Position/Größe kommen direkt von den
  // Board-Koordinaten (Fotos) bzw. den gespeicherten Rahmen-Koordinaten -
  // kein separates Editieren der Kamerafahrt.
  // ------------------------------------------------------------------
  var impressScriptPromise = null;
  function loadImpress() {
    if (window.impress) { return Promise.resolve(); }
    if (!impressScriptPromise) {
      impressScriptPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = cfg.impressurl;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return impressScriptPromise;
  }

  function openPresentation(thread) {
    if (window.innerWidth < 900) { alert(S.present_smallscreen); return; }
    loadImpress().then(function () {
      var overlay = el('div', { class: 'ic-present-overlay' });
      var impressRoot = el('div', { id: 'pinnwand-impress' });
      var canvasEl = el('div', { class: 'step', id: 'ic-present-start', 'data-x': '0', 'data-y': '0' });
      impressRoot.appendChild(canvasEl);

      thread.items.forEach(function (item, idx) {
        var x, y, w;
        if (item.itemtype === 'frame') {
          x = item.framex; y = item.framey; w = item.framew;
        } else {
          var photo = state.photos.filter(function (p) { return p.id === item.photoid; })[0];
          if (!photo) { return; }
          x = photo.canvasx; y = photo.canvasy; w = photo.canvasw;
        }
        var scale = Math.max(0.4, Math.min(2.5, w / 400));
        var step = el('div', {
          class: 'step', id: 'ic-present-step-' + idx,
          'data-x': String(x + w / 2), 'data-y': String(y + (w * 0.7) / 2), 'data-scale': String(scale)
        });
        if (item.itemtype === 'frame') {
          step.classList.add('ic-present-frame');
          if (item.framelabel) { step.appendChild(el('div', { class: 'ic-present-frame-label' }, [item.framelabel])); }
        } else {
          var photo2 = state.photos.filter(function (p) { return p.id === item.photoid; })[0];
          step.appendChild(el('img', { src: photo2.url, alt: '' }));
        }
        impressRoot.appendChild(step);
      });

      var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost ic-present-close', title: S.exitpresent }, ['\u2715']);
      var prevBtn = el('button', { class: 'ic-btn ic-present-nav ic-present-prev' }, ['\u2039']);
      var nextBtn = el('button', { class: 'ic-btn ic-present-nav ic-present-next' }, ['\u203A']);

      overlay.appendChild(impressRoot);
      overlay.appendChild(closeBtn);
      overlay.appendChild(prevBtn);
      overlay.appendChild(nextBtn);
      document.body.appendChild(overlay);

      var api = window.impress('pinnwand-impress');
      api.init();
      prevBtn.addEventListener('click', function () { api.prev(); });
      nextBtn.addEventListener('click', function () { api.next(); });
      closeBtn.addEventListener('click', function () {
        api.tear();
        document.body.classList.remove('impress-enabled', 'impress-disabled', 'impress-supported', 'impress-not-supported');
        overlay.remove();
      });
    });
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
      var span = b.querySelector('span');
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
    var ownSpan = ownBtn.querySelector('span');
    function refreshOwnBtn() {
      ownBtn.classList.toggle('active', filterOwn !== 0);
      ownSpan.textContent = filterOwn === 1 ? S.filter_own_mine : filterOwn === 2 ? S.filter_own_others : S.filter_own;
      ownBtn.title = ownSpan.textContent;
    }
    ownBtn.addEventListener('click', function () { filterOwn = (filterOwn + 1) % 3; refreshOwnBtn(); renderList(); });
    refreshOwnBtn();
    toolbar.appendChild(ownBtn);

    var boardBtn = toolBtn('pin', S.filter_board);
    var boardSpan = boardBtn.querySelector('span');
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
      var row = el('div', { class: 'ic-moderate-row' });
      var thumbWrap = el('div', { class: 'ic-moderate-thumb' });
      var img = el('img', { src: p.url, alt: '' });
      thumbWrap.appendChild(img);

      // Kompakte Overlay-Steuerung direkt auf dem Thumbnail (nur schmale
      // Bildschirme sichtbar) - auf breiten Bildschirmen bleiben die
      // ausführlichen Steuerelemente weiter unten in der Zeile aktiv.
      if (candelete && state.teachercansend) {
        var pinOverlay = el('button', {
          class: 'ic-thumb-btn ic-thumb-btn-pin' + (p.hiddenfromboard ? '' : ' active'),
          title: p.hiddenfromboard ? S.sendtoboard : S.removefromboard
        }, [icon('pin')]);
        pinOverlay.addEventListener('click', function () {
          var newHidden = !p.hiddenfromboard;
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: p.id, hidden: newHidden }).then(function () {
            p.hiddenfromboard = newHidden;
            pinOverlay.classList.toggle('active', !p.hiddenfromboard);
            pinOverlay.title = p.hiddenfromboard ? S.sendtoboard : S.removefromboard;
            if (typeof pinCheck !== 'undefined') { pinCheck.checked = !p.hiddenfromboard; }
          });
        });
        thumbWrap.appendChild(pinOverlay);
      }
      if (candelete) {
        var delOverlay = el('button', { class: 'ic-thumb-btn ic-thumb-btn-del', html: '&times;' });
        delOverlay.addEventListener('click', function () {
          if (!confirm(S.deletephoto_confirm_other)) { return; }
          callAjax('mod_pinnwand_delete_photo', { cmid: cfg.cmid, photoid: p.id }).then(function () {
            row.remove();
          });
        });
        thumbWrap.appendChild(delOverlay);
      }
      row.appendChild(thumbWrap);
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
        var meLabel = el('label', { class: 'ic-me-check' });
        var meCheck = el('input', { type: 'checkbox' });
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
        meLabel.appendChild(document.createTextNode(S.student_is_author));
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

      if (candelete && state.teachercansend) {
        var pinLabel = el('label', { class: 'ic-me-check ic-wide-only' });
        var pinCheck = el('input', { type: 'checkbox' });
        pinCheck.checked = !p.hiddenfromboard;
        pinCheck.addEventListener('change', function () {
          var newHidden = !pinCheck.checked;
          callAjax('mod_pinnwand_set_photo_hidden', { cmid: cfg.cmid, photoid: p.id, hidden: newHidden }).then(function () {
            p.hiddenfromboard = newHidden;
          }).catch(function () { pinCheck.checked = !pinCheck.checked; });
        });
        pinLabel.appendChild(pinCheck);
        pinLabel.appendChild(document.createTextNode(S.pinboard));
        meta.appendChild(pinLabel);
      }
      row.appendChild(meta);

      if (candelete) {
        var del = el('button', { class: 'ic-btn ic-btn-danger ic-wide-only' }, ['\u2715']);
        del.addEventListener('click', function () {
          if (!confirm(S.deletephoto_confirm_other)) { return; }
          callAjax('mod_pinnwand_delete_photo', { cmid: cfg.cmid, photoid: p.id }).then(function () {
            row.remove();
          });
        });
        row.appendChild(del);
      }
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
          group.photos.forEach(function (p) { renderRow(section, p, lastRes.canedit, lastRes.candelete); });
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
      cmid: cfg.cmid, photoid: p.id, x: p.canvasx, y: p.canvasy, w: p.canvasw, rot: p.canvasrot || 0, z: p.canvasz || 0
    }).catch(function () { /* still keep local state */ });
  }

  // ------------------------------------------------------------------
  // Hintergrund der Anordnungs-Leinwand: Farbe (Standard dunkelgrau) oder
  // eines der eigenen Fotos als Bild. Pro Nutzer*in/Aktivität gespeichert.
  // ------------------------------------------------------------------
  function applyBackground(bgEl) {
    var bg = state.background || { type: 'color', color: '#2b2d33' };
    if ((bg.type === 'image' || bg.type === 'url' || bg.type === 'upload') && bg.url) {
      // Die gewählte Farbe bleibt als Basis gesetzt, damit sie durchscheint,
      // falls das Bild transparent ist oder den Hintergrund nicht ganz füllt.
      bgEl.style.backgroundColor = bg.color || '#2b2d33';
      bgEl.style.backgroundImage = "url('" + bg.url + "')";
      // "contain" statt "cover": das Bild wird nie beschnitten, füllt die
      // Fläche so gut es geht - der Rest bleibt in der gewählten Farbe sichtbar.
      bgEl.style.backgroundSize = 'contain';
      bgEl.style.backgroundRepeat = 'no-repeat';
      bgEl.style.backgroundPosition = 'center';
    } else {
      bgEl.style.backgroundImage = 'none';
      bgEl.style.backgroundColor = bg.color || '#2b2d33';
    }
    var brightness = (bg.brightness != null ? bg.brightness : 100);
    var saturation = (bg.saturation != null ? bg.saturation : 100);
    bgEl.style.filter = 'brightness(' + brightness + '%) saturate(' + saturation + '%)';
  }

  function openBackgroundPanel(body) {
    var existing = document.getElementById('ic-bg-panel');
    if (existing) { existing.remove(); return; }

    function bgLayerEl() { return document.querySelector('.ic-canvas-bg'); }
    function currentBrightness() { return (state.background && state.background.brightness != null) ? state.background.brightness : 100; }
    function currentSaturation() { return (state.background && state.background.saturation != null) ? state.background.saturation : 100; }

    var panel = el('div', { class: 'ic-bg-panel', id: 'ic-bg-panel' });
    panel.appendChild(el('label', {}, [S.bg_color]));
    var colorInput = el('input', { type: 'color', value: (state.background && state.background.color) || '#2b2d33' });
    colorInput.addEventListener('input', function () {
      state.background = { type: 'color', color: colorInput.value, url: null, brightness: currentBrightness(), saturation: currentSaturation() };
      applyBackground(bgLayerEl());
    });
    colorInput.addEventListener('change', function () {
      callAjax('mod_pinnwand_save_background', {
        cmid: cfg.cmid, type: 'color', color: colorInput.value, photoid: 0,
        brightness: currentBrightness(), saturation: currentSaturation()
      }).then(function (res) { state.background = res.background; });
    });
    panel.appendChild(colorInput);

    if (state.photos.length > 0) {
      panel.appendChild(el('label', { style: 'margin-top:10px' }, [S.bg_image]));
      var row = el('div', { class: 'ic-bg-thumbs' });
      state.photos.forEach(function (p) {
        var t = el('img', { src: p.url, alt: '', class: 'ic-bg-thumb' });
        t.addEventListener('click', function () {
          state.background = { type: 'image', color: colorInput.value, url: p.url, brightness: currentBrightness(), saturation: currentSaturation() };
          applyBackground(bgLayerEl());
          callAjax('mod_pinnwand_save_background', {
            cmid: cfg.cmid, type: 'image', color: colorInput.value, photoid: p.id,
            brightness: currentBrightness(), saturation: currentSaturation()
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
      state.background = { type: 'url', color: colorInput.value, url: url, brightness: currentBrightness(), saturation: currentSaturation() };
      applyBackground(bgLayerEl());
      callAjax('mod_pinnwand_save_background', {
        cmid: cfg.cmid, type: 'url', color: colorInput.value, photoid: 0, url: url,
        brightness: currentBrightness(), saturation: currentSaturation()
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
          brightness: currentBrightness(), saturation: currentSaturation()
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
        brightness: currentBrightness(), saturation: currentSaturation()
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

    var closeBtn = el('button', { class: 'ic-btn ic-btn-ghost', style: 'margin-top:10px' }, [S.draw_done]);
    closeBtn.addEventListener('click', function () { panel.remove(); });
    panel.appendChild(closeBtn);

    body.appendChild(panel);
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
      if (except !== 'draw' && drawing) { exitDrawing(true); }
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
      var img = new Image();
      img.onload = function () {
        state.editingPhotoId = p.id;
        loadCapturedImage(img);
      };
      img.onerror = function () { alert(S.url_load_error); };
      img.src = p.url;
    });
    leftDock.appendChild(gridBtn); leftDock.appendChild(dataBtn); leftDock.appendChild(editBtn);

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
      if (existing) { existing.remove(); return; }

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
      closeBtn.addEventListener('click', function () { panel.remove(); });
      panel.appendChild(closeBtn);

      lb.appendChild(panel);
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
      if (existing) { existing.remove(); return; }

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
      closeBtn.addEventListener('click', function () { panel.remove(); });
      panel.appendChild(closeBtn);

      lb.appendChild(panel);
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
      var old = imgbox.querySelector('.ic-annot-layer');
      if (old) { old.remove(); }

      var p = state.photos[state.lightboxIndex];
      strokes = parseStrokes(p);
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

      var toolbar = el('div', { class: 'ic-ink-dock' });
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
      // Stift, Text-Werkzeug und Größen-Punkte übernehmen die gewählte Farbe,
      // damit auf einen Blick klar ist, mit welcher Farbe gerade gezeichnet wird.
      function updateToolColor() {
        penBtn.style.color = inkColor;
        textBtn.style.color = inkColor;
        toolbar.querySelectorAll('.ic-ink-size span').forEach(function (dot) { dot.style.background = inkColor; });
      }
      INK_COLORS.forEach(function (c) {
        var sw = el('button', {
          class: 'ic-ink-swatch' + (c === inkColor ? ' active' : ''), style: 'background:' + c
        });
        sw.addEventListener('click', function () {
          inkColor = c;
          colorRow.querySelectorAll('.ic-ink-swatch').forEach(function (s) { s.classList.remove('active'); });
          sw.classList.add('active');
          updateToolColor();
        });
        colorRow.appendChild(sw);
      });
      toolbar.appendChild(colorRow);

      var sizeRow = el('div', { class: 'ic-ink-dock-row' });
      INK_SIZES.forEach(function (sz) {
        var b = el('button', { class: 'ic-ink-size' + (sz === inkSize ? ' active' : '') },
          [el('span', { style: 'width:' + Math.min(sz, 18) + 'px;height:' + Math.min(sz, 18) + 'px' })]);
        b.addEventListener('click', function () {
          inkSize = sz;
          sizeRow.querySelectorAll('.ic-ink-size').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        });
        sizeRow.appendChild(b);
      });
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
      }, [icon('pin')]);
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
        inkCanvas.remove(); inkCanvas = null; inkCtx = null;
      }
      currentStroke = null;
      drawing = false;
      stylusBtn.classList.remove('active');
      stylusBtn.onclick = function () { closeAllPanels('draw'); enterDrawing(); };
      renderStaticAnnotation(p);
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
    if (startDrawing) { closeAllPanels('draw'); enterDrawing(); }
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

    // Lehrkräfte landen direkt in der für die Bildschirmgröße passenden
    // Übersicht - große Bildschirme in der Pinnwand, kleine (mobile) in der
    // Klassenansicht. Im Kurs-Bearbeiten-Modus bleibt es beim normalen Menü,
    // damit die Aktivitätseinstellungen weiterhin erreichbar sind.
    if (state.canmoderate && !cfg.isediting) {
      state.step = window.innerWidth >= 900 ? 'arrange' : 'moderate';
    }
    render();
    callAjax('mod_pinnwand_get_threads', { cmid: cfg.cmid }).then(function (res) {
      state.threads = res.threads || [];
      state.canusethreads = !!res.canuse;
      if (state.step === 'arrange') { render(); }
    }).catch(function () { /* Fäden bleiben leer, Board funktioniert trotzdem */ });
  }).catch(function () {
    render();
  });

})();
