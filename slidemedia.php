<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Medien für Folien speichern (Bild, Audio, Video): entweder als
 * hochgeladene Datei (action=upload, Feld "file") oder von einer
 * Internetadresse übernommen (action=url). Antwortet mit JSON
 * {file, mimetype, size} bzw. {error}.
 *
 * Die Datei liegt im Dateibereich "slidemedia" (itemid 0) der Aktivität,
 * benannt nach ihrem Inhalt (sha1), sodass dieselbe Datei nur einmal
 * gespeichert wird.
 *
 * @package    mod_pinnwand
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('AJAX_SCRIPT', true);

require_once(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/filelib.php');

$cmid = required_param('cmid', PARAM_INT);
$action = required_param('action', PARAM_ALPHA);

$cm = get_coursemodule_from_id('pinnwand', $cmid, 0, false, MUST_EXIST);
$course = get_course($cm->course);
require_login($course, false, $cm);
require_sesskey();
$context = context_module::instance($cm->id);
require_capability('mod/pinnwand:submit', $context);

header('Content-Type: application/json; charset=utf-8');

/**
 * JSON-Antwort senden und beenden.
 *
 * @param array $data
 */
function pinnwand_slidemedia_out(array $data) {
    echo json_encode($data);
    die();
}

/**
 * Medientyp aus MIME-Typ bzw. Dateiendung bestimmen (nur Bild/Audio/Video).
 *
 * @param string $mimetype
 * @param string $filename
 * @return string MIME-Typ oder '' wenn nicht erlaubt
 */
function pinnwand_slidemedia_mime($mimetype, $filename) {
    $mimetype = strtolower(trim(explode(';', (string) $mimetype)[0]));
    if (!preg_match('#^(image|audio|video)/#', $mimetype)) {
        $mimetype = mimeinfo('type', $filename);
    }
    if (!preg_match('#^(image|audio|video)/[a-z0-9.+-]+$#', (string) $mimetype)) {
        return '';
    }
    // SVG kann Skripte enthalten - nicht als Folienmedium speichern.
    if ($mimetype === 'image/svg+xml') {
        return '';
    }
    return $mimetype;
}

/**
 * Passende Dateiendung zum MIME-Typ.
 *
 * @param string $mimetype
 * @param string $filename
 * @return string
 */
function pinnwand_slidemedia_ext($mimetype, $filename) {
    $ext = strtolower(pathinfo((string) $filename, PATHINFO_EXTENSION));
    if ($ext !== '' && preg_match('/^[a-z0-9]{1,5}$/', $ext) && mimeinfo('type', 'x.' . $ext) === $mimetype) {
        return $ext;
    }
    $exts = file_get_typegroup('extension', $mimetype);
    if (!empty($exts)) {
        return ltrim(reset($exts), '.');
    }
    $sub = preg_replace('/[^a-z0-9]/', '', explode('/', $mimetype)[1]);
    return $sub !== '' ? substr($sub, 0, 5) : 'bin';
}

$maxbytes = get_user_max_upload_file_size($context, $CFG->maxbytes, $course->maxbytes);
$limit = optional_param('limit', 0, PARAM_INT);
if ($limit > 0 && ($maxbytes <= 0 || $limit < $maxbytes)) {
    $maxbytes = $limit;
}

$tmppath = '';
$origname = '';
$mimetype = '';

if ($action === 'upload') {
    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        $err = !empty($_FILES['file']['error']) && in_array($_FILES['file']['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE])
            ? 'toolarge' : 'failed';
        pinnwand_slidemedia_out(['error' => $err]);
    }
    if ($maxbytes > 0 && $_FILES['file']['size'] > $maxbytes) {
        pinnwand_slidemedia_out(['error' => 'toolarge', 'maxbytes' => $maxbytes]);
    }
    $tmppath = $_FILES['file']['tmp_name'];
    $origname = clean_filename($_FILES['file']['name']);
    $mimetype = pinnwand_slidemedia_mime($_FILES['file']['type'], $origname);
} else if ($action === 'url') {
    $url = required_param('url', PARAM_URL);
    if (!preg_match('#^https?://#i', $url)) {
        pinnwand_slidemedia_out(['error' => 'invalid']);
    }
    $tmpdir = make_request_directory();
    $tmppath = $tmpdir . '/download';
    $curl = new curl();
    $opts = ['filepath' => $tmppath, 'timeout' => 120, 'followlocation' => true, 'maxredirs' => 4];
    if ($maxbytes > 0) {
        $curl->setopt(['CURLOPT_MAXFILESIZE' => $maxbytes]);
        // Ohne Content-Length bricht der Download spätestens hier ab.
        $curl->setopt(['CURLOPT_NOPROGRESS' => false, 'CURLOPT_PROGRESSFUNCTION' =>
            function($ch, $dltotal, $dlnow) use ($maxbytes) {
                return ($dlnow > $maxbytes || $dltotal > $maxbytes) ? 1 : 0;
            }]);
    }
    $result = $curl->download_one($url, null, $opts);
    $info = $curl->get_info();
    $errno = $curl->get_errno();
    if ($errno == 63 || $errno == 42 || ($maxbytes > 0 && is_file($tmppath) && filesize($tmppath) > $maxbytes)) {
        pinnwand_slidemedia_out(['error' => 'toolarge', 'maxbytes' => $maxbytes]);
    }
    if ($result !== true || empty($info['http_code']) || (int) $info['http_code'] >= 400 || !is_file($tmppath)) {
        pinnwand_slidemedia_out(['error' => 'download']);
    }
    $origname = clean_filename(basename(parse_url($url, PHP_URL_PATH) ?: 'download'));
    $mimetype = pinnwand_slidemedia_mime($info['content_type'] ?? '', $origname);
} else {
    pinnwand_slidemedia_out(['error' => 'invalid']);
}

if ($mimetype === '') {
    pinnwand_slidemedia_out(['error' => 'type']);
}
$size = filesize($tmppath);
if (!$size) {
    pinnwand_slidemedia_out(['error' => 'failed']);
}

$filename = sha1_file($tmppath) . '.' . pinnwand_slidemedia_ext($mimetype, $origname);
$fs = get_file_storage();
if (!$fs->get_file($context->id, 'mod_pinnwand', 'slidemedia', 0, '/', $filename)) {
    $fs->create_file_from_pathname([
        'contextid' => $context->id,
        'component' => 'mod_pinnwand',
        'filearea' => 'slidemedia',
        'itemid' => 0,
        'filepath' => '/',
        'filename' => $filename,
        'userid' => $USER->id,
        'mimetype' => $mimetype,
    ], $tmppath);
}

pinnwand_slidemedia_out(['file' => $filename, 'mimetype' => $mimetype, 'size' => $size]);
