<?php
// This file is part of Moodle - http://moodle.org/
defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/pinnwand/backup/moodle2/backup_pinnwand_stepslib.php');

/**
 * Backup-Task für die Aktivität mod_pinnwand.
 *
 * Ohne diese Klasse (und die zugehörige restore_*-Gegenseite) schlägt die
 * Kurssicherung fehl bzw. übergeht die Aktivität kommentarlos, sobald
 * lib.php FEATURE_BACKUP_MOODLE2 => true meldet.
 */
class backup_pinnwand_activity_task extends backup_activity_task {

    /**
     * Keine aktivitätsspezifischen Backup-Einstellungen nötig.
     */
    protected function define_my_settings() {
    }

    /**
     * Definiert die Backup-Schritte für diese Aktivität.
     */
    protected function define_my_steps() {
        $this->add_step(new backup_pinnwand_activity_structure_step('pinnwand_structure', 'pinnwand.xml'));
    }

    /**
     * Kodiert im Aktivitätsinhalt (z. B. intro-Feld) enthaltene Links auf
     * view.php, damit sie beim Restore auf die neue Kurs-Modul-ID zeigen.
     */
    public static function encode_content_links($content) {
        global $CFG;

        $base = preg_quote($CFG->wwwroot, '/');

        $content = preg_replace(
            "/(" . $base . "\/mod\/pinnwand\/view\.php\?id\=)([0-9]+)/",
            '$@PINNWANDVIEWBYID*$2@$',
            $content
        );

        return $content;
    }
}
