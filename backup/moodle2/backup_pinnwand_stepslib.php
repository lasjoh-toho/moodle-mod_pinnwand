<?php
// This file is part of Moodle - http://moodle.org/
defined('MOODLE_INTERNAL') || die();

use mod_pinnwand\local\layers;

/**
 * Definiert die vollständige Sicherungsstruktur der Aktivität mod_pinnwand.
 *
 * Gesichert wird je Person eine „Schicht“ (siehe classes/local/layers.php):
 * Objekte mit Dateien und weiteren Platzierungen, Roter Faden, Stift auf dem
 * Board, eigene Board-Titel und Hintergrund. Mit „Nutzerdaten einschließen“
 * kommen alle Schichten mit, ohne nur die der Lehrkräfte - eine Pinnwand lässt
 * sich so als Vorlage in einen neuen Kurs kopieren, ohne Daten der Lernenden.
 */
class backup_pinnwand_activity_structure_step extends backup_activity_structure_step {

    /** Spalten einer Tabelle ohne id und ohne die angegebenen Verweise. */
    protected static function columns(string $table, array $skip = []): array {
        global $DB;
        return array_values(array_diff(array_keys($DB->get_columns($table)), array_merge(['id'], $skip)));
    }

    protected function define_structure() {
        global $DB;

        $userinfo = $this->get_setting_value('userinfo');

        // Aktivitätsinstanz selbst - immer gesichert, mit allen Spalten (auch künftigen).
        $pinnwand = new backup_nested_element('pinnwand', ['id'], self::columns('pinnwand', ['course']));

        // Schichten: eine je Person, mit Lehrkraft-Kennzeichen und Hintergrund-Einstellung.
        $layerlist = new backup_nested_element('layers');
        $layer = new backup_nested_element('layer', ['userid'], ['teacher', 'bg', 'bgfx']);

        $photos = new backup_nested_element('photos');
        $photo = new backup_nested_element('photo', ['id'], self::columns('pinnwand_photos', ['pinnwandid']));

        // Weitere Platzierungen eines Objekts auf anderen Boards (z. B. geklonte Boards).
        $placements = new backup_nested_element('placements');
        $placement = new backup_nested_element('placement', ['id'], self::columns('pinnwand_object_placements', ['pinnwandid']));

        $threads = new backup_nested_element('threads');
        $thread = new backup_nested_element('thread', ['id'], self::columns('pinnwand_threads', ['pinnwandid']));
        $threaditems = new backup_nested_element('threaditems');
        $threaditem = new backup_nested_element('threaditem', ['id'], self::columns('pinnwand_thread_items', ['threadid']));

        $boardinks = new backup_nested_element('boardinks');
        $boardink = new backup_nested_element('boardink', ['id'], self::columns('pinnwand_board_ink', ['pinnwandid']));

        $boardnames = new backup_nested_element('boardnames');
        $boardname = new backup_nested_element('boardname', ['id'], self::columns('pinnwand_board_names', ['pinnwandid']));

        $pinnwand->add_child($layerlist);
        $layerlist->add_child($layer);
        $pinnwand->add_child($photos);
        $photos->add_child($photo);
        $pinnwand->add_child($placements);
        $placements->add_child($placement);
        $pinnwand->add_child($threads);
        $threads->add_child($thread);
        $thread->add_child($threaditems);
        $threaditems->add_child($threaditem);
        $pinnwand->add_child($boardinks);
        $boardinks->add_child($boardink);
        $pinnwand->add_child($boardnames);
        $boardnames->add_child($boardname);

        $pinnwand->set_source_table('pinnwand', ['id' => backup::VAR_ACTIVITYID]);

        // Welche Schichten? Mit Nutzerdaten alle, sonst nur die der Lehrkräfte.
        $instanceid = (int) $this->task->get_activityid();
        $context = context_module::instance($this->task->get_moduleid());
        $owners = $userinfo ? layers::owners($instanceid) : layers::teacher_owners($instanceid, $context);
        $collected = $owners ? layers::collect((object) ['id' => $instanceid], $context, $owners) : [];

        $layerrows = $photorows = $placementrows = $threadrows = $inkrows = $namerows = [];
        foreach ($collected as $l) {
            $layerrows[] = ['userid' => $l['userid'], 'teacher' => $l['teacher'] ? 1 : 0, 'bg' => $l['bg'], 'bgfx' => $l['bgfx']];
            $photorows = array_merge($photorows, $l['photos']);
            $placementrows = array_merge($placementrows, $l['placements']);
            foreach ($l['threads'] as $t) {
                unset($t['items']);
                $threadrows[] = $t;
            }
            $inkrows = array_merge($inkrows, $l['inks']);
            $namerows = array_merge($namerows, $l['names']);
        }
        $layer->set_source_array($layerrows);
        $photo->set_source_array($photorows);
        $placement->set_source_array($placementrows);
        $thread->set_source_array($threadrows);
        $threaditem->set_source_table('pinnwand_thread_items', ['threadid' => backup::VAR_PARENTID], 'sortorder ASC');
        $boardink->set_source_array($inkrows);
        $boardname->set_source_array($namerows);

        $layer->annotate_ids('user', 'userid');
        $photo->annotate_ids('user', 'userid');
        $thread->annotate_ids('user', 'userid');
        $boardink->annotate_ids('user', 'userid');
        $boardname->annotate_ids('user', 'userid');

        // Editor-Dateien der Aktivitätsbeschreibung (intro).
        $pinnwand->annotate_files('mod_pinnwand', 'intro', null);

        // Dateien der Objekte - itemid ist jeweils die Objekt-id.
        foreach (layers::PHOTO_AREAS as $area) {
            $photo->annotate_files('mod_pinnwand', $area, 'id');
        }

        // Medien der Folien (Bild/Audio/Video), itemid immer 0.
        $pinnwand->annotate_files('mod_pinnwand', 'slidemedia', null);

        // Eigene Hintergrundbilder - itemid ist die Nutzer-id der Schicht.
        foreach (layers::USER_AREAS as $area) {
            $layer->annotate_files('mod_pinnwand', $area, 'userid');
        }

        return $this->prepare_activity_structure($pinnwand);
    }
}
