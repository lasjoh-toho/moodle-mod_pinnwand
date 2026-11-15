<?php
// This file is part of Moodle - http://moodle.org/
defined('MOODLE_INTERNAL') || die();

use mod_pinnwand\local\layers;

/**
 * Stellt die Struktur aus backup_pinnwand_stepslib.php wieder her.
 *
 * Die Zeilen werden zuerst je Person gesammelt und am Ende als Schichten
 * eingefügt (layers::insert_layer). Wem eine Schicht gehört:
 * - mit Nutzerdaten der zugeordneten Person;
 * - Schichten von Lehrkräften ohne zugeordnete Person (Wiederherstellen ohne
 *   Nutzerdaten, andere Moodle-Instanz) der Person, die wiederherstellt;
 * - Schichten von Lernenden ohne zugeordnete Person entfallen.
 */
class restore_pinnwand_activity_structure_step extends restore_activity_structure_step {

    /** @var array gesammelte Schichten nach alter Nutzer-id */
    protected $layers = [];
    /** @var int alte id des zuletzt gelesenen Fadens (Stationen folgen ihm in der Datei) */
    protected $currentthread = 0;

    protected function define_structure() {
        $paths = [];
        $paths[] = new restore_path_element('pinnwand', '/activity/pinnwand');
        $paths[] = new restore_path_element('pinnwand_layer', '/activity/pinnwand/layers/layer');
        $paths[] = new restore_path_element('photo', '/activity/pinnwand/photos/photo');
        $paths[] = new restore_path_element('placement', '/activity/pinnwand/placements/placement');
        $paths[] = new restore_path_element('thread', '/activity/pinnwand/threads/thread');
        $paths[] = new restore_path_element('threaditem', '/activity/pinnwand/threads/thread/threaditems/threaditem');
        $paths[] = new restore_path_element('boardink', '/activity/pinnwand/boardinks/boardink');
        $paths[] = new restore_path_element('boardname', '/activity/pinnwand/boardnames/boardname');
        return $this->prepare_activity_structure($paths);
    }

    /** Schicht einer alten Nutzer-id (wird bei Bedarf angelegt). */
    protected function &layer($olduserid) {
        $olduserid = (int) $olduserid;
        if (!isset($this->layers[$olduserid])) {
            $this->layers[$olduserid] = ['userid' => $olduserid, 'teacher' => null, 'bg' => null, 'bgfx' => null,
                'photos' => [], 'placements' => [], 'threads' => [], 'inks' => [], 'names' => [], 'photoowner' => []];
        }
        return $this->layers[$olduserid];
    }

    protected function process_pinnwand($data) {
        global $DB;

        $data = (object) $data;
        $data->course = $this->get_courseid();
        if (empty($data->timecreated)) {
            $data->timecreated = time();
        }
        if (empty($data->timemodified)) {
            $data->timemodified = time();
        }
        $newitemid = $DB->insert_record('pinnwand', $data);
        $this->apply_activity_instance($newitemid);
    }

    protected function process_pinnwand_layer($data) {
        $l = &$this->layer($data['userid']);
        $l['teacher'] = !empty($data['teacher']);
        $l['bg'] = isset($data['bg']) && $data['bg'] !== '' && $data['bg'] !== '$@NULL@$' ? $data['bg'] : null;
        $l['bgfx'] = isset($data['bgfx']) && $data['bgfx'] !== '' && $data['bgfx'] !== '$@NULL@$' ? $data['bgfx'] : null;
    }

    protected function process_photo($data) {
        $l = &$this->layer($data['userid']);
        $l['photos'][] = $data;
        $this->photoowners[(int) $data['id']] = (int) $data['userid'];
    }

    /** @var array alte Objekt-id => alte Nutzer-id */
    protected $photoowners = [];

    protected function process_placement($data) {
        $owner = $this->photoowners[(int) ($data['photoid'] ?? 0)] ?? null;
        if ($owner !== null) {
            $l = &$this->layer($owner);
            $l['placements'][] = $data;
        }
    }

    protected function process_thread($data) {
        $l = &$this->layer($data['userid']);
        $data['items'] = [];
        $l['threads'][(int) $data['id']] = $data;
        $this->currentthread = (int) $data['id'];
        $this->threadowners[(int) $data['id']] = (int) $data['userid'];
    }

    /** @var array alte Faden-id => alte Nutzer-id */
    protected $threadowners = [];

    protected function process_threaditem($data) {
        $owner = $this->threadowners[$this->currentthread] ?? null;
        if ($owner !== null) {
            $this->layers[$owner]['threads'][$this->currentthread]['items'][] = $data;
        }
    }

    protected function process_boardink($data) {
        $l = &$this->layer($data['userid']);
        $l['inks'][] = $data;
    }

    protected function process_boardname($data) {
        $l = &$this->layer($data['userid']);
        $l['names'][] = $data;
    }

    protected function after_execute() {
        global $DB;
        $userinfo = $this->get_setting_value('userinfo');
        $instance = $DB->get_record('pinnwand', ['id' => $this->task->get_activityid()], '*', MUST_EXIST);
        $restorer = (int) $this->task->get_userid();

        foreach ($this->layers as $olduserid => $layer) {
            // Ältere Sicherungen ohne Schicht-Angabe: Lehrkraft unbekannt.
            $teacher = !empty($layer['teacher']);
            if (!$userinfo && !$teacher) {
                continue;
            }
            $target = $userinfo ? (int) $this->get_mappingid('user', $olduserid) : 0;
            if (!$target) {
                if (!$teacher) {
                    continue;
                }
                $target = $restorer;
            }
            $layer['threads'] = array_values($layer['threads']);
            $res = layers::insert_layer($instance, $target, $layer);
            foreach ($res['photos'] as $old => $new) {
                $this->set_mapping('pinnwand_photo', $old, $new, true);
            }
            if ($res['bg']) {
                $this->set_mapping('pinnwand_bguser', $olduserid, $target, true);
            }
        }

        // Dateien der Objekte - itemid entspricht der (neuen) Objekt-id.
        foreach (layers::PHOTO_AREAS as $area) {
            $this->add_related_files('mod_pinnwand', $area, 'pinnwand_photo');
        }

        // Editor-Dateien der Aktivitätsbeschreibung.
        $this->add_related_files('mod_pinnwand', 'intro', null);

        // Medien der Folien (Dateiname bleibt gleich, die Folien verweisen nur über den Namen darauf).
        $this->add_related_files('mod_pinnwand', 'slidemedia', null);

        // Eigene Hintergrundbilder: itemid ist die Nutzer-id, jetzt über die Zuordnung der Schicht.
        foreach (layers::USER_AREAS as $area) {
            $this->add_related_files('mod_pinnwand', $area, 'pinnwand_bguser');
        }
    }
}
