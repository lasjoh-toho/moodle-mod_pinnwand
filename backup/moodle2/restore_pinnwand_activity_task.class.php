<?php
// This file is part of Moodle - http://moodle.org/
defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/pinnwand/backup/moodle2/restore_pinnwand_stepslib.php');

/**
 * Restore-Task für die Aktivität mod_pinnwand (Gegenstück zum Backup-Task).
 */
class restore_pinnwand_activity_task extends restore_activity_task {

    /**
     * Keine aktivitätsspezifischen Restore-Einstellungen nötig.
     */
    protected function define_my_settings() {
    }

    /**
     * Definiert die Restore-Schritte für diese Aktivität.
     */
    protected function define_my_steps() {
        $this->add_step(new restore_pinnwand_activity_structure_step('pinnwand_structure', 'pinnwand.xml'));
    }

    /**
     * Für Inhaltskodierung (siehe backup_..._task::encode_content_links).
     */
    public static function define_decode_contents() {
        $contents = [];
        $contents[] = new restore_decode_content('pinnwand', ['intro'], 'pinnwand');
        return $contents;
    }

    /**
     * Löst die in encode_content_links() erzeugten Platzhalter beim Restore
     * wieder in echte view.php-Links auf.
     */
    public static function define_decode_rules() {
        $rules = [];
        $rules[] = new restore_decode_rule('PINNWANDVIEWBYID', '/mod/pinnwand/view.php?id=$1', 'course_module');
        return $rules;
    }

    /**
     * Zuordnung für den Kurs-Log/Report ("Letzte Aktivitäten" etc.).
     */
    public static function define_restore_log_rules() {
        $rules = [];
        $rules[] = new restore_log_rule('pinnwand', 'add', 'view.php?id={course_module}', '{name}');
        $rules[] = new restore_log_rule('pinnwand', 'update', 'view.php?id={course_module}', '{name}');
        $rules[] = new restore_log_rule('pinnwand', 'view', 'view.php?id={course_module}', '{name}');
        return $rules;
    }
}
