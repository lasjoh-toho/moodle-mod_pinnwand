<?php
// This file is part of Moodle - http://moodle.org/
defined('MOODLE_INTERNAL') || die();

/**
 * Stellt die Struktur aus backup_pinnwand_stepslib.php wieder her.
 */
class restore_pinnwand_activity_structure_step extends restore_activity_structure_step {

    protected function define_structure() {
        $paths = [];
        $userinfo = $this->get_setting_value('userinfo');

        $paths[] = new restore_path_element('pinnwand', '/activity/pinnwand');

        if ($userinfo) {
            $paths[] = new restore_path_element('photo', '/activity/pinnwand/photos/photo');
        }

        return $this->prepare_activity_structure($paths);
    }

    protected function process_pinnwand($data) {
        global $DB;

        $data = (object) $data;
        $data->course = $this->get_courseid();
        if (empty($data->timecreated)) { $data->timecreated = time(); }
        if (empty($data->timemodified)) { $data->timemodified = time(); }

        $newitemid = $DB->insert_record('pinnwand', $data);
        $this->apply_activity_instance($newitemid);
    }

    protected function process_photo($data) {
        global $DB;

        $data = (object) $data;
        $oldid = $data->id;
        $data->pinnwandid = $this->get_new_parentid('pinnwand');
        $data->userid = $this->get_mappingid('user', $data->userid);

        $newitemid = $DB->insert_record('pinnwand_photos', $data);
        // "true" = für dieses Mapping existieren Dateien (siehe after_execute()).
        $this->set_mapping('pinnwand_photo', $oldid, $newitemid, true);
    }

    protected function after_execute() {
        // Fotodateien - itemid entspricht der (neuen) photo-id.
        $this->add_related_files('mod_pinnwand', 'photo', 'pinnwand_photo');

        // Editor-Dateien der Aktivitätsbeschreibung.
        $this->add_related_files('mod_pinnwand', 'intro', null);

        // Persönliche Hintergrundbilder: itemid bleibt die ursprüngliche
        // Nutzer-ID. Bekannte Einschränkung (siehe backup_pinnwand_stepslib.php
        // und IMPLEMENTATION_PLAN.md): funktioniert nur korrekt, solange sich
        // die Nutzer-IDs zwischen Quelle und Ziel nicht ändern.
        $this->add_related_files('mod_pinnwand', 'background', null);
    }
}
