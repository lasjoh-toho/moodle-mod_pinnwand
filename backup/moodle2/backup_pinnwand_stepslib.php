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
            'boardpannable', 'consenttext', 'timecreated', 'timemodified',
        ]);

        // Fotos - personenbezogen, daher nur mit "userinfo" gesichert.
        $photos = new backup_nested_element('photos');

        $photo = new backup_nested_element('photo', ['id'], [
            'userid', 'sortorder', 'gridtype', 'gridvalue', 'consent',
            'sourceauthor', 'sourceyear', 'sourceepoch', 'sourceplace',
            'sourceorigauthor', 'sourcetitle', 'gridcolor', 'hiddenfromboard',
            'annotationonboard', 'annotationdata', 'canvasx', 'canvasy',
            'canvasw', 'canvasrot', 'canvasz', 'boardid', 'timecreated',
        ]);

        $pinnwand->add_child($photos);
        $photos->add_child($photo);

        $pinnwand->set_source_table('pinnwand', ['id' => backup::VAR_ACTIVITYID]);

        if ($userinfo) {
            $photo->set_source_table('pinnwand_photos', ['pinnwandid' => backup::VAR_PARENTID]);
        }

        $photo->annotate_ids('user', 'userid');

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
