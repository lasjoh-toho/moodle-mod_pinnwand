<?php
defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {
    $settings->add(new admin_setting_configtext(
        'mod_pinnwand/adminmaxstudent',
        get_string('adminmaxstudent', 'pinnwand'),
        get_string('adminmaxstudent_desc', 'pinnwand'),
        0,
        PARAM_INT
    ));
    $settings->add(new admin_setting_configtext(
        'mod_pinnwand/adminmaxteacher',
        get_string('adminmaxteacher', 'pinnwand'),
        get_string('adminmaxteacher_desc', 'pinnwand'),
        20,
        PARAM_INT
    ));
}
