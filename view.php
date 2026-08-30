<?php
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$id = required_param('id', PARAM_INT); // course_module id

$cm = get_coursemodule_from_id('pinnwand', $id, 0, false, MUST_EXIST);
$course = get_course($cm->course);
$instance = $DB->get_record('pinnwand', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/pinnwand:view', $context);

$event = \mod_pinnwand\event\course_module_viewed::create([
    'objectid' => $instance->id,
    'context' => $context,
]);
$event->add_record_snapshot('course_modules', $cm);
$event->add_record_snapshot('pinnwand', $instance);
$event->trigger();

$isediting = $PAGE->user_is_editing();
$forceapp = optional_param('app', 0, PARAM_BOOL);
$showapp = !$isediting || $forceapp;

$PAGE->set_url('/mod/pinnwand/view.php', ['id' => $cm->id]);
$PAGE->set_title(format_string($instance->name));
$PAGE->set_heading(format_string($course->fullname));
if ($showapp) {
    // Eigenes, schlankes mobiltaugliches Layout ohne Standard-Moodle-Chrome/Blöcke.
    $PAGE->set_pagelayout('embedded');
} else {
    // Bearbeiten-Modus aktiv: normaler Moodle-View mit Kursnavigation, damit
    // die Aktivitätseinstellungen (Zahnrad/Einstellungsmenü) erreichbar bleiben.
    $PAGE->set_pagelayout('incourse');
}
$PAGE->set_context($context);

$canmanage = has_capability('mod/pinnwand:viewall', $context);

if (!$showapp) {
    echo $OUTPUT->header();
    echo $OUTPUT->heading(format_string($instance->name));
    if ($instance->intro) {
        echo $OUTPUT->box(format_module_intro('pinnwand', $instance, $cm->id), 'generalbox mod_introbox');
    }
    $appurl = new moodle_url('/mod/pinnwand/view.php', ['id' => $cm->id, 'app' => 1]);
    echo $OUTPUT->single_button($appurl, get_string('modulename', 'pinnwand'), 'get');
    if (has_capability('moodle/course:manageactivities', $context)) {
        $settingsurl = new moodle_url('/course/modedit.php', ['update' => $cm->id, 'return' => 1]);
        echo html_writer::div(html_writer::link($settingsurl, get_string('activitysettings', 'pinnwand')), 'mt-2');
    }
    echo $OUTPUT->footer();
    exit;
}

$config = [
    'cmid' => $cm->id,
    'contextid' => $context->id,
    'sesskey' => sesskey(),
    'wwwroot' => $CFG->wwwroot,
    'maxpictures' => (int) $instance->maxpictures,
    'boardpannable' => (bool) $instance->boardpannable,
    'allowconsent' => (bool) $instance->allowconsent,
    'consenttext' => format_string($instance->consenttext),
    'canmanage' => $canmanage,
    'currentuserfullname' => fullname($USER),
    'managerurl' => $canmanage ? (new moodle_url('/mod/pinnwand/manage.php', ['id' => $cm->id]))->out(false) : null,
    'courseurl' => (new moodle_url('/course/view.php', ['id' => $course->id]))->out(false),
    'isediting' => $isediting,
    'settingsurl' => ($isediting && has_capability('moodle/course:manageactivities', $context))
        ? (new moodle_url('/course/modedit.php', ['update' => $cm->id, 'return' => 1]))->out(false) : null,
    'strings' => [
        'step_capture' => get_string('step_capture', 'pinnwand'),
        'step_perspective' => get_string('step_perspective', 'pinnwand'),
        'step_crop' => get_string('step_crop', 'pinnwand'),
        'step_color' => get_string('step_color', 'pinnwand'),
        'step_grid' => get_string('step_grid', 'pinnwand'),
        'step_arrange' => get_string('step_arrange', 'pinnwand'),
        'takephoto' => get_string('takephoto', 'pinnwand'),
        'uploadphoto' => get_string('uploadphoto', 'pinnwand'),
        'addviaurl' => get_string('addviaurl', 'pinnwand'),
        'url_load_error' => get_string('url_load_error', 'pinnwand'),
        'usefullimage' => get_string('usefullimage', 'pinnwand'),
        'rotate90' => get_string('rotate90', 'pinnwand'),
        'overlay_onboard' => get_string('overlay_onboard', 'pinnwand'),
        'back_course' => get_string('back_course', 'pinnwand'),
        'fullscreen' => get_string('fullscreen', 'pinnwand'),
        'exitfullscreen' => get_string('exitfullscreen', 'pinnwand'),
        'mygallery' => get_string('mygallery', 'pinnwand'),
        'editphoto' => get_string('editphoto', 'pinnwand'),
        'activitysettings' => get_string('activitysettings', 'pinnwand'),
        'retake' => get_string('retake', 'pinnwand'),
        'next' => get_string('next', 'pinnwand'),
        'back' => get_string('back', 'pinnwand'),
        'reset' => get_string('reset', 'pinnwand'),
        'savephoto' => get_string('savephoto', 'pinnwand'),
        'finishandarrange' => get_string('finishandarrange', 'pinnwand'),
        'addanother' => get_string('addanother', 'pinnwand'),
        'perspective_hint' => get_string('perspective_hint', 'pinnwand'),
        'crop_hint' => get_string('crop_hint', 'pinnwand'),
        'grid_none' => get_string('grid_none', 'pinnwand'),
        'grid_square' => get_string('grid_square', 'pinnwand'),
        'grid_fixed' => get_string('grid_fixed', 'pinnwand'),
        'gridsize' => get_string('gridsize', 'pinnwand'),
        'gridcount' => get_string('gridcount', 'pinnwand'),
        'gridcolor' => get_string('gridcolor', 'pinnwand'),
        'brightness' => get_string('brightness', 'pinnwand'),
        'contrast' => get_string('contrast', 'pinnwand'),
        'saturation' => get_string('saturation', 'pinnwand'),
        'grayscale' => get_string('grayscale', 'pinnwand'),
        'maxreached' => get_string('maxreached', 'pinnwand'),
        'consent_label' => get_string('consent_label', 'pinnwand'),
        'gallery_title' => get_string('gallery_title', 'pinnwand'),
        'deletephoto' => get_string('deletephoto', 'pinnwand'),
        'confirmdelete' => get_string('confirmdelete', 'pinnwand'),
        'photocount' => get_string('photocount', 'pinnwand', ['count' => '{count}', 'max' => '{max}']),
        'photocount_unlimited' => get_string('photocount_unlimited', 'pinnwand', '{count}'),
        'loading' => get_string('loading', 'pinnwand'),
        'error_camera' => get_string('error_camera', 'pinnwand'),
        'error_save' => get_string('error_save', 'pinnwand'),
        'step_source' => get_string('step_source', 'pinnwand'),
        'sourceauthor' => get_string('sourceauthor', 'pinnwand'),
        'sourceyear' => get_string('sourceyear', 'pinnwand'),
        'sourceepoch' => get_string('sourceepoch', 'pinnwand'),
        'sourceplace' => get_string('sourceplace', 'pinnwand'),
        'sourceorigauthor' => get_string('sourceorigauthor', 'pinnwand'),
        'source_hint' => get_string('source_hint', 'pinnwand'),
        'gridtoggle' => get_string('gridtoggle', 'pinnwand'),
        'author_me' => get_string('author_me', 'pinnwand'),
        'draw_toggle' => get_string('draw_toggle', 'pinnwand'),
        'draw_done' => get_string('draw_done', 'pinnwand'),
        'draw_clear' => get_string('draw_clear', 'pinnwand'),
        'draw_pen' => get_string('draw_pen', 'pinnwand'),
        'draw_eraser' => get_string('draw_eraser', 'pinnwand'),
        'zoom_in' => get_string('zoom_in', 'pinnwand'),
        'zoom_out' => get_string('zoom_out', 'pinnwand'),
        'zoom_reset' => get_string('zoom_reset', 'pinnwand'),
        'pantool' => get_string('pantool', 'pinnwand'),
        'boardof' => get_string('boardof', 'pinnwand', ['cur' => '{cur}', 'total' => '{total}']),
        'newboard' => get_string('newboard', 'pinnwand'),
        'boardfull_confirm' => get_string('boardfull_confirm', 'pinnwand'),
        'drawonboard' => get_string('drawonboard', 'pinnwand'),
        'bg_color' => get_string('bg_color', 'pinnwand'),
        'bg_image' => get_string('bg_image', 'pinnwand'),
        'bg_url' => get_string('bg_url', 'pinnwand'),
        'bg_url_apply' => get_string('bg_url_apply', 'pinnwand'),
        'bg_upload' => get_string('bg_upload', 'pinnwand'),
        'bg_brightness' => get_string('bg_brightness', 'pinnwand'),
        'bg_saturation' => get_string('bg_saturation', 'pinnwand'),
        'sourcetitle' => get_string('sourcetitle', 'pinnwand'),
        'showdata' => get_string('showdata', 'pinnwand'),
        'hidedata' => get_string('hidedata', 'pinnwand'),
        'databtn' => get_string('databtn', 'pinnwand'),
        'pinboard' => get_string('pinboard', 'pinnwand'),
        'sendtoboard' => get_string('sendtoboard', 'pinnwand'),
        'removefromboard' => get_string('removefromboard', 'pinnwand'),
        'draw_text' => get_string('draw_text', 'pinnwand'),
        'text_placeholder' => get_string('text_placeholder', 'pinnwand'),
        'back_menu' => get_string('back_menu', 'pinnwand'),
        'addphoto' => get_string('addphoto', 'pinnwand'),
        'options' => get_string('options', 'pinnwand'),
        'uploaded_on' => get_string('uploaded_on', 'pinnwand'),
        'moderate_mode' => get_string('moderate_mode', 'pinnwand'),
        'moderate_title' => get_string('moderate_title', 'pinnwand'),
        'moderate_empty' => get_string('moderate_empty', 'pinnwand'),
        'sort_user' => get_string('sort_user', 'pinnwand'),
        'sort_year' => get_string('sort_year', 'pinnwand'),
        'sort_upload' => get_string('sort_upload', 'pinnwand'),
        'student_is_author' => get_string('student_is_author', 'pinnwand'),
        'filter_own' => get_string('filter_own', 'pinnwand'),
        'filter_own_mine' => get_string('filter_own_mine', 'pinnwand'),
        'filter_own_others' => get_string('filter_own_others', 'pinnwand'),
        'filter_board' => get_string('filter_board', 'pinnwand'),
        'filter_board_on' => get_string('filter_board_on', 'pinnwand'),
        'filter_board_off' => get_string('filter_board_off', 'pinnwand'),
        'deletephoto_confirm_other' => get_string('deletephoto_confirm_other', 'pinnwand'),
    ],
];

$PAGE->requires->css(new moodle_url('/mod/pinnwand/styles.css', ['v' => get_config('mod_pinnwand', 'version')]));

echo $OUTPUT->header();
?>
<div id="pinnwand-app" class="pinnwand-app" data-title="<?php echo s(format_string($instance->name)); ?>">
  <noscript><?php echo get_string('modulename', 'pinnwand'); ?> benötigt JavaScript.</noscript>
</div>
<script>
  window.pinnwandConfig = <?php echo json_encode($config); ?>;
</script>
<script src="<?php echo (new moodle_url('/mod/pinnwand/js/app.js', ['v' => get_config('mod_pinnwand', 'version')]))->out(false); ?>"></script>
<?php
echo $OUTPUT->footer();
