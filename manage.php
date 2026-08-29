<?php
require_once(__DIR__ . '/../../config.php');

$id = required_param('id', PARAM_INT);
$cm = get_coursemodule_from_id('pinnwand', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$instance = $DB->get_record('pinnwand', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/pinnwand:viewall', $context);

$PAGE->set_url('/mod/pinnwand/manage.php', ['id' => $cm->id]);
$PAGE->set_title(format_string($instance->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);
$PAGE->set_pagelayout('incourse');

echo $OUTPUT->header();
echo $OUTPUT->heading(format_string($instance->name) . ' – ' . get_string('manage_title', 'pinnwand'));

$sql = "SELECT p.*, u.firstname, u.lastname
          FROM {pinnwand_photos} p
          JOIN {user} u ON u.id = p.userid
         WHERE p.pinnwandid = :icid
      ORDER BY u.lastname, u.firstname, p.sortorder";
$photos = $DB->get_records_sql($sql, ['icid' => $instance->id]);

if (empty($photos)) {
    echo html_writer::tag('p', get_string('manage_nosubmissions', 'pinnwand'));
} else {
    $fs = get_file_storage();
    $byuser = [];
    foreach ($photos as $p) {
        $byuser[$p->userid]['name'] = fullname($p);
        $byuser[$p->userid]['photos'][] = $p;
    }

    foreach ($byuser as $userid => $data) {
        echo html_writer::tag('h4', s($data['name']) .
            ' — ' . count($data['photos']) . '/' . ($instance->maxpictures ?: '∞'));
        echo html_writer::start_div('pinnwand-manage-grid');
        foreach ($data['photos'] as $p) {
            $files = $fs->get_area_files($context->id, 'mod_pinnwand', 'photo', $p->id, 'filename', false);
            $file = reset($files);
            if (!$file) {
                continue;
            }
            $url = moodle_url::make_pluginfile_url($context->id, 'mod_pinnwand', 'photo', $p->id, '/', $file->get_filename());
            $consent = $p->consent
                ? get_string('manage_yes', 'pinnwand')
                : get_string('manage_no', 'pinnwand');
            echo html_writer::start_div('pinnwand-manage-item');
            echo html_writer::link($url, html_writer::empty_tag('img', ['src' => $url, 'alt' => '']), ['target' => '_blank']);
            echo html_writer::tag('div', get_string('manage_consent', 'pinnwand') . ': ' . $consent,
                ['class' => $p->consent ? 'ic-consent-yes' : 'ic-consent-no']);
            $sourceparts = array_filter([
                $p->sourceauthor ?? '',
                $p->sourceyear ?? '',
                $p->sourceepoch ?? '',
                $p->sourceplace ?? '',
            ]);
            if (!empty($sourceparts)) {
                echo html_writer::tag('div', s(implode(' · ', $sourceparts)), ['class' => 'ic-consent-no']);
            }
            if (!empty($p->sourceorigauthor)) {
                echo html_writer::tag('div', get_string('sourceorigauthor', 'pinnwand') . ': ' . s($p->sourceorigauthor),
                    ['class' => 'ic-consent-no']);
            }
            echo html_writer::end_div();
        }
        echo html_writer::end_div();
    }
}

echo $OUTPUT->footer();
