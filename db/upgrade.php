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

    if ($oldversion < 2026083001) {
        // Phase 3: Roter Faden (geordnete Foto-/Rahmen-Sequenz je Person) +
        // impress.js-Präsentation.
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('studentthreads', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'boardpannable');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $threads = new xmldb_table('pinnwand_threads');
        if (!$dbman->table_exists($threads)) {
            $threads->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $threads->add_field('pinnwandid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $threads->add_field('userid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $threads->add_field('color', XMLDB_TYPE_CHAR, '7', null, XMLDB_NOTNULL, null, '#e0503f');
            $threads->add_field('timecreated', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $threads->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $threads->add_key('pinnwandid', XMLDB_KEY_FOREIGN, ['pinnwandid'], 'pinnwand', ['id']);
            $threads->add_key('userid', XMLDB_KEY_FOREIGN, ['userid'], 'user', ['id']);
            $dbman->create_table($threads);
        }

        $items = new xmldb_table('pinnwand_thread_items');
        if (!$dbman->table_exists($items)) {
            $items->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $items->add_field('threadid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $items->add_field('sortorder', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $items->add_field('itemtype', XMLDB_TYPE_CHAR, '10', null, XMLDB_NOTNULL, null, 'photo');
            $items->add_field('photoid', XMLDB_TYPE_INTEGER, '10', null, null, null, null);
            $items->add_field('boardid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $items->add_field('framex', XMLDB_TYPE_NUMBER, '10,2', null, null, null, null);
            $items->add_field('framey', XMLDB_TYPE_NUMBER, '10,2', null, null, null, null);
            $items->add_field('framew', XMLDB_TYPE_NUMBER, '10,2', null, null, null, null);
            $items->add_field('frameh', XMLDB_TYPE_NUMBER, '10,2', null, null, null, null);
            $items->add_field('framelabel', XMLDB_TYPE_CHAR, '255', null, null, null, null);
            $items->add_field('timecreated', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $items->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $items->add_key('threadid', XMLDB_KEY_FOREIGN, ['threadid'], 'pinnwand_threads', ['id']);
            $items->add_key('photoid', XMLDB_KEY_FOREIGN, ['photoid'], 'pinnwand_photos', ['id']);
            $dbman->create_table($items);
        }

        upgrade_mod_savepoint(true, 2026083001, 'pinnwand');
    }

    if ($oldversion < 2026083002) {
        // Phase 4: Post-Stream - Rückverfolgung, von welchem fremden Foto
        // eine Board-Kopie stammt (siehe adopt_photo_to_board()).
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('sourcephotoid', XMLDB_TYPE_INTEGER, '10', null, null, null, null, 'boardid');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026083002, 'pinnwand');
    }

    if ($oldversion < 2026083004) {
        // Phase 6: Rückseiten-Beschriftung (per Doppelklick umblätterbar).
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('backphotoid', XMLDB_TYPE_INTEGER, '10', null, null, null, null, 'sourcephotoid');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        $field2 = new xmldb_field('showingback', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'backphotoid');
        if (!$dbman->field_exists($table, $field2)) {
            $dbman->add_field($table, $field2);
        }
        upgrade_mod_savepoint(true, 2026083004, 'pinnwand');
    }

    if ($oldversion < 2026083007) {
        // Feedback-Durchgang: Post-Stream als "Warteraum" vor der Leinwand -
        // ein Foto zeigt erst auf dem Board an, wenn es aktiv aus dem
        // Post-Stream dorthin gezogen/gepinnt wurde.
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('boardplaced', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'showingback');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
            // Bestandsfotos gelten als bereits platziert, damit sich das
            // Aussehen bestehender Boards durch dieses Update nicht
            // rückwirkend ändert - nur künftig neu eingereichte/gepinnte
            // Fotos durchlaufen den neuen Post-Stream-Warteraum.
            $DB->execute("UPDATE {pinnwand_photos} SET boardplaced = 1");
        }
        upgrade_mod_savepoint(true, 2026083007, 'pinnwand');
    }

    if ($oldversion < 2026083008) {
        // Feedback-Durchgang: Berechtigungs-Einstellungen für Post-Stream
        // und Schichtung-Panel (analog zu studentthreads).
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('studentpoststream', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1', 'studentthreads');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        $field2 = new xmldb_field('studentlayers', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'studentpoststream');
        if (!$dbman->field_exists($table, $field2)) {
            $dbman->add_field($table, $field2);
        }
        upgrade_mod_savepoint(true, 2026083008, 'pinnwand');
    }

    if ($oldversion < 2026083010) {
        // Feedback-Durchgang: Wortfeld bleibt bearbeitbarer Text (SVG statt
        // PNG) - strukturierte Daten für erneutes Bearbeiten.
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('wordfielddata', XMLDB_TYPE_TEXT, null, null, null, null, null, 'boardplaced');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026083010, 'pinnwand');
    }

    if ($oldversion < 2026083011) {
        // Feedback-Durchgang: Rahmen drehbar + Hintergrund optional mit dem
        // Präsentations-Zoom mitbewegen.
        $table = new xmldb_table('pinnwand_thread_items');
        $field = new xmldb_field('framerot', XMLDB_TYPE_NUMBER, '10, 2', null, XMLDB_NOTNULL, null, '0', 'frameh');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        $table2 = new xmldb_table('pinnwand_threads');
        $field2 = new xmldb_field('bgmoves', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'color');
        if (!$dbman->field_exists($table2, $field2)) {
            $dbman->add_field($table2, $field2);
        }
        upgrade_mod_savepoint(true, 2026083011, 'pinnwand');
    }

    if ($oldversion < 2026083015) {
        // Feedback-Durchgang: Rahmen in der Schichtung verschiebbar, Faden-
        // Dicke einstellbar.
        $table = new xmldb_table('pinnwand_thread_items');
        $field = new xmldb_field('framez', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0', 'framerot');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        $table2 = new xmldb_table('pinnwand_threads');
        $field2 = new xmldb_field('linewidth', XMLDB_TYPE_NUMBER, '10, 2', null, XMLDB_NOTNULL, null, '3', 'bgmoves');
        if (!$dbman->field_exists($table2, $field2)) {
            $dbman->add_field($table2, $field2);
        }
        upgrade_mod_savepoint(true, 2026083015, 'pinnwand');
    }

    if ($oldversion < 2026083018) {
        // Feedback-Durchgang: Deckkraft der Seitenleisten-Hintergründe
        // als Instanzeinstellung konfigurierbar.
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('sidebaropacity', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '92', 'boardpannable');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026083018, 'pinnwand');
    }

    if ($oldversion < 2026083019) {
        // Feedback-Durchgang: Stylus-Werkzeug - Freihand-Anmerkungen direkt
        // auf dem Board-Hintergrund.
        $table = new xmldb_table('pinnwand_board_ink');
        if (!$dbman->table_exists($table)) {
            $table->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $table->add_field('pinnwandid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table->add_field('userid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table->add_field('boardid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table->add_field('strokedata', XMLDB_TYPE_TEXT, null, null, null, null, null);
            $table->add_field('timecreated', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table->add_field('timemodified', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $table->add_key('pinnwandid', XMLDB_KEY_FOREIGN, ['pinnwandid'], 'pinnwand', ['id']);
            $table->add_index('userboard', XMLDB_INDEX_UNIQUE, ['pinnwandid', 'userid', 'boardid']);
            $dbman->create_table($table);
        }
        upgrade_mod_savepoint(true, 2026083019, 'pinnwand');
    }

    if ($oldversion < 2026083025) {
        // Feedback-Durchgang: Board-Namen (Standard: Aktivitätstitel [+
        // Nummer]) + Klon-Button für Lernende.
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('studentboardclone', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'sidebaropacity');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        $table2 = new xmldb_table('pinnwand_board_names');
        if (!$dbman->table_exists($table2)) {
            $table2->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $table2->add_field('pinnwandid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table2->add_field('userid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table2->add_field('boardid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table2->add_field('name', XMLDB_TYPE_CHAR, '255', null, null, null, null);
            $table2->add_field('timemodified', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table2->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $table2->add_key('pinnwandid', XMLDB_KEY_FOREIGN, ['pinnwandid'], 'pinnwand', ['id']);
            $table2->add_index('userboard', XMLDB_INDEX_UNIQUE, ['pinnwandid', 'userid', 'boardid']);
            $dbman->create_table($table2);
        }
        upgrade_mod_savepoint(true, 2026083025, 'pinnwand');
    }

    if ($oldversion < 2026083031) {
        // Feedback-Durchgang: Mehrfach-Board-Platzierung ohne Duplizierung
        // (Trash-System + zusätzliche Board-Platzierungen für geklonte
        // Boards, statt beim Klonen komplette Kopien anzulegen).
        $table = new xmldb_table('pinnwand_photos');
        $field = new xmldb_field('status', XMLDB_TYPE_CHAR, '10', null, XMLDB_NOTNULL, null, 'active', 'wordfielddata');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $table2 = new xmldb_table('pinnwand_object_placements');
        if (!$dbman->table_exists($table2)) {
            $table2->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $table2->add_field('pinnwandid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table2->add_field('photoid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table2->add_field('boardid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table2->add_field('canvasx', XMLDB_TYPE_NUMBER, '10, 2', null, XMLDB_NOTNULL, null, '0');
            $table2->add_field('canvasy', XMLDB_TYPE_NUMBER, '10, 2', null, XMLDB_NOTNULL, null, '0');
            $table2->add_field('canvasw', XMLDB_TYPE_NUMBER, '10, 2', null, XMLDB_NOTNULL, null, '200');
            $table2->add_field('canvasrot', XMLDB_TYPE_NUMBER, '10, 2', null, XMLDB_NOTNULL, null, '0');
            $table2->add_field('canvasz', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table2->add_field('boardplaced', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '1');
            $table2->add_field('status', XMLDB_TYPE_CHAR, '10', null, XMLDB_NOTNULL, null, 'active');
            $table2->add_field('timecreated', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table2->add_field('timemodified', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $table2->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $table2->add_key('pinnwandid', XMLDB_KEY_FOREIGN, ['pinnwandid'], 'pinnwand', ['id']);
            $table2->add_key('photoid', XMLDB_KEY_FOREIGN, ['photoid'], 'pinnwand_photos', ['id']);
            $table2->add_index('photoboard', XMLDB_INDEX_UNIQUE, ['photoid', 'boardid']);
            $dbman->create_table($table2);
        }
        upgrade_mod_savepoint(true, 2026083031, 'pinnwand');
    }

    if ($oldversion < 2026083033) {
        // Feedback-Durchgang: Kopfzeilen-Board-Dropdown mit Sichtbarkeit
        // für andere Lernende.
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('studentseeotherboards', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'studentboardclone');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        $table2 = new xmldb_table('pinnwand_board_names');
        $field2 = new xmldb_field('hidden', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'name');
        if (!$dbman->field_exists($table2, $field2)) {
            $dbman->add_field($table2, $field2);
        }
        upgrade_mod_savepoint(true, 2026083033, 'pinnwand');
    }

    if ($oldversion < 2026083057) {
        // Feedback-Durchgang: neues, leeres eigenes Board per Plus
        // anlegen - eigene Einstellung analog zum Klonen.
        $table = new xmldb_table('pinnwand');
        $field = new xmldb_field('studentboardcreate', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'studentboardclone');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }
        upgrade_mod_savepoint(true, 2026083057, 'pinnwand');
    }

    return true;
}
