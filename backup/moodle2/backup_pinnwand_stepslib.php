<?php
// This file is part of Moodle - http://moodle.org/
defined('MOODLE_INTERNAL') || die();

/**
 * Definiert die vollständige Sicherungsstruktur der Aktivität mod_pinnwand,
 * inklusive der Fotos (pinnwand_photos) und der zugehörigen Dateien.
 */
class backup_pinnwand_activity_structure_step extends backup_activity_structure_step {

    protected function define_structure() {

        $userinfo = $this->get_setting_value('userinfo');

        // Aktivitätsinstanz selbst - immer gesichert, unabhängig von "userinfo".
        $pinnwand = new backup_nested_element('pinnwand', ['id'], [
            'name', 'intro', 'introformat', 'maxpictures', 'allowconsent',
            'boarddefault', 'studentcansend', 'teachercansend', 'studentclassview',
            'boardpannable', 'studentthreads', 'consenttext', 'timecreated', 'timemodified',
        ]);

        // Fotos - personenbezogen, daher nur mit "userinfo" gesichert.
        $photos = new backup_nested_element('photos');

        $photo = new backup_nested_element('photo', ['id'], [
            'userid', 'sortorder', 'gridtype', 'gridvalue', 'consent',
            'sourceauthor', 'sourceyear', 'sourceepoch', 'sourceplace',
            'sourceorigauthor', 'sourcetitle', 'gridcolor', 'hiddenfromboard',
            'annotationonboard', 'annotationdata', 'canvasx', 'canvasy',
            'canvasw', 'canvasrot', 'canvasz', 'boardid', 'sourcephotoid',
            'backphotoid', 'showingback', 'boardplaced', 'wordfielddata', 'timecreated',
        ]);

        // Rote Fäden - ebenfalls personenbezogen (ein Faden pro Person).
        $threads = new backup_nested_element('threads');
        $thread = new backup_nested_element('thread', ['id'], ['userid', 'color', 'bgmoves', 'linewidth', 'timecreated']);
        $threaditems = new backup_nested_element('threaditems');
        $threaditem = new backup_nested_element('threaditem', ['id'], [
            'sortorder', 'itemtype', 'photoid', 'boardid',
            'framex', 'framey', 'framew', 'frameh', 'framerot', 'framez', 'framelabel', 'timecreated',
        ]);

        $pinnwand->add_child($photos);
        $photos->add_child($photo);

        $pinnwand->add_child($threads);
        $threads->add_child($thread);
        $thread->add_child($threaditems);
        $threaditems->add_child($threaditem);

        $pinnwand->set_source_table('pinnwand', ['id' => backup::VAR_ACTIVITYID]);

        if ($userinfo) {
            $photo->set_source_table('pinnwand_photos', ['pinnwandid' => backup::VAR_PARENTID]);
            $thread->set_source_table('pinnwand_threads', ['pinnwandid' => backup::VAR_PARENTID]);
            $threaditem->set_source_table('pinnwand_thread_items', ['threadid' => backup::VAR_PARENTID]);
        }

        $photo->annotate_ids('user', 'userid');
        $thread->annotate_ids('user', 'userid');
        // photoid verweist auf ein Foto derselben Aktivität - wird beim
        // Restore über die 'pinnwand_photo'-Zuordnung aufgelöst (siehe
        // restore_pinnwand_stepslib.php process_threaditem()).
        $threaditem->annotate_ids('pinnwand_photo', 'photoid');

        // Editor-Dateien der Aktivitätsbeschreibung (intro).
        $pinnwand->annotate_files('mod_pinnwand', 'intro', null);

        // Fotodateien - itemid entspricht jeweils der photo-id (siehe photo->id).
        $photo->annotate_files('mod_pinnwand', 'photo', 'id');

        if ($userinfo) {
            // Persönliche Hintergrundbilder (Anordnungs-Leinwand) - itemid ist
            // dort die Nutzer-ID, nicht an eine Zeile dieser Struktur gebunden.
            // Bekannte Einschränkung: ohne Nutzer-ID-Remapping funktioniert die
            // Wiederherstellung nur korrekt, solange sich die Nutzer-IDs
            // zwischen Quelle und Ziel nicht ändern (siehe IMPLEMENTATION_PLAN.md).
            $pinnwand->annotate_files('mod_pinnwand', 'background', null);
        }

        return $this->prepare_activity_structure($pinnwand);
    }
}
