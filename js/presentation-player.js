/* mod_pinnwand – gemeinsame Präsentations-Navigation.
 *
 * EINE Umsetzung für beide Orte, an denen ein Roter Faden abgespielt wird:
 *  - die Live-Präsentation innerhalb von Moodle (openPresentation() in
 *    app.js, per <script> vor app.js geladen) und
 *  - die exportierte, eigenständige HTML-Datei (export_presentation.php
 *    bettet GENAU DIESE Datei wörtlich ein).
 * Vorher gab es zwei getrennt gepflegte Kopien, die mit der Zeit
 * auseinandergelaufen sind (z.B. fehlten in Moodle die Klickzonen am
 * linken/rechten Bildschirmrand und der Bedienhinweis). Kamera, Schritte,
 * Verdeckung, Stapel-Fortschrittsanzeige, Tastatur, Klickzonen, Ziehen,
 * Mausrad und Pinch sind dadurch garantiert identisch.
 *
 * Kein Build-Schritt, keine Abhängigkeiten, ES5 - läuft in Moodle und als
 * lokale Datei gleichermaßen.
 *
 * Verwendung:
 *   var player = PinnwandPresentation.create(rootEl, { labels: {...}, onEscape: fn });
 *   // Hintergrund/Fotos/Rahmen in player.stage / player.canvas einfügen
 *   player.start(steps, occludables, startIndex);
 * steps:       [{ cx, cy, w, h, rot, z, overview, frame, el, previewUrl }]
 *              (Board-Koordinaten, w/h = Bereich, der den Bildschirm füllen soll)
 * occludables: [{ el, z }] - Objekte, die ausgeblendet werden, sobald sie
 *              über (höheres z) der aktiven Station liegen.
 */
(function (global) {
  'use strict';

  var CSS = [
    '.pwp-root{position:fixed;inset:0;overflow:hidden;font-family:sans-serif;}',
    '.pwp-stage{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;}',
    '.pwp-stage.pwp-dragging{cursor:grabbing;}',
    '.pwp-canvas{position:absolute;left:0;top:0;transform-origin:0 0;z-index:1;}',
    '.pwp-occluded{opacity:0 !important;pointer-events:none !important;}',
    '.pwp-hint{position:fixed;top:16px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.55);',
    'padding:6px 16px;border-radius:20px;font-size:.85rem;z-index:20;pointer-events:none;transition:opacity 1s;',
    'white-space:nowrap;max-width:calc(100vw - 140px);overflow:hidden;text-overflow:ellipsis;}',
    /* Bedienelemente (Zurück/Vorwärts) OHNE grauen Kasten/Rand - nur ein
       kleiner Weichzeichner des Hintergrunds dahinter plus eine
       kontrastreiche Symbolfarbe heben sie hervor, egal was dahinter liegt. */
    '.pwp-progress{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;',
    'display:flex;flex-direction:column;align-items:center;}',
    '.pwp-progresshint{color:rgba(255,255,255,.55);font-size:.7rem;text-align:center;margin-bottom:4px;',
    'text-shadow:0 1px 3px rgba(0,0,0,.7);pointer-events:none;}',
    '.pwp-bottombar{display:flex;align-items:center;gap:14px;}',
    '.pwp-counter{color:#fff;background:rgba(255,255,255,.08);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
    'padding:6px 16px;border-radius:20px;font-size:.85rem;cursor:pointer;user-select:none;white-space:nowrap;',
    'text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.5);transition:background .15s ease;}',
    '.pwp-counter:hover{background:rgba(255,255,255,.18);}',
    '.pwp-navbtn{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);margin:0;padding:0;',
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fff;border:none;line-height:1;font-family:inherit;',
    'text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.5);box-shadow:none;',
    'font-size:1.3rem;cursor:pointer;flex:0 0 auto;transition:background .15s ease;}',
    '.pwp-navbtn:hover{background:rgba(255,255,255,.18);}',
    /* Gestapelte Fortschrittsanzeige - standardmäßig unsichtbar, klappt
       erst bei Hover über die Zähler-Anzeige selbst auf (NICHT über die
       Pfeile daneben) und bleibt dann offen, solange die Maus im
       Bedienbereich ist, damit die Karten auch erreichbar sind (Klasse
       pwp-open, siehe JS). Zeigt ALLE Stationen, die letzte ganz oben. */
    '.pwp-stack{display:flex;flex-direction:column;align-items:center;',
    'opacity:0;max-height:0;overflow:hidden;pointer-events:none;transition:opacity .15s ease;}',
    '.pwp-progress.pwp-open .pwp-stack{opacity:1;max-height:60vh;pointer-events:auto;margin-bottom:8px;}',
    '.pwp-seg{width:130px;border-radius:2px;background:rgba(255,255,255,.32);pointer-events:auto;',
    'cursor:pointer;transition:background .15s ease,transform .1s ease;}',
    '.pwp-seg:hover{background:rgba(255,255,255,.85);transform:scaleX(1.04);}',
    '.pwp-seg.pwp-seg-played{background:rgba(255,255,255,.12);}',
    '.pwp-seg.pwp-seg-played:hover{background:rgba(255,255,255,.4);}',
    '.pwp-seg.pwp-seg-current{background:#4f8cff;}',
    '.pwp-seg.pwp-seg-last{box-shadow:0 0 0 1px rgba(255,255,255,.6) inset;}',
    /* Vorschau-Kachel beim Durchhovern - immer an derselben Position
       (Daumenkino-Effekt). */
    '.pwp-preview{position:fixed;left:50%;bottom:130px;transform:translateX(-50%);',
    'width:220px;height:150px;border-radius:8px;z-index:21;',
    'background:rgba(20,21,24,.85) center/contain no-repeat;',
    'box-shadow:0 8px 28px rgba(0,0,0,.55);opacity:0;transition:opacity .1s ease;',
    'pointer-events:none;display:flex;align-items:center;justify-content:center;',
    'color:rgba(255,255,255,.7);font-size:.8rem;text-align:center;padding:8px;box-sizing:border-box;}',
    '.pwp-preview.pwp-visible{opacity:1;}',
    /* Unsichtbare Klickzonen am linken/rechten Bildschirmrand: Klick =
       zurück/weiter (wie ein Präsentations-Klicker). */
    '.pwp-navzone{position:fixed;top:0;bottom:0;width:16%;z-index:15;cursor:pointer;background:transparent;',
    'border:none;margin:0;padding:0;box-shadow:none;outline:none;}',
    '.pwp-navzone.pwp-prev{left:0;}.pwp-navzone.pwp-next{right:0;}',
    /* Ein-/Ausblenden von Ebenen (Notizen auf der Pinnwand, Annotationen auf
       Objekten) - wie der Augen-Knopf im Modul; oben links. */
    '.pwp-toggles{position:fixed;top:16px;left:16px;z-index:20;display:flex;gap:8px;}',
    '.pwp-toggle{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:17px;border:none;margin:0;',
    'background:rgba(255,255,255,.08);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fff;font:inherit;font-size:.8rem;',
    'text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.5);cursor:pointer;transition:background .15s ease,opacity .15s ease;}',
    '.pwp-toggle:hover{background:rgba(255,255,255,.18);}',
    '.pwp-toggle svg{width:16px;height:16px;display:block;}',
    '.pwp-toggle.pwp-off{opacity:.55;}',
    '.pwp-layer-overlay{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;}'
  ].join('');

  var EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><path d="M3 3l18 18"/></svg>';

  // Zeichnet Stylus-Striche/-Texte (0..1-normalisierte Koordinaten,
  // Strichbreite relativ zur Höhe) auf einen Canvas - EINE Umsetzung für
  // Pinnwand, Moodle-Präsentation und exportierte Datei (app.js ruft sie
  // über redrawInk() auf).
  function drawInk(canvas, ctx, strokes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width, h = canvas.height;
    (strokes || []).forEach(function (s) {
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

  // Anmerkungs-Ebene als Canvas über einem Element (Board-Fläche oder
  // einzelnes Objekt). Doppelte Auflösung, damit Schrift/Striche beim
  // Heranzoomen scharf bleiben. layerKey ('ink'/'annot') ordnet die Ebene
  // einem Ein-/Ausblenden-Schalter zu (siehe opts.toggles).
  function inkLayer(strokes, cssW, cssH, layerKey, zIndex) {
    var c = document.createElement('canvas');
    c.className = 'pwp-layer-overlay pwp-layer-' + layerKey;
    if (cssW && cssH) {
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
      c.width = Math.round(cssW * 2); c.height = Math.round(cssH * 2);
      drawInk(c, c.getContext('2d'), strokes);
    }
    if (zIndex != null) { c.style.zIndex = zIndex; }
    return c;
  }
  // Wie inkLayer, aber passt sich der (evtl. erst nach dem Laden eines
  // Bildes bekannten) Größe des umgebenden Elements an.
  function attachInk(container, strokes, layerKey) {
    if (!strokes || !strokes.length) { return null; }
    var c = inkLayer(strokes, 0, 0, layerKey);
    c.style.width = '100%'; c.style.height = '100%';
    container.appendChild(c);
    function draw() {
      var w = container.offsetWidth, h = container.offsetHeight;
      if (!w || !h) { return; }
      c.width = Math.round(w * 2); c.height = Math.round(h * 2);
      drawInk(c, c.getContext('2d'), strokes);
    }
    // Zeichnen, sobald das Element eine Größe hat (Bild geladen / im DOM) -
    // und erneut bei Größenänderung.
    var img = container.querySelector('img');
    if (img && !img.complete) { img.addEventListener('load', draw); }
    draw();
    setTimeout(draw, 0);
    if (window.ResizeObserver) { new ResizeObserver(draw).observe(container); }
    return c;
  }

  function injectCss(doc) {
    if (doc.getElementById('pwp-style')) { return; }
    var st = doc.createElement('style');
    st.id = 'pwp-style';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function div(cls, text) {
    var e = document.createElement('div');
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    return e;
  }
  function button(cls, text, aria) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (text) { b.textContent = text; }
    if (aria) { b.setAttribute('aria-label', aria); }
    return b;
  }

  function create(root, opts) {
    opts = opts || {};
    var labels = opts.labels || {};
    var L = {
      overview: labels.overview || 'Übersicht',
      frame: labels.frame || 'Rahmen',
      hint: labels.hint || '← → oder Leertaste zum Navigieren, Klick außerhalb zum Verschieben, Mausrad zum Zoomen',
      empty: labels.empty || 'Kein Roter Faden mit Stationen vorhanden.',
      prev: labels.prev || 'Zurück',
      next: labels.next || 'Weiter'
    };
    injectCss(document);
    root.classList.add('pwp-root');

    var stage = div('pwp-stage');
    var canvas = div('pwp-canvas');
    stage.appendChild(canvas);
    var previewEl = div('pwp-preview');
    var stackEl = div('pwp-stack');
    var counter = div('pwp-counter');
    var prevBtn = button('pwp-navbtn', '‹', L.prev);
    var nextBtn = button('pwp-navbtn', '›', L.next);
    var bottombar = div('pwp-bottombar');
    bottombar.appendChild(prevBtn); bottombar.appendChild(counter); bottombar.appendChild(nextBtn);
    var progressEl = div('pwp-progress');
    progressEl.appendChild(stackEl);
    progressEl.appendChild(div('pwp-progresshint', '⌃'));
    progressEl.appendChild(bottombar);
    var hint = div('pwp-hint', L.hint);
    var zonePrev = button('pwp-navzone pwp-prev', '', L.prev);
    var zoneNext = button('pwp-navzone pwp-next', '', L.next);
    root.appendChild(stage);
    root.appendChild(previewEl);
    root.appendChild(progressEl);
    root.appendChild(hint);
    root.appendChild(zonePrev);
    root.appendChild(zoneNext);

    // Ein-/Ausblenden-Schalter (z.B. Notizen/Annotationen) - wirken auf alle
    // Elemente mit der Klasse pwp-layer-<key>, auch wenn diese erst später
    // (nach start()) eingefügt werden.
    var hidden = {};
    function applyToggle(key) {
      var els = root.querySelectorAll('.pwp-layer-' + key);
      for (var i = 0; i < els.length; i++) { els[i].style.display = hidden[key] ? 'none' : ''; }
    }
    var toggleBar = null;
    function addToggle(key, label) {
      if (!toggleBar) { toggleBar = div('pwp-toggles'); root.appendChild(toggleBar); }
      if (toggleBar.querySelector('[data-key="' + key + '"]')) { return; }
      var tb = button('pwp-toggle', '', label);
      tb.setAttribute('data-key', key);
      tb.title = label;
      function paint() {
        tb.innerHTML = (hidden[key] ? EYE_OFF : EYE_ON) + '<span></span>';
        tb.lastChild.textContent = label;
        tb.classList.toggle('pwp-off', !!hidden[key]);
      }
      tb.addEventListener('click', function () { hidden[key] = !hidden[key]; paint(); applyToggle(key); });
      paint();
      toggleBar.appendChild(tb);
    }
    (opts.toggles || []).forEach(function (t) { addToggle(t.key, t.label); });

    var steps = [];
    var occludables = [];
    var idx = 0;
    var currentTransform = null;
    var cameraFrame = null;
    var hintTimer = null;
    var destroyed = false;

    function targetFor(s) {
      return { scale: Math.min(window.innerWidth / s.w, window.innerHeight / s.h), cx: s.cx, cy: s.cy, rot: s.rot || 0 };
    }

    // Kamera-Transformation: translate(tx,ty) rotate(rot) scale(scale) mit
    // transform-origin 0 0 - cx/cy müssen VOR der Verschiebungsberechnung um
    // "rot" gedreht werden, sonst landet der Zielpunkt bei gedrehten Rahmen
    // nicht in der Bildschirmmitte.
    function applyTransform(scale, cx, cy, rot) {
      var rad = (rot || 0) * Math.PI / 180;
      var rx = cx * Math.cos(rad) - cy * Math.sin(rad);
      var ry = cx * Math.sin(rad) + cy * Math.cos(rad);
      var tx = window.innerWidth / 2 - scale * rx;
      var ty = window.innerHeight / 2 - scale * ry;
      canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) rotate(' + (rot || 0) + 'deg) scale(' + scale + ')';
    }

    function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

    // Eine durchgehende Animation von "from" nach "to": bei kurzen Wegen
    // elastisches Gleiten, bei weiten Wegen ein Bogen (kurz stärker
    // herauszoomen für den Überblick), bevor zur Zielstation gelandet wird.
    function animateCamera(from, to, onDone) {
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
      var dist = Math.sqrt(Math.pow(to.cx - from.cx, 2) + Math.pow(to.cy - from.cy, 2));
      var duration = Math.min(2400, Math.max(500, 550 + dist * 0.55));
      var hopFactor = Math.min(0.55, Math.max(0, (dist - 120) / 1800));
      var hopAmount = Math.min(from.scale, to.scale) * hopFactor;
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
        if (raw < 1) { cameraFrame = requestAnimationFrame(frame); }
        else { cameraFrame = null; if (onDone) { onDone(); } }
      }
      cameraFrame = requestAnimationFrame(frame);
    }

    // Verdeckung: nur Objekte mit höherer Z-Ebene als die aktive Station
    // werden ausgeblendet; beim Überblick bleibt alles sichtbar.
    function updateOcclusion() {
      var active = steps[idx];
      occludables.forEach(function (rec) {
        var hide = !!active && !active.overview && rec.el !== active.el && (rec.z || 0) > (active.z || 0);
        rec.el.classList.toggle('pwp-occluded', hide);
      });
    }

    function showPreview(s) {
      if (s.previewUrl) {
        previewEl.style.backgroundImage = "url('" + s.previewUrl + "')";
        previewEl.textContent = '';
      } else {
        previewEl.style.backgroundImage = 'none';
        previewEl.textContent = s.overview ? L.overview : (s.frame ? L.frame : '');
      }
      previewEl.classList.add('pwp-visible');
    }
    function hidePreview() { previewEl.classList.remove('pwp-visible'); }
    counter.addEventListener('mouseenter', function () { progressEl.classList.add('pwp-open'); });
    progressEl.addEventListener('mouseleave', function () { progressEl.classList.remove('pwp-open'); hidePreview(); });

    function renderStack() {
      stackEl.innerHTML = '';
      var segH = Math.max(2, Math.min(6, Math.floor(320 / Math.max(1, steps.length))));
      var gap = segH >= 4 ? 2 : 1;
      for (var si = steps.length - 1; si >= 0; si--) {
        (function (si) {
          var cls = 'pwp-seg';
          if (si === steps.length - 1) { cls += ' pwp-seg-last'; }
          if (si === idx) { cls += ' pwp-seg-current'; }
          else if (si < idx) { cls += ' pwp-seg-played'; }
          var seg = div(cls);
          seg.style.height = segH + 'px';
          seg.style.marginBottom = gap + 'px';
          seg.addEventListener('click', function () { goToStep(si); });
          seg.addEventListener('mouseenter', function () { showPreview(steps[si]); });
          seg.addEventListener('mouseleave', hidePreview);
          stackEl.appendChild(seg);
        })(si);
      }
    }

    function overviewIndex() {
      for (var oi = 0; oi < steps.length; oi++) { if (steps[oi].overview) { return oi; } }
      return 0;
    }

    function goToStep(newIdx, skipTransition) {
      if (!steps.length) { return; }
      var fromIdx = idx;
      idx = Math.max(0, Math.min(steps.length - 1, newIdx));
      var s = steps[idx];
      var target = targetFor(s);
      updateOcclusion();
      counter.textContent = (idx + 1) + ' / ' + steps.length;
      renderStack();
      if (skipTransition || fromIdx === idx || !currentTransform) {
        if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
        applyTransform(target.scale, target.cx, target.cy, target.rot);
        currentTransform = target;
        return;
      }
      animateCamera(currentTransform, target, function () { currentTransform = target; });
      currentTransform = target;
    }
    function step(dir) { goToStep(idx + dir); }

    function onKey(ev) {
      if (ev.key === 'ArrowRight' || ev.key === ' ') { step(1); ev.preventDefault(); }
      else if (ev.key === 'ArrowLeft') { step(-1); }
      else if (ev.key === 'Escape' && opts.onEscape) { opts.onEscape(); }
    }
    document.addEventListener('keydown', onKey);
    zonePrev.addEventListener('click', function () { step(-1); });
    zoneNext.addEventListener('click', function () { step(1); });
    prevBtn.addEventListener('click', function () { step(-1); });
    nextBtn.addEventListener('click', function () { step(1); });
    counter.addEventListener('click', function () { goToStep(overviewIndex()); });

    // Manuelles Verschieben/Zoomen zwischen den Stationen (Ziehen auf der
    // Fläche, Mausrad, Pinch) - aktualisiert currentTransform direkt, damit
    // der nächste Schritt von der angepassten Ansicht aus weiterfliegt.
    function zoomAt(newScale, clientX, clientY) {
      if (!currentTransform) { return; }
      newScale = Math.max(0.05, Math.min(8, newScale));
      var rad = (currentTransform.rot || 0) * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      var dx = clientX - window.innerWidth / 2, dy = clientY - window.innerHeight / 2;
      var wx = currentTransform.cx + (dx * cos + dy * sin) / currentTransform.scale;
      var wy = currentTransform.cy + (-dx * sin + dy * cos) / currentTransform.scale;
      currentTransform.scale = newScale;
      currentTransform.cx = wx - (dx * cos + dy * sin) / newScale;
      currentTransform.cy = wy - (-dx * sin + dy * cos) / newScale;
      applyTransform(currentTransform.scale, currentTransform.cx, currentTransform.cy, currentTransform.rot);
    }
    var dragging = false, dragStartX = 0, dragStartY = 0, dragStartCx = 0, dragStartCy = 0;
    stage.addEventListener('pointerdown', function (ev) {
      if (!currentTransform) { return; }
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
      dragging = true; stage.classList.add('pwp-dragging');
      dragStartX = ev.clientX; dragStartY = ev.clientY;
      dragStartCx = currentTransform.cx; dragStartCy = currentTransform.cy;
    });
    function onPointerMove(ev) {
      if (!dragging || !currentTransform) { return; }
      var rad = (currentTransform.rot || 0) * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      var dx = ev.clientX - dragStartX, dy = ev.clientY - dragStartY;
      currentTransform.cx = dragStartCx - (dx * cos + dy * sin) / currentTransform.scale;
      currentTransform.cy = dragStartCy - (-dx * sin + dy * cos) / currentTransform.scale;
      applyTransform(currentTransform.scale, currentTransform.cx, currentTransform.cy, currentTransform.rot);
    }
    function onPointerUp() { dragging = false; stage.classList.remove('pwp-dragging'); }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('wheel', function (ev) {
      if (!currentTransform) { return; }
      ev.preventDefault();
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
      zoomAt(currentTransform.scale * (ev.deltaY < 0 ? 1.1 : 0.9), ev.clientX, ev.clientY);
    }, { passive: false });
    var pinchDist = 0, pinchScale = 1, pinchMidX = 0, pinchMidY = 0;
    function touchDist(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    stage.addEventListener('touchstart', function (ev) {
      if (ev.touches.length === 2 && currentTransform) {
        dragging = false;
        pinchDist = touchDist(ev.touches) || 1;
        pinchScale = currentTransform.scale;
        pinchMidX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2;
        pinchMidY = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
      }
    }, { passive: true });
    stage.addEventListener('touchmove', function (ev) {
      if (ev.touches.length !== 2) { return; }
      ev.preventDefault();
      zoomAt(pinchScale * ((touchDist(ev.touches) || 1) / pinchDist), pinchMidX, pinchMidY);
    }, { passive: false });

    function start(newSteps, newOccludables, startIndex) {
      steps = newSteps || [];
      occludables = newOccludables || [];
      if (!steps.length) {
        hint.textContent = L.empty;
        counter.textContent = '0 / 0';
        return;
      }
      var first = (typeof startIndex === 'number' && steps[startIndex]) ? startIndex : 0;
      idx = first;
      goToStep(first, true);
      hintTimer = setTimeout(function () { hint.style.opacity = '0'; }, 4000);
    }

    // Station nachträglich anhängen (Live-Präsentation: Klick auf ein noch
    // nicht im Faden enthaltenes Objekt) und direkt dorthin fliegen.
    function addStep(s) {
      steps.push(s);
      goToStep(steps.length - 1);
    }

    // Maße einer Station haben sich geändert (z.B. Bild erst jetzt fertig
    // geladen) - falls sie gerade aktiv ist, ohne Animation nachführen.
    function refreshStep(s) {
      if (steps[idx] === s && !cameraFrame) { goToStep(idx, true); }
    }

    function destroy() {
      if (destroyed) { return; }
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
      if (hintTimer) { clearTimeout(hintTimer); }
    }

    return {
      stage: stage,
      canvas: canvas,
      start: start,
      goToStep: goToStep,
      step: step,
      addStep: addStep,
      refreshStep: refreshStep,
      addToggle: addToggle,
      destroy: destroy,
      currentIndex: function () { return idx; }
    };
  }

  global.PinnwandPresentation = { create: create, drawInk: drawInk, inkLayer: inkLayer, attachInk: attachInk };
})(window);
