<?php
namespace mod_pinnwand\event;

defined('MOODLE_INTERNAL') || die();

/**
 * Event: eine pinnwand-Instanz wurde angesehen.
 *
 * core\event\course_module_viewed ist abstrakt und darf nicht direkt
 * instanziiert werden - jedes Aktivitätsmodul muss eine eigene,
 * konkrete Unterklasse mitbringen.
 */
class course_module_viewed extends \core\event\course_module_viewed {

    protected function init() {
        $this->data['crud'] = 'r';
        $this->data['edulevel'] = self::LEVEL_PARTICIPATING;
        $this->data['objecttable'] = 'pinnwand';
    }

    public static function get_objectid_mapping() {
        return ['db' => 'pinnwand', 'restore' => 'pinnwand'];
    }

    public static function get_other_mapping() {
        return false;
    }
}
