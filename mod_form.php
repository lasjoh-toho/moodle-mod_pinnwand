<?php
defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/course/moodleform_mod.php');

class mod_pinnwand_mod_form extends moodleform_mod {

    public function definition() {
        global $CFG;
        $mform = $this->_form;

        $mform->addElement('text', 'name', get_string('pinnwandname', 'pinnwand'), ['size' => '64']);
        $mform->setType('name', PARAM_TEXT);
        $mform->addRule('name', null, 'required', null, 'client');
        $mform->addRule('name', get_string('maximumchars', '', 255), 'maxlength', 255, 'client');

        $this->standard_intro_elements();

        $mform->addElement('header', 'pinnwandsettings', get_string('settings', 'pinnwand'));

        $mform->addElement('text', 'maxpictures', get_string('maxpictures', 'pinnwand'), ['size' => '5']);
        $mform->setType('maxpictures', PARAM_INT);
        $mform->setDefault('maxpictures', 0);
        $mform->addHelpButton('maxpictures', 'maxpictures', 'pinnwand');

        $mform->addElement('advcheckbox', 'allowconsent', get_string('allowconsent', 'pinnwand'));
        $mform->setDefault('allowconsent', 1);
        $mform->addHelpButton('allowconsent', 'allowconsent', 'pinnwand');

        $mform->addElement('textarea', 'consenttext', get_string('consenttext', 'pinnwand'),
            'wrap="virtual" rows="3" cols="60"');
        $mform->setType('consenttext', PARAM_TEXT);
        $mform->setDefault('consenttext', get_string('consenttext_default', 'pinnwand'));
        $mform->hideIf('consenttext', 'allowconsent', 'notchecked');

        $mform->addElement('header', 'pinnwandboard', get_string('boardsettings', 'pinnwand'));

        $mform->addElement('advcheckbox', 'boarddefault', get_string('boarddefault', 'pinnwand'));
        $mform->setDefault('boarddefault', 1);
        $mform->addHelpButton('boarddefault', 'boarddefault', 'pinnwand');

        $mform->addElement('advcheckbox', 'studentcansend', get_string('studentcansend', 'pinnwand'));
        $mform->setDefault('studentcansend', 1);
        $mform->addHelpButton('studentcansend', 'studentcansend', 'pinnwand');

        $mform->addElement('advcheckbox', 'teachercansend', get_string('teachercansend', 'pinnwand'));
        $mform->setDefault('teachercansend', 1);
        $mform->addHelpButton('teachercansend', 'teachercansend', 'pinnwand');

        $mform->addElement('advcheckbox', 'studentclassview', get_string('studentclassview', 'pinnwand'));
        $mform->setDefault('studentclassview', 0);
        $mform->addHelpButton('studentclassview', 'studentclassview', 'pinnwand');

        $mform->addElement('advcheckbox', 'boardpannable', get_string('boardpannable', 'pinnwand'));
        $mform->setDefault('boardpannable', 0);
        $mform->addHelpButton('boardpannable', 'boardpannable', 'pinnwand');

        $mform->addElement('text', 'sidebaropacity', get_string('sidebaropacity', 'pinnwand'), ['size' => 4]);
        $mform->setType('sidebaropacity', PARAM_INT);
        $mform->setDefault('sidebaropacity', 92);
        $mform->addHelpButton('sidebaropacity', 'sidebaropacity', 'pinnwand');

        $mform->addElement('advcheckbox', 'studentboardclone', get_string('studentboardclone', 'pinnwand'));
        $mform->setDefault('studentboardclone', 0);
        $mform->addHelpButton('studentboardclone', 'studentboardclone', 'pinnwand');

        $mform->addElement('advcheckbox', 'studentthreads', get_string('studentthreads', 'pinnwand'));
        $mform->setDefault('studentthreads', 0);
        $mform->addHelpButton('studentthreads', 'studentthreads', 'pinnwand');

        $mform->addElement('advcheckbox', 'studentpoststream', get_string('studentpoststream', 'pinnwand'));
        $mform->setDefault('studentpoststream', 1);
        $mform->addHelpButton('studentpoststream', 'studentpoststream', 'pinnwand');

        $mform->addElement('advcheckbox', 'studentlayers', get_string('studentlayers', 'pinnwand'));
        $mform->setDefault('studentlayers', 0);
        $mform->addHelpButton('studentlayers', 'studentlayers', 'pinnwand');

        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    public function validation($data, $files) {
        $errors = parent::validation($data, $files);
        if (isset($data['maxpictures']) && $data['maxpictures'] < 0) {
            $errors['maxpictures'] = get_string('err_maxpictures', 'pinnwand');
        }
        if (isset($data['sidebaropacity']) && ($data['sidebaropacity'] < 0 || $data['sidebaropacity'] > 100)) {
            $errors['sidebaropacity'] = get_string('err_sidebaropacity', 'pinnwand');
        }
        return $errors;
    }
}
