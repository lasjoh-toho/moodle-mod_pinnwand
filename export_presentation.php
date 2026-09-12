<?php
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$id = required_param('id', PARAM_INT); // course_module id

$cm = get_coursemodule_from_id('pinnwand', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$instance = $DB->get_record('pinnwand', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/pinnwand:viewall', $context);

// -----------------------------------------------------------------
// Eigenen Roten Faden (den "offiziellen" der Lehrkraft) + Stationen
// laden - dieselbe Quelle wie die normale Präsentation im Plugin.
// -----------------------------------------------------------------
$thread = $DB->get_record('pinnwand_threads', ['pinnwandid' => $instance->id, 'userid' => $USER->id]);
if (!$thread) {
    throw new moodle_exception('nothreadtoexport', 'mod_pinnwand', new moodle_url('/mod/pinnwand/view.php', ['id' => $cm->id]));
}
$items = $DB->get_records('pinnwand_thread_items', ['threadid' => $thread->id], 'sortorder ASC');

$fs = get_file_storage();

// -----------------------------------------------------------------
// Jedes referenzierte Foto einmal laden, Datei als Base64 einbetten -
// eine eigenständige Datei darf keine pluginfile.php-URLs referenzieren,
// die außerhalb Moodles nicht erreichbar wären.
// -----------------------------------------------------------------
$photocache = [];
function pinnwand_export_photo_data($photoid, $context, $fs, &$photocache) {
    if ($photoid <= 0) {
        return null;
    }
    if (isset($photocache[$photoid])) {
        return $photocache[$photoid];
    }
    global $DB;
    $photo = $DB->get_record('pinnwand_photos', ['id' => $photoid]);
    if (!$photo) {
        return $photocache[$photoid] = null;
    }
    $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $photoid, 'itemid', false);
    $file = reset($files);
    if (!$file) {
        return $photocache[$photoid] = null;
    }
    $binary = $file->get_content();
    $mimetype = $file->get_mimetype() ?: 'image/svg+xml';
    $dataurl = 'data:' . $mimetype . ';base64,' . base64_encode($binary);
    $result = [
        'id' => (int) $photo->id,
        'url' => $dataurl,
        'canvasx' => (float) $photo->canvasx,
        'canvasy' => (float) $photo->canvasy,
        'canvasw' => (float) $photo->canvasw,
        'canvasrot' => (float) $photo->canvasrot,
        'canvasz' => (int) $photo->canvasz,
    ];
    return $photocache[$photoid] = $result;
}

$exportitems = [];
foreach ($items as $it) {
    $entry = [
        'itemtype' => $it->itemtype,
        'framex' => (float) $it->framex,
        'framey' => (float) $it->framey,
        'framew' => (float) $it->framew,
        'frameh' => (float) $it->frameh,
        'framerot' => (float) $it->framerot,
        'framelabel' => (string) ($it->framelabel ?? ''),
    ];
    if ($it->itemtype === 'photo' && $it->photoid) {
        $entry['photo'] = pinnwand_export_photo_data((int) $it->photoid, $context, $fs, $photocache);
    }
    $exportitems[] = $entry;
}

// Alle Fotos, die überhaupt auf dem/den betroffenen Board(s) sichtbar
// platziert sind - für den Hintergrund-Kontext während der Präsentation
// (nicht nur die Stationen selbst, siehe Verdeckungslogik der Live-
// Präsentation: Objekte auf niedrigeren Ebenen bleiben sichtbar).
$boardids = [];
foreach ($items as $it) {
    if (!empty($it->boardid)) {
        $boardids[$it->boardid] = true;
    }
}
$boardphotos = [];
if (!empty($boardids)) {
    [$insql, $inparams] = $DB->get_in_or_equal(array_keys($boardids));
    $records = $DB->get_records_select(
        'pinnwand_photos',
        "pinnwandid = ? AND boardplaced = 1 AND hiddenfromboard = 0 AND boardid $insql",
        array_merge([$instance->id], $inparams)
    );
    foreach ($records as $r) {
        $data = pinnwand_export_photo_data((int) $r->id, $context, $fs, $photocache);
        if ($data) {
            $boardphotos[] = $data;
        }
    }
}

// -----------------------------------------------------------------
// Versionierter Datenblock - bewusst so aufgebaut, dass ein späterer
// Re-Import (in dieselbe oder eine andere Pinnwand-Instanz) möglich
// wäre: klare formatVersion, vollständige Positions-/Rotationsdaten,
// eingebettete Bilddaten statt bloßer Referenzen.
// -----------------------------------------------------------------
$exportdata = [
    'formatVersion' => 1,
    'exportedAt' => time(),
    'pluginVersion' => get_config('mod_pinnwand', 'version'),
    'boardWidth' => 1400,
    'boardHeight' => 1000,
    'thread' => [
        'color' => $thread->color,
        'linewidth' => (float) $thread->linewidth,
        'bgmoves' => (bool) $thread->bgmoves,
        'items' => $exportitems,
    ],
    'boardPhotos' => $boardphotos,
];

$json = json_encode($exportdata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$title = format_string($instance->name) . ' - Präsentation';

// -----------------------------------------------------------------
// Eigenständige HTML-Datei: eingebettetes CSS/JS, keine externen
// Abhängigkeiten, kein Moodle nötig zum Abspielen. Der Datenblock
// steckt als eigenes <script type="application/json">, klar getrennt
// von der Abspiel-Logik - für einen möglichen späteren Re-Import.
// -----------------------------------------------------------------
$html = pinnwand_export_build_html($title, $json);

$filename = clean_filename(format_string($instance->name) . '-praesentation.html');
header('Content-Type: text/html; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Content-Length: ' . strlen($html));
echo $html;
die;

function pinnwand_export_build_html($title, $json) {
    $titleesc = htmlspecialchars($title, ENT_QUOTES);
    return <<<HTML
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>{$titleesc}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#2b2d33;overflow:hidden;height:100%;font-family:sans-serif;}
  #stage{position:fixed;inset:0;overflow:hidden;cursor:grab;}
  #stage.dragging{cursor:grabbing;}
  #canvas{position:absolute;left:0;top:0;transform-origin:0 0;}
  #canvas.animated{transition:none;}
  .ph{position:absolute;transition:opacity .2s;}
  .ph img{width:100%;display:block;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,.5);}
  .ph.occluded{opacity:0;pointer-events:none;}
  #hint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.55);
    padding:6px 16px;border-radius:20px;font-size:.85rem;z-index:20;pointer-events:none;}
  #counter{position:fixed;top:14px;right:16px;color:#fff;background:rgba(0,0,0,.55);padding:5px 12px;border-radius:12px;font-size:.85rem;z-index:20;}
  .navzone{position:fixed;top:0;bottom:0;width:16%;z-index:15;cursor:pointer;background:transparent;border:none;}
  .navzone.prev{left:0;} .navzone.next{right:0;}
</style>
</head>
<body>
<div id="stage">
  <div id="canvas"></div>
</div>
<div id="counter"></div>
<div id="hint">&#8592; &#8594; oder Leertaste zum Navigieren, Klick au&szlig;erhalb zum Verschieben, Mausrad zum Zoomen</div>
<button class="navzone prev" aria-label="Zur&uuml;ck"></button>
<button class="navzone next" aria-label="Weiter"></button>
<script type="application/json" id="pinnwand-export-data">
{$json}
</script>
<script>
(function(){
  var data = JSON.parse(document.getElementById('pinnwand-export-data').textContent);
  var stage = document.getElementById('stage');
  var canvas = document.getElementById('canvas');
  var counter = document.getElementById('counter');
  var hint = document.getElementById('hint');

  // Alle Board-Fotos als feste Ebene aufbauen (Positionen exakt wie auf
  // dem Board) - dieselbe Grundlage wie in der echten Präsentation, wo
  // ALLE platzierten Fotos gezeigt werden, nicht nur die Stationen
  // selbst.
  var photoRecs = {};
  (data.boardPhotos || []).forEach(function (p) {
    if (!p) { return; }
    var pel = document.createElement('div');
    pel.className = 'ph';
    pel.style.left = p.canvasx + 'px';
    pel.style.top = p.canvasy + 'px';
    pel.style.width = p.canvasw + 'px';
    pel.style.transform = 'rotate(' + (p.canvasrot || 0) + 'deg)';
    pel.style.zIndex = p.canvasz || 0;
    var img = document.createElement('img');
    img.src = p.url; img.alt = '';
    pel.appendChild(img);
    canvas.appendChild(pel);
    photoRecs[p.id] = { el: pel, z: p.canvasz || 0 };
  });

  // Stationen (Fotos, Rahmen als reine Zoom-Ziele, Überblick) genau wie
  // im Original aufbauen - dieselbe Datenstruktur (buildStep in
  // openPresentation()).
  var items = (data.thread && data.thread.items) || [];
  var steps = items.map(function (it) {
    if (it.itemtype === 'overview') {
      return { cx: (data.boardWidth || 1400) / 2, cy: (data.boardHeight || 1000) / 2, w: data.boardWidth || 1400, h: data.boardHeight || 1000, rot: 0, overview: true };
    }
    if (it.itemtype === 'frame') {
      return {
        cx: it.framex + it.framew / 2, cy: it.framey + it.frameh / 2,
        w: it.framew, h: it.frameh, rot: -(it.framerot || 0), z: 0
      };
    }
    if (it.photo) {
      var rec = photoRecs[it.photo.id];
      var natW = it.photo.canvasw;
      var img2 = rec ? rec.el.querySelector('img') : null;
      var natH = (img2 && img2.naturalWidth) ? natW * (img2.naturalHeight / img2.naturalWidth) : natW * 0.75;
      return { cx: it.photo.canvasx + natW / 2, cy: it.photo.canvasy + natH / 2, w: natW, h: natH, rot: 0, z: it.photo.canvasz || 0 };
    }
    return null;
  }).filter(Boolean);

  function targetFor(s) {
    return { scale: Math.min(window.innerWidth / s.w, window.innerHeight / s.h), cx: s.cx, cy: s.cy, rot: s.rot || 0 };
  }

  // Dieselbe Kamera-Transformation wie im Original: translate(tx,ty)
  // rotate(rot) scale(scale) mit transform-origin 0 0 - cx/cy müssen VOR
  // der Verschiebungsberechnung um "rot" gedreht werden, sonst landet der
  // Zielpunkt bei gedrehten Rahmen nicht in der Bildschirmmitte.
  function applyTransform(scale, cx, cy, rot) {
    var rad = (rot || 0) * Math.PI / 180;
    var rx = cx * Math.cos(rad) - cy * Math.sin(rad);
    var ry = cx * Math.sin(rad) + cy * Math.cos(rad);
    var tx = window.innerWidth / 2 - scale * rx;
    var ty = window.innerHeight / 2 - scale * ry;
    canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) rotate(' + (rot || 0) + 'deg) scale(' + scale + ')';
  }

  function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  var cameraFrame = null;
  // Dieselbe "Bogen"-Animation wie im Original: bei weiten Wegen kurz
  // stärker herauszoomen (Überblick über die Strecke), bevor zur
  // Zielstation gelandet wird.
  function animateCamera(from, to, onDone) {
    if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
    var dist = Math.sqrt(Math.pow(to.cx - from.cx, 2) + Math.pow(to.cy - from.cy, 2));
    var duration = Math.min(2400, Math.max(500, 550 + dist * 0.55));
    var hopFactor = Math.min(0.55, Math.max(0, (dist - 120) / 1800));
    var hopAmount = Math.min(from.scale, to.scale) * hopFactor;
    var rotDelta = (to.rot - from.rot + 540) % 360 - 180;
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
  // werden ausgeblendet - dieselbe Regel wie im Original (updateOcclusion).
  function updateOcclusion() {
    var active = steps[idx];
    if (!active || active.overview) {
      Object.keys(photoRecs).forEach(function (pid) { photoRecs[pid].el.classList.remove('occluded'); });
      return;
    }
    var activeZ = active.z || 0;
    Object.keys(photoRecs).forEach(function (pid) {
      var rec = photoRecs[pid];
      rec.el.classList.toggle('occluded', rec.z > activeZ);
    });
  }

  var idx = 0;
  var currentTransform = null;
  function goToStep(newIdx, skipTransition) {
    var fromIdx = idx;
    idx = Math.max(0, Math.min(steps.length - 1, newIdx));
    var s = steps[idx];
    if (!s) { return; }
    var target = targetFor(s);
    updateOcclusion();
    counter.textContent = (idx + 1) + ' / ' + steps.length;
    if (skipTransition || fromIdx === idx || !currentTransform) {
      if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = null; }
      applyTransform(target.scale, target.cx, target.cy, target.rot);
      currentTransform = target;
      return;
    }
    animateCamera(currentTransform, target, function () { currentTransform = target; });
    currentTransform = target;
  }
  window.pinnwandStep = function (dir) { goToStep(idx + dir); };

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowRight' || ev.key === ' ') { pinnwandStep(1); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { pinnwandStep(-1); }
  });
  document.querySelector('.navzone.prev').addEventListener('click', function () { pinnwandStep(-1); });
  document.querySelector('.navzone.next').addEventListener('click', function () { pinnwandStep(1); });

  // Manuelles Verschieben/Zoomen zwischen den Stationen - wie im Original,
  // damit man sich die Umgebung auch selbst ansehen kann.
  var dragging = false, dragStartX = 0, dragStartY = 0, dragStartCx = 0, dragStartCy = 0;
  stage.addEventListener('pointerdown', function (ev) {
    if (ev.target.closest('.navzone') || !currentTransform) { return; }
    dragging = true; stage.classList.add('dragging');
    dragStartX = ev.clientX; dragStartY = ev.clientY;
    dragStartCx = currentTransform.cx; dragStartCy = currentTransform.cy;
  });
  window.addEventListener('pointermove', function (ev) {
    if (!dragging || !currentTransform) { return; }
    var rad = (currentTransform.rot || 0) * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var dx = ev.clientX - dragStartX, dy = ev.clientY - dragStartY;
    currentTransform.cx = dragStartCx - (dx * cos + dy * sin) / currentTransform.scale;
    currentTransform.cy = dragStartCy - (-dx * sin + dy * cos) / currentTransform.scale;
    applyTransform(currentTransform.scale, currentTransform.cx, currentTransform.cy, currentTransform.rot);
  });
  window.addEventListener('pointerup', function () { dragging = false; stage.classList.remove('dragging'); });
  stage.addEventListener('wheel', function (ev) {
    if (!currentTransform) { return; }
    ev.preventDefault();
    var newScale = Math.max(0.05, Math.min(8, currentTransform.scale * (ev.deltaY < 0 ? 1.1 : 0.9)));
    var rad = (currentTransform.rot || 0) * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var dx = ev.clientX - window.innerWidth / 2, dy = ev.clientY - window.innerHeight / 2;
    var wx = currentTransform.cx + (dx * cos + dy * sin) / currentTransform.scale;
    var wy = currentTransform.cy + (-dx * sin + dy * cos) / currentTransform.scale;
    currentTransform.scale = newScale;
    currentTransform.cx = wx - (dx * cos + dy * sin) / newScale;
    currentTransform.cy = wy - (-dx * sin + dy * cos) / newScale;
    applyTransform(currentTransform.scale, currentTransform.cx, currentTransform.cy, currentTransform.rot);
  }, { passive: false });

  if (steps.length) {
    goToStep(0, true);
    setTimeout(function () { hint.style.opacity = '0'; hint.style.transition = 'opacity 1s'; }, 4000);
  } else {
    hint.textContent = 'Kein Roter Faden mit Stationen vorhanden.';
  }
})();
</script>
</body>
</html>
HTML;
}
