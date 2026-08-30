<?php
defined('MOODLE_INTERNAL') || die();

function xmldb_pinnwand_upgrade($oldversion) {
    global $DB;
    $dbman = $DB->get_manager();

    if ($oldversion < 2026082401) {
        $table = new xmldb_table('pinnwand_photos');

        $fields = [
            new xmldb_field('sourceauthor', XMLDB_TYPE_CHAR, '255', null, null, null, null, 'consent'),
            new xmldb_field('sourceyear', XMLDB_TYPE_CHAR, '50', null, null, null, null, 'sourceauthor'),
            new xmldb_field('sourceepoch', XMLDB_TYPE_CHAR, '255', null, null, null, null, 'sourceyear'),
            new xmldb_field('sourceplace', XMLDB_TYPE_CHAR, '255', null, null, null, null, 'sourceepoch'),
            new xmldb_field('sourceorigauthor', XMLDB_TYPE_CHAR, '255', null, null, null, null, 'sourceplace'),
        ];
        foreach ($fields as $field) {
            if (!$dbman->field_exists($table, $field)) {
                $dbman->add_field($table, $field);
            }
        }

        upgrade_mod_savepoint(true, 2026082401, 'pinnwand');
    }

    if ($oldversion < 2026082405) {
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('annotationdata', XMLDB_TYPE_TEXT, null, null, null, null, null, 'sourceorigauthor');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026082405, 'pinnwand');
    }

    if ($oldversion < 2026082406) {
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('sourcetitle', XMLDB_TYPE_CHAR, '255', null, null, null, null, 'sourceorigauthor');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026082406, 'pinnwand');
    }

    if ($oldversion < 2026082407) {
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('gridcolor', XMLDB_TYPE_CHAR, '7', null, null, null, null, 'sourcetitle');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026082407, 'pinnwand');
    }

    if ($oldversion < 2026082408) {
        // Hinweis: ein früherer, inzwischen verworfener Entwurf legte hier ein
        // "canvasenabled"-Feld an (instanzweites Ausblenden der gesamten
        // Pinnwand). Ersetzt durch feingranulare Einstellungen weiter unten.
        $table = new xmldb_table('pinnwand');
        $fields = [
            new xmldb_field('boarddefault', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'allowconsent'),
            new xmldb_field('studentcansend', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'boarddefault'),
            new xmldb_field('teachercansend', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'studentcansend'),
        ];
        foreach ($fields as $field) {
            if (!$dbman->field_exists($table, $field)) {
                $dbman->add_field($table, $field);
            }
        }
        upgrade_mod_savepoint(true, 2026082408, 'pinnwand');
    }

    if ($oldversion < 2026082409) {
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('hiddenfromboard', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'gridcolor');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026082409, 'pinnwand');
    }

    if ($oldversion < 2026082410) {
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('annotationonboard', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'hiddenfromboard');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026082410, 'pinnwand');
    }

    if ($oldversion < 2026082410.01) {
        // Reparatur für Websites, bei denen der Schritt 2026082408 bereits
        // mit einer früheren Fassung gelaufen war (dort wurde stattdessen
        // ein inzwischen entferntes "canvasenabled"-Feld angelegt) und
        // dadurch als erledigt markiert wurde, ohne dass boarddefault/
        // studentcansend/teachercansend tatsächlich existieren. Idempotent -
        // schadet auch nicht, falls die Felder schon vorhanden sind.
        $table = new xmldb_table('pinnwand');
        $fields = [
            new xmldb_field('boarddefault', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'allowconsent'),
            new xmldb_field('studentcansend', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'boarddefault'),
            new xmldb_field('teachercansend', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'studentcansend'),
        ];
        foreach ($fields as $field) {
            if (!$dbman->field_exists($table, $field)) {
                $dbman->add_field($table, $field);
            }
        }
        upgrade_mod_savepoint(true, 2026082410.01, 'pinnwand');
    }

    if ($oldversion < 2026082411) {
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('studentclassview', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'teachercansend');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026082411, 'pinnwand');
    }

    if ($oldversion < 2026083000) {
        // Phase 2: Pinnwand verschiebbar/zoombar (Einstellung) + Mehrfach-Boards
        // (Zuordnung einzelner Fotos zu einem von mehreren Boards).
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('boardpannable', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'studentclassview');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('boardid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0', 'canvasz');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_mod_savepoint(true, 2026083000, 'pinnwand');
    }

    return true;
}
