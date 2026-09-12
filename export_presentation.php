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
  html,body{margin:0;padding:0;background:#111;overflow:hidden;height:100%;font-family:sans-serif;}
  #stage{position:absolute;inset:0;overflow:hidden;}
  #camera{position:absolute;left:0;top:0;transform-origin:0 0;transition:transform 1.1s cubic-bezier(.4,0,.2,1);}
  .ph{position:absolute;}
  .ph img{width:100%;display:block;border-radius:4px;}
  #hint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.5);
    padding:6px 14px;border-radius:20px;font-size:.85rem;z-index:10;}
  #counter{position:fixed;top:14px;right:14px;color:#fff;background:rgba(0,0,0,.5);padding:4px 10px;border-radius:12px;font-size:.85rem;z-index:10;}
  #nav{position:fixed;top:0;bottom:0;width:20%;z-index:5;cursor:pointer;}
  #navprev{left:0;} #navnext{right:0;}
</style>
</head>
<body>
<div id="stage"><div id="camera"></div></div>
<div id="counter"></div>
<div id="hint">&#8592; &#8594; oder Klick zum Navigieren</div>
<div id="nav" id="navprev" style="left:0;" onclick="pinnwandStep(-1)"></div>
<div id="nav" id="navnext" style="right:0;" onclick="pinnwandStep(1)"></div>
<script type="application/json" id="pinnwand-export-data">
{$json}
</script>
<script>
(function(){
  var data = JSON.parse(document.getElementById('pinnwand-export-data').textContent);
  var camera = document.getElementById('camera');
  var stage = document.getElementById('stage');
  var counter = document.getElementById('counter');
  var BOARD_W = data.boardWidth || 1400, BOARD_H = data.boardHeight || 1000;

  // Alle Board-Fotos einmal als Hintergrund-Ebene aufbauen (feste
  // Positionen, werden von der Kamera nur mit-verschoben/skaliert).
  (data.boardPhotos || []).forEach(function(p){
    if (!p) return;
    var el = document.createElement('div');
    el.className = 'ph';
    el.style.left = p.canvasx + 'px';
    el.style.top = p.canvasy + 'px';
    el.style.width = p.canvasw + 'px';
    el.style.transform = 'rotate(' + (p.canvasrot||0) + 'deg)';
    el.style.zIndex = p.canvasz || 0;
    el.innerHTML = '<img src="' + p.url + '" alt="">';
    camera.appendChild(el);
  });

  var items = (data.thread && data.thread.items) || [];
  var idx = 0;

  function applyStep(i) {
    var it = items[i];
    if (!it) return;
    var fx, fy, fw, fh;
    if (it.itemtype === 'photo' && it.photo) {
      fw = it.photo.canvasw; fh = fw; // Höhe folgt näherungsweise der Breite (quadratisches Verhältnis als Fallback)
      fx = it.photo.canvasx; fy = it.photo.canvasy;
    } else {
      fx = it.framex; fy = it.framey; fw = it.framew; fh = it.frameh;
    }
    var scale = Math.min(stage.clientWidth / fw, stage.clientHeight / fh);
    var tx = stage.clientWidth / 2 - (fx + fw / 2) * scale;
    var ty = stage.clientHeight / 2 - (fy + fh / 2) * scale;
    camera.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    counter.textContent = (i + 1) + ' / ' + items.length + (it.framelabel ? ' \u2013 ' + it.framelabel : '');
  }

  window.pinnwandStep = function(dir) {
    idx = Math.max(0, Math.min(items.length - 1, idx + dir));
    applyStep(idx);
  };
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'ArrowRight' || ev.key === ' ') { pinnwandStep(1); }
    else if (ev.key === 'ArrowLeft') { pinnwandStep(-1); }
  });
  if (items.length) { applyStep(0); }
  else { document.getElementById('hint').textContent = 'Kein Roter Faden mit Stationen vorhanden.'; }
})();
</script>
</body>
</html>
HTML;
}
