<?php
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$id = required_param('id', PARAM_INT); // course_module id
// Welches Board exportiert werden soll - MUSS explizit übergeben werden
// (der Button in der Klassenübersicht fragt das jetzt vorher ab, analog
// zum Board-Wechsel-Dropdown auf der Pinnwand selbst). Ohne Angabe wird
// Board 0 angenommen (Rückwärtskompatibilität mit alten, gespeicherten
// Export-Links). WICHTIG: vorher wurden die exportierten Boards allein
// aus den boardid-Werten der Roter-Faden-Stationen "erraten" - lag der
// Faden (auch nur teilweise, z.B. durch eine einzelne ältere Station)
// über mehrere Boards verteilt, wurden deren Fotos alle auf DIESELBEN
// 1400x1000-Koordinaten übereinandergelegt ("Dateien doppelt auf der
// exportierten Pinnwand" bzw. "Dateien, die nicht auf der Pinnwand
// sind"). Jetzt wird immer genau EIN Board exportiert.
$boardid = optional_param('boardid', 0, PARAM_INT);

$cm = get_coursemodule_from_id('pinnwand', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$instance = $DB->get_record('pinnwand', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/pinnwand:viewall', $context);

// -----------------------------------------------------------------
// Eigenen Roten Faden (den "offiziellen" der Lehrkraft) + Stationen
// laden - dieselbe Quelle wie die normale Präsentation im Plugin.
// Nur Stationen DIESES Boards werden übernommen (siehe Begründung oben).
// -----------------------------------------------------------------
$thread = $DB->get_record('pinnwand_threads', ['pinnwandid' => $instance->id, 'userid' => $USER->id]);
if (!$thread) {
    throw new moodle_exception('nothreadtoexport', 'mod_pinnwand', new moodle_url('/mod/pinnwand/view.php', ['id' => $cm->id]));
}
$allitems = $DB->get_records('pinnwand_thread_items', ['threadid' => $thread->id], 'sortorder ASC');
$items = array_filter($allitems, function ($it) use ($boardid) {
    return (int) $it->boardid === $boardid;
});

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
        'iswordart' => !empty($photo->wordfielddata),
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

// Alle Fotos, die auf GENAU DIESEM Board sichtbar platziert sind - für
// den Hintergrund-Kontext während der Präsentation (nicht nur die
// Stationen selbst, siehe Verdeckungslogik der Live-Präsentation:
// Objekte auf niedrigeren Ebenen bleiben sichtbar). Frühere Version
// sammelte alle boardids, die IRGENDEINE Roter-Faden-Station referenzierte,
// und mischte so ggf. mehrere Boards auf einer Leinwand zusammen - siehe
// Begründung bei $boardid weiter oben.
//
// Zwei weitere, bis hierhin unentdeckte Bugs derselben Abfrage: (1) es
// fehlte "userid" - boardid ist NICHT global eindeutig, sondern nur pro
// Person (jede Person zählt ihre eigenen Boards bei 0 los), d.h. Board 0
// der Lehrkraft und Board 0 JEDES Lernenden wurden alle zusammen
// eingesammelt und übereinandergelegt ("Dateien doppelt auf der
// exportierten Pinnwand"). (2) es fehlte "status" - gelöschte Objekte
// werden nicht sofort entfernt, sondern landen nur mit status=trash im
// Papierkorb (siehe pinnwand_photos.status-Kommentar), erschienen aber
// im Export weiter ("Dateien, die schon gelöscht worden waren, stören").
$boardphotos = [];
$seenphotoids = [];
$records = $DB->get_records('pinnwand_photos', [
    'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $boardid,
    'boardplaced' => 1, 'hiddenfromboard' => 0, 'status' => 'active',
]);
foreach ($records as $r) {
    $data = pinnwand_export_photo_data((int) $r->id, $context, $fs, $photocache);
    if ($data) {
        $boardphotos[] = $data;
        $seenphotoids[$r->id] = true;
    }
}

// Zusätzliche Platzierungen desselben Boards (z.B. nach Board-Klonen,
// siehe pinnwand_object_placements-Tabellenkommentar): das Objekt selbst
// existiert weiterhin nur einmal in pinnwand_photos, hat aber eine
// EIGENE Position/Rotation/Ebene auf diesem weiteren Board - im Export
// bislang komplett übergangen, dadurch fehlten geklonte Board-Inhalte.
$placements = $DB->get_records_sql(
    "SELECT pl.*
       FROM {pinnwand_object_placements} pl
       JOIN {pinnwand_photos} p ON p.id = pl.photoid
      WHERE pl.pinnwandid = :icid AND pl.boardid = :boardid AND pl.status = 'active'
        AND pl.boardplaced = 1 AND p.userid = :userid AND p.status = 'active'",
    ['icid' => $instance->id, 'boardid' => $boardid, 'userid' => $USER->id]
);
foreach ($placements as $pl) {
    if (isset($seenphotoids[$pl->photoid])) {
        // Dasselbe Foto ist auf diesem Board bereits über seine
        // Heimat-Platzierung vertreten - keine zweite Kachel.
        continue;
    }
    $photodata = pinnwand_export_photo_data((int) $pl->photoid, $context, $fs, $photocache);
    if (!$photodata) {
        continue;
    }
    // Position/Rotation/Ebene DIESER Platzierung verwenden, nicht die der
    // Heimat-Platzierung (die zeigt auf ein anderes Board).
    $photodata['canvasx'] = (float) $pl->canvasx;
    $photodata['canvasy'] = (float) $pl->canvasy;
    $photodata['canvasw'] = (float) $pl->canvasw;
    $photodata['canvasrot'] = (float) $pl->canvasrot;
    $photodata['canvasz'] = (int) $pl->canvasz;
    $boardphotos[] = $photodata;
    $seenphotoids[$pl->photoid] = true;
}

// -----------------------------------------------------------------
// Hintergrund (Farbe/Bild) der Lehrkraft einbetten - bisher im Export
// komplett ignoriert (fest #2b2d33). Eigenständige Datei darf auch hier
// keine pluginfile.php-URLs referenzieren, deshalb Bild-/Upload-
// Hintergründe als Base64 einbetten; ein extern verlinkter Hintergrund
// (Typ "url") wird direkt referenziert, da ein serverseitiger Fremd-
// Fetch hier nicht zuverlässig möglich ist. Der Hintergrund ist laut
// Plugin-Design NICHT pro Board unterschiedlich (ein globaler Wert pro
// Person), daher unabhängig von $boardid.
function pinnwand_export_background_data($instance, $context, $fs) {
    global $USER, $DB;
    $result = ['type' => 'color', 'color' => '#2b2d33', 'url' => null, 'brightness' => 100, 'saturation' => 100, 'fit' => 'contain'];
    $raw = get_user_preferences('mod_pinnwand_bg_' . $instance->id, null, $USER->id);
    if (!$raw) {
        return $result;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return $result;
    }
    $type = $decoded['type'] ?? 'color';
    $result['color'] = clean_param($decoded['color'] ?? $result['color'], PARAM_TEXT);
    $result['brightness'] = max(20, min(180, (int) ($decoded['brightness'] ?? 100)));
    $result['saturation'] = max(0, min(200, (int) ($decoded['saturation'] ?? 100)));
    $fitval = $decoded['fit'] ?? 'contain';
    $result['fit'] = in_array($fitval, ['cover', 'contain'], true) ? $fitval : 'contain';
    if ($type === 'image' && !empty($decoded['photoid'])) {
        $photo = $DB->get_record('pinnwand_photos', ['id' => (int) $decoded['photoid'], 'pinnwandid' => $instance->id]);
        if ($photo) {
            $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $photo->id, 'filename', false);
            $file = reset($files);
            if ($file) {
                $result['type'] = 'image';
                $result['url'] = 'data:' . ($file->get_mimetype() ?: 'image/jpeg') . ';base64,' . base64_encode($file->get_content());
            }
        }
    } else if ($type === 'upload') {
        $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'background', $USER->id, 'filename', false);
        $file = reset($files);
        if ($file) {
            $result['type'] = 'upload';
            $result['url'] = 'data:' . ($file->get_mimetype() ?: 'image/jpeg') . ';base64,' . base64_encode($file->get_content());
        }
    } else if ($type === 'url') {
        $url = clean_param($decoded['url'] ?? '', PARAM_URL);
        if ($url !== '') {
            $result['type'] = 'url';
            $result['url'] = $url;
        }
    }
    return $result;
}
$background = pinnwand_export_background_data($instance, $context, $fs);

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
    'boardid' => $boardid,
    'boardWidth' => 1400,
    'boardHeight' => 1000,
    'background' => $background,
    'thread' => [
        'color' => $thread->color,
        'linewidth' => (float) $thread->linewidth,
        'bgmoves' => (bool) $thread->bgmoves,
        'items' => $exportitems,
    ],
    'boardPhotos' => $boardphotos,
];

// JSON_UNESCAPED_SLASHES bewusst NICHT gesetzt: Base64-eingebettete
// Bilddaten sind zufällig aussehende Zeichenfolgen, die die Sequenz
// "</script" enthalten könnten (bei genug eingebetteten Bildern
// praktisch nicht auszuschließen) - das würde den umschließenden
// <script>-Block vorzeitig beenden und die komplette restliche Seite
// unbrauchbar machen ("nur graue Fläche" statt der Präsentation).
// Mit escapten Schrägstrichen (\/) kann "</script" nicht mehr
// auftreten, ohne die JSON-Gültigkeit zu beeinträchtigen.
$json = json_encode($exportdata, JSON_UNESCAPED_UNICODE);
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
  #bg{position:absolute;z-index:0;}
  #bg.moves{left:0;top:0;width:1400px;height:1000px;}
  #bg-image{position:absolute;left:0;top:0;width:1400px;height:1000px;background-repeat:no-repeat;background-position:center;}
  #canvas.animated{transition:none;}
  .ph{position:absolute;transition:opacity .2s;}
  .ph img{width:100%;display:block;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,.5);}
  .ph.wordart img{border-radius:0;box-shadow:none;}
  .ph.occluded{opacity:0;pointer-events:none;}
  #hint{position:fixed;top:16px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.55);
    padding:6px 16px;border-radius:20px;font-size:.85rem;z-index:20;pointer-events:none;}
  /* Bedienelemente (Zurück/Vorwärts) OHNE grauen Kasten/Rand - nur ein
     kleiner Weichzeichner (blur) des Hintergrunds dahinter plus eine
     kontrastreiche Symbolfarbe (weiß mit dunklem Schlagschatten) heben
     sie hervor, egal was dahinter liegt. */
  #progress{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;
    display:flex;flex-direction:column;align-items:center;}
  #progresshint{color:rgba(255,255,255,.55);font-size:.7rem;text-align:center;margin-bottom:4px;
    text-shadow:0 1px 3px rgba(0,0,0,.7);pointer-events:none;}
  #bottombar{display:flex;align-items:center;gap:14px;}
  #counter{color:#fff;background:rgba(255,255,255,.08);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    padding:6px 16px;border-radius:20px;font-size:.85rem;cursor:pointer;user-select:none;white-space:nowrap;
    text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.5);transition:background .15s ease;}
  #counter:hover{background:rgba(255,255,255,.18);}
  .navbtn{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fff;border:none;
    text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.5);
    font-size:1.3rem;cursor:pointer;flex:0 0 auto;transition:background .15s ease;}
  .navbtn:hover{background:rgba(255,255,255,.18);}
  /* Gestapelte Fortschrittsanzeige - standardmäßig unsichtbar, erscheint
     erst bei Hover über den ganzen Bedienbereich (#progress:hover), zeigt
     dann ALLE Stationen (nicht nur kommende - auch Rücksprünge möglich),
     die letzte Station ganz oben. Bereits gezeigte bleiben matt. */
  #stack{display:flex;flex-direction:column;align-items:center;
    opacity:0;max-height:0;overflow:hidden;pointer-events:none;transition:opacity .15s ease;}
  #progress:hover #stack{opacity:1;max-height:60vh;pointer-events:auto;margin-bottom:8px;}
  .stackseg{width:130px;border-radius:2px;background:rgba(255,255,255,.32);pointer-events:auto;
    cursor:pointer;transition:background .15s ease,transform .1s ease;}
  .stackseg:hover{background:rgba(255,255,255,.85);transform:scaleX(1.04);}
  .stackseg.stackplayed{background:rgba(255,255,255,.12);}
  .stackseg.stackplayed:hover{background:rgba(255,255,255,.4);}
  .stackseg.stackcurrent{background:#4f8cff;}
  .stackseg.stacklast{box-shadow:0 0 0 1px rgba(255,255,255,.6) inset;}
  /* Vorschau-Kachel beim Durchhovern - immer an derselben Bildschirm-
     position, wie ein Daumenkino durchfahrbar. */
  #stackpreview{position:fixed;left:50%;bottom:130px;transform:translateX(-50%);
    width:220px;height:150px;border-radius:8px;z-index:21;
    background:rgba(20,21,24,.85) center/cover no-repeat;
    box-shadow:0 8px 28px rgba(0,0,0,.55);opacity:0;transition:opacity .1s ease;
    pointer-events:none;display:flex;align-items:center;justify-content:center;
    color:rgba(255,255,255,.7);font-size:.8rem;text-align:center;padding:8px;box-sizing:border-box;}
  #stackpreview.visible{opacity:1;}
  .navzone{position:fixed;top:0;bottom:0;width:16%;z-index:15;cursor:pointer;background:transparent;border:none;}
  .navzone.prev{left:0;} .navzone.next{right:0;}
</style>
</head>
<body>
<div id="stage">
  <div id="canvas"></div>
</div>
<div id="stackpreview"></div>
<div id="progress">
  <div id="stack"></div>
  <div id="progresshint">&#8963;</div>
  <div id="bottombar">
    <button class="navbtn" id="prevbtn" aria-label="Zur&uuml;ck">&#8249;</button>
    <div id="counter"></div>
    <button class="navbtn" id="nextbtn" aria-label="Weiter">&#8250;</button>
  </div>
</div>
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
  var stackEl = document.getElementById('stack');
  var previewEl = document.getElementById('stackpreview');
  var progressEl = document.getElementById('progress');
  var prevBtn = document.getElementById('prevbtn');
  var nextBtn = document.getElementById('nextbtn');

  // Hintergrund (Farbe/Bild) - bisher im Export komplett ignoriert (fest
  // dunkelgrau). Dieselbe Logik wie applyBackground() im Plugin selbst:
  // äußeres Element trägt die reine Farbe (auch als "Letterbox" um ein im
  // "contain"-Modus eingepasstes Bild herum), inneres Element (exakt
  // 1400x1000, dasselbe Koordinatensystem wie die Fotos) trägt das
  // eigentliche Bild. "bgmoves" entscheidet, ob der Hintergrund Teil der
  // gezoomten Leinwand ist (#canvas) oder bildschirmfüllend fest steht
  // (#stage, Größe an window.innerWidth/Height gebunden).
  var bg = data.background || { type: 'color', color: '#2b2d33' };
  var bgEl = document.createElement('div');
  bgEl.id = 'bg';
  bgEl.style.backgroundColor = bg.color || '#2b2d33';
  var bgImage = document.createElement('div');
  bgImage.id = 'bg-image';
  bgEl.appendChild(bgImage);
  if ((bg.type === 'image' || bg.type === 'url' || bg.type === 'upload') && bg.url) {
    bgImage.style.backgroundColor = bg.color || '#2b2d33';
    bgImage.style.backgroundImage = "url('" + bg.url + "')";
    bgImage.style.backgroundSize = bg.fit === 'cover' ? 'cover' : 'contain';
  } else {
    bgImage.style.backgroundColor = bg.color || '#2b2d33';
  }
  var bgBrightness = (bg.brightness != null ? bg.brightness : 100);
  var bgSaturation = (bg.saturation != null ? bg.saturation : 100);
  bgImage.style.filter = 'brightness(' + bgBrightness + '%) saturate(' + bgSaturation + '%)';
  if (data.thread && data.thread.bgmoves) {
    bgEl.classList.add('moves');
    canvas.appendChild(bgEl);
  } else {
    bgEl.style.left = '0'; bgEl.style.top = '0';
    bgEl.style.width = window.innerWidth + 'px';
    bgEl.style.height = window.innerHeight + 'px';
    stage.insertBefore(bgEl, canvas);
  }

  // Alle Board-Fotos als feste Ebene aufbauen (Positionen exakt wie auf
  // dem Board) - dieselbe Grundlage wie in der echten Präsentation, wo
  // ALLE platzierten Fotos gezeigt werden, nicht nur die Stationen
  // selbst.
  var photoRecs = {};
  (data.boardPhotos || []).forEach(function (p) {
    if (!p) { return; }
    var pel = document.createElement('div');
    pel.className = 'ph' + (p.iswordart ? ' wordart' : '');
    pel.style.left = p.canvasx + 'px';
    pel.style.top = p.canvasy + 'px';
    pel.style.width = p.canvasw + 'px';
    pel.style.transform = 'rotate(' + (p.canvasrot || 0) + 'deg)';
    pel.style.zIndex = p.canvasz || 0;
    var img = document.createElement('img');
    img.src = p.url; img.alt = '';
    pel.appendChild(img);
    canvas.appendChild(pel);
    photoRecs[p.id] = { el: pel, z: p.canvasz || 0, wordart: !!p.iswordart };
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
        w: it.framew, h: it.frameh, rot: -(it.framerot || 0), z: 0, frame: true
      };
    }
    if (it.photo) {
      var rec = photoRecs[it.photo.id];
      var natW = it.photo.canvasw;
      var img2 = rec ? rec.el.querySelector('img') : null;
      var natH = (img2 && img2.naturalWidth) ? natW * (img2.naturalHeight / img2.naturalWidth) : natW * 0.75;
      // Wortfeld/WordArt-Stationen bekommen etwas Puffer NUR am oberen
      // Rand, damit die Schrift beim Heranzoomen nicht direkt am
      // Bildschirmrand klebt - der untere Rand bleibt unverändert eng
      // (Höhe wächst nur nach oben, Mittelpunkt verschiebt sich passend
      // nach oben, siehe Herleitung: neue Kante oben = alte Kante oben -
      // topPad, neue Kante unten = alte Kante unten).
      var topPad = (rec && rec.wordart) ? natH * 0.12 : 0;
      return {
        cx: it.photo.canvasx + natW / 2, cy: it.photo.canvasy + natH / 2 - topPad / 2,
        w: natW, h: natH + topPad, rot: 0, z: it.photo.canvasz || 0,
        url: img2 ? img2.src : null
      };
    }
    return null;
  }).filter(Boolean);

  // Präsentation startet immer mit einem Überblick über die ganze
  // Pinnwand (falls der Rote Faden nicht selbst schon mit einer
  // Überblick-Station beginnt) - erst danach folgen die eigentlichen
  // Stationen. Manuelles Verschieben/Zoomen (siehe weiter unten) ist von
  // dieser Überblick-Station aus bereits möglich, bevor man mit den
  // Pfeiltasten/Klicks weiter zur ersten echten Station geht.
  if (steps.length && !steps[0].overview) {
    steps.unshift({ cx: (data.boardWidth || 1400) / 2, cy: (data.boardHeight || 1000) / 2, w: data.boardWidth || 1400, h: data.boardHeight || 1000, rot: 0, overview: true });
  }

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

  // Vorschau-Kachel beim Durchhovern des Stapels - immer an derselben
  // Bildschirmposition, unabhängig davon, welche Karte gerade gehovert
  // wird (Daumenkino-Effekt).
  function showPreview(s) {
    if (s.url) {
      previewEl.style.backgroundImage = "url('" + s.url + "')";
      previewEl.textContent = '';
    } else {
      previewEl.style.backgroundImage = 'none';
      previewEl.textContent = s.overview ? 'Übersicht' : (s.frame ? 'Rahmen' : '');
    }
    previewEl.classList.add('visible');
  }
  function hidePreview() { previewEl.classList.remove('visible'); }
  progressEl.addEventListener('mouseleave', hidePreview);

  // Gestapelte Fortschrittsanzeige, standardmäßig unsichtbar (siehe
  // #progress:hover in <style>) - bei Hover über den Bedienbereich
  // erscheint sie vollständig mit ALLEN Stationen (nicht nur kommenden -
  // auch Rücksprünge sind so möglich), die LETZTE Station ganz oben.
  // Bereits gezeigte Stationen bleiben matt, die aktuelle ist
  // hervorgehoben. Hover über eine Karte zeigt deren Vorschau, Klick
  // springt direkt dorthin - siehe .ic-present-stack im Plugin selbst
  // (dieselbe Darstellung).
  function renderStack() {
    stackEl.innerHTML = '';
    var segH = Math.max(2, Math.min(6, Math.floor(320 / Math.max(1, steps.length))));
    var gap = segH >= 4 ? 2 : 1;
    for (var si = steps.length - 1; si >= 0; si--) {
      (function (si) {
        var cls = 'stackseg';
        if (si === steps.length - 1) { cls += ' stacklast'; }
        if (si === idx) { cls += ' stackcurrent'; }
        else if (si < idx) { cls += ' stackplayed'; }
        var seg = document.createElement('div');
        seg.className = cls;
        seg.style.height = segH + 'px';
        seg.style.marginBottom = gap + 'px';
        seg.addEventListener('click', function () { goToStep(si); });
        seg.addEventListener('mouseenter', function () { showPreview(steps[si]); });
        seg.addEventListener('mouseleave', hidePreview);
        stackEl.appendChild(seg);
      })(si);
    }
  }

  var idx = 0;
  var currentTransform = null;
  // Übersicht-Station (falls vorhanden) merken - ein Klick auf den Zähler
  // selbst springt direkt dorthin, unabhängig von der aktuellen Position.
  var overviewIdx = 0;
  for (var oi = 0; oi < steps.length; oi++) { if (steps[oi].overview) { overviewIdx = oi; break; } }
  function goToStep(newIdx, skipTransition) {
    var fromIdx = idx;
    idx = Math.max(0, Math.min(steps.length - 1, newIdx));
    var s = steps[idx];
    if (!s) { return; }
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
  window.pinnwandStep = function (dir) { goToStep(idx + dir); };

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowRight' || ev.key === ' ') { pinnwandStep(1); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { pinnwandStep(-1); }
  });
  document.querySelector('.navzone.prev').addEventListener('click', function () { pinnwandStep(-1); });
  document.querySelector('.navzone.next').addEventListener('click', function () { pinnwandStep(1); });
  prevBtn.addEventListener('click', function () { pinnwandStep(-1); });
  nextBtn.addEventListener('click', function () { pinnwandStep(1); });
  counter.addEventListener('click', function () { goToStep(overviewIdx); });

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
