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

    if ($filearea === 'background') {
        // Eigenes hochgeladenes Hintergrundbild - Zugriff nur für die
        // besitzende Person selbst (itemid = deren Nutzer-ID).
        $itemid = (int) array_shift($args);
        if ($itemid !== (int) $USER->id) {
            return false;
        }
        $filename = array_pop($args);
        $filepath = $args ? '/' . implode('/', $args) . '/' : '/';
        $fs = get_file_storage();
        $file = $fs->get_file($context->id, 'mod_pinnwand', 'background', $itemid, $filepath, $filename);
        if (!$file || $file->is_directory()) {
            return false;
        }
        send_stored_file($file, 86400, 0, $forcedownload, $options);
        return;
    }

    if ($filearea !== 'photo') {
        return false;
    }

    $photoid = (int) array_shift($args);
    $photo = $DB->get_record('pinnwand_photos', ['id' => $photoid], '*', MUST_EXIST);

    // Eigene Fotos darf jede/r sehen, fremde nur mit viewall-Recht.
    if ($photo->userid != $USER->id && !has_capability('mod/pinnwand:viewall', $context)) {
        return false;
    }

    $itemid = $photoid;
    $filename = array_pop($args);
    $filepath = $args ? '/' . implode('/', $args) . '/' : '/';

    $fs = get_file_storage();
    $file = $fs->get_file($context->id, 'mod_pinnwand', $filearea, $itemid, $filepath, $filename);
    if (!$file || $file->is_directory()) {
        return false;
    }

    send_stored_file($file, 86400, 0, $forcedownload, $options);
}
