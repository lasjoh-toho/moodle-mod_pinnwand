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
    '[data-pwp-build]{transition:opacity .45s ease,transform .45s ease;}',
    '[data-pwp-exit]{transition:opacity .45s ease;}',
    '.pwp-exit-hidden{opacity:0 !important;pointer-events:none !important;}',
    '.pwp-bg-off{background:transparent !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}',
    '.pwp-build-hidden{opacity:0 !important;pointer-events:none !important;}',
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
    /* Stift unten links: im Ruhezustand sehr transparent und ohne
       Weichzeichner, bei Hover/aktiv deutlich. */
    '.pwp-pen{position:fixed;left:18px;bottom:18px;z-index:22;width:46px;height:46px;border-radius:50%;border:none;margin:0;padding:0;',
    'display:flex;align-items:center;justify-content:center;background:transparent;color:#fff;opacity:.2;cursor:pointer;',
    'filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));transition:opacity .15s ease,background .15s ease;}',
    '.pwp-pen:hover,.pwp-pen.pwp-on{opacity:1;background:rgba(20,21,24,.7);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}',
    '.pwp-pen.pwp-on{box-shadow:0 0 0 2px #4f8cff;}',
    '.pwp-pen svg{width:22px;height:22px;display:block;}',
    '.pwp-pen-panel{position:fixed;left:18px;bottom:74px;z-index:22;display:none;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;border-radius:16px;',
    'background:rgba(20,21,24,.75);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 20px rgba(0,0,0,.45);}',
    '.pwp-pen-panel.pwp-visible{display:flex;}',
    '.pwp-pen-toolwrap{position:relative;display:flex;}',
    '.pwp-pen-tool{width:34px;height:34px;border-radius:50%;border:none;margin:0;padding:0;background:rgba(20,21,24,.55);color:#fff;',
    'display:flex;align-items:center;justify-content:center;cursor:pointer;}',
    '.pwp-pen-tool svg{width:18px;height:18px;display:block;}',
    '.pwp-pen-tool:hover{background:rgba(255,255,255,.18);}',
    '.pwp-pen-tool.pwp-on{background:#4f8cff;}',
    '.pwp-pen-danger{background:#e0342a;}',
    '.pwp-pen-flyout{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);display:none;align-items:center;gap:8px;padding:6px 10px;',
    'border-radius:12px;white-space:nowrap;background:rgba(20,21,24,.9);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
    'box-shadow:0 4px 16px rgba(0,0,0,.4);font-size:.75rem;color:rgba(255,255,255,.65);}',
    '.pwp-pen-flyout::before{content:"";position:absolute;left:-10px;top:0;bottom:0;width:10px;}',
    '.pwp-pen-toolwrap:hover .pwp-pen-flyout{display:flex;}',
    '.pwp-pen-flyout input{width:110px;}',
    '.pwp-pen-shapes{gap:4px;padding:5px 8px;}',
    '.pwp-pen-flyout-val{min-width:2em;text-align:right;color:#fff;font-variant-numeric:tabular-nums;}',
    '.pwp-pen-sep{width:22px;height:1px;background:rgba(255,255,255,.18);margin:2px 0;}',
    '.pwp-pen-color{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.3);margin:0;padding:0;cursor:pointer;}',
    '.pwp-pen-color.pwp-on{border-color:#fff;box-shadow:0 0 0 2px #4f8cff;}',
    '.pwp-pen-custom{width:26px;height:26px;border:none;border-radius:50%;padding:0;background:transparent;cursor:pointer;}',
    '.pwp-pen-input{position:fixed;z-index:23;transform:translateY(-2px);min-width:120px;background:transparent;color:transparent;border:1px dashed rgba(255,255,255,.45);',
    'border-radius:4px;padding:0 4px;outline:none;font-family:sans-serif;}',
    '.pwp-drawing .pwp-navzone{display:none;}',
    '.pwp-drawing .pwp-stage{cursor:crosshair;}',
    '.pwp-layer-overlay{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;}'
  ].join('');

  var SVG_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  var SVG_TEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5h14M12 5v14M9 19h6"/></svg>';
  var SVG_ERASER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H9L3.5 14.5a2 2 0 0 1 0-2.8l8.2-8.2a2 2 0 0 1 2.8 0l5.5 5.5a2 2 0 0 1 0 2.8L13 19"/><path d="M8 10l6 6"/></svg>';
  var SVG_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var SVG_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.1 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.1-1.5"/><path d="M3 3l18 18"/></svg>';
  var SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

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

  // Notizen-Ebene als SVG statt Canvas: auflösungsunabhängig (beim
  // Heranzoomen scharf) und NICHT auf die Pinnwand-Fläche begrenzt -
  // Striche außerhalb (Koordinaten < 0 oder > 1) bleiben sichtbar
  // (overflow:visible). Radierer-Striche werden per SVG-Maske umgesetzt
  // (wirken wie beim Canvas nur auf das, was VOR ihnen gezeichnet wurde).
  var inkSvgUid = 0;
  function inkEsc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inkSvgMarkup(strokes, W, H, uid) {
    var defs = '', body = '', m = 0;
    (strokes || []).forEach(function (s) {
      if (s.type === 'text') {
        if (!s.text) { return; }
        var fs = Math.max(10, (s.size || 20) * (H / 900) * 1.6);
        body += '<text x="' + (s.x * W) + '" y="' + (s.y * H) + '" font-size="' + fs + '" font-family="sans-serif" fill="' + inkEsc(s.color) +
          '" dominant-baseline="text-before-edge">' + inkEsc(s.text) + '</text>';
        return;
      }
      if (!s.points || !s.points.length) { return; }
      var d = '';
      s.points.forEach(function (pt, i) { d += (i ? ' L' : 'M') + (Math.round(pt.x * W * 10) / 10) + ' ' + (Math.round(pt.y * H * 10) / 10); });
      if (s.points.length === 1) { d += ' L' + (s.points[0].x * W + 0.01) + ' ' + (s.points[0].y * H); }
      var sw = Math.max(0.5, s.width * H);
      if (s.erase) {
        var id = 'inkm' + uid + '_' + (m++);
        defs += '<mask id="' + id + '" maskUnits="userSpaceOnUse" x="' + (-50 * W) + '" y="' + (-50 * H) + '" width="' + (101 * W) + '" height="' + (101 * H) + '">' +
          '<rect x="' + (-50 * W) + '" y="' + (-50 * H) + '" width="' + (101 * W) + '" height="' + (101 * H) + '" fill="#fff"/>' +
          '<path d="' + d + '" fill="none" stroke="#000" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/></mask>';
        body = '<g mask="url(#' + id + ')">' + body + '</g>';
      } else {
        body += '<path d="' + d + '" fill="none" stroke="' + inkEsc(s.color) + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
      }
    });
    return (defs ? '<defs>' + defs + '</defs>' : '') + body;
  }
  // Liefert ein <svg> in Board-Größe (W x H), das per setStrokes(strokes)
  // neu gezeichnet werden kann.
  function inkLayer(strokes, cssW, cssH, layerKey, zIndex) {
    var uid = ++inkSvgUid;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pwp-ink-svg pwp-layer-' + layerKey);
    svg.setAttribute('viewBox', '0 0 ' + cssW + ' ' + cssH);
    svg.setAttribute('width', cssW);
    svg.setAttribute('height', cssH);
    svg.style.cssText = 'position:absolute;left:0;top:0;width:' + cssW + 'px;height:' + cssH + 'px;overflow:visible;pointer-events:none;' +
      (zIndex != null ? 'z-index:' + zIndex + ';' : '');
    svg.setStrokes = function (list) { svg.innerHTML = inkSvgMarkup(list, cssW, cssH, uid); };
    svg.setStrokes(strokes);
    return svg;
  }
  // Ausdehnung von Notizen in Board-Koordinaten (für den Überblick, falls
  // Notizen über die Leinwand hinausragen).
  function inkBounds(strokes, W, H) {
    var b = null;
    (strokes || []).forEach(function (st) {
      var pts = st.type === 'text' ? [{ x: st.x, y: st.y }] : (st.erase ? [] : (st.points || []));
      var pad = st.type === 'text' ? 0 : (st.width || 0) * H;
      pts.forEach(function (pt) {
        var x = pt.x * W, y = pt.y * H;
        if (!b) { b = { x1: x - pad, y1: y - pad, x2: x + pad, y2: y + pad }; return; }
        b.x1 = Math.min(b.x1, x - pad); b.y1 = Math.min(b.y1, y - pad);
        b.x2 = Math.max(b.x2, x + pad); b.y2 = Math.max(b.y2, y + pad);
      });
      if (st.type === 'text' && b) {
        var fs = Math.max(10, (st.size || 20) * (H / 900) * 1.6);
        b.x2 = Math.max(b.x2, st.x * W + (st.text || '').length * fs * 0.6);
        b.y2 = Math.max(b.y2, st.y * H + fs * 1.2);
      }
    });
    return b;
  }
  // Annotationen auf einem einzelnen Objekt: Canvas über dem Element, passt
  // sich dessen (evtl. erst nach dem Laden eines Bildes bekannten) Größe an.
  // layerKey ordnet die Ebene einem Ein-/Ausblenden-Schalter zu.
  function attachInk(container, strokes, layerKey) {
    if (!strokes || !strokes.length) { return null; }
    var c = document.createElement('canvas');
    c.className = 'pwp-layer-overlay pwp-layer-' + layerKey;
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
      next: labels.next || 'Weiter',
      pen: labels.pen || 'Stift',
      penDraw: labels.penDraw || 'Zeichnen',
      penText: labels.penText || 'Text schreiben',
      penErase: labels.penErase || 'Radieren',
      penSize: labels.penSize || 'Strichstärke',
      penClear: labels.penClear || 'Eigene Zeichnungen löschen',
      show: labels.show || 'Einblenden',
      hide: labels.hide || 'Ausblenden'
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

    // ---------------------------------------------------------------
    // Stift unten links (dieselbe Stelle wie das Stift-Werkzeug auf der
    // Pinnwand): im Ruhezustand kaum sichtbar, bei Hover/aktiv deutlich.
    // Öffnet ein kleines Werkzeugfeld zum Schreiben/Zeichnen während der
    // Präsentation (Stift, Text, Radierer, Farben, Stärke, alles löschen)
    // sowie Schalter zum Ein-/Ausblenden der Notizen (Stift-Werkzeug der
    // Pinnwand) und Annotationen (Zeichnungen auf einzelnen Objekten).
    // Das hier Geschriebene ist eine flüchtige Präsentationsebene - es wird
    // nicht gespeichert.
    // ---------------------------------------------------------------
    var BW = opts.boardW || 1400, BH = opts.boardH || 1000;
    var PEN_COLORS = ['#ef4444', '#111111', '#2563eb', '#22c55e', '#facc15', '#ffffff'];
    var hidden = {};
    var layers = [];
    function applyToggle(key) {
      var els = root.querySelectorAll('.pwp-layer-' + key);
      for (var i = 0; i < els.length; i++) { els[i].style.display = hidden[key] ? 'none' : ''; }
    }
    var pen = { on: false, tool: 'pen', color: PEN_COLORS[0], px: 6, textPx: 24, shape: 'rect', strokes: [] };
    var drawCanvas = null;
    function ensureDrawCanvas() {
      if (!drawCanvas) { drawCanvas = inkLayer([], BW, BH, 'draw', 700); canvas.appendChild(drawCanvas); }
    }
    function redrawPen() { ensureDrawCanvas(); drawCanvas.setStrokes(pen.strokes); }

    var penBtn = button('pwp-pen', '', L.pen);
    penBtn.title = L.pen;
    penBtn.innerHTML = SVG_PEN;
    var penPanel = div('pwp-pen-panel');
    function toolBtn(tool, svg, title) {
      var b = button('pwp-pen-tool' + (pen.tool === tool ? ' pwp-on' : ''), '', title);
      b.title = title;
      b.innerHTML = svg;
      b.addEventListener('click', function () { pen.tool = pen.tool === tool ? null : tool; renderPenPanel(); });
      return b;
    }
    // Wie die Stift-Spalte auf der Pinnwand: alle Werkzeuge untereinander am
    // linken Rand, Stärke bzw. Schriftgröße klappen beim Überfahren nach
    // rechts aus, darunter Farben, eigene Farbe, Ebenen und Löschen.
    function flyout(label, min, max, get, set) {
      var fl = div('pwp-pen-flyout');
      fl.appendChild(document.createTextNode(label));
      var r = document.createElement('input');
      r.type = 'range'; r.min = String(min); r.max = String(max); r.value = String(get());
      var val = div('pwp-pen-flyout-val', String(get()));
      r.addEventListener('input', function () { set(parseInt(r.value, 10)); val.textContent = r.value; });
      fl.appendChild(r);
      fl.appendChild(val);
      return fl;
    }
    function toolWrap(tool, svg, title, fl) {
      var w = div('pwp-pen-toolwrap');
      w.appendChild(toolBtn(tool, svg, title));
      if (fl) { w.appendChild(fl); }
      return w;
    }
    function renderPenPanel() {
      penPanel.innerHTML = '';
      penPanel.appendChild(toolWrap('pen', SVG_PEN, L.penDraw, flyout(L.penSize, 2, 30, function () { return pen.px; }, function (v) { pen.px = v; })));
      penPanel.appendChild(toolWrap('text', SVG_TEXT, L.penText, flyout(L.penSize, 10, 72, function () { return pen.textPx; }, function (v) { pen.textPx = v; })));
      // Formen hinter einem Werkzeug, Auswahl im Ausklapp-Feld.
      var shapeFl = div('pwp-pen-flyout pwp-pen-shapes');
      SHAPE_KINDS.forEach(function (k) {
        var kb = button('pwp-pen-tool' + (pen.tool === 'shape' && pen.shape === k ? ' pwp-on' : ''), '', (L.shapes && L.shapes[k]) || k);
        kb.title = (L.shapes && L.shapes[k]) || k;
        kb.innerHTML = SHAPE_SVG[k];
        kb.addEventListener('click', function () { pen.shape = k; pen.tool = 'shape'; renderPenPanel(); });
        shapeFl.appendChild(kb);
      });
      var shapeWrap = div('pwp-pen-toolwrap');
      var shapeMain = button('pwp-pen-tool' + (pen.tool === 'shape' ? ' pwp-on' : ''), '', L.penShapes || 'Formen');
      shapeMain.title = L.penShapes || '';
      shapeMain.innerHTML = SHAPE_SVG[pen.tool === 'shape' ? pen.shape : 'shapes'];
      shapeMain.addEventListener('click', function () { pen.tool = pen.tool === 'shape' ? null : 'shape'; renderPenPanel(); });
      shapeWrap.appendChild(shapeMain);
      shapeWrap.appendChild(shapeFl);
      penPanel.appendChild(shapeWrap);
      penPanel.appendChild(toolWrap('eraser', SVG_ERASER, L.penErase, flyout(L.penSize, 2, 30, function () { return pen.px; }, function (v) { pen.px = v; })));
      penPanel.appendChild(div('pwp-pen-sep'));
      PEN_COLORS.forEach(function (c) {
        var sw = button('pwp-pen-color' + (pen.color === c ? ' pwp-on' : ''), '', c);
        sw.style.background = c;
        sw.addEventListener('click', function () {
          pen.color = c;
          if (pen.tool !== 'pen' && pen.tool !== 'text') { pen.tool = 'pen'; }
          renderPenPanel();
        });
        penPanel.appendChild(sw);
      });
      var custom = document.createElement('input');
      custom.type = 'color'; custom.className = 'pwp-pen-custom'; custom.value = pen.color; custom.title = L.penDraw;
      custom.addEventListener('input', function () { pen.color = custom.value; if (pen.tool !== 'pen' && pen.tool !== 'text') { pen.tool = 'pen'; } });
      custom.addEventListener('change', renderPenPanel);
      penPanel.appendChild(custom);
      if (layers.length) {
        penPanel.appendChild(div('pwp-pen-sep'));
        layers.forEach(function (ly) {
          var chip = button('pwp-pen-tool pwp-pen-layer' + (hidden[ly.key] ? '' : ' pwp-on'), '', ly.label);
          chip.innerHTML = hidden[ly.key] ? SVG_EYE_OFF : SVG_EYE;
          chip.title = (hidden[ly.key] ? L.show : L.hide) + ': ' + ly.label;
          chip.addEventListener('click', function () { hidden[ly.key] = !hidden[ly.key]; applyToggle(ly.key); renderPenPanel(); });
          penPanel.appendChild(chip);
        });
      }
      penPanel.appendChild(div('pwp-pen-sep'));
      var clr = button('pwp-pen-tool pwp-pen-danger', '', L.penClear);
      clr.title = L.penClear;
      clr.innerHTML = SVG_TRASH;
      clr.addEventListener('click', function () { pen.strokes = []; redrawPen(); });
      penPanel.appendChild(clr);
    }
    function setPenOn(on) {
      pen.on = on;
      if (on && !pen.tool) { pen.tool = 'pen'; }
      penBtn.classList.toggle('pwp-on', on);
      penPanel.classList.toggle('pwp-visible', on);
      root.classList.toggle('pwp-drawing', on);
      renderPenPanel();
    }
    penBtn.addEventListener('click', function () { setPenOn(!pen.on); });
    root.appendChild(penPanel);
    root.appendChild(penBtn);
    renderPenPanel();
    function drawingActive() { return pen.on && !!pen.tool; }

    // Bildschirm- -> Board-Koordinaten (Umkehrung der Kamera, siehe applyTransform).
    function toBoard(clientX, clientY) {
      var t = currentTransform;
      var rad = (t.rot || 0) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      var dx = clientX - window.innerWidth / 2, dy = clientY - window.innerHeight / 2;
      return { x: t.cx + (dx * cos + dy * sin) / t.scale, y: t.cy + (-dx * sin + dy * cos) / t.scale };
    }
    var penStroke = null;
    stage.addEventListener('pointerdown', function (ev) {
      if (!drawingActive() || !currentTransform) { return; }
      ev.preventDefault();
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
      var b = toBoard(ev.clientX, ev.clientY);
      if (pen.tool === 'text') { openTextInput(ev.clientX, ev.clientY, b); return; }
      if (pen.tool === 'shape') {
        var bp = { x: b.x / BW, y: b.y / BH };
        if (pen.shape === 'poly' || pen.shape === 'curve') {
          if (!penShape) {
            penShape = { pts: [bp], stroke: { points: [bp, bp], color: pen.color, width: pen.px / currentTransform.scale / BH, erase: false } };
            pen.strokes.push(penShape.stroke);
          } else { penShape.pts.push(bp); }
          penShape.stroke.points = shapePoints(pen.shape, penShape.pts.concat([bp]), BW / BH, false);
        } else {
          penShape = { drag: true, pts: [bp], stroke: { points: [bp, bp], color: pen.color, width: pen.px / currentTransform.scale / BH, erase: false } };
          pen.strokes.push(penShape.stroke);
        }
        redrawPen();
        return;
      }
      var widthBoard = (pen.tool === 'eraser' ? pen.px * 4 : pen.px) / currentTransform.scale;
      penStroke = { points: [{ x: b.x / BW, y: b.y / BH }], color: pen.color, width: widthBoard / BH, erase: pen.tool === 'eraser' };
      pen.strokes.push(penStroke);
      redrawPen();
    });
    var penShape = null;
    function finishPenShape(cancel) {
      if (!penShape) { return; }
      var d = penShape;
      penShape = null;
      var pts = [];
      d.pts.forEach(function (q) {
        var last = pts[pts.length - 1];
        if (!last || Math.abs(last.x - q.x) * BW > 2 || Math.abs(last.y - q.y) * BH > 2) { pts.push(q); }
      });
      if (cancel || pts.length < 2) { pen.strokes = pen.strokes.filter(function (st) { return st !== d.stroke; }); }
      else { d.stroke.points = shapePoints(pen.shape, pts, BW / BH, false); }
      redrawPen();
    }
    stage.addEventListener('dblclick', function () { if (penShape && !penShape.drag) { finishPenShape(false); } });
    document.addEventListener('keydown', function (ev) {
      if (!penShape || penShape.drag) { return; }
      if (ev.key === 'Enter') { finishPenShape(false); ev.preventDefault(); ev.stopPropagation(); }
      else if (ev.key === 'Escape') { finishPenShape(true); ev.preventDefault(); ev.stopPropagation(); }
    }, true);
    function onPenMove(ev) {
      if (penShape && currentTransform) {
        var mb = toBoard(ev.clientX, ev.clientY), mp = { x: mb.x / BW, y: mb.y / BH };
        penShape.stroke.points = penShape.drag
          ? shapePoints(pen.shape, [penShape.pts[0], mp], BW / BH, ev.shiftKey)
          : shapePoints(pen.shape, penShape.pts.concat([mp]), BW / BH, false);
        redrawPen();
        return;
      }
      if (!penStroke) { return; }
      var b = toBoard(ev.clientX, ev.clientY);
      penStroke.points.push({ x: b.x / BW, y: b.y / BH });
      redrawPen();
    }
    function onPenUp(ev) {
      penStroke = null;
      if (penShape && penShape.drag) {
        var ub = toBoard(ev.clientX, ev.clientY), up = { x: ub.x / BW, y: ub.y / BH };
        var moved = Math.abs(up.x - penShape.pts[0].x) * BW > 2 || Math.abs(up.y - penShape.pts[0].y) * BH > 2;
        penShape.stroke.points = shapePoints(pen.shape, [penShape.pts[0], up], BW / BH, ev.shiftKey);
        if (!moved) { var dead = penShape.stroke; pen.strokes = pen.strokes.filter(function (st) { return st !== dead; }); }
        penShape = null;
        redrawPen();
      }
    }
    window.addEventListener('pointermove', onPenMove);
    window.addEventListener('pointerup', onPenUp);
    function openTextInput(clientX, clientY, b) {
      var fontScreen = pen.textPx;
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'pwp-pen-input';
      inp.style.left = clientX + 'px';
      inp.style.top = clientY + 'px';
      inp.style.fontSize = fontScreen + 'px';
      inp.style.caretColor = pen.color;
      root.appendChild(inp);
      setTimeout(function () { inp.focus(); }, 0);
      // Gleiches Textformat wie die Notizen der Pinnwand; der Text erscheint
      // beim Tippen direkt (live) in der Zeichenebene.
      var boardFont = fontScreen / currentTransform.scale;
      var live = { type: 'text', text: '', x: b.x / BW, y: b.y / BH, color: pen.color, size: boardFont / (BH / 900 * 1.6) };
      inp.addEventListener('input', function () {
        live.text = inp.value;
        ensureDrawCanvas();
        drawCanvas.setStrokes(pen.strokes.concat(inp.value ? [live] : []));
      });
      var done = false;
      function commit() {
        if (done) { return; }
        done = true;
        var text = inp.value;
        inp.remove();
        if (text) { live.text = text; pen.strokes.push(live); }
        redrawPen();
      }
      inp.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        if (ev.key === 'Enter') { commit(); }
        else if (ev.key === 'Escape') { done = true; inp.remove(); redrawPen(); }
      });
      inp.addEventListener('blur', commit);
    }

    // Ebene (z.B. Notizen/Annotationen) zum Ein-/Ausblenden im Stift-Feld
    // anmelden - nur, wenn es davon tatsächlich etwas gibt.
    function addToggle(key, label) {
      if (layers.some(function (l) { return l.key === key; })) { return; }
      layers.push({ key: key, label: label });
      layers.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
      renderPenPanel();
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
      // Feststehende Bildschirmebene (z. B. nicht mitzoomender Hintergrund):
      // liegt IN der gezoomten Leinwand - nur so können Objekte per
      // mix-blend-mode mit ihr mischen - und hebt die Transformation exakt
      // wieder auf (inverse Matrix: S^-1 R^-1 T^-1).
      if (screenLayer) {
        screenLayer.style.width = window.innerWidth + 'px';
        screenLayer.style.height = window.innerHeight + 'px';
        screenLayer.style.transform = 'scale(' + (1 / scale) + ') rotate(' + (-(rot || 0)) + 'deg) translate(' + (-tx) + 'px,' + (-ty) + 'px)';
      }
    }

    var screenLayer = null;
    function setScreenLayer(elm) {
      screenLayer = elm;
      elm.style.position = 'absolute';
      elm.style.left = '0';
      elm.style.top = '0';
      elm.style.transformOrigin = '0 0';
      elm.style.pointerEvents = 'none';
      elm.style.zIndex = '-1000000';
      canvas.insertBefore(elm, canvas.firstChild);
      if (currentTransform) {
        applyTransform(currentTransform.scale, currentTransform.cx, currentTransform.cy, currentTransform.rot);
      }
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
        // Mit der Folie verknüpfte Objekte (active.keep) bleiben sichtbar,
        // obwohl sie darüber liegen.
        var hide = !!active && !active.overview && rec.el !== active.el && (rec.z || 0) > (active.z || 0) &&
          !(active.keep && active.keep.indexOf(rec.el) !== -1);
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

    // Animationsschritte (Folien): Kinder mit data-pwp-build="k" sind erst
    // ab Stufe k sichtbar. Vor der Folie ist nichts davon zu sehen, danach
    // (und im Überblick) alles.
    function updateBuilds() {
      var active = steps[idx];
      var els = [];
      steps.forEach(function (st) { if (st.buildEl && els.indexOf(st.buildEl) === -1) { els.push(st.buildEl); } });
      // Folien: Hintergrund (Farbe/Weichzeichnen) nur solange die Folie
      // aktiv ist (Standard), Objekte mit "Abgang" verschwinden beim
      // Weiterblättern.
      var slides = [];
      steps.forEach(function (st) { if (st.slideEl && slides.indexOf(st.slideEl) === -1) { slides.push(st.slideEl); } });
      slides.forEach(function (sel) {
        var isActive = !!active && active.slideEl === sel;
        var showAll = !active || active.overview;
        var first = -1, last = -1, hideBefore = true, hideAfter = true;
        steps.forEach(function (st, si) {
          if (st.slideEl !== sel) { return; }
          if (first === -1) { first = si; }
          last = si;
          hideBefore = st.slideBgHideBefore !== false;
          hideAfter = st.slideBgHideAfter !== false;
        });
        // Im Überblick gilt "vorher unsichtbar" ebenfalls: der Effekt erscheint
        // erst, wenn die Folie selbst an der Reihe ist.
        var bgOff = !isActive && (showAll ? hideBefore : ((idx < first && hideBefore) || (idx > last && hideAfter)));
        sel.classList.toggle('pwp-bg-off', bgOff);
        var passed = !isActive && !showAll && idx > last;
        var exits = sel.querySelectorAll('[data-pwp-exit]');
        for (var xi = 0; xi < exits.length; xi++) { exits[xi].classList.toggle('pwp-exit-hidden', passed); }
      });
      els.forEach(function (bel) {
        var level;
        if (active && active.buildEl === bel) {
          level = active.build || 0;
        } else if (!active || active.overview) {
          level = Infinity;
        } else {
          var last = -1;
          steps.forEach(function (st, si) { if (st.buildEl === bel) { last = si; } });
          level = idx > last ? Infinity : 0;
        }
        var kids = bel.querySelectorAll('[data-pwp-build]');
        for (var ki = 0; ki < kids.length; ki++) {
          kids[ki].classList.toggle('pwp-build-hidden', parseInt(kids[ki].getAttribute('data-pwp-build'), 10) > level);
        }
      });
    }

    function goToStep(newIdx, skipTransition) {
      if (!steps.length) { return; }
      var fromIdx = idx;
      idx = Math.max(0, Math.min(steps.length - 1, newIdx));
      var s = steps[idx];
      var target = targetFor(s);
      updateOcclusion();
      updateBuilds();
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
      if (!currentTransform || drawingActive()) { return; }
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

    // Fenstergröße geändert (z.B. Vollbild an/aus): aktuelle Station neu
    // einpassen, sonst läge sie außermittig bzw. im falschen Maßstab.
    var resizeTimer = null;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (steps.length) { goToStep(idx, true); } }, 60);
    }
    window.addEventListener('resize', onResize);

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

    // Überblick-Stationen so erweitern, dass zusätzlich der Bereich b
    // (Board-Koordinaten) sichtbar ist - z.B. Notizen außerhalb der Leinwand.
    function includeInOverview(b) {
      if (!b) { return; }
      steps.forEach(function (st) {
        if (!st.overview) { return; }
        var x1 = Math.min(0, b.x1), y1 = Math.min(0, b.y1), x2 = Math.max(BW, b.x2), y2 = Math.max(BH, b.y2);
        st.cx = (x1 + x2) / 2; st.cy = (y1 + y2) / 2; st.w = (x2 - x1) * 1.04; st.h = (y2 - y1) * 1.04;
        refreshStep(st);
      });
    }

    function destroy() {
      if (destroyed) { return; }
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPenMove);
      window.removeEventListener('pointerup', onPenUp);
      window.removeEventListener('resize', onResize);
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
      includeInOverview: includeInOverview,
      setScreenLayer: setScreenLayer,
      destroy: destroy,
      currentIndex: function () { return idx; }
    };
  }

  // Formen der Stift-Werkzeuge (Pinnwand und Präsentation) als Punktfolge
  // in normalisierten Koordinaten - so funktionieren Zeichnen, Auswahl,
  // Verschieben und Export ohne Sonderfälle. aspect = Breite/Höhe der Fläche
  // (für echte Kreise/Quadrate), square = Umschalt gedrückt.
  function shapePoints(kind, pts, aspect, square) {
    if (!pts || !pts.length) { return []; }
    aspect = aspect || 1;
    var a = pts[0], b = pts[pts.length - 1];
    if ((kind === 'rect' || kind === 'ellipse') && square) {
      var dxp = (b.x - a.x) * aspect, dyp = b.y - a.y, side = Math.max(Math.abs(dxp), Math.abs(dyp));
      b = { x: a.x + (dxp < 0 ? -side : side) / aspect, y: a.y + (dyp < 0 ? -side : side) };
    }
    if (kind === 'rect') {
      return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, { x: a.x, y: a.y }];
    }
    if (kind === 'ellipse') {
      var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2, out = [];
      for (var i = 0; i <= 64; i++) { var t = i / 64 * Math.PI * 2; out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry }); }
      return out;
    }
    if (kind === 'line') {
      if (square) {
        // Umschalt: in 45°-Schritten.
        var lx = (b.x - a.x) * aspect, ly = b.y - a.y, ang = Math.round(Math.atan2(ly, lx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.sqrt(lx * lx + ly * ly);
        b = { x: a.x + Math.cos(ang) * len / aspect, y: a.y + Math.sin(ang) * len };
      }
      return [a, b];
    }
    if (kind === 'curve' && pts.length > 2) {
      // Glatte Kurve durch alle Punkte (Catmull-Rom als kubische Bezier).
      var res = [pts[0]];
      for (var k = 0; k < pts.length - 1; k++) {
        var p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
        for (var j = 1; j <= 12; j++) {
          var u = j / 12, u2 = u * u, u3 = u2 * u;
          res.push({
            x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
            y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3)
          });
        }
      }
      return res;
    }
    return pts.slice();
  }
  var SHAPE_KINDS = ['rect', 'ellipse', 'line', 'poly', 'curve'];
  var SHAPE_SVG = {
    rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="8" ry="6"/></svg>',
    line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19L19 5"/></svg>',
    poly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18l5-10 5 7 6-9"/></svg>',
    curve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 18C8 4 14 22 20 6"/></svg>',
    shapes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="9" height="9" rx="1"/><circle cx="16" cy="8" r="5"/></svg>'
  };

  // Station mit buildCount n wird zu n+1 Stationen mit derselben Kamera:
  // Stufe 0 (nur die festen Objekte) bis Stufe n (alles sichtbar).
  function expandBuildSteps(list) {
    var out = [];
    list.forEach(function (st) {
      out.push(st);
      if (!st || !st.buildEl || !st.buildCount) { return; }
      st.build = 0;
      for (var k = 1; k <= st.buildCount; k++) {
        var c = {};
        for (var key in st) { if (Object.prototype.hasOwnProperty.call(st, key)) { c[key] = st[key]; } }
        c.build = k;
        c.buildOf = st;
        out.push(c);
      }
    });
    return out;
  }

  global.PinnwandPresentation = { create: create, expandBuildSteps: expandBuildSteps, shapePoints: shapePoints, SHAPE_KINDS: SHAPE_KINDS, SHAPE_SVG: SHAPE_SVG, drawInk: drawInk, inkLayer: inkLayer, attachInk: attachInk, inkBounds: inkBounds };
})(window);
