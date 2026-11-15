<?php
// This file is part of Moodle - http://moodle.org/

/**
 * Schichten einer Pinnwand gezielt exportieren und importieren: die eigene Fassung
 * der Lehrkraft oder ausgewählte Fassungen von Lernenden, als ZIP-Datei.
 */
require_once(__DIR__ . '/../../config.php');

use mod_pinnwand\local\layers;

$id = required_param('id', PARAM_INT);
$action = optional_param('action', '', PARAM_ALPHA);

$cm = get_coursemodule_from_id('pinnwand', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$instance = $DB->get_record('pinnwand', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/pinnwand:manage', $context);

$url = new moodle_url('/mod/pinnwand/layers.php', ['id' => $cm->id]);
$PAGE->set_url($url);
$PAGE->set_title(format_string($instance->name) . ': ' . get_string('layers_title', 'pinnwand'));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);
$PAGE->set_pagelayout('incourse');

$tempbase = make_temp_directory('mod_pinnwand/layerimport');

/** Verzeichnis eines hochgeladenen Imports (nur eigene, gültige Kennungen). */
function pinnwand_layers_tempdir(string $base, string $token): string {
    global $USER;
    if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
        throw new moodle_exception('layers_error_file', 'pinnwand');
    }
    return $base . '/' . $USER->id . '_' . $token;
}

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------
if ($action === 'export') {
    require_sesskey();
    $userids = array_map('intval', optional_param_array('userids', [], PARAM_INT));
    $userids = array_values(array_intersect($userids, layers::owners((int) $instance->id)));
    if (!$userids) {
        redirect($url, get_string('layers_none_selected', 'pinnwand'), null, \core\output\notification::NOTIFY_WARNING);
    }
    $full = optional_param('full', 0, PARAM_BOOL);
    \core_php_time_limit::raise(300);
    raise_memory_limit(MEMORY_EXTRA);
    $zip = layers::export_file($instance, $context, $userids, (bool) $full);
    $filename = clean_filename('pinnwand-' . format_string($instance->name) . '-' . get_string('layers_file', 'pinnwand') .
        '-' . date('Y-m-d') . '.zip');
    send_file($zip, $filename, 0, 0, false, true, 'application/zip');
    die;
}

// ---------------------------------------------------------------
// Import, Schritt 2: übernehmen
// ---------------------------------------------------------------
if ($action === 'import') {
    require_sesskey();
    $token = required_param('token', PARAM_ALPHANUM);
    $dir = pinnwand_layers_tempdir($tempbase, $token);
    if (!is_dir($dir)) {
        redirect($url, get_string('layers_error_file', 'pinnwand'), null, \core\output\notification::NOTIFY_ERROR);
    }
    [$dir, $manifest] = layers::read_file($dir . '/upload.zip', $dir . '/x');
    $raw = optional_param_array('target', [], PARAM_INT);
    $allowed = [(int) $USER->id => true];
    foreach (get_enrolled_users($context, 'mod/pinnwand:view', 0, 'u.id') as $u) {
        $allowed[(int) $u->id] = true;
    }
    $targets = [];
    foreach ($raw as $old => $new) {
        if ($new > 0 && isset($allowed[(int) $new])) {
            $targets[(int) $old] = (int) $new;
        }
    }
    \core_php_time_limit::raise(300);
    $transaction = $DB->start_delegated_transaction();
    $count = layers::import($instance, $context, $dir, $manifest, $targets);
    $transaction->allow_commit();
    remove_dir(dirname($dir));
    redirect(new moodle_url('/mod/pinnwand/view.php', ['id' => $cm->id]),
        get_string('layers_imported', 'pinnwand', $count), null, \core\output\notification::NOTIFY_SUCCESS);
}

echo $OUTPUT->header();
echo $OUTPUT->heading(format_string($instance->name) . ' – ' . get_string('layers_title', 'pinnwand'));

// ---------------------------------------------------------------
// Import, Schritt 1: Datei hochgeladen → Schichten zuordnen
// ---------------------------------------------------------------
if ($action === 'upload') {
    require_sesskey();
    $file = $_FILES['layerfile'] ?? null;
    if (!$file || !empty($file['error']) || !is_uploaded_file($file['tmp_name'])) {
        echo $OUTPUT->notification(get_string('layers_error_file', 'pinnwand'), 'error');
        echo $OUTPUT->continue_button($url);
        echo $OUTPUT->footer();
        die;
    }
    $token = md5(random_string(32) . microtime());
    $dir = pinnwand_layers_tempdir($tempbase, $token);
    check_dir_exists($dir);
    move_uploaded_file($file['tmp_name'], $dir . '/upload.zip');
    try {
        [, $manifest] = layers::read_file($dir . '/upload.zip', $dir . '/x');
    } catch (moodle_exception $e) {
        remove_dir($dir);
        echo $OUTPUT->notification(get_string('layers_error_file', 'pinnwand'), 'error');
        echo $OUTPUT->continue_button($url);
        echo $OUTPUT->footer();
        die;
    }
    $users = get_enrolled_users($context, 'mod/pinnwand:view', 0, 'u.*', 'u.lastname, u.firstname');
    $byusername = [];
    foreach ($users as $u) {
        $byusername[$u->username] = $u;
    }
    $options = [0 => get_string('layers_skip', 'pinnwand'), $USER->id => get_string('layers_me', 'pinnwand', fullname($USER))];
    foreach ($users as $u) {
        if ((int) $u->id !== (int) $USER->id) {
            $options[$u->id] = fullname($u);
        }
    }
    echo html_writer::tag('p', get_string('layers_import_intro', 'pinnwand', s($manifest['source']['name'] ?? '')));
    echo html_writer::start_tag('form', ['method' => 'post', 'action' => $url->out(false)]);
    echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
    echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'action', 'value' => 'import']);
    echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'token', 'value' => $token]);
    $table = new html_table();
    $table->head = [get_string('layers_person', 'pinnwand'), get_string('layers_content', 'pinnwand'),
        get_string('layers_target', 'pinnwand')];
    foreach ($manifest['layers'] as $layer) {
        $sum = layers::summary($layer);
        $old = (int) ($layer['userid'] ?? 0);
        $match = $byusername[$layer['username'] ?? ''] ?? null;
        if ($match) {
            $selected = (int) $match->id;
        } else {
            $selected = !empty($layer['teacher']) ? (int) $USER->id : 0;
        }
        $name = s($layer['fullname'] ?? '') . (!empty($layer['teacher'])
            ? ' ' . html_writer::span(get_string('layers_teacher', 'pinnwand'), 'badge bg-info text-dark') : '');
        $table->data[] = [
            $name,
            get_string('layers_summary', 'pinnwand', (object) $sum),
            html_writer::select($options, 'target[' . $old . ']', $selected, false, ['class' => 'form-select']),
        ];
    }
    echo html_writer::table($table);
    echo html_writer::tag('p', get_string('layers_import_merge', 'pinnwand'), ['class' => 'text-muted']);
    echo html_writer::empty_tag('input', ['type' => 'submit', 'class' => 'btn btn-primary',
        'value' => get_string('layers_import_go', 'pinnwand')]);
    echo ' ' . html_writer::link($url, get_string('cancel'), ['class' => 'btn btn-secondary']);
    echo html_writer::end_tag('form');
    echo $OUTPUT->footer();
    die;
}

// Alte, liegengebliebene Uploads (älter als einen Tag) aufräumen.
foreach (glob($tempbase . '/*', GLOB_ONLYDIR) ?: [] as $old) {
    if (filemtime($old) < time() - DAYSECS) {
        remove_dir($old);
    }
}

// ---------------------------------------------------------------
// Übersicht: Export
// ---------------------------------------------------------------
echo html_writer::tag('h3', get_string('layers_export', 'pinnwand'));
echo html_writer::tag('p', get_string('layers_export_intro', 'pinnwand'));
$owners = layers::owners((int) $instance->id);
if (!$owners) {
    echo html_writer::tag('p', get_string('layers_empty', 'pinnwand'), ['class' => 'text-muted']);
} else {
    $collected = layers::collect($instance, $context, $owners);
    // Eigene Schicht zuerst, dann weitere Lehrkräfte, dann Lernende nach Namen.
    uasort($collected, function ($a, $b) use ($USER) {
        $ka = [(int) $a['userid'] !== (int) $USER->id, !$a['teacher'], core_text::strtolower($a['fullname'])];
        $kb = [(int) $b['userid'] !== (int) $USER->id, !$b['teacher'], core_text::strtolower($b['fullname'])];
        return $ka <=> $kb;
    });
    $hasown = isset($collected[(int) $USER->id]);
    echo html_writer::start_tag('form', ['method' => 'post', 'action' => $url->out(false), 'id' => 'pinnwand-layers-export']);
    echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
    echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'action', 'value' => 'export']);
    $table = new html_table();
    $table->head = ['', get_string('layers_person', 'pinnwand'), get_string('layers_content', 'pinnwand')];
    foreach ($collected as $layer) {
        $isown = (int) $layer['userid'] === (int) $USER->id;
        $checked = $isown || (!$hasown && $layer['teacher']);
        $cb = html_writer::empty_tag('input', ['type' => 'checkbox', 'name' => 'userids[]', 'value' => $layer['userid'],
            'id' => 'pl' . $layer['userid'], 'data-teacher' => $layer['teacher'] ? 1 : 0] + ($checked ? ['checked' => 'checked'] : []));
        $label = s($layer['fullname']) . ($isown ? ' (' . get_string('layers_own', 'pinnwand') . ')' : '');
        if ($layer['teacher']) {
            $label .= ' ' . html_writer::span(get_string('layers_teacher', 'pinnwand'), 'badge bg-info text-dark');
        }
        $table->data[] = [$cb, html_writer::label($label, 'pl' . $layer['userid'], false),
            get_string('layers_summary', 'pinnwand', (object) layers::summary($layer))];
    }
    echo html_writer::div(
        html_writer::link('#', get_string('layers_pick_own', 'pinnwand'), ['data-pick' => 'own', 'class' => 'me-3']) .
        html_writer::link('#', get_string('layers_pick_teachers', 'pinnwand'), ['data-pick' => 'teachers', 'class' => 'me-3']) .
        html_writer::link('#', get_string('layers_pick_all', 'pinnwand'), ['data-pick' => 'all', 'class' => 'me-3']) .
        html_writer::link('#', get_string('layers_pick_none', 'pinnwand'), ['data-pick' => 'none']), 'mb-2');
    echo html_writer::table($table);
    echo html_writer::div(html_writer::checkbox('full', 1, true, get_string('layers_full', 'pinnwand')), 'mb-3');
    echo html_writer::empty_tag('input', ['type' => 'submit', 'class' => 'btn btn-primary',
        'value' => get_string('layers_export_go', 'pinnwand')]);
    echo html_writer::end_tag('form');
    $ownid = (int) $USER->id;
    echo html_writer::script("
        document.querySelectorAll('#pinnwand-layers-export [data-pick]').forEach(function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                var mode = a.getAttribute('data-pick');
                document.querySelectorAll('#pinnwand-layers-export input[name=\"userids[]\"]').forEach(function (cb) {
                    cb.checked = mode === 'all' || (mode === 'own' && +cb.value === $ownid) ||
                        (mode === 'teachers' && cb.getAttribute('data-teacher') === '1');
                });
            });
        });");
}

// ---------------------------------------------------------------
// Übersicht: Import
// ---------------------------------------------------------------
echo html_writer::tag('h3', get_string('layers_import', 'pinnwand'), ['class' => 'mt-4']);
echo html_writer::tag('p', get_string('layers_import_help', 'pinnwand'));
echo html_writer::start_tag('form', ['method' => 'post', 'action' => $url->out(false), 'enctype' => 'multipart/form-data']);
echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'action', 'value' => 'upload']);
echo html_writer::empty_tag('input', ['type' => 'file', 'name' => 'layerfile', 'accept' => '.zip,application/zip',
    'required' => 'required', 'class' => 'form-control mb-2', 'style' => 'max-width:30rem']);
echo html_writer::empty_tag('input', ['type' => 'submit', 'class' => 'btn btn-secondary',
    'value' => get_string('layers_upload', 'pinnwand')]);
echo html_writer::end_tag('form');

echo html_writer::tag('p', get_string('layers_backup_hint', 'pinnwand'), ['class' => 'text-muted mt-4']);

echo $OUTPUT->footer();
