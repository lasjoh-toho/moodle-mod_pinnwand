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
            $paths[] = new restore_path_element('thread', '/activity/pinnwand/threads/thread');
            $paths[] = new restore_path_element('threaditem', '/activity/pinnwand/threads/thread/threaditems/threaditem');
            $paths[] = new restore_path_element('boardink', '/activity/pinnwand/boardinks/boardink');
            $paths[] = new restore_path_element('boardname', '/activity/pinnwand/boardnames/boardname');
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

    protected function process_thread($data) {
        global $DB;

        $data = (object) $data;
        $oldid = $data->id;
        $data->pinnwandid = $this->get_new_parentid('pinnwand');
        $data->userid = $this->get_mappingid('user', $data->userid);

        $newitemid = $DB->insert_record('pinnwand_threads', $data);
        $this->set_mapping('pinnwand_thread', $oldid, $newitemid);
    }

    protected function process_threaditem($data) {
        global $DB;

        $data = (object) $data;
        $data->threadid = $this->get_new_parentid('thread');
        if (!empty($data->photoid)) {
            $data->photoid = $this->get_mappingid('pinnwand_photo', $data->photoid);
        }

        $DB->insert_record('pinnwand_thread_items', $data);
    }

    protected function process_boardink($data) {
        global $DB;

        $data = (object) $data;
        $data->pinnwandid = $this->get_new_parentid('pinnwand');
        $data->userid = $this->get_mappingid('user', $data->userid);

        $DB->insert_record('pinnwand_board_ink', $data);
    }

    protected function process_boardname($data) {
        global $DB;

        $data = (object) $data;
        $data->pinnwandid = $this->get_new_parentid('pinnwand');
        $data->userid = $this->get_mappingid('user', $data->userid);

        $DB->insert_record('pinnwand_board_names', $data);
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
