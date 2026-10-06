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
// Optional (Checkboxen im Export-Dialog): Annotationen auf den einzelnen
// Objekten bzw. die Notizen des Stylus-Werkzeugs direkt auf der Pinnwand
// mit exportieren. In der exportierten Datei lassen sie sich dann - wie im
// Modul - ein- und ausblenden. Ohne Angabe (alte Export-Links) wie bisher
// nicht enthalten.
$includeannot = optional_param('annot', 0, PARAM_BOOL);
$includeink = optional_param('ink', 0, PARAM_BOOL);

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
/**
 * Anzahl der Animationsschritte einer Folie - wie slideAnimMap() in js/app.js.
 *
 * @param array $tf Wortfeld-Daten
 * @return int
 */
function pinnwand_export_anim_steps(array $tf): int {
    $exists = [];
    foreach (($tf['texts'] ?? []) as $t) {
        $exists['t' . ($t['id'] ?? '')] = true;
    }
    foreach (($tf['shapes'] ?? []) as $sh) {
        if (empty($sh['main'])) {
            $exists['s' . ($sh['id'] ?? '')] = true;
        }
    }
    $steps = 0;
    $seen = [];
    foreach (($tf['anim'] ?? []) as $a) {
        $key = is_array($a) ? ($a['key'] ?? '') : '';
        if ($key === '' || empty($exists[$key]) || isset($seen[$key])) {
            continue;
        }
        if (!(!empty($a['withPrev']) && $steps > 0)) {
            $steps++;
        }
        $seen[$key] = true;
    }
    return $steps;
}

function pinnwand_export_photo_data($photoid, $context, $fs, &$photocache, $includeannot = false) {
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
        'blendmode' => (string) ($photo->blendmode ?? ''),
    ];
    // Annotationen des Objekts nur, wenn gewünscht UND auf der Pinnwand
    // sichtbar geschaltet (annotationonboard) - genau das, was man dort sieht.
    if (!empty($includeannot) && !empty($photo->annotationonboard) && !empty($photo->annotationdata)) {
        $strokes = json_decode($photo->annotationdata, true);
        if (is_array($strokes) && count($strokes)) {
            $result['annotation'] = $strokes;
        }
    }
    // Wortfelder (Zettel/WordArt): auf der Pinnwand entspricht canvasw der
    // Breite der KARTE (tf.w), das gespeicherte SVG ist aber größer (viewBox
    // umfasst zusätzlich über die Karte hinausragende WordArt, x/y meist
    // negativ). Wurde das SVG einfach auf canvasw Breite gezeigt, erschien
    // der Inhalt kleiner und verschoben gegenüber der Pinnwand. Mit
    // Kartengröße + viewBox kann die Abspiel-Logik das Bild so platzieren,
    // dass die Karte exakt auf ihrer Board-Position liegt.
    if (!empty($photo->wordfielddata)) {
        $tf = json_decode($photo->wordfielddata, true);
        if (is_array($tf) && !empty($tf['w']) && !empty($tf['h'])) {
            $result['tfw'] = (float) $tf['w'];
            $result['tfh'] = (float) $tf['h'];
            $haswordart = !empty($tf['isWordArt']);
            foreach (($tf['texts'] ?? []) as $t) {
                if (!empty($t['wordartStyle']) && $t['wordartStyle'] !== 'none') {
                    $haswordart = true;
                }
            }
            // Folie: Zoom-Ziel ist der Rahmen selbst; Animationsschritte
            // zählen wie slideAnimMap() in js/app.js.
            if (!empty($tf['isSlide'])) {
                $haswordart = false;
                $result['slide'] = true;
                $result['animsteps'] = pinnwand_export_anim_steps($tf);
            }
            $result['wordartframe'] = $haswordart;
            if (preg_match('/<svg\b[^>]*\sviewBox="([^"]+)"/i', $binary, $m)) {
                $vb = array_map('floatval', preg_split('/[\s,]+/', trim($m[1])));
                if (count($vb) === 4 && $vb[2] > 0 && $vb[3] > 0) {
                    $result['vb'] = $vb;
                }
            }
        }
    }
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
        'framez' => (int) ($it->framez ?? 0),
        'framelabel' => (string) ($it->framelabel ?? ''),
    ];
    if ($it->itemtype === 'photo' && $it->photoid) {
        $entry['photo'] = pinnwand_export_photo_data((int) $it->photoid, $context, $fs, $photocache, $includeannot);
    }
    // Folie (Rahmen mit Inhalt): gerendertes SVG, Animationsschritte, Mischmodus.
    if ($it->itemtype === 'frame' && !empty($it->framedata) && !empty($it->framesvg)) {
        $ftf = json_decode($it->framedata, true);
        if (is_array($ftf)) {
            $entry['framesvg'] = (string) $it->framesvg;
            $entry['animsteps'] = pinnwand_export_anim_steps($ftf);
            $entry['blend'] = in_array($ftf['blend'] ?? '', ['multiply', 'difference', 'color-burn'], true) ? $ftf['blend'] : '';
            // Folien-Hintergrund (Farbe/Deckkraft/Weichzeichnen) und mit der
            // Folie verknüpfte Objekte (bleiben trotz höherer Ebene sichtbar).
            $sbg = is_array($ftf['slideBg'] ?? null) ? $ftf['slideBg'] : [];
            $entry['slidebg'] = [
                'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($sbg['color'] ?? '')) ? $sbg['color'] : '#000000',
                'opacity' => max(0, min(100, (int) ($sbg['opacity'] ?? 0))),
                'blur' => max(0, min(30, (int) ($sbg['blur'] ?? 0))),
                'invert' => max(0, min(100, (int) ($sbg['invert'] ?? 0))),
                'brightness' => max(0, min(200, (int) ($sbg['brightness'] ?? 100))),
            ];
            $entry['bgpersist'] = !empty($ftf['bgPersist']);
            $entry['bgshowbefore'] = !empty($ftf['bgShowBefore']);
            $entry['linked'] = array_values(array_map('intval', is_array($ftf['linked'] ?? null) ? $ftf['linked'] : []));
        }
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
    $data = pinnwand_export_photo_data((int) $r->id, $context, $fs, $photocache, $includeannot);
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
    $photodata = pinnwand_export_photo_data((int) $pl->photoid, $context, $fs, $photocache, $includeannot);
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
    $result = ['type' => 'color', 'color' => '#2b2d33', 'url' => null, 'brightness' => 100, 'saturation' => 100, 'invert' => 0, 'fit' => 'contain'];
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
    $result['invert'] = max(0, min(100, (int) ($decoded['invert'] ?? 0)));
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
// Präsentationsstart: eigene Wahl (Hintergrund-Einstellungen), sonst die
// Einstellung der Aktivität.
$exportstartmode = (($instance->startmode ?? 'overview') === 'slide') ? 'slide' : 'overview';
$bgprefraw = get_user_preferences('mod_pinnwand_bg_' . $instance->id, null, $USER->id);
$bgpref = $bgprefraw ? json_decode($bgprefraw, true) : null;
if (is_array($bgpref) && in_array($bgpref['startmode'] ?? '', ['overview', 'slide'], true)) {
    $exportstartmode = $bgpref['startmode'];
}

// -----------------------------------------------------------------
// Versionierter Datenblock - bewusst so aufgebaut, dass ein späterer
// Re-Import (in dieselbe oder eine andere Pinnwand-Instanz) möglich
// wäre: klare formatVersion, vollständige Positions-/Rotationsdaten,
// eingebettete Bilddaten statt bloßer Referenzen.
// -----------------------------------------------------------------
// Notizen des Stylus-Werkzeugs auf diesem Board (eigene, wie in der
// Präsentation im Modul).
$boardink = [];
if ($includeink) {
    $inkrow = $DB->get_record('pinnwand_board_ink', [
        'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $boardid,
    ]);
    if ($inkrow && !empty($inkrow->strokedata)) {
        $decodedink = json_decode($inkrow->strokedata, true);
        if (is_array($decodedink)) {
            $boardink = $decodedink;
        }
    }
}

$exportdata = [
    'formatVersion' => 1,
    'exportedAt' => time(),
    'pluginVersion' => get_config('mod_pinnwand', 'version'),
    'boardid' => $boardid,
    'boardWidth' => 1400,
    'startMode' => $exportstartmode,
    'boardHeight' => 1000,
    'background' => $background,
    'thread' => [
        'color' => $thread->color,
        'linewidth' => (float) $thread->linewidth,
        'bgmoves' => (bool) $thread->bgmoves,
        'items' => $exportitems,
    ],
    'boardPhotos' => $boardphotos,
    'boardInk' => $boardink,
    'labels' => [
        'ink' => get_string('present_toggle_ink', 'pinnwand'),
        'annot' => get_string('present_toggle_annot', 'pinnwand'),
        'pen' => get_string('present_pen', 'pinnwand'),
        'penDraw' => get_string('present_pen_draw', 'pinnwand'),
        'penText' => get_string('present_pen_text', 'pinnwand'),
        'penErase' => get_string('present_pen_erase', 'pinnwand'),
        'penSize' => get_string('present_pen_size', 'pinnwand'),
        'penClear' => get_string('present_pen_clear', 'pinnwand'),
        'penShapes' => get_string('ink_tool_shapes', 'pinnwand'),
        'shapes' => [
            'rect' => get_string('ink_shape_rect', 'pinnwand'),
            'ellipse' => get_string('ink_shape_ellipse', 'pinnwand'),
            'line' => get_string('ink_shape_line', 'pinnwand'),
            'poly' => get_string('ink_shape_poly', 'pinnwand'),
            'curve' => get_string('ink_shape_curve', 'pinnwand'),
        ],
        'show' => get_string('present_show', 'pinnwand'),
        'hide' => get_string('present_hide', 'pinnwand'),
        'hint' => get_string('present_hint', 'pinnwand'),
        'prev' => get_string('present_prev', 'pinnwand'),
        'next' => get_string('present_next', 'pinnwand'),
        'overview' => get_string('present_overview', 'pinnwand'),
        'frame' => get_string('present_frame', 'pinnwand'),
        'empty' => get_string('present_empty', 'pinnwand'),
    ],
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
    // Navigation/Kamera/Bedienelemente: WÖRTLICH dieselbe Datei wie die
    // Live-Präsentation in Moodle (js/presentation-player.js) - dadurch
    // bedienen sich Export und Moodle-Präsentation garantiert identisch.
    // Die Datei enthält kein "</script" (würde den Block vorzeitig
    // beenden) - zur Sicherheit trotzdem entschärft.
    $player = str_ireplace('</script', '<\/script', (string) file_get_contents(__DIR__ . '/js/presentation-player.js'));
    return <<<HTML
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>{$titleesc}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#2b2d33;overflow:hidden;height:100%;font-family:sans-serif;}
  #bg{position:absolute;z-index:0;}
  #bg.moves{left:0;top:0;width:1400px;height:1000px;}
  #bg-image{position:absolute;left:0;top:0;width:1400px;height:1000px;background-repeat:no-repeat;background-position:center;}
  .ph{position:absolute;transition:opacity .2s;}
  .ph img{width:100%;display:block;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,.5);}
  .ph.wordart img{border-radius:0;box-shadow:none;}
  /* Wortfeld mit bekannter Kartengröße/viewBox: .ph ist exakt die Karte
     (wie auf der Pinnwand, dreht sich auch um deren Mitte), das Bild
     ragt so weit darüber hinaus, wie seine viewBox es vorgibt. */
  .ph.wordfield-mapped img{position:absolute;max-width:none;}
</style>
</head>
<body>
<div id="player"></div>
<script type="application/json" id="pinnwand-export-data">
{$json}
</script>
<script>
{$player}
</script>
<script>
(function(){
  var data = JSON.parse(document.getElementById('pinnwand-export-data').textContent);
  var BW = data.boardWidth || 1400, BH = data.boardHeight || 1000;
  // Rand je Seite beim Heranzoomen an eine Station - identisch mit
  // PRESENT_STEP_MARGIN in app.js (Live-Präsentation).
  var STEP_MARGIN = 0.05;
  var player = PinnwandPresentation.create(document.getElementById('player'), { labels: data.labels || {} });
  var stage = player.stage;
  var canvas = player.canvas;

  // Hintergrund (Farbe/Bild) - dieselbe Logik wie applyBackground() im
  // Plugin: äußeres Element trägt die reine Farbe (auch als "Letterbox" um
  // ein im "contain"-Modus eingepasstes Bild herum), inneres Element
  // (exakt 1400x1000, dasselbe Koordinatensystem wie die Fotos) trägt das
  // eigentliche Bild. "bgmoves" entscheidet, ob der Hintergrund Teil der
  // gezoomten Leinwand ist oder bildschirmfüllend fest steht.
  var bg = data.background || { type: 'color', color: '#2b2d33' };
  // Farbe zusätzlich direkt auf body, damit sie in JEDEM Fall sichtbar
  // bleibt (auch wenn Farbe UND Bild zusammen gewählt sind).
  document.body.style.backgroundColor = bg.color || '#2b2d33';
  var bgEl = document.createElement('div');
  bgEl.id = 'bg';
  bgEl.style.backgroundColor = bg.color || '#2b2d33';
  var bgImage = document.createElement('div');
  bgImage.id = 'bg-image';
  bgEl.appendChild(bgImage);
  bgImage.style.backgroundColor = bg.color || '#2b2d33';
  if ((bg.type === 'image' || bg.type === 'url' || bg.type === 'upload') && bg.url) {
    bgImage.style.backgroundImage = "url('" + bg.url + "')";
    bgImage.style.backgroundSize = bg.fit === 'cover' ? 'cover' : 'contain';
  }
  var bgBrightness = (bg.brightness != null ? bg.brightness : 100);
  var bgSaturation = (bg.saturation != null ? bg.saturation : 100);
  var bgInvert = (bg.invert != null ? bg.invert : 0);
  bgImage.style.filter = 'brightness(' + bgBrightness + '%) saturate(' + bgSaturation + '%)' + (bgInvert ? ' invert(' + bgInvert + '%)' : '');
  if (data.thread && data.thread.bgmoves) {
    bgEl.classList.add('moves');
    canvas.appendChild(bgEl);
  } else {
    player.setScreenLayer(bgEl);
  }

  // Alle Board-Objekte als feste Ebene (Positionen exakt wie auf dem
  // Board) - nicht nur die Stationen selbst.
  var photoRecs = {};
  var occludables = [];
  var hasAnnot = false;
  var inkForOverview = null;
  (data.boardPhotos || []).forEach(function (p) {
    if (!p) { return; }
    var pel = document.createElement('div');
    pel.className = 'ph' + (p.iswordart ? ' wordart' : '');
    pel.style.left = p.canvasx + 'px';
    pel.style.top = p.canvasy + 'px';
    pel.style.width = p.canvasw + 'px';
    pel.style.transform = 'rotate(' + (p.canvasrot || 0) + 'deg)';
    pel.style.zIndex = p.canvasz || 0;
    if (p.blendmode) { pel.style.mixBlendMode = p.blendmode; }
    var img = document.createElement('img');
    img.src = p.url; img.alt = '';
    // Folie mit Animationsschritten: SVG direkt einbetten statt als Bild,
    // damit die Abspiel-Logik einzelne Objekte (data-pwp-build) ein- und
    // ausblenden kann.
    if (p.animsteps && p.url.indexOf('data:image/svg+xml;base64,') === 0) {
      try {
        var svgText = decodeURIComponent(escape(atob(p.url.slice(26))));
        var holder = document.createElement('div');
        holder.innerHTML = svgText;
        var svgEl = holder.querySelector('svg');
        if (svgEl) { img = svgEl; img.style.display = 'block'; }
      } catch (e) { /* Bild bleibt */ }
    }
    var rec = { el: pel, z: p.canvasz || 0, img: img, photo: p, box: null };
    if (p.tfw && p.tfh && p.vb) {
      // Karte (tf.w x tf.h) liegt exakt auf canvasx/canvasy/canvasw - wie
      // auf der Pinnwand; das SVG wird gemäß seiner viewBox darum herum
      // platziert, statt auf Kartenbreite zusammengestaucht zu werden.
      var k = p.canvasw / p.tfw;
      pel.classList.add('wordfield-mapped');
      pel.style.height = (p.tfh * k) + 'px';
      img.style.left = (p.vb[0] * k) + 'px';
      img.style.top = (p.vb[1] * k) + 'px';
      img.style.width = (p.vb[2] * k) + 'px';
      if (img.tagName.toLowerCase() === 'svg') {
        img.style.position = 'absolute';
        img.style.height = (p.vb[3] * k) + 'px';
      }
      // Zoom-Ziel: bei WordArt der ganze sichtbare Bereich (viewBox), bei
      // normalen Zetteln die Karte selbst.
      rec.box = p.wordartframe
        ? { x: p.canvasx + p.vb[0] * k, y: p.canvasy + p.vb[1] * k, w: p.vb[2] * k, h: p.vb[3] * k }
        : { x: p.canvasx, y: p.canvasy, w: p.canvasw, h: p.tfh * k };
    }
    pel.appendChild(img);
    canvas.appendChild(pel);
    // Annotationen auf dem Objekt (nur falls beim Export gewählt).
    if (p.annotation && p.annotation.length) {
      PinnwandPresentation.attachInk(pel, p.annotation, 'annot');
      hasAnnot = true;
    }
    photoRecs[p.id] = rec;
    occludables.push(rec);
  });

  // Notizen des Stylus-Werkzeugs auf der Pinnwand - über allen Objekten,
  // wie in der Präsentation im Modul.
  if (hasAnnot) { player.addToggle('annot', (data.labels && data.labels.annot) || 'Annotationen'); }
  if (data.boardInk && data.boardInk.length) {
    canvas.appendChild(PinnwandPresentation.inkLayer(data.boardInk, BW, BH, 'ink', 600));
    player.addToggle('ink', (data.labels && data.labels.ink) || 'Notizen');
    inkForOverview = PinnwandPresentation.inkBounds(data.boardInk, BW, BH);
  }

  function overviewStep() {
    return { cx: BW / 2, cy: BH / 2, w: BW, h: BH, rot: 0, overview: true };
  }

  // Stationen (Fotos, Wortfelder, Rahmen als reine Zoom-Ziele, Überblick)
  // genau wie in der Live-Präsentation (buildStep in openPresentation()).
  var items = (data.thread && data.thread.items) || [];
  var steps = items.map(function (it) {
    if (it.itemtype === 'overview') { return overviewStep(); }
    if (it.itemtype === 'frame') {
      var fstep = {
        cx: it.framex + it.framew / 2, cy: it.framey + it.frameh / 2,
        w: it.framew, h: it.frameh, rot: -(it.framerot || 0), z: it.framez || 0, frame: true
      };
      // Folie: Inhalt (SVG) im Rahmen, gedreht wie der Rahmen, mit Ebene,
      // Mischmodus und Animationsschritten.
      if (it.framesvg) {
        var fel = document.createElement('div');
        fel.className = 'ph slide';
        fel.style.left = it.framex + 'px';
        fel.style.top = it.framey + 'px';
        fel.style.width = it.framew + 'px';
        fel.style.height = it.frameh + 'px';
        fel.style.transform = 'rotate(' + (it.framerot || 0) + 'deg)';
        fel.style.zIndex = it.framez || 0;
        if (it.blend) { fel.style.mixBlendMode = it.blend; }
        if (it.slidebg && (it.slidebg.opacity || it.slidebg.blur || it.slidebg.invert || it.slidebg.brightness !== 100)) {
          var sc = it.slidebg.color || '#000000';
          // Überlagerungsfarbe durchläuft Helligkeit und Invertieren wie der Hintergrund.
          var sbr = (it.slidebg.brightness != null ? it.slidebg.brightness : 100) / 100, sinv = (it.slidebg.invert || 0) / 100;
          var srgb = [1, 3, 5].map(function (o) {
            var v = Math.min(1, parseInt(sc.substr(o, 2), 16) / 255 * sbr);
            return Math.round(255 * (v * (1 - sinv) + (1 - v) * sinv));
          });
          fel.style.background = 'rgba(' + srgb[0] + ',' + srgb[1] + ',' + srgb[2] + ',' + ((it.slidebg.opacity || 0) / 100) + ')';
          var sbf = (it.slidebg.blur ? 'blur(' + it.slidebg.blur + 'px) ' : '') + (it.slidebg.invert ? 'invert(' + it.slidebg.invert + '%) ' : '') + (it.slidebg.brightness !== 100 ? 'brightness(' + it.slidebg.brightness + '%)' : '');
          if (sbf) { fel.style.backdropFilter = fel.style.webkitBackdropFilter = sbf; }
        }
        fel.innerHTML = it.framesvg;
        var fsvg = fel.querySelector('svg');
        if (fsvg) { fsvg.style.width = '100%'; fsvg.style.height = '100%'; fsvg.style.display = 'block'; }
        canvas.appendChild(fel);
        occludables.push({ el: fel, z: it.framez || 0 });
        fstep.el = fel;
        if (it.animsteps) { fstep.buildEl = fel; fstep.buildCount = it.animsteps; }
        fstep.keep = (it.linked || []).map(function (pid) { return photoRecs[pid] && photoRecs[pid].el; }).filter(Boolean);
        fstep.slideEl = fel;
        fstep.slideBgHideBefore = !it.bgshowbefore;
        fstep.slideBgHideAfter = !it.bgpersist;
      }
      return fstep;
    }
    if (!it.photo) { return null; }
    var rec = photoRecs[it.photo.id];
    if (!rec) { return null; }
    var p = rec.photo;
    if (rec.box) {
      return {
        el: rec.el, cx: rec.box.x + rec.box.w / 2, cy: rec.box.y + rec.box.h / 2,
        w: rec.box.w * (1 + 2 * STEP_MARGIN), h: rec.box.h * (1 + 2 * STEP_MARGIN),
        rot: 0, z: p.canvasz || 0, previewUrl: p.url,
        buildEl: p.animsteps ? rec.el : null, buildCount: p.animsteps || 0
      };
    }
    var natW = p.canvasw;
    var img2 = rec.img;
    var natH = img2.naturalWidth ? natW * (img2.naturalHeight / img2.naturalWidth) : natW * 0.75;
    var s = {
      el: rec.el, cx: p.canvasx + natW / 2, cy: p.canvasy + natH / 2,
      w: natW, h: natH, rot: 0, z: p.canvasz || 0, previewUrl: p.url
    };
    if (!img2.naturalWidth) {
      // Eingebettete Bilder werden asynchron dekodiert - das echte
      // Seitenverhältnis steht erst nach "load" fest.
      img2.addEventListener('load', function () {
        var h = natW * (img2.naturalHeight / img2.naturalWidth);
        s.h = h;
        s.cy = p.canvasy + h / 2;
        player.refreshStep(s);
      });
    }
    return s;
  }).filter(Boolean);

  // Präsentation startet immer mit einem Überblick über die ganze
  // Pinnwand (falls der Rote Faden nicht selbst schon damit beginnt).
  steps = PinnwandPresentation.expandBuildSteps(steps);
  if (steps.length && !steps[0].overview) { steps.unshift(overviewStep()); }
  player.start(steps, occludables, (data.startMode === 'slide' && steps.length > 1 && steps[0].overview) ? 1 : 0);
  // Notizen außerhalb der Leinwand: Überblick entsprechend vergrößern.
  if (inkForOverview) { player.includeInOverview(inkForOverview); }
})();
</script>
</body>
</html>
HTML;
}
