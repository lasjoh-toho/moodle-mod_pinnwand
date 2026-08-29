<?php
require_once(__DIR__ . '/../../config.php');

$courseid = required_param('id', PARAM_INT);
$course = get_course($courseid);
require_login($course);

$context = context_course::instance($course->id);
$PAGE->set_url('/mod/pinnwand/index.php', ['id' => $course->id]);
$PAGE->set_title(format_string($course->fullname));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->set_context($context);

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('modulenameplural', 'pinnwand'));

$instances = get_all_instances_in_course('pinnwand', $course);
if (empty($instances)) {
    notice(get_string('thereareno', 'moodle', get_string('modulenameplural', 'pinnwand')),
        new moodle_url('/course/view.php', ['id' => $course->id]));
} else {
    $table = new html_table();
    $table->head = [get_string('name')];
    foreach ($instances as $instance) {
        $link = html_writer::link(
            new moodle_url('/mod/pinnwand/view.php', ['id' => $instance->coursemodule]),
            format_string($instance->name)
        );
        $table->data[] = [$link];
    }
    echo html_writer::table($table);
}

echo $OUTPUT->footer();
