<?php
defined('MOODLE_INTERNAL') || die();

function pinnwand_supports($feature) {
    switch ($feature) {
        case FEATURE_MOD_INTRO:
            return true;
        case FEATURE_SHOW_DESCRIPTION:
            return true;
        case FEATURE_BACKUP_MOODLE2:
            return true;
        case FEATURE_GRADE_HAS_GRADE:
            return false;
        case FEATURE_MOD_PURPOSE:
            return defined('MOD_PURPOSE_CONTENT') ? MOD_PURPOSE_CONTENT : null;
        default:
            return null;
    }
}

function pinnwand_add_instance($data, $mform = null) {
    global $DB;
    $data->timecreated = time();
    $data->timemodified = $data->timecreated;
    return $DB->insert_record('pinnwand', $data);
}

function pinnwand_update_instance($data, $mform = null) {
    global $DB;
    $data->id = $data->instance;
    $data->timemodified = time();
    return $DB->update_record('pinnwand', $data);
}

function pinnwand_delete_instance($id) {
    global $DB;
    if (!$instance = $DB->get_record('pinnwand', ['id' => $id])) {
        return false;
    }
    // Zugehörige Foto-Datensätze entfernen (Dateien werden über den Kontext
    // beim Löschen des Kurskontexts durch Moodle mitentfernt).
    $threadids = $DB->get_fieldset_select('pinnwand_threads', 'id', 'pinnwandid = ?', [$id]);
    if ($threadids) {
        $DB->delete_records_list('pinnwand_thread_items', 'threadid', $threadids);
    }
    foreach (['pinnwand_object_placements', 'pinnwand_threads', 'pinnwand_board_ink', 'pinnwand_board_names', 'pinnwand_board_bg'] as $table) {
        $DB->delete_records($table, ['pinnwandid' => $id]);
    }
    $DB->delete_records('pinnwand_photos', ['pinnwandid' => $id]);
    $DB->delete_records('pinnwand', ['id' => $id]);
    return true;
}

/**
 * Dateizugriff (Bilder) über pluginfile.php ausliefern.
 */
function pinnwand_pluginfile($course, $cm, $context, $filearea, $args, $forcedownload, array $options = []) {
    global $DB, $USER;

    if ($context->contextlevel != CONTEXT_MODULE) {
        return false;
    }
    require_login($course, false, $cm);

    if ($filearea === 'background' || $filearea === 'backgroundpdf') {
        // Eigenes hochgeladenes Hintergrundbild - Zugriff nur für die
        // besitzende Person selbst (itemid = deren Nutzer-ID).
        $itemid = (int) array_shift($args);
        if ($itemid !== (int) $USER->id) {
            return false;
        }
        $filename = array_pop($args);
        $filepath = $args ? '/' . implode('/', $args) . '/' : '/';
        $fs = get_file_storage();
        $file = $fs->get_file($context->id, 'mod_pinnwand', $filearea, $itemid, $filepath, $filename);
        if (!$file || $file->is_directory()) {
            return false;
        }
        send_stored_file($file, 86400, 0, $forcedownload, $options);
        return;
    }

    if ($filearea === 'boardbg') {
        // Hintergrund eines Untersuchungs-Boards (Kopie eines Bildes der
        // Lehrkraft): für die besitzende Person und die Lehrkraft.
        $itemid = (int) array_shift($args);
        $rec = $DB->get_record('pinnwand_board_bg', ['id' => $itemid]);
        if (!$rec || ((int) $rec->userid !== (int) $USER->id && !has_capability('mod/pinnwand:viewall', $context))) {
            return false;
        }
        $filename = array_pop($args);
        $filepath = $args ? '/' . implode('/', $args) . '/' : '/';
        $file = get_file_storage()->get_file($context->id, 'mod_pinnwand', 'boardbg', $itemid, $filepath, $filename);
        if (!$file || $file->is_directory()) {
            return false;
        }
        send_stored_file($file, 86400, 0, $forcedownload, $options);
        return;
    }

    if ($filearea === 'slidemedia') {
        // Medien von Folien (Bild/Audio/Video): wer die Aktivität sehen
        // darf, darf sie abspielen (Präsentation).
        require_capability('mod/pinnwand:view', $context);
        $itemid = (int) array_shift($args);
        $filename = array_pop($args);
        $filepath = $args ? '/' . implode('/', $args) . '/' : '/';
        $fs = get_file_storage();
        $file = $fs->get_file($context->id, 'mod_pinnwand', 'slidemedia', $itemid, $filepath, $filename);
        if (!$file || $file->is_directory()) {
            return false;
        }
        send_stored_file($file, 86400, 0, $forcedownload, $options);
        return;
    }

    if (!in_array($filearea, ['photo', 'photoorig', 'photomask', 'photofull', 'photothumb'], true)) {
        return false;
    }

    $photoid = (int) array_shift($args);
    $photo = $DB->get_record('pinnwand_photos', ['id' => $photoid], '*', MUST_EXIST);

    // Eigene Fotos darf jede/r sehen, fremde nur mit viewall-Recht - außer
    // die Lehrkraft hat das Bild zum Untersuchen freigegeben.
    if ($photo->userid != $USER->id && !has_capability('mod/pinnwand:viewall', $context)
            && !(!empty($photo->studyable) && $photo->status === 'active' && in_array($filearea, ['photo', 'photofull', 'photothumb'], true))) {
        return false;
    }

    $itemid = $photoid;
    $filename = array_pop($args);
    $filepath = $args ? '/' . implode('/', $args) . '/' : '/';

    $fs = get_file_storage();
    if ($filearea === 'photothumb') {
        // Vorschau entsteht bei Bedarf aus dem Anzeigebild (und neu, wenn es sich geändert hat).
        $file = \mod_pinnwand\local\media::thumbnail($context, $photoid);
        if (!$file) {
            return false;
        }
        send_stored_file($file, 86400, 0, $forcedownload, $options);
        return;
    }
    $file = $fs->get_file($context->id, 'mod_pinnwand', $filearea, $itemid, $filepath, $filename);
    if (!$file || $file->is_directory()) {
        return false;
    }

    send_stored_file($file, 86400, 0, $forcedownload, $options);
}

/**
 * Eintrag „Schichten“ im Menü der Aktivität (Export/Import einzelner Schichten).
 */
function pinnwand_extend_settings_navigation(settings_navigation $settingsnav, navigation_node $node) {
    global $PAGE;
    $cm = $PAGE->cm;
    if (!$cm || !has_capability('mod/pinnwand:manage', $cm->context)) {
        return;
    }
    $node->add(get_string('layers_title', 'pinnwand'), new moodle_url('/mod/pinnwand/layers.php', ['id' => $cm->id]),
        navigation_node::TYPE_SETTING, null, 'pinnwandlayers', new pix_icon('i/backup', ''));
}
