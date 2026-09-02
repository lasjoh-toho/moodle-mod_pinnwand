<?php
defined('MOODLE_INTERNAL') || die();

require_once($CFG->libdir . '/externallib.php');

class mod_pinnwand_external extends external_api {

    // ---------------------------------------------------------------
    // Hilfsfunktion: Kontext/Instanz/Capability aus cmid ableiten.
    // ---------------------------------------------------------------
    protected static function get_context_instance($cmid, $capability) {
        $cm = get_coursemodule_from_id('pinnwand', $cmid, 0, false, MUST_EXIST);
        $context = context_module::instance($cm->id);
        self::validate_context($context);
        require_capability($capability, $context);
        global $DB;
        $instance = $DB->get_record('pinnwand', ['id' => $cm->instance], '*', MUST_EXIST);
        return [$cm, $context, $instance];
    }

    /**
     * Effektive Höchstzahl an Bildern für die aktuelle Person in dieser
     * Aktivität. Lehrkräfte (erkannt an mod/pinnwand:viewall) haben ein
     * eigenes, von der Aktivitätseinstellung unabhängiges Admin-Limit.
     * Für Lernende gilt das kleinere von Aktivitätseinstellung und
     * Admin-Obergrenze (0 = jeweils "kein Limit an dieser Stelle").
     */
    protected static function get_effective_max($instance, $context) {
        $isteacherlike = has_capability('mod/pinnwand:viewall', $context);
        if ($isteacherlike) {
            $adminmax = (int) get_config('mod_pinnwand', 'adminmaxteacher');
            return max(0, $adminmax);
        }
        $activitymax = (int) $instance->maxpictures;
        $adminmax = (int) get_config('mod_pinnwand', 'adminmaxstudent');
        $candidates = array_filter([$activitymax, $adminmax], function ($v) { return $v > 0; });
        return empty($candidates) ? 0 : min($candidates);
    }

    // ---------------------------------------------------------------
    // save_photo
    // ---------------------------------------------------------------
    public static function save_photo_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'imagedata' => new external_value(PARAM_RAW, 'Data-URL (base64) des fertig bearbeiteten Fotos (ohne Raster)'),
            'gridtype' => new external_value(PARAM_ALPHA, 'none|square|fixed', VALUE_DEFAULT, 'none'),
            'gridvalue' => new external_value(PARAM_INT, 'Zellgröße bzw. Anzahl Unterteilungen', VALUE_DEFAULT, 0),
            'consent' => new external_value(PARAM_BOOL, 'Einwilligung zur Verwendung auf der Schulwebseite', VALUE_DEFAULT, false),
            'sourcetitle' => new external_value(PARAM_TEXT, 'Titel', VALUE_DEFAULT, ''),
            'sourceauthor' => new external_value(PARAM_TEXT, 'Autor*in', VALUE_DEFAULT, ''),
            'sourceyear' => new external_value(PARAM_TEXT, 'Jahr', VALUE_DEFAULT, ''),
            'sourceepoch' => new external_value(PARAM_TEXT, 'Epoche', VALUE_DEFAULT, ''),
            'sourceplace' => new external_value(PARAM_TEXT, 'Ort', VALUE_DEFAULT, ''),
            'sourceorigauthor' => new external_value(PARAM_TEXT, 'Autor*in der Vorlage', VALUE_DEFAULT, ''),
            'boardid' => new external_value(PARAM_INT, 'Board-ID', VALUE_DEFAULT, 0),
            'wordfielddata' => new external_value(PARAM_RAW, 'Strukturierte Wortfeld-Daten (JSON), falls dieses Foto ein Wortfeld ist', VALUE_DEFAULT, ''),
        ]);
    }

    public static function save_photo($cmid, $imagedata, $gridtype, $gridvalue, $consent,
            $sourcetitle, $sourceauthor, $sourceyear, $sourceepoch, $sourceplace, $sourceorigauthor, $boardid = 0,
            $wordfielddata = '') {
        global $DB, $USER;

        $params = self::validate_parameters(self::save_photo_parameters(), [
            'cmid' => $cmid, 'imagedata' => $imagedata, 'gridtype' => $gridtype,
            'gridvalue' => $gridvalue, 'consent' => $consent, 'sourcetitle' => $sourcetitle,
            'sourceauthor' => $sourceauthor, 'sourceyear' => $sourceyear, 'sourceepoch' => $sourceepoch,
            'sourceplace' => $sourceplace, 'sourceorigauthor' => $sourceorigauthor, 'boardid' => $boardid,
            'wordfielddata' => $wordfielddata,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        // Limit prüfen (Aktivitätseinstellung kombiniert mit getrennten
        // Admin-Obergrenzen für Lernende bzw. Lehrkräfte).
        $existing = $DB->count_records('pinnwand_photos', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id,
        ]);
        $effectivemax = self::get_effective_max($instance, $context);
        if ($effectivemax > 0 && $existing >= $effectivemax) {
            throw new moodle_exception('maxreached', 'pinnwand');
        }

        if (!in_array($params['gridtype'], ['none', 'square', 'fixed'], true)) {
            $params['gridtype'] = 'none';
        }

        // Bilddaten aus Data-URL extrahieren. SVG (Wortfeld) bleibt als
        // editierbarer Text erhalten statt gerastert zu werden - deutlich
        // kleiner als ein PNG und die Schrift bleibt scharf bei jeder Größe.
        if (!preg_match('#^data:image/(png|jpeg|jpg|svg\+xml);base64,(.+)$#', $params['imagedata'], $m)) {
            throw new moodle_exception('error_save', 'pinnwand');
        }
        $ext = $m[1] === 'png' ? 'png' : ($m[1] === 'svg+xml' ? 'svg' : 'jpg');
        $binary = base64_decode($m[2]);
        if ($binary === false || strlen($binary) < 20) {
            throw new moodle_exception('error_save', 'pinnwand');
        }

        $record = new stdClass();
        $record->pinnwandid = $instance->id;
        $record->userid = $USER->id;
        $record->sortorder = $existing;
        $record->gridtype = $params['gridtype'];
        $record->gridvalue = (int) $params['gridvalue'];
        $record->consent = !empty($params['consent']) ? 1 : 0;
        $record->hiddenfromboard = empty($instance->boarddefault) ? 1 : 0;
        $record->annotationonboard = 1;
        $record->sourcetitle = clean_param($params['sourcetitle'], PARAM_TEXT);
        $record->sourceauthor = clean_param($params['sourceauthor'], PARAM_TEXT);
        $record->sourceyear = clean_param($params['sourceyear'], PARAM_TEXT);
        $record->sourceepoch = clean_param($params['sourceepoch'], PARAM_TEXT);
        $record->sourceplace = clean_param($params['sourceplace'], PARAM_TEXT);
        $record->sourceorigauthor = clean_param($params['sourceorigauthor'], PARAM_TEXT);
        $record->canvasx = 20 + ($existing % 5) * 30;
        $record->canvasy = 20 + intdiv($existing, 5) * 30;
        $record->canvasw = 220;
        $record->canvasrot = 0;
        $record->canvasz = $existing;
        $record->boardid = $params['boardid'];
        $record->wordfielddata = $params['wordfielddata'] !== '' ? $params['wordfielddata'] : null;
        $record->timecreated = time();
        $record->id = $DB->insert_record('pinnwand_photos', $record);

        $fs = get_file_storage();
        $filerecord = [
            'contextid' => $context->id,
            'component' => 'mod_pinnwand',
            'filearea'  => 'photo',
            'itemid'    => $record->id,
            'filepath'  => '/',
            'filename'  => 'photo_' . $record->id . '.' . $ext,
        ];
        $fs->create_file_from_string($filerecord, $binary);

        $newcount = $existing + 1;
        return [
            'photoid' => $record->id,
            'count' => $newcount,
            'max' => $effectivemax,
            'maxreached' => ($effectivemax > 0 && $newcount >= $effectivemax),
            'hiddenfromboard' => (bool) $record->hiddenfromboard,
            'url' => (string) moodle_url::make_pluginfile_url(
                $context->id, 'mod_pinnwand', 'photo', $record->id, '/', $filerecord['filename']
            ),
        ];
    }

    public static function save_photo_returns() {
        return new external_single_structure([
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'count' => new external_value(PARAM_INT, 'Anzahl bisheriger Fotos'),
            'max' => new external_value(PARAM_INT, 'Maximum (0 = unbegrenzt)'),
            'maxreached' => new external_value(PARAM_BOOL, 'Limit erreicht'),
            'hiddenfromboard' => new external_value(PARAM_BOOL, 'Von der Pinnwand ausgeblendet'),
            'url' => new external_value(PARAM_RAW, 'Bild-URL'),
        ]);
    }

    // ---------------------------------------------------------------
    // get_photos
    // ---------------------------------------------------------------
    public static function get_photos_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
        ]);
    }

    public static function get_photos($cmid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_photos_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $records = $DB->get_records('pinnwand_photos', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'status' => 'active',
        ], 'sortorder ASC');

        $fs = get_file_storage();
        $placementcounts = [];
        if ($records) {
            list($insql, $inparams) = $DB->get_in_or_equal(array_keys($records));
            $counts = $DB->get_records_sql(
                "SELECT photoid, COUNT(*) AS cnt FROM {pinnwand_object_placements}
                  WHERE status = 'active' AND photoid $insql GROUP BY photoid", $inparams
            );
            foreach ($counts as $c) {
                $placementcounts[$c->photoid] = (int) $c->cnt;
            }
        }
        $out = [];
        foreach ($records as $r) {
            $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $r->id, 'filename', false);
            $file = reset($files);
            if (!$file) {
                continue;
            }
            $out[] = [
                'id' => (int) $r->id,
                'url' => (string) moodle_url::make_pluginfile_url(
                    $context->id, 'mod_pinnwand', 'photo', $r->id, '/', $file->get_filename()
                ),
                'annotationdata' => $r->annotationdata !== null ? (string) $r->annotationdata : '[]',
                'gridtype' => $r->gridtype,
                'gridvalue' => (int) $r->gridvalue,
                'gridcolor' => $r->gridcolor ?: '#ff3c3c',
                'consent' => (bool) $r->consent,
                'hiddenfromboard' => (bool) $r->hiddenfromboard,
                'annotationonboard' => (bool) $r->annotationonboard,
                'sourcetitle' => (string) $r->sourcetitle,
                'sourceauthor' => (string) $r->sourceauthor,
                'sourceyear' => (string) $r->sourceyear,
                'sourceepoch' => (string) $r->sourceepoch,
                'sourceplace' => (string) $r->sourceplace,
                'sourceorigauthor' => (string) $r->sourceorigauthor,
                'timecreated' => (int) $r->timecreated,
                'canvasx' => (float) $r->canvasx,
                'canvasy' => (float) $r->canvasy,
                'canvasw' => (float) $r->canvasw,
                'canvasrot' => (float) $r->canvasrot,
                'canvasz' => (int) $r->canvasz,
                'boardid' => (int) $r->boardid,
                'backphotoid' => $r->backphotoid !== null ? (int) $r->backphotoid : 0,
                'showingback' => (bool) $r->showingback,
                'boardplaced' => (bool) $r->boardplaced,
                'wordfielddata' => (string) ($r->wordfielddata ?? ''),
                'otherboardcount' => $placementcounts[$r->id] ?? 0,
                'userfullname' => fullname($USER),
            ];
        }
        return [
            'photos' => $out,
            'max' => self::get_effective_max($instance, $context),
            'background' => self::get_background_data($instance, $context),
            'candelete' => has_capability('mod/pinnwand:manage', $context),
            'canmoderate' => self::can_view_class($instance, $context),
            'studentcansend' => (bool) $instance->studentcansend,
            'teachercansend' => (bool) $instance->teachercansend,
        ];
    }

    protected static function get_background_data($instance, $context) {
        global $USER;
        $default = ['type' => 'color', 'color' => '#2b2d33', 'url' => null, 'brightness' => 100, 'saturation' => 100, 'fit' => 'contain'];
        $raw = get_user_preferences('mod_pinnwand_bg_' . $instance->id, null, $USER->id);
        if (!$raw) {
            return $default;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return $default;
        }
        $bg = $default;
        $type = $decoded['type'] ?? 'color';
        $bg['type'] = in_array($type, ['image', 'url', 'upload'], true) ? $type : 'color';
        $bg['color'] = clean_param($decoded['color'] ?? $default['color'], PARAM_TEXT);
        $bg['brightness'] = max(20, min(180, (int) ($decoded['brightness'] ?? 100)));
        $bg['saturation'] = max(0, min(200, (int) ($decoded['saturation'] ?? 100)));
        $fitval = $decoded['fit'] ?? 'contain';
        $bg['fit'] = in_array($fitval, ['cover', 'contain'], true) ? $fitval : 'contain';
        if ($bg['type'] === 'image' && !empty($decoded['photoid'])) {
            global $DB;
            // Eigene Fotos immer erlaubt; fremde Fotos (aus den Uploads der
            // Klasse) nur, wenn die Person auch die Klassenansicht sehen darf -
            // sonst würde eine gespeicherte Präferenz weiterhin ein Bild
            // zeigen, dessen Berechtigung inzwischen entzogen wurde.
            $photo = $DB->get_record('pinnwand_photos', ['id' => (int) $decoded['photoid'], 'pinnwandid' => $instance->id]);
            if ($photo && ((int) $photo->userid !== (int) $USER->id) && !self::can_view_class($instance, $context)) {
                $photo = false;
            }
            if ($photo) {
                $fs = get_file_storage();
                $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $photo->id, 'filename', false);
                $file = reset($files);
                if ($file) {
                    $bg['url'] = (string) moodle_url::make_pluginfile_url(
                        $context->id, 'mod_pinnwand', 'photo', $photo->id, '/', $file->get_filename()
                    );
                }
            }
            if (!$bg['url']) {
                $bg['type'] = 'color';
            }
        } else if ($bg['type'] === 'url') {
            $url = clean_param($decoded['url'] ?? '', PARAM_URL);
            $bg['url'] = $url !== '' ? $url : null;
            if (!$bg['url']) {
                $bg['type'] = 'color';
            }
        } else if ($bg['type'] === 'upload') {
            $fs = get_file_storage();
            $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'background', $USER->id, 'filename', false);
            $file = reset($files);
            if ($file) {
                $bg['url'] = (string) moodle_url::make_pluginfile_url(
                    $context->id, 'mod_pinnwand', 'background', $USER->id, '/', $file->get_filename()
                );
            }
            if (!$bg['url']) {
                $bg['type'] = 'color';
            }
        }
        return $bg;
    }

    public static function get_photos_returns() {
        return new external_single_structure([
            'max' => new external_value(PARAM_INT, 'Maximum'),
            'candelete' => new external_value(PARAM_BOOL, 'Darf fremde Fotos löschen (Bereinigen)'),
            'canmoderate' => new external_value(PARAM_BOOL, 'Darf Klassenansicht sehen'),
            'studentcansend' => new external_value(PARAM_BOOL, 'Lernende dürfen eigene Fotos zur Pinnwand senden/entfernen'),
            'teachercansend' => new external_value(PARAM_BOOL, 'Lehrkräfte dürfen beliebige Fotos zur Pinnwand senden/entfernen'),
            'background' => new external_single_structure([
                'type' => new external_value(PARAM_ALPHA, 'color|image|url|upload'),
                'color' => new external_value(PARAM_TEXT, 'Hintergrundfarbe'),
                'url' => new external_value(PARAM_RAW, 'Hintergrundbild-URL', VALUE_DEFAULT, null, NULL_ALLOWED),
                'brightness' => new external_value(PARAM_INT, 'Helligkeit in %'),
                'saturation' => new external_value(PARAM_INT, 'Sättigung in %'),
                'fit' => new external_value(PARAM_ALPHA, 'contain oder cover'),
            ]),
            'photos' => new external_multiple_structure(new external_single_structure([
                'id' => new external_value(PARAM_INT, 'ID'),
                'url' => new external_value(PARAM_RAW, 'URL'),
                'annotationdata' => new external_value(PARAM_RAW, 'JSON-Array der Zeichen-/Schreib-Striche'),
                'gridtype' => new external_value(PARAM_ALPHA, 'Rastertyp'),
                'gridvalue' => new external_value(PARAM_INT, 'Rasterwert'),
                'gridcolor' => new external_value(PARAM_TEXT, 'Rasterfarbe (Hex)'),
                'consent' => new external_value(PARAM_BOOL, 'Einwilligung'),
                'hiddenfromboard' => new external_value(PARAM_BOOL, 'Von der Pinnwand ausgeblendet'),
                'annotationonboard' => new external_value(PARAM_BOOL, 'Zeichen-Ebene auf der Pinnwand zeigen'),
                'sourcetitle' => new external_value(PARAM_TEXT, 'Titel'),
                'sourceauthor' => new external_value(PARAM_TEXT, 'Autor*in'),
                'sourceyear' => new external_value(PARAM_TEXT, 'Jahr'),
                'sourceepoch' => new external_value(PARAM_TEXT, 'Epoche'),
                'sourceplace' => new external_value(PARAM_TEXT, 'Ort'),
                'sourceorigauthor' => new external_value(PARAM_TEXT, 'Autor*in der Vorlage'),
                'timecreated' => new external_value(PARAM_INT, 'Hochgeladen am (Unix-Zeitstempel)'),
                'canvasx' => new external_value(PARAM_FLOAT, 'x'),
                'canvasy' => new external_value(PARAM_FLOAT, 'y'),
                'canvasw' => new external_value(PARAM_FLOAT, 'Breite'),
                'canvasrot' => new external_value(PARAM_FLOAT, 'Rotation'),
                'canvasz' => new external_value(PARAM_INT, 'Ebene'),
                'boardid' => new external_value(PARAM_INT, 'Board-ID (0 = erstes/Standard-Board)'),
                'backphotoid' => new external_value(PARAM_INT, 'Verknüpfte Rückseite (0 = keine)'),
                'showingback' => new external_value(PARAM_BOOL, 'Rückseite zeigt gerade nach oben'),
                'boardplaced' => new external_value(PARAM_BOOL, 'Hat reale Board-Koordinaten (ist auf der Leinwand platziert)'),
                'wordfielddata' => new external_value(PARAM_RAW, 'Strukturierte Wortfeld-Daten (JSON) oder leer'),
                'otherboardcount' => new external_value(PARAM_INT, 'Anzahl zusätzlicher aktiver Platzierungen auf anderen Boards'),
                'userfullname' => new external_value(PARAM_TEXT, 'Name der hochladenden Person (auf dem eigenen Board immer man selbst)'),
            ])),
        ]);
    }

    // ---------------------------------------------------------------
    // save_annotation: speichert/überschreibt die Zeichen-/Schreib-Ebene
    // eines Fotos (transparentes PNG, exakt auf das Foto gemappt).
    // ---------------------------------------------------------------
    public static function save_annotation_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'strokes' => new external_value(PARAM_RAW, 'JSON-Array der Striche (vektoriell, normalisierte Koordinaten)'),
        ]);
    }

    /**
     * Striche werden als Vektordaten gespeichert (Punkte, Farbe, Breite,
     * Radierer-Flag) - nicht als gerastertes Bild. So lässt sich die Ebene
     * verlustfrei bei jeder Anzeigegröße neu zeichnen, einzelne Striche
     * bleiben löschbar, und dieselben Daten reichen für Galerie- UND
     * Anordnungs-Ansicht.
     */
    /**
     * Bereinigt/validiert eine rohe Strichdaten-Liste (JSON-dekodiert) -
     * gemeinsam für Foto-Annotationen UND Board-weite Stylus-Anmerkungen
     * genutzt (siehe save_annotation/save_board_ink).
     */
    protected static function clean_strokes($decoded) {
        $clean = [];
        foreach (array_slice($decoded, 0, 500) as $stroke) {
            if (!is_array($stroke)) {
                continue;
            }
            $color = preg_match('/^#[0-9a-fA-F]{6}$/', $stroke['color'] ?? '') ? $stroke['color'] : '#ef4444';
            $id = clean_param((string) ($stroke['id'] ?? ''), PARAM_ALPHANUMEXT);

            if (($stroke['type'] ?? '') === 'text') {
                $text = clean_param((string) ($stroke['text'] ?? ''), PARAM_TEXT);
                if ($text === '' || !isset($stroke['x'], $stroke['y'])) {
                    continue;
                }
                $clean[] = [
                    'id' => $id,
                    'type' => 'text',
                    'x' => (float) $stroke['x'],
                    'y' => (float) $stroke['y'],
                    'text' => mb_substr($text, 0, 300),
                    'color' => $color,
                    'size' => (float) ($stroke['size'] ?? 20),
                ];
                continue;
            }

            if (empty($stroke['points']) || !is_array($stroke['points'])) {
                continue;
            }
            $points = [];
            foreach (array_slice($stroke['points'], 0, 2000) as $pt) {
                if (!isset($pt['x'], $pt['y'])) {
                    continue;
                }
                $points[] = ['x' => (float) $pt['x'], 'y' => (float) $pt['y']];
            }
            if (empty($points)) {
                continue;
            }
            $clean[] = [
                'id' => $id,
                'points' => $points,
                'color' => $color,
                'width' => (float) ($stroke['width'] ?? 0.01),
                'erase' => !empty($stroke['erase']),
            ];
        }
        return $clean;
    }

    public static function save_annotation($cmid, $photoid, $strokes) {
        global $DB, $USER;
        $params = self::validate_parameters(self::save_annotation_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'strokes' => $strokes,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->userid != $USER->id || $photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'save_annotation');
        }

        $decoded = json_decode($params['strokes'], true);
        if (!is_array($decoded)) {
            throw new moodle_exception('error_save', 'pinnwand');
        }
        $photo->annotationdata = json_encode(self::clean_strokes($decoded));
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true, 'annotationdata' => $photo->annotationdata];
    }

    public static function save_annotation_returns() {
        return new external_single_structure([
            'success' => new external_value(PARAM_BOOL, 'OK'),
            'annotationdata' => new external_value(PARAM_RAW, 'Gespeicherte, bereinigte Strichdaten (JSON)'),
        ]);
    }

    // ---------------------------------------------------------------
    // Stylus-Werkzeug: Freihand-Anmerkungen direkt auf dem Board-Hintergrund
    // (nicht an ein einzelnes Foto gebunden) - ein Datensatz je Person+Board.
    // ---------------------------------------------------------------
    public static function get_board_ink_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'boardid' => new external_value(PARAM_INT, 'Board-ID', VALUE_DEFAULT, 0),
        ]);
    }

    public static function get_board_ink($cmid, $boardid = 0) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_board_ink_parameters(), ['cmid' => $cmid, 'boardid' => $boardid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $row = $DB->get_record('pinnwand_board_ink', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
        ]);
        return ['strokedata' => $row ? (string) $row->strokedata : '[]'];
    }

    public static function get_board_ink_returns() {
        return new external_single_structure(['strokedata' => new external_value(PARAM_RAW, 'JSON-Array der Striche')]);
    }

    public static function save_board_ink_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'boardid' => new external_value(PARAM_INT, 'Board-ID', VALUE_DEFAULT, 0),
            'strokes' => new external_value(PARAM_RAW, 'JSON-Array der Striche'),
        ]);
    }

    public static function save_board_ink($cmid, $boardid, $strokes) {
        global $DB, $USER;
        $params = self::validate_parameters(self::save_board_ink_parameters(), [
            'cmid' => $cmid, 'boardid' => $boardid, 'strokes' => $strokes,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $decoded = json_decode($params['strokes'], true);
        if (!is_array($decoded)) {
            throw new moodle_exception('error_save', 'pinnwand');
        }
        $clean = json_encode(self::clean_strokes($decoded));

        $row = $DB->get_record('pinnwand_board_ink', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
        ]);
        if ($row) {
            $row->strokedata = $clean;
            $row->timemodified = time();
            $DB->update_record('pinnwand_board_ink', $row);
        } else {
            $DB->insert_record('pinnwand_board_ink', (object) [
                'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
                'strokedata' => $clean, 'timecreated' => time(), 'timemodified' => time(),
            ]);
        }

        return ['success' => true, 'strokedata' => $clean];
    }

    public static function save_board_ink_returns() {
        return new external_single_structure([
            'success' => new external_value(PARAM_BOOL, 'OK'),
            'strokedata' => new external_value(PARAM_RAW, 'Gespeicherte, bereinigte Strichdaten (JSON)'),
        ]);
    }

    // ---------------------------------------------------------------
    // Board-Namen: eigener Titel je Board (Standard: Aktivitätstitel [+
    // Nummer], wird clientseitig berechnet, falls kein eigener Name gesetzt
    // ist) - sowie Board-Klonen (eigene Kopie der Pinnwand als neues Board).
    // ---------------------------------------------------------------
    // Zusätzliche Board-Platzierungen: ein Objekt (Foto/Zettel/WordArt)
    // kann über mehrere Boards derselben Person hinweg erscheinen (z.B.
    // nach dem Klonen eines Boards), ohne dass die Objekt-Zeile selbst
    // dupliziert wird - siehe clone_board().
    // ---------------------------------------------------------------
    public static function get_object_placements_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'boardid' => new external_value(PARAM_INT, 'Board-ID'),
        ]);
    }

    public static function get_object_placements($cmid, $boardid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_object_placements_parameters(), ['cmid' => $cmid, 'boardid' => $boardid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $sql = "SELECT pl.*, p.userid AS objectuserid
                  FROM {pinnwand_object_placements} pl
                  JOIN {pinnwand_photos} p ON p.id = pl.photoid
                 WHERE pl.pinnwandid = :icid AND pl.boardid = :boardid
                   AND pl.status = 'active' AND p.userid = :userid";
        $records = $DB->get_records_sql($sql, ['icid' => $instance->id, 'boardid' => $params['boardid'], 'userid' => $USER->id]);

        $out = [];
        foreach ($records as $r) {
            $out[] = [
                'id' => (int) $r->id,
                'photoid' => (int) $r->photoid,
                'boardid' => (int) $r->boardid,
                'canvasx' => (float) $r->canvasx,
                'canvasy' => (float) $r->canvasy,
                'canvasw' => (float) $r->canvasw,
                'canvasrot' => (float) $r->canvasrot,
                'canvasz' => (int) $r->canvasz,
                'boardplaced' => (bool) $r->boardplaced,
            ];
        }
        return ['placements' => $out];
    }

    public static function get_object_placements_returns() {
        return new external_single_structure([
            'placements' => new external_multiple_structure(new external_single_structure([
                'id' => new external_value(PARAM_INT, 'Platzierungs-ID'),
                'photoid' => new external_value(PARAM_INT, 'Verweist auf das Objekt'),
                'boardid' => new external_value(PARAM_INT, 'Board-ID'),
                'canvasx' => new external_value(PARAM_FLOAT, 'x'),
                'canvasy' => new external_value(PARAM_FLOAT, 'y'),
                'canvasw' => new external_value(PARAM_FLOAT, 'Breite'),
                'canvasrot' => new external_value(PARAM_FLOAT, 'Rotation'),
                'canvasz' => new external_value(PARAM_INT, 'Z-Reihenfolge'),
                'boardplaced' => new external_value(PARAM_BOOL, 'Hat reale Board-Koordinaten'),
            ])),
        ]);
    }

    public static function update_object_placement_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'placementid' => new external_value(PARAM_INT, 'Platzierungs-ID'),
            'x' => new external_value(PARAM_FLOAT, 'x'),
            'y' => new external_value(PARAM_FLOAT, 'y'),
            'w' => new external_value(PARAM_FLOAT, 'Breite'),
            'rot' => new external_value(PARAM_FLOAT, 'Rotation', VALUE_DEFAULT, 0),
            'z' => new external_value(PARAM_INT, 'Z-Reihenfolge', VALUE_DEFAULT, 0),
        ]);
    }

    public static function update_object_placement($cmid, $placementid, $x, $y, $w, $rot = 0, $z = 0) {
        global $DB, $USER;
        $params = self::validate_parameters(self::update_object_placement_parameters(), [
            'cmid' => $cmid, 'placementid' => $placementid, 'x' => $x, 'y' => $y, 'w' => $w, 'rot' => $rot, 'z' => $z,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $placement = self::require_own_placement($params['placementid'], $instance->id, $USER->id);
        $placement->canvasx = $params['x'];
        $placement->canvasy = $params['y'];
        $placement->canvasw = $params['w'];
        $placement->canvasrot = $params['rot'];
        $placement->canvasz = $params['z'];
        $placement->boardplaced = 1;
        $placement->timemodified = time();
        $DB->update_record('pinnwand_object_placements', $placement);

        return ['success' => true];
    }

    public static function update_object_placement_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function set_placement_status_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'placementid' => new external_value(PARAM_INT, 'Platzierungs-ID'),
            'status' => new external_value(PARAM_ALPHA, 'active oder trash'),
        ]);
    }

    /**
     * Entfernt eine zusätzliche Platzierung von ihrem Board (status=trash,
     * über den Trashbin wiederherstellbar) oder stellt sie wieder her
     * (status=active). Das referenzierte Objekt selbst bleibt in jedem
     * Fall unangetastet - es kann ja noch auf anderen Boards aktiv sein.
     */
    public static function set_placement_status($cmid, $placementid, $status) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_placement_status_parameters(), [
            'cmid' => $cmid, 'placementid' => $placementid, 'status' => $status,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');
        if (!in_array($params['status'], ['active', 'trash'], true)) {
            throw new moodle_exception('error_save', 'pinnwand');
        }

        $placement = self::require_own_placement($params['placementid'], $instance->id, $USER->id);
        $placement->status = $params['status'];
        $placement->timemodified = time();
        $DB->update_record('pinnwand_object_placements', $placement);

        return ['success' => true];
    }

    public static function set_placement_status_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    /**
     * Lädt eine Platzierung und prüft, dass sie zu dieser Aktivität gehört
     * und das referenzierte Objekt der aufrufenden Person gehört.
     */
    public static function get_object_usage_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Objekt-ID'),
        ]);
    }

    /**
     * Listet alle Boards, auf denen ein Objekt der aufrufenden Person
     * aktiv erscheint (Heimat-Board + zusätzliche Platzierungen) - für
     * das Übersichts-Modal, wenn ein Objekt auf 3+ Boards liegt.
     */
    public static function get_object_usage($cmid, $photoid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_object_usage_parameters(), ['cmid' => $cmid, 'photoid' => $photoid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->pinnwandid != $instance->id || $photo->userid != $USER->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'get_object_usage');
        }

        $out = [];
        if ($photo->status === 'active') {
            $out[] = ['kind' => 'home', 'id' => (int) $photo->id, 'boardid' => (int) $photo->boardid];
        }
        $placements = $DB->get_records('pinnwand_object_placements', ['photoid' => $photo->id, 'status' => 'active']);
        foreach ($placements as $pl) {
            $out[] = ['kind' => 'placement', 'id' => (int) $pl->id, 'boardid' => (int) $pl->boardid];
        }
        return ['usages' => $out];
    }

    public static function get_object_usage_returns() {
        return new external_single_structure([
            'usages' => new external_multiple_structure(new external_single_structure([
                'kind' => new external_value(PARAM_ALPHA, 'home (Heimat-Board) oder placement (zusätzliche Platzierung)'),
                'id' => new external_value(PARAM_INT, 'ID des Objekts bzw. der Platzierung'),
                'boardid' => new external_value(PARAM_INT, 'Board-ID'),
            ])),
        ]);
    }

    protected static function require_own_placement($placementid, $instanceid, $userid) {
        global $DB;
        $placement = $DB->get_record('pinnwand_object_placements', ['id' => $placementid], '*', MUST_EXIST);
        if ($placement->pinnwandid != $instanceid) {
            throw new moodle_exception('nopermissions', 'error', '', 'placement');
        }
        $photo = $DB->get_record('pinnwand_photos', ['id' => $placement->photoid], '*', MUST_EXIST);
        if ($photo->userid != $userid) {
            throw new moodle_exception('nopermissions', 'error', '', 'placement');
        }
        return $placement;
    }

    // ---------------------------------------------------------------
    public static function get_board_names_parameters() {
        return new external_function_parameters(['cmid' => new external_value(PARAM_INT, 'Course module id')]);
    }

    public static function get_board_names($cmid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_board_names_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $rows = $DB->get_records('pinnwand_board_names', ['pinnwandid' => $instance->id, 'userid' => $USER->id]);
        $out = [];
        foreach ($rows as $r) {
            $out[] = ['boardid' => (int) $r->boardid, 'name' => (string) $r->name];
        }
        return ['names' => $out];
    }

    public static function get_board_names_returns() {
        return new external_single_structure([
            'names' => new external_multiple_structure(new external_single_structure([
                'boardid' => new external_value(PARAM_INT, 'Board-ID'),
                'name' => new external_value(PARAM_TEXT, 'Eigener Titel'),
            ])),
        ]);
    }

    public static function set_board_name_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'boardid' => new external_value(PARAM_INT, 'Board-ID'),
            'name' => new external_value(PARAM_TEXT, 'Eigener Titel'),
        ]);
    }

    public static function set_board_name($cmid, $boardid, $name) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_board_name_parameters(), [
            'cmid' => $cmid, 'boardid' => $boardid, 'name' => $name,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $name = clean_param($params['name'], PARAM_TEXT);
        $row = $DB->get_record('pinnwand_board_names', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
        ]);
        if ($row) {
            $row->name = $name;
            $row->timemodified = time();
            $DB->update_record('pinnwand_board_names', $row);
        } else {
            $DB->insert_record('pinnwand_board_names', (object) [
                'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
                'name' => $name, 'timemodified' => time(),
            ]);
        }
        return ['success' => true];
    }

    public static function set_board_name_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function set_board_hidden_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'boardid' => new external_value(PARAM_INT, 'Board-ID'),
            'hidden' => new external_value(PARAM_BOOL, 'Für andere Lernende ausgeblendet'),
        ]);
    }

    public static function set_board_hidden($cmid, $boardid, $hidden) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_board_hidden_parameters(), [
            'cmid' => $cmid, 'boardid' => $boardid, 'hidden' => $hidden,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $row = $DB->get_record('pinnwand_board_names', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
        ]);
        if ($row) {
            $row->hidden = (int) $params['hidden'];
            $row->timemodified = time();
            $DB->update_record('pinnwand_board_names', $row);
        } else {
            $DB->insert_record('pinnwand_board_names', (object) [
                'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
                'name' => null, 'hidden' => (int) $params['hidden'], 'timemodified' => time(),
            ]);
        }
        return ['success' => true];
    }

    public static function set_board_hidden_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function get_all_boards_parameters() {
        return new external_function_parameters(['cmid' => new external_value(PARAM_INT, 'Course module id')]);
    }

    /**
     * Liste aller Boards für den Kopfzeilen-Dropdown: immer die eigenen,
     * dazu die Boards anderer Personen, wenn die aufrufende Person die
     * Lehrkraft ist (sieht immer alles, auch ausgeblendete) oder wenn
     * "studentseeotherboards" aktiviert ist (dann ohne ausgeblendete).
     */
    public static function get_all_boards($cmid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_all_boards_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');
        $isteacher = has_capability('mod/pinnwand:viewall', $context);
        $seeothers = $isteacher || !empty($instance->studentseeotherboards);

        $sql = "SELECT DISTINCT p.userid, p.boardid, u.firstname, u.lastname
                  FROM {pinnwand_photos} p
                  JOIN {user} u ON u.id = p.userid
                 WHERE p.pinnwandid = :icid";
        $params2 = ['icid' => $instance->id];
        if (!$seeothers) {
            $sql .= " AND p.userid = :ownid";
            $params2['ownid'] = $USER->id;
        }
        $rows = $DB->get_records_sql($sql, $params2);

        $names = $DB->get_records('pinnwand_board_names', ['pinnwandid' => $instance->id]);
        $namekey = function ($userid, $boardid) { return $userid . ':' . $boardid; };
        $namemap = [];
        foreach ($names as $n) {
            $namemap[$namekey($n->userid, $n->boardid)] = $n;
        }

        $out = [];
        foreach ($rows as $r) {
            $isown = $r->userid == $USER->id;
            $entry = $namemap[$namekey($r->userid, $r->boardid)] ?? null;
            $hidden = $entry ? (bool) $entry->hidden : false;
            if ($hidden && !$isown && !$isteacher) {
                continue;
            }
            $out[] = [
                'userid' => (int) $r->userid,
                'boardid' => (int) $r->boardid,
                'ownername' => fullname($r),
                'isown' => $isown,
                'name' => $entry && $entry->name !== null ? (string) $entry->name : '',
                'hidden' => $hidden,
            ];
        }
        return ['boards' => $out];
    }

    public static function get_all_boards_returns() {
        return new external_single_structure([
            'boards' => new external_multiple_structure(new external_single_structure([
                'userid' => new external_value(PARAM_INT, 'Besitzer*in des Boards'),
                'boardid' => new external_value(PARAM_INT, 'Board-ID'),
                'ownername' => new external_value(PARAM_TEXT, 'Name der besitzenden Person'),
                'isown' => new external_value(PARAM_BOOL, 'Gehört der aufrufenden Person'),
                'name' => new external_value(PARAM_TEXT, 'Eigener Titel, falls gesetzt'),
                'hidden' => new external_value(PARAM_BOOL, 'Für andere Lernende ausgeblendet'),
            ])),
        ]);
    }

    public static function clone_board_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'boardid' => new external_value(PARAM_INT, 'Zu klonendes Board'),
        ]);
    }

    /**
     * Klont das angegebene Board der aktuellen Person: kopiert alle
     * platzierten Fotos (inkl. Dateien) und Rahmen des eigenen Fadens auf
     * diesem Board in ein neues Board. Stylus-Anmerkungen und der Faden
     * selbst werden bewusst NICHT mitkopiert (Scoping).
     */
    public static function clone_board($cmid, $boardid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::clone_board_parameters(), ['cmid' => $cmid, 'boardid' => $boardid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');
        if (!has_capability('mod/pinnwand:viewall', $context) && empty($instance->studentboardclone)) {
            throw new moodle_exception('nopermissions', 'error', '', 'clone_board');
        }

        $maxboard = (int) $DB->get_field_sql(
            'SELECT MAX(boardid) FROM {pinnwand_photos} WHERE pinnwandid = ? AND userid = ?',
            [$instance->id, $USER->id]
        );
        $newboardid = max($maxboard, $params['boardid']) + 1;

        // Kein Kopieren mehr: für jedes Objekt auf dem Quell-Board wird nur
        // eine ZUSÄTZLICHE Platzierung auf dem neuen Board angelegt (gleiche
        // Position). Das Objekt selbst (Datei, Titel, Zeichnung, Wortfeld...)
        // existiert weiterhin nur einmal - dadurch erscheint es in "Meine
        // Bilder" auch weiterhin nur einmal.
        $photos = $DB->get_records('pinnwand_photos', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'], 'status' => 'active',
        ]);
        foreach ($photos as $source) {
            $DB->insert_record('pinnwand_object_placements', (object) [
                'pinnwandid' => $instance->id, 'photoid' => $source->id, 'boardid' => $newboardid,
                'canvasx' => $source->canvasx, 'canvasy' => $source->canvasy, 'canvasw' => $source->canvasw,
                'canvasrot' => $source->canvasrot, 'canvasz' => $source->canvasz,
                'boardplaced' => $source->boardplaced, 'status' => 'active',
                'timecreated' => time(), 'timemodified' => time(),
            ]);
        }

        // Eigenen Board-Namen mitkopieren, falls gesetzt.
        $sourcename = $DB->get_record('pinnwand_board_names', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $params['boardid'],
        ]);
        if ($sourcename) {
            $DB->insert_record('pinnwand_board_names', (object) [
                'pinnwandid' => $instance->id, 'userid' => $USER->id, 'boardid' => $newboardid,
                'name' => $sourcename->name, 'timemodified' => time(),
            ]);
        }

        return ['newboardid' => $newboardid];
    }

    public static function clone_board_returns() {
        return new external_single_structure(['newboardid' => new external_value(PARAM_INT, 'ID des neuen Boards')]);
    }

    // ---------------------------------------------------------------
    // save_background: Hintergrund der Anordnungs-Leinwand (pro Nutzer*in
    // und Aktivität), entweder Farbe oder eines der eigenen Fotos als Bild.
    // ---------------------------------------------------------------
    public static function save_background_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'type' => new external_value(PARAM_ALPHA, 'color|image|url|upload'),
            'color' => new external_value(PARAM_TEXT, 'Hex-Farbe', VALUE_DEFAULT, '#2b2d33'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID als Hintergrundbild', VALUE_DEFAULT, 0),
            'url' => new external_value(PARAM_RAW, 'Externe Bild-URL', VALUE_DEFAULT, ''),
            'imagedata' => new external_value(PARAM_RAW, 'Data-URL (base64) für hochgeladenes Hintergrundbild', VALUE_DEFAULT, ''),
            'brightness' => new external_value(PARAM_INT, 'Helligkeit in % (20-180)', VALUE_DEFAULT, 100),
            'saturation' => new external_value(PARAM_INT, 'Sättigung in % (0-200)', VALUE_DEFAULT, 100),
            'fit' => new external_value(PARAM_ALPHA, 'contain (füllen, mit Rand) oder cover (abschneiden)', VALUE_DEFAULT, 'contain'),
        ]);
    }

    public static function save_background($cmid, $type, $color, $photoid, $url, $imagedata, $brightness, $saturation, $fit = 'contain') {
        global $USER, $DB;
        $params = self::validate_parameters(self::save_background_parameters(), [
            'cmid' => $cmid, 'type' => $type, 'color' => $color, 'photoid' => $photoid, 'url' => $url,
            'imagedata' => $imagedata, 'brightness' => $brightness, 'saturation' => $saturation, 'fit' => $fit,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $type = in_array($params['type'], ['image', 'url', 'upload'], true) ? $params['type'] : 'color';

        // Fremde Fotos (aus den Uploads der Klasse) nur erlauben, wenn die
        // Person die Klassenansicht sehen darf - sonst könnte theoretisch
        // jede beliebige Foto-ID untergeschoben werden.
        if ($type === 'image' && $params['photoid'] > 0) {
            $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid'], 'pinnwandid' => $instance->id]);
            if (!$photo || ((int) $photo->userid !== (int) $USER->id && !self::can_view_class($instance, $context))) {
                throw new moodle_exception('nopermissions', 'error', '', 'save_background');
            }
        }

        // Nur eine echte Datei schreiben, wenn tatsächlich neue Bilddaten
        // mitgeschickt wurden (sonst ist es z.B. nur eine Helligkeits-/
        // Sättigungsänderung an einem bereits hochgeladenen Bild).
        if ($type === 'upload' && $params['imagedata'] !== '') {
            if (!preg_match('#^data:image/(png|jpeg|jpg);base64,(.+)$#', $params['imagedata'], $m)) {
                throw new moodle_exception('error_save', 'pinnwand');
            }
            $ext = $m[1] === 'png' ? 'png' : 'jpg';
            $binary = base64_decode($m[2]);
            if ($binary === false || strlen($binary) < 50) {
                throw new moodle_exception('error_save', 'pinnwand');
            }
            $fs = get_file_storage();
            $fs->delete_area_files($context->id, 'mod_pinnwand', 'background', $USER->id);
            $fs->create_file_from_string([
                'contextid' => $context->id,
                'component' => 'mod_pinnwand',
                'filearea'  => 'background',
                'itemid'    => $USER->id,
                'filepath'  => '/',
                'filename'  => 'bg_' . $USER->id . '.' . $ext,
            ], $binary);
        }

        $payload = [
            'type' => $type,
            'color' => clean_param($params['color'], PARAM_TEXT),
            'photoid' => (int) $params['photoid'],
            'url' => clean_param($params['url'], PARAM_URL),
            'brightness' => max(20, min(180, (int) $params['brightness'])),
            'saturation' => max(0, min(200, (int) $params['saturation'])),
            'fit' => in_array($params['fit'], ['cover', 'contain'], true) ? $params['fit'] : 'contain',
        ];
        set_user_preference('mod_pinnwand_bg_' . $instance->id, json_encode($payload), $USER->id);

        return ['background' => self::get_background_data($instance, $context)];
    }

    public static function save_background_returns() {
        return new external_single_structure([
            'background' => new external_single_structure([
                'type' => new external_value(PARAM_ALPHA, 'color|image|url|upload'),
                'color' => new external_value(PARAM_TEXT, 'Hintergrundfarbe'),
                'url' => new external_value(PARAM_RAW, 'Hintergrundbild-URL', VALUE_DEFAULT, null, NULL_ALLOWED),
                'brightness' => new external_value(PARAM_INT, 'Helligkeit in %'),
                'saturation' => new external_value(PARAM_INT, 'Sättigung in %'),
                'fit' => new external_value(PARAM_ALPHA, 'contain oder cover'),
            ]),
        ]);
    }

    // ---------------------------------------------------------------
    // update_layout
    // ---------------------------------------------------------------
    public static function update_layout_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'x' => new external_value(PARAM_FLOAT, 'x'),
            'y' => new external_value(PARAM_FLOAT, 'y'),
            'w' => new external_value(PARAM_FLOAT, 'Breite'),
            'rot' => new external_value(PARAM_FLOAT, 'Rotation'),
            'z' => new external_value(PARAM_INT, 'Ebene'),
            'boardid' => new external_value(PARAM_INT, 'Board-ID', VALUE_DEFAULT, 0),
        ]);
    }

    public static function update_layout($cmid, $photoid, $x, $y, $w, $rot, $z, $boardid = 0) {
        global $DB, $USER;
        $params = self::validate_parameters(self::update_layout_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'x' => $x, 'y' => $y, 'w' => $w, 'rot' => $rot, 'z' => $z,
            'boardid' => $boardid,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->userid != $USER->id || $photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'update_layout');
        }
        $photo->canvasx = $params['x'];
        $photo->canvasy = $params['y'];
        $photo->canvasw = max(40, $params['w']);
        $photo->canvasrot = $params['rot'];
        $photo->canvasz = $params['z'];
        $photo->boardid = $params['boardid'];
        // Ein Aufruf von update_layout bedeutet immer, dass das Foto jetzt
        // reale Board-Koordinaten hat - egal ob es gerade erst aus dem
        // Post-Stream übernommen oder ein bereits platziertes Foto nur
        // verschoben/skaliert/rotiert wurde.
        $photo->boardplaced = 1;
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true];
    }

    public static function update_layout_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    // ---------------------------------------------------------------
    // update_grid: Raster wird erst hier, in der Galerieansicht, pro
    // Foto festgelegt (nicht mehr während der Aufnahme).
    // ---------------------------------------------------------------
    public static function update_grid_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'gridtype' => new external_value(PARAM_ALPHA, 'none|square|fixed'),
            'gridvalue' => new external_value(PARAM_INT, 'Zellgröße bzw. Anzahl Unterteilungen', VALUE_DEFAULT, 0),
            'gridcolor' => new external_value(PARAM_TEXT, 'Hex-Farbe des Rasters', VALUE_DEFAULT, '#ff3c3c'),
        ]);
    }

    public static function update_grid($cmid, $photoid, $gridtype, $gridvalue, $gridcolor) {
        global $DB, $USER;
        $params = self::validate_parameters(self::update_grid_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'gridtype' => $gridtype, 'gridvalue' => $gridvalue,
            'gridcolor' => $gridcolor,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->userid != $USER->id || $photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'update_grid');
        }
        $gridtype = in_array($params['gridtype'], ['none', 'square', 'fixed'], true) ? $params['gridtype'] : 'none';
        $photo->gridtype = $gridtype;
        $photo->gridvalue = (int) $params['gridvalue'];
        $photo->gridcolor = preg_match('/^#[0-9a-fA-F]{6}$/', $params['gridcolor']) ? $params['gridcolor'] : '#ff3c3c';
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true];
    }

    public static function update_grid_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    // ---------------------------------------------------------------
    // update_source: Quellenangaben nachträglich bearbeiten. Eigene Fotos
    // mit submit-Recht, fremde nur mit manage-Recht (Lehrkraft-Ansicht).
    // ---------------------------------------------------------------
    public static function update_source_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'sourcetitle' => new external_value(PARAM_TEXT, 'Titel', VALUE_DEFAULT, ''),
            'sourceauthor' => new external_value(PARAM_TEXT, 'Autor*in', VALUE_DEFAULT, ''),
            'sourceyear' => new external_value(PARAM_TEXT, 'Jahr', VALUE_DEFAULT, ''),
            'sourceepoch' => new external_value(PARAM_TEXT, 'Epoche', VALUE_DEFAULT, ''),
            'sourceplace' => new external_value(PARAM_TEXT, 'Ort', VALUE_DEFAULT, ''),
            'sourceorigauthor' => new external_value(PARAM_TEXT, 'Autor*in der Vorlage', VALUE_DEFAULT, ''),
        ]);
    }

    public static function update_source($cmid, $photoid, $sourcetitle, $sourceauthor, $sourceyear,
            $sourceepoch, $sourceplace, $sourceorigauthor) {
        global $DB, $USER;
        $params = self::validate_parameters(self::update_source_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'sourcetitle' => $sourcetitle, 'sourceauthor' => $sourceauthor,
            'sourceyear' => $sourceyear, 'sourceepoch' => $sourceepoch, 'sourceplace' => $sourceplace,
            'sourceorigauthor' => $sourceorigauthor,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'update_source');
        }
        $isown = $photo->userid == $USER->id;
        $canmanage = has_capability('mod/pinnwand:manage', $context);
        $ok = $canmanage || ($isown && has_capability('mod/pinnwand:submit', $context));
        if (!$ok) {
            throw new moodle_exception('nopermissions', 'error', '', 'update_source');
        }

        $photo->sourcetitle = clean_param($params['sourcetitle'], PARAM_TEXT);
        $photo->sourceauthor = clean_param($params['sourceauthor'], PARAM_TEXT);
        $photo->sourceyear = clean_param($params['sourceyear'], PARAM_TEXT);
        $photo->sourceepoch = clean_param($params['sourceepoch'], PARAM_TEXT);
        $photo->sourceplace = clean_param($params['sourceplace'], PARAM_TEXT);
        $photo->sourceorigauthor = clean_param($params['sourceorigauthor'], PARAM_TEXT);
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true];
    }

    public static function update_source_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    // ---------------------------------------------------------------
    // delete_photo
    // ---------------------------------------------------------------
    public static function delete_photo_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
        ]);
    }

    public static function delete_photo($cmid, $photoid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::delete_photo_parameters(), ['cmid' => $cmid, 'photoid' => $photoid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'delete_photo');
        }
        // Eigene Fotos darf man mit submit-Recht löschen; fremde Fotos nur
        // mit manage-Recht (Lehrkraft-Bereinigungsmodus).
        $isown = $photo->userid == $USER->id;
        $canmanage = has_capability('mod/pinnwand:manage', $context);
        $ok = $canmanage || ($isown && has_capability('mod/pinnwand:submit', $context));
        if (!$ok) {
            throw new moodle_exception('nopermissions', 'error', '', 'delete_photo');
        }
        // Landet zunächst im Trashbin (reversibel), statt sofort endgültig
        // gelöscht zu werden - siehe permanently_delete_photo/restore_photo.
        $photo->status = 'trash';
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true];
    }

    public static function delete_photo_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function restore_photo_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
        ]);
    }

    public static function restore_photo($cmid, $photoid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::restore_photo_parameters(), ['cmid' => $cmid, 'photoid' => $photoid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->pinnwandid != $instance->id || $photo->userid != $USER->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'restore_photo');
        }
        $photo->status = 'active';
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true];
    }

    public static function restore_photo_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function permanently_delete_photo_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
        ]);
    }

    /**
     * Löscht ein Objekt endgültig - nur möglich, wenn es im Trashbin liegt
     * UND auf keinem anderen Board mehr aktiv platziert ist (sonst würde es
     * dort verschwinden, obwohl die Person das nicht angefordert hat).
     */
    public static function permanently_delete_photo($cmid, $photoid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::permanently_delete_photo_parameters(), ['cmid' => $cmid, 'photoid' => $photoid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->pinnwandid != $instance->id || $photo->userid != $USER->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'permanently_delete_photo');
        }
        $stillused = $DB->count_records('pinnwand_object_placements', ['photoid' => $photo->id, 'status' => 'active']);
        if ($stillused > 0) {
            throw new moodle_exception('error_save', 'pinnwand');
        }
        $fs = get_file_storage();
        $fs->delete_area_files($context->id, 'mod_pinnwand', 'photo', $photo->id);
        $DB->delete_records('pinnwand_photos', ['id' => $photo->id]);
        $DB->delete_records('pinnwand_object_placements', ['photoid' => $photo->id]);

        return ['success' => true];
    }

    public static function permanently_delete_photo_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function get_trash_parameters() {
        return new external_function_parameters(['cmid' => new external_value(PARAM_INT, 'Course module id')]);
    }

    /**
     * Trashbin-Inhalt: eigene Objekte mit status=trash sowie eigene
     * Platzierungen mit status=trash (von einem Board entfernt, Objekt
     * selbst aber noch aktiv) - gruppiert nach Board im Client.
     */
    public static function get_trash($cmid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_trash_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $trashedphotos = $DB->get_records('pinnwand_photos', [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'status' => 'trash',
        ]);
        $out = [];
        foreach ($trashedphotos as $r) {
            $activecount = $DB->count_records('pinnwand_object_placements', ['photoid' => $r->id, 'status' => 'active']);
            $out[] = [
                'kind' => 'object', 'id' => (int) $r->id, 'boardid' => (int) $r->boardid,
                'sourcetitle' => (string) $r->sourcetitle, 'usedelsewhere' => $activecount > 0,
            ];
        }
        $trashedplacements = $DB->get_records_sql(
            "SELECT pl.* FROM {pinnwand_object_placements} pl
              JOIN {pinnwand_photos} p ON p.id = pl.photoid
             WHERE pl.pinnwandid = :icid AND pl.status = 'trash' AND p.userid = :userid",
            ['icid' => $instance->id, 'userid' => $USER->id]
        );
        foreach ($trashedplacements as $r) {
            $out[] = [
                'kind' => 'placement', 'id' => (int) $r->id, 'boardid' => (int) $r->boardid,
                'sourcetitle' => '', 'usedelsewhere' => true,
            ];
        }
        return ['items' => $out];
    }

    public static function get_trash_returns() {
        return new external_single_structure([
            'items' => new external_multiple_structure(new external_single_structure([
                'kind' => new external_value(PARAM_ALPHA, 'object (Foto komplett im Trash) oder placement (nur eine Board-Platzierung)'),
                'id' => new external_value(PARAM_INT, 'ID des Objekts bzw. der Platzierung'),
                'boardid' => new external_value(PARAM_INT, 'Board, von dem entfernt wurde'),
                'sourcetitle' => new external_value(PARAM_TEXT, 'Titel (nur bei kind=object)'),
                'usedelsewhere' => new external_value(PARAM_BOOL, 'Objekt ist noch auf mind. einem anderen Board aktiv'),
            ])),
        ]);
    }

    // ---------------------------------------------------------------
    // get_all_photos: Klassenansicht für die Lehrkraft - alle eingereichten
    // Fotos, gruppiert nach Nutzer*in (untereinander pro Lernender/m).
    // ---------------------------------------------------------------
    public static function get_all_photos_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
        ]);
    }

    /**
     * Klassenansicht: Lehrkräfte (viewall) dürfen immer; Lernende nur, wenn
     * die Aktivitätseinstellung "studentclassview" das erlaubt - dann aber
     * nur lesend (candelete/canedit bleiben an das manage-Recht gebunden).
     */
    protected static function can_view_class($instance, $context) {
        return has_capability('mod/pinnwand:viewall', $context)
            || (!empty($instance->studentclassview) && has_capability('mod/pinnwand:view', $context));
    }

    public static function get_all_photos($cmid) {
        global $DB;
        $params = self::validate_parameters(self::get_all_photos_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');
        if (!self::can_view_class($instance, $context)) {
            throw new moodle_exception('nopermissions', 'error', '', 'get_all_photos');
        }

        $sql = "SELECT p.*, u.firstname, u.lastname
                  FROM {pinnwand_photos} p
                  JOIN {user} u ON u.id = p.userid
                 WHERE p.pinnwandid = :icid AND p.status = 'active'
              ORDER BY u.lastname, u.firstname, p.sortorder";
        $records = $DB->get_records_sql($sql, ['icid' => $instance->id]);

        $fs = get_file_storage();
        $out = [];
        foreach ($records as $r) {
            $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $r->id, 'filename', false);
            $file = reset($files);
            if (!$file) {
                continue;
            }
            $out[] = [
                'id' => (int) $r->id,
                'userid' => (int) $r->userid,
                'userfullname' => fullname($r),
                'url' => (string) moodle_url::make_pluginfile_url(
                    $context->id, 'mod_pinnwand', 'photo', $r->id, '/', $file->get_filename()
                ),
                'sourcetitle' => (string) $r->sourcetitle,
                'sourceauthor' => (string) $r->sourceauthor,
                'sourceyear' => (string) $r->sourceyear,
                'sourceepoch' => (string) $r->sourceepoch,
                'sourceplace' => (string) $r->sourceplace,
                'sourceorigauthor' => (string) $r->sourceorigauthor,
                'consent' => (bool) $r->consent,
                'hiddenfromboard' => (bool) $r->hiddenfromboard,
                'timecreated' => (int) $r->timecreated,
            ];
        }
        return [
            'photos' => $out,
            'candelete' => has_capability('mod/pinnwand:manage', $context),
            'canedit' => has_capability('mod/pinnwand:manage', $context),
        ];
    }

    public static function get_all_photos_returns() {
        return new external_single_structure([
            'candelete' => new external_value(PARAM_BOOL, 'Darf löschen'),
            'canedit' => new external_value(PARAM_BOOL, 'Darf Angaben bearbeiten'),
            'photos' => new external_multiple_structure(new external_single_structure([
                'id' => new external_value(PARAM_INT, 'ID'),
                'userid' => new external_value(PARAM_INT, 'Nutzer-ID'),
                'userfullname' => new external_value(PARAM_TEXT, 'Voller Name'),
                'url' => new external_value(PARAM_RAW, 'URL'),
                'sourcetitle' => new external_value(PARAM_TEXT, 'Titel'),
                'sourceauthor' => new external_value(PARAM_TEXT, 'Autor*in'),
                'sourceyear' => new external_value(PARAM_TEXT, 'Jahr'),
                'sourceepoch' => new external_value(PARAM_TEXT, 'Epoche'),
                'sourceplace' => new external_value(PARAM_TEXT, 'Ort'),
                'sourceorigauthor' => new external_value(PARAM_TEXT, 'Autor*in der Vorlage'),
                'consent' => new external_value(PARAM_BOOL, 'Einwilligung'),
                'hiddenfromboard' => new external_value(PARAM_BOOL, 'Von der Pinnwand ausgeblendet'),
                'timecreated' => new external_value(PARAM_INT, 'Hochgeladen am'),
            ])),
        ]);
    }

    // ---------------------------------------------------------------
    // set_photo_hidden: einzelnes Foto von der Pinnwand aus-/einblenden.
    // Eigene Fotos mit submit-Recht, sofern "Lernende können senden"
    // aktiviert ist (oder man ohnehin manage-Recht hat). Fremde Fotos nur
    // mit manage-Recht, sofern "Lehrkräfte können senden" aktiviert ist.
    // ---------------------------------------------------------------
    public static function set_photo_hidden_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'hidden' => new external_value(PARAM_BOOL, 'Von der Pinnwand ausgeblendet'),
        ]);
    }

    public static function set_photo_hidden($cmid, $photoid, $hidden) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_photo_hidden_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'hidden' => $hidden,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'set_photo_hidden');
        }
        $isown = $photo->userid == $USER->id;
        $canmanage = has_capability('mod/pinnwand:manage', $context);
        if ($isown) {
            $ok = has_capability('mod/pinnwand:submit', $context) && ($canmanage || !empty($instance->studentcansend));
        } else {
            $ok = $canmanage && !empty($instance->teachercansend);
        }
        if (!$ok) {
            throw new moodle_exception('nopermissions', 'error', '', 'set_photo_hidden');
        }

        $photo->hiddenfromboard = !empty($params['hidden']) ? 1 : 0;
        if ($photo->hiddenfromboard) {
            // Ein erneutes Anpinnen soll wieder über den Post-Stream laufen
            // (dorthin gezogen/getippt werden), nicht sofort an der alten
            // Position auf dem Board wieder auftauchen.
            $photo->boardplaced = 0;
        }
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true, 'hiddenfromboard' => (bool) $photo->hiddenfromboard];
    }

    public static function set_photo_hidden_returns() {
        return new external_single_structure([
            'success' => new external_value(PARAM_BOOL, 'OK'),
            'hiddenfromboard' => new external_value(PARAM_BOOL, 'Neuer Zustand'),
        ]);
    }

    // ---------------------------------------------------------------
    // set_annotation_onboard: eigenes Foto - steuert, ob die Zeichen-/
    // Schreib-Ebene dieses Fotos auch auf der Pinnwand sichtbar ist
    // (unabhängig davon, ob sie in der Galerie gezeigt wird).
    // ---------------------------------------------------------------
    public static function set_annotation_onboard_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'onboard' => new external_value(PARAM_BOOL, 'Auf der Pinnwand zeigen'),
        ]);
    }

    public static function set_annotation_onboard($cmid, $photoid, $onboard) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_annotation_onboard_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'onboard' => $onboard,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->userid != $USER->id || $photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'set_annotation_onboard');
        }
        $photo->annotationonboard = !empty($params['onboard']) ? 1 : 0;
        $DB->update_record('pinnwand_photos', $photo);

        return ['success' => true, 'annotationonboard' => (bool) $photo->annotationonboard];
    }

    public static function set_annotation_onboard_returns() {
        return new external_single_structure([
            'success' => new external_value(PARAM_BOOL, 'OK'),
            'annotationonboard' => new external_value(PARAM_BOOL, 'Neuer Zustand'),
        ]);
    }

    // ---------------------------------------------------------------
    // update_photo: ein bereits gespeichertes Foto erneut bearbeiten
    // (Entzerren/Zuschneiden/Farbe) und das Bild darunter ersetzen, ohne
    // einen neuen Datensatz anzulegen - Quellenangaben, Raster, Position
    // auf der Pinnwand usw. bleiben unverändert erhalten.
    // ---------------------------------------------------------------
    public static function update_photo_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID'),
            'imagedata' => new external_value(PARAM_RAW, 'Data-URL (base64) des neu bearbeiteten Fotos'),
            'wordfielddata' => new external_value(PARAM_RAW, 'Strukturierte Wortfeld-Daten (JSON), falls Wortfeld', VALUE_DEFAULT, ''),
        ]);
    }

    public static function update_photo($cmid, $photoid, $imagedata, $wordfielddata = '') {
        global $DB, $USER;
        $params = self::validate_parameters(self::update_photo_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'imagedata' => $imagedata, 'wordfielddata' => $wordfielddata,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'update_photo');
        }
        $isown = $photo->userid == $USER->id;
        $canmanage = has_capability('mod/pinnwand:manage', $context);
        $ok = $canmanage || ($isown && has_capability('mod/pinnwand:submit', $context));
        if (!$ok) {
            throw new moodle_exception('nopermissions', 'error', '', 'update_photo');
        }

        if (!preg_match('#^data:image/(png|jpeg|jpg|svg\+xml);base64,(.+)$#', $params['imagedata'], $m)) {
            throw new moodle_exception('error_save', 'pinnwand');
        }
        $ext = $m[1] === 'png' ? 'png' : ($m[1] === 'svg+xml' ? 'svg' : 'jpg');
        $binary = base64_decode($m[2]);
        if ($binary === false || strlen($binary) < 20) {
            throw new moodle_exception('error_save', 'pinnwand');
        }

        $photo->wordfielddata = $params['wordfielddata'] !== '' ? $params['wordfielddata'] : null;
        $DB->update_record('pinnwand_photos', $photo);

        $fs = get_file_storage();
        $fs->delete_area_files($context->id, 'mod_pinnwand', 'photo', $photo->id);
        $filerecord = [
            'contextid' => $context->id,
            'component' => 'mod_pinnwand',
            'filearea'  => 'photo',
            'itemid'    => $photo->id,
            'filepath'  => '/',
            'filename'  => 'photo_' . $photo->id . '_' . time() . '.' . $ext,
        ];
        $fs->create_file_from_string($filerecord, $binary);

        return [
            'success' => true,
            'url' => (string) moodle_url::make_pluginfile_url(
                $context->id, 'mod_pinnwand', 'photo', $photo->id, '/', $filerecord['filename']
            ),
        ];
    }

    public static function update_photo_returns() {
        return new external_single_structure([
            'success' => new external_value(PARAM_BOOL, 'OK'),
            'url' => new external_value(PARAM_RAW, 'Neue Bild-URL'),
        ]);
    }

    // ---------------------------------------------------------------
    // Roter Faden: ein Faden pro Person (Lehrkraft immer, Lernende nur
    // falls die Aktivitätseinstellung "studentthreads" es erlaubt).
    // Farbe wird beim Anlegen einmalig aus einer festen Palette anhand der
    // Nutzer-ID vergeben (deterministisch, ohne UI zur Auswahl).
    // ---------------------------------------------------------------
    const THREAD_COLORS = ['#e0503f', '#4f8cff', '#3fcf8e', '#e0b23f', '#b06fe0', '#3fc7cf'];

    protected static function can_use_threads($instance, $context) {
        return has_capability('mod/pinnwand:viewall', $context) || (bool) $instance->studentthreads;
    }

    protected static function get_or_create_thread($instance, $context, $USER) {
        global $DB;
        $thread = $DB->get_record('pinnwand_threads', ['pinnwandid' => $instance->id, 'userid' => $USER->id]);
        if ($thread) {
            return $thread;
        }
        if (!self::can_use_threads($instance, $context)) {
            throw new moodle_exception('nopermissions', 'error', '', 'thread');
        }
        // Der Faden der Lehrkraft ("Hauptfaden") ist immer echtes Rot -
        // Lernende bekommen stattdessen eine unterscheidbare Farbe aus der
        // Palette, deterministisch je nach Nutzer-ID.
        $color = has_capability('mod/pinnwand:viewall', $context)
            ? '#e0231f' : self::THREAD_COLORS[$USER->id % count(self::THREAD_COLORS)];
        $thread = (object) [
            'pinnwandid' => $instance->id, 'userid' => $USER->id, 'color' => $color, 'timecreated' => time(),
        ];
        $thread->id = $DB->insert_record('pinnwand_threads', $thread);
        return $thread;
    }

    protected static function export_thread_items($threadid) {
        global $DB;
        $records = $DB->get_records('pinnwand_thread_items', ['threadid' => $threadid], 'sortorder ASC');
        $out = [];
        foreach ($records as $r) {
            $out[] = [
                'id' => (int) $r->id,
                'itemtype' => $r->itemtype,
                'photoid' => $r->photoid !== null ? (int) $r->photoid : 0,
                'boardid' => (int) $r->boardid,
                'framex' => $r->framex !== null ? (float) $r->framex : 0,
                'framey' => $r->framey !== null ? (float) $r->framey : 0,
                'framew' => $r->framew !== null ? (float) $r->framew : 0,
                'frameh' => $r->frameh !== null ? (float) $r->frameh : 0,
                'framerot' => $r->framerot !== null ? (float) $r->framerot : 0,
                'framez' => (int) $r->framez,
                'framelabel' => (string) ($r->framelabel ?? ''),
            ];
        }
        return $out;
    }

    protected static function thread_structure() {
        return new external_single_structure([
            'id' => new external_value(PARAM_INT, 'Thread-ID'),
            'color' => new external_value(PARAM_TEXT, 'Farbe (Hex)'),
            'bgmoves' => new external_value(PARAM_BOOL, 'Hintergrund bewegt sich beim Präsentations-Zoom mit'),
            'linewidth' => new external_value(PARAM_FLOAT, 'Dicke der Fadenlinie/Rahmen-Umrandung in px'),
            'isown' => new external_value(PARAM_BOOL, 'Gehört der aktuellen Person'),
            'items' => new external_multiple_structure(new external_single_structure([
                'id' => new external_value(PARAM_INT, 'Item-ID'),
                'itemtype' => new external_value(PARAM_ALPHA, 'photo|frame|overview'),
                'photoid' => new external_value(PARAM_INT, 'Foto-ID (0 bei frame/overview)'),
                'boardid' => new external_value(PARAM_INT, 'Board-ID'),
                'framex' => new external_value(PARAM_FLOAT, 'x (nur frame)'),
                'framey' => new external_value(PARAM_FLOAT, 'y (nur frame)'),
                'framew' => new external_value(PARAM_FLOAT, 'Breite (nur frame)'),
                'frameh' => new external_value(PARAM_FLOAT, 'Höhe (nur frame)'),
                'framerot' => new external_value(PARAM_FLOAT, 'Rotation in Grad (nur frame)'),
                'framez' => new external_value(PARAM_INT, 'Z-Reihenfolge (nur frame)'),
                'framelabel' => new external_value(PARAM_TEXT, 'Beschriftung (nur frame)'),
            ])),
        ]);
    }

    public static function get_threads_parameters() {
        return new external_function_parameters(['cmid' => new external_value(PARAM_INT, 'Course module id')]);
    }

    public static function get_threads($cmid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_threads_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $out = [];
        $own = $DB->get_record('pinnwand_threads', ['pinnwandid' => $instance->id, 'userid' => $USER->id]);
        if ($own) {
            $out[] = array_merge(
                ['id' => (int) $own->id, 'color' => $own->color, 'bgmoves' => (bool) $own->bgmoves,
                    'linewidth' => (float) $own->linewidth, 'isown' => true],
                ['items' => self::export_thread_items($own->id)]
            );
        }
        // Lernende sehen zusätzlich (nur lesend/abspielbar) den Faden der
        // Lehrkraft, sofern vorhanden - die Lehrkraft selbst braucht das
        // nicht (sieht ohnehin nur ihren eigenen offiziellen Faden).
        if (!has_capability('mod/pinnwand:viewall', $context)) {
            $teacherids = array_keys(get_users_by_capability($context, 'mod/pinnwand:viewall', 'u.id'));
            if (!empty($teacherids)) {
                [$insql, $inparams] = $DB->get_in_or_equal($teacherids);
                $teacherthread = $DB->get_record_select(
                    'pinnwand_threads', "pinnwandid = ? AND userid $insql",
                    array_merge([$instance->id], $inparams), '*', IGNORE_MULTIPLE
                );
                if ($teacherthread) {
                    $out[] = array_merge(
                        ['id' => (int) $teacherthread->id, 'color' => $teacherthread->color,
                            'bgmoves' => (bool) $teacherthread->bgmoves,
                            'linewidth' => (float) $teacherthread->linewidth, 'isown' => false],
                        ['items' => self::export_thread_items($teacherthread->id)]
                    );
                }
            }
        }
        return ['threads' => $out, 'canuse' => self::can_use_threads($instance, $context)];
    }

    public static function get_threads_returns() {
        return new external_single_structure([
            'threads' => new external_multiple_structure(self::thread_structure()),
            'canuse' => new external_value(PARAM_BOOL, 'Darf einen eigenen Faden anlegen/bearbeiten'),
        ]);
    }

    public static function add_thread_item_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'itemtype' => new external_value(PARAM_ALPHA, 'photo|frame'),
            'photoid' => new external_value(PARAM_INT, 'Foto-ID (bei photo)', VALUE_DEFAULT, 0),
            'boardid' => new external_value(PARAM_INT, 'Board-ID', VALUE_DEFAULT, 0),
            'framex' => new external_value(PARAM_FLOAT, 'x (bei frame)', VALUE_DEFAULT, 0),
            'framey' => new external_value(PARAM_FLOAT, 'y (bei frame)', VALUE_DEFAULT, 0),
            'framew' => new external_value(PARAM_FLOAT, 'Breite (bei frame)', VALUE_DEFAULT, 200),
            'frameh' => new external_value(PARAM_FLOAT, 'Höhe (bei frame)', VALUE_DEFAULT, 150),
            'framelabel' => new external_value(PARAM_TEXT, 'Beschriftung (bei frame)', VALUE_DEFAULT, ''),
        ]);
    }

    public static function add_thread_item($cmid, $itemtype, $photoid = 0, $boardid = 0,
            $framex = 0, $framey = 0, $framew = 200, $frameh = 150, $framelabel = '') {
        global $DB, $USER;
        $params = self::validate_parameters(self::add_thread_item_parameters(), [
            'cmid' => $cmid, 'itemtype' => $itemtype, 'photoid' => $photoid, 'boardid' => $boardid,
            'framex' => $framex, 'framey' => $framey, 'framew' => $framew, 'frameh' => $frameh,
            'framelabel' => $framelabel,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');
        if (!in_array($params['itemtype'], ['photo', 'frame', 'overview'], true)) {
            throw new moodle_exception('invalidparameter', 'debug');
        }
        $thread = self::get_or_create_thread($instance, $context, $USER);

        if ($params['itemtype'] === 'photo') {
            $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
            if ($photo->userid != $USER->id || $photo->pinnwandid != $instance->id) {
                throw new moodle_exception('nopermissions', 'error', '', 'add_thread_item');
            }
        }

        $maxorder = (int) $DB->get_field_sql(
            'SELECT MAX(sortorder) FROM {pinnwand_thread_items} WHERE threadid = ?', [$thread->id]
        );
        $maxz = (int) $DB->get_field_sql(
            'SELECT MAX(framez) FROM {pinnwand_thread_items} WHERE threadid = ?', [$thread->id]
        );
        $item = (object) [
            'threadid' => $thread->id,
            'sortorder' => $maxorder + 1,
            'itemtype' => $params['itemtype'],
            'photoid' => $params['itemtype'] === 'photo' ? $params['photoid'] : null,
            'boardid' => $params['boardid'],
            'framex' => $params['itemtype'] === 'frame' ? $params['framex'] : null,
            'framey' => $params['itemtype'] === 'frame' ? $params['framey'] : null,
            'framew' => $params['itemtype'] === 'frame' ? $params['framew'] : null,
            'frameh' => $params['itemtype'] === 'frame' ? $params['frameh'] : null,
            'framez' => $params['itemtype'] === 'frame' ? ($maxz + 1) : 0,
            'framelabel' => $params['itemtype'] === 'frame' ? $params['framelabel'] : null,
            'timecreated' => time(),
        ];
        $item->id = $DB->insert_record('pinnwand_thread_items', $item);

        return ['threadid' => (int) $thread->id, 'color' => $thread->color, 'items' => self::export_thread_items($thread->id)];
    }

    public static function add_thread_item_returns() {
        return new external_single_structure([
            'threadid' => new external_value(PARAM_INT, 'Thread-ID'),
            'color' => new external_value(PARAM_TEXT, 'Farbe (Hex)'),
            'items' => new external_multiple_structure(new external_single_structure([
                'id' => new external_value(PARAM_INT, 'Item-ID'),
                'itemtype' => new external_value(PARAM_ALPHA, 'photo|frame'),
                'photoid' => new external_value(PARAM_INT, 'Foto-ID (0 bei frame)'),
                'boardid' => new external_value(PARAM_INT, 'Board-ID'),
                'framex' => new external_value(PARAM_FLOAT, 'x (nur frame)'),
                'framey' => new external_value(PARAM_FLOAT, 'y (nur frame)'),
                'framew' => new external_value(PARAM_FLOAT, 'Breite (nur frame)'),
                'frameh' => new external_value(PARAM_FLOAT, 'Höhe (nur frame)'),
                'framerot' => new external_value(PARAM_FLOAT, 'Rotation in Grad (nur frame)'),
                'framez' => new external_value(PARAM_INT, 'Z-Reihenfolge (nur frame)'),
                'framelabel' => new external_value(PARAM_TEXT, 'Beschriftung (nur frame)'),
            ])),
        ]);
    }

    public static function remove_thread_item_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'itemid' => new external_value(PARAM_INT, 'Item-ID'),
        ]);
    }

    public static function remove_thread_item($cmid, $itemid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::remove_thread_item_parameters(), ['cmid' => $cmid, 'itemid' => $itemid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $item = $DB->get_record('pinnwand_thread_items', ['id' => $params['itemid']], '*', MUST_EXIST);
        $thread = $DB->get_record('pinnwand_threads', ['id' => $item->threadid], '*', MUST_EXIST);
        if ($thread->userid != $USER->id || $thread->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'remove_thread_item');
        }
        $DB->delete_records('pinnwand_thread_items', ['id' => $item->id]);
        return ['success' => true];
    }

    public static function remove_thread_item_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function reorder_thread_items_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'itemids' => new external_multiple_structure(new external_value(PARAM_INT, 'Item-ID'), 'Neue Reihenfolge'),
        ]);
    }

    public static function reorder_thread_items($cmid, $itemids) {
        global $DB, $USER;
        $params = self::validate_parameters(self::reorder_thread_items_parameters(), ['cmid' => $cmid, 'itemids' => $itemids]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $own = $DB->get_record('pinnwand_threads', ['pinnwandid' => $instance->id, 'userid' => $USER->id], '*', MUST_EXIST);
        foreach ($params['itemids'] as $order => $itemid) {
            $item = $DB->get_record('pinnwand_thread_items', ['id' => $itemid, 'threadid' => $own->id]);
            if ($item) {
                $item->sortorder = $order;
                $DB->update_record('pinnwand_thread_items', $item);
            }
        }
        return ['success' => true];
    }

    public static function reorder_thread_items_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function update_thread_frame_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'itemid' => new external_value(PARAM_INT, 'Item-ID (Leerrahmen)'),
            'framex' => new external_value(PARAM_FLOAT, 'x'),
            'framey' => new external_value(PARAM_FLOAT, 'y'),
            'framew' => new external_value(PARAM_FLOAT, 'Breite'),
            'frameh' => new external_value(PARAM_FLOAT, 'Höhe'),
            'framerot' => new external_value(PARAM_FLOAT, 'Rotation in Grad', VALUE_DEFAULT, 0),
            'framez' => new external_value(PARAM_INT, 'Z-Reihenfolge', VALUE_DEFAULT, 0),
        ]);
    }

    /**
     * Speichert Position/Größe/Rotation/Schichtung eines Leerrahmens,
     * nachdem er auf der Pinnwand verschoben, skaliert, gedreht oder in
     * der Schichtung-Liste umsortiert wurde.
     */
    public static function update_thread_frame($cmid, $itemid, $framex, $framey, $framew, $frameh, $framerot = 0, $framez = 0) {
        global $DB, $USER;
        $params = self::validate_parameters(self::update_thread_frame_parameters(), [
            'cmid' => $cmid, 'itemid' => $itemid, 'framex' => $framex, 'framey' => $framey,
            'framew' => $framew, 'frameh' => $frameh, 'framerot' => $framerot, 'framez' => $framez,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $item = $DB->get_record('pinnwand_thread_items', ['id' => $params['itemid'], 'itemtype' => 'frame'], '*', MUST_EXIST);
        $thread = $DB->get_record('pinnwand_threads', ['id' => $item->threadid], '*', MUST_EXIST);
        if ($thread->userid != $USER->id || $thread->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'update_thread_frame');
        }
        $item->framex = $params['framex'];
        $item->framey = $params['framey'];
        $item->framew = max(40, $params['framew']);
        $item->frameh = max(40, $params['frameh']);
        $item->framerot = $params['framerot'];
        $item->framez = $params['framez'];
        $DB->update_record('pinnwand_thread_items', $item);

        return ['success' => true];
    }

    public static function update_thread_frame_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function set_frame_label_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'itemid' => new external_value(PARAM_INT, 'Item-ID (Leerrahmen)'),
            'framelabel' => new external_value(PARAM_TEXT, 'Beschriftung'),
        ]);
    }

    /** Benennt einen Leerrahmen um - eigener leichtgewichtiger Endpunkt, damit
     * dafür nicht die komplette Geometrie erneut mitgeschickt werden muss. */
    public static function set_frame_label($cmid, $itemid, $framelabel) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_frame_label_parameters(), [
            'cmid' => $cmid, 'itemid' => $itemid, 'framelabel' => $framelabel,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $item = $DB->get_record('pinnwand_thread_items', ['id' => $params['itemid'], 'itemtype' => 'frame'], '*', MUST_EXIST);
        $thread = $DB->get_record('pinnwand_threads', ['id' => $item->threadid], '*', MUST_EXIST);
        if ($thread->userid != $USER->id || $thread->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'set_frame_label');
        }
        $item->framelabel = clean_param($params['framelabel'], PARAM_TEXT);
        $DB->update_record('pinnwand_thread_items', $item);

        return ['success' => true];
    }

    public static function set_frame_label_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function delete_thread_parameters() {
        return new external_function_parameters(['cmid' => new external_value(PARAM_INT, 'Course module id')]);
    }

    public static function delete_thread($cmid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::delete_thread_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $own = $DB->get_record('pinnwand_threads', ['pinnwandid' => $instance->id, 'userid' => $USER->id]);
        if ($own) {
            $DB->delete_records('pinnwand_thread_items', ['threadid' => $own->id]);
            $DB->delete_records('pinnwand_threads', ['id' => $own->id]);
        }
        return ['success' => true];
    }

    public static function delete_thread_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function set_thread_bgmoves_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'bgmoves' => new external_value(PARAM_BOOL, 'Hintergrund bewegt sich beim Zoom mit'),
        ]);
    }

    public static function set_thread_bgmoves($cmid, $bgmoves) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_thread_bgmoves_parameters(), ['cmid' => $cmid, 'bgmoves' => $bgmoves]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $thread = self::get_or_create_thread($instance, $context, $USER);
        $thread->bgmoves = !empty($params['bgmoves']) ? 1 : 0;
        $DB->update_record('pinnwand_threads', $thread);

        return ['success' => true];
    }

    public static function set_thread_bgmoves_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function set_thread_style_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'color' => new external_value(PARAM_TEXT, 'Hex-Farbe der Fadenlinie/Rahmen'),
            'linewidth' => new external_value(PARAM_FLOAT, 'Dicke in px'),
        ]);
    }

    public static function set_thread_style($cmid, $color, $linewidth) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_thread_style_parameters(), [
            'cmid' => $cmid, 'color' => $color, 'linewidth' => $linewidth,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $thread = self::get_or_create_thread($instance, $context, $USER);
        $thread->color = clean_param($params['color'], PARAM_TEXT);
        $thread->linewidth = max(1, min(12, $params['linewidth']));
        $DB->update_record('pinnwand_threads', $thread);

        return ['success' => true];
    }

    public static function set_thread_style_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    // ---------------------------------------------------------------
    // Post-Stream: neue Einreichungen aller Lernenden (außer der eigenen)
    // für die Lehrkraft, damit sie Kopien direkt aufs eigene Board ziehen
    // kann. Nur mit mod/pinnwand:viewall (teacher-artig).
    // ---------------------------------------------------------------
    public static function get_stream_photos_parameters() {
        return new external_function_parameters(['cmid' => new external_value(PARAM_INT, 'Course module id')]);
    }

    public static function get_stream_photos($cmid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::get_stream_photos_parameters(), ['cmid' => $cmid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:view');

        $fs = get_file_storage();
        $out = [];

        $export = function ($r, $mine) use ($fs, $context, &$out) {
            $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $r->id, 'filename', false);
            $file = reset($files);
            if (!$file) {
                return;
            }
            $out[] = [
                'id' => (int) $r->id,
                'userid' => (int) $r->userid,
                'userfullname' => fullname($r),
                'mine' => $mine,
                'url' => (string) moodle_url::make_pluginfile_url(
                    $context->id, 'mod_pinnwand', 'photo', $r->id, '/', $file->get_filename()
                ),
                'sourcetitle' => (string) $r->sourcetitle,
                'timecreated' => (int) $r->timecreated,
            ];
        };

        // Eigene, gepinnte aber noch nicht auf dem Board platzierte Fotos -
        // der "Warteraum" vor der eigentlichen Leinwand. Lehrkraft immer,
        // Lernende nur mit der Instanzeinstellung "studentpoststream".
        $canusepoststream = has_capability('mod/pinnwand:viewall', $context) || !empty($instance->studentpoststream);
        $own = $canusepoststream ? $DB->get_records_select(
            'pinnwand_photos', 'pinnwandid = ? AND userid = ? AND hiddenfromboard = 0 AND boardplaced = 0 AND status = ?',
            [$instance->id, $USER->id, 'active'], 'timecreated DESC', '*', 0, 100
        ) : [];
        foreach ($own as $r) {
            $r->firstname = $USER->firstname; $r->lastname = $USER->lastname;
            $export($r, true);
        }

        // Fremde, ebenfalls noch nicht platzierte Einreichungen - nur für
        // die Lehrkraft (Post-Stream zur Klassen-Durchsicht).
        if (has_capability('mod/pinnwand:viewall', $context)) {
            $sql = "SELECT p.*, u.firstname, u.lastname
                      FROM {pinnwand_photos} p
                      JOIN {user} u ON u.id = p.userid
                     WHERE p.pinnwandid = :icid AND p.userid <> :ownid
                       AND p.hiddenfromboard = 0 AND p.boardplaced = 0 AND p.status = 'active'
                  ORDER BY p.timecreated DESC";
            $records = $DB->get_records_sql($sql, ['icid' => $instance->id, 'ownid' => $USER->id], 0, 100);
            foreach ($records as $r) {
                $export($r, false);
            }
        }

        return ['photos' => $out];
    }

    public static function get_stream_photos_returns() {
        return new external_single_structure([
            'photos' => new external_multiple_structure(new external_single_structure([
                'id' => new external_value(PARAM_INT, 'ID'),
                'userid' => new external_value(PARAM_INT, 'Nutzer-ID'),
                'userfullname' => new external_value(PARAM_TEXT, 'Voller Name'),
                'mine' => new external_value(PARAM_BOOL, 'Eigenes Foto (sonst: fremde Einreichung für die Lehrkraft)'),
                'url' => new external_value(PARAM_RAW, 'URL'),
                'sourcetitle' => new external_value(PARAM_TEXT, 'Titel'),
                'timecreated' => new external_value(PARAM_INT, 'Eingereicht am'),
            ])),
        ]);
    }

    public static function adopt_photo_to_board_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'ID des fremden Fotos aus dem Post-Stream'),
            'x' => new external_value(PARAM_FLOAT, 'x auf dem eigenen Board'),
            'y' => new external_value(PARAM_FLOAT, 'y auf dem eigenen Board'),
            'boardid' => new external_value(PARAM_INT, 'Eigenes Board', VALUE_DEFAULT, 0),
        ]);
    }

    /**
     * Kopiert ein fremdes Foto (aus dem Post-Stream) als eigenen, neuen
     * Datensatz inkl. Bilddatei auf das eigene Board der Lehrkraft - das
     * Original bleibt beim einreichenden Lernenden unverändert erhalten.
     */
    public static function adopt_photo_to_board($cmid, $photoid, $x, $y, $boardid = 0) {
        global $DB, $USER;
        $params = self::validate_parameters(self::adopt_photo_to_board_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'x' => $x, 'y' => $y, 'boardid' => $boardid,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:viewall');

        $source = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($source->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'adopt_photo_to_board');
        }

        $copy = clone $source;
        unset($copy->id);
        $copy->userid = $USER->id;
        $copy->boardid = $params['boardid'];
        $copy->sourcephotoid = $source->id;
        $copy->backphotoid = null;
        $copy->showingback = 0;
        $copy->hiddenfromboard = 0;
        $copy->canvasx = $params['x'];
        $copy->canvasy = $params['y'];
        $copy->canvasw = 200;
        $copy->canvasrot = 0;
        $copy->canvasz = 0;
        $copy->boardplaced = 1;
        $copy->timecreated = time();
        $newid = $DB->insert_record('pinnwand_photos', $copy);

        $fs = get_file_storage();
        $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $source->id, 'filename', false);
        $file = reset($files);
        $url = null;
        if ($file) {
            $newfile = $fs->create_file_from_storedfile([
                'contextid' => $context->id, 'component' => 'mod_pinnwand', 'filearea' => 'photo',
                'itemid' => $newid, 'filepath' => '/', 'filename' => $file->get_filename(),
            ], $file);
            $url = (string) moodle_url::make_pluginfile_url(
                $context->id, 'mod_pinnwand', 'photo', $newid, '/', $newfile->get_filename()
            );
        }

        return ['id' => (int) $newid, 'url' => (string) $url];
    }

    public static function adopt_photo_to_board_returns() {
        return new external_single_structure([
            'id' => new external_value(PARAM_INT, 'ID der neuen Kopie'),
            'url' => new external_value(PARAM_RAW, 'Bild-URL der Kopie'),
        ]);
    }

    // ---------------------------------------------------------------
    // Rückseiten-Beschriftung: ein eigenes Foto kann eine Rückseite (ein
    // anderes eigenes Foto) zugewiesen bekommen. Per Doppelklick auf der
    // Pinnwand wird zwischen Vorder- und Rückseite umgeblättert
    // (showingback). Die als Rückseite verknüpfte Aufnahme wird dadurch
    // NICHT selbst zu einer weiteren, separaten Karte auf dem Board (siehe
    // Filter in renderArrange auf JS-Seite).
    // ---------------------------------------------------------------
    public static function set_backside_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Vorderseiten-Foto-ID'),
            'backphotoid' => new external_value(PARAM_INT, 'Rückseiten-Foto-ID (0 = Verknüpfung aufheben)'),
        ]);
    }

    public static function set_backside($cmid, $photoid, $backphotoid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::set_backside_parameters(), [
            'cmid' => $cmid, 'photoid' => $photoid, 'backphotoid' => $backphotoid,
        ]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->userid != $USER->id || $photo->pinnwandid != $instance->id) {
            throw new moodle_exception('nopermissions', 'error', '', 'set_backside');
        }

        if ($params['backphotoid'] > 0) {
            if ($params['backphotoid'] == $photo->id) {
                throw new moodle_exception('invalidparameter', 'debug');
            }
            $back = $DB->get_record('pinnwand_photos', ['id' => $params['backphotoid']], '*', MUST_EXIST);
            if ($back->userid != $USER->id || $back->pinnwandid != $instance->id) {
                throw new moodle_exception('nopermissions', 'error', '', 'set_backside');
            }
            $photo->backphotoid = $back->id;
        } else {
            $photo->backphotoid = null;
            $photo->showingback = 0;
        }
        $DB->update_record('pinnwand_photos', $photo);
        return ['success' => true];
    }

    public static function set_backside_returns() {
        return new external_single_structure(['success' => new external_value(PARAM_BOOL, 'OK')]);
    }

    public static function toggle_backside_parameters() {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'photoid' => new external_value(PARAM_INT, 'Vorderseiten-Foto-ID'),
        ]);
    }

    public static function toggle_backside($cmid, $photoid) {
        global $DB, $USER;
        $params = self::validate_parameters(self::toggle_backside_parameters(), ['cmid' => $cmid, 'photoid' => $photoid]);
        [$cm, $context, $instance] = self::get_context_instance($params['cmid'], 'mod/pinnwand:submit');

        $photo = $DB->get_record('pinnwand_photos', ['id' => $params['photoid']], '*', MUST_EXIST);
        if ($photo->userid != $USER->id || $photo->pinnwandid != $instance->id || empty($photo->backphotoid)) {
            throw new moodle_exception('nopermissions', 'error', '', 'toggle_backside');
        }
        $photo->showingback = $photo->showingback ? 0 : 1;
        $DB->update_record('pinnwand_photos', $photo);
        return ['showingback' => (bool) $photo->showingback];
    }

    public static function toggle_backside_returns() {
        return new external_single_structure(['showingback' => new external_value(PARAM_BOOL, 'Rückseite zeigt jetzt nach oben')]);
    }
}
