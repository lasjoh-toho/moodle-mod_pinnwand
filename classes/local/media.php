<?php
// This file is part of Moodle - http://moodle.org/
namespace mod_pinnwand\local;

defined('MOODLE_INTERNAL') || die();

/**
 * Bildgrößen eines Objekts:
 * - photothumb: kleine Vorschau (THUMB px) für Listen und „Meine Bilder“, entsteht bei Bedarf auf dem Server;
 * - photo: Anzeigegröße (wie bisher, etwa 1600–1800 px);
 * - photofull: volle Auflösung (bis 4096 px), nur wenn das Original größer war; wird erst geladen,
 *   wenn jemand tiefer hineinzoomt, als die Anzeigegröße hergibt;
 * - photoorig/photomask: Original und Freistellmaske für die nicht-destruktive Bearbeitung.
 */
class media {

    /** Längste Seite der Vorschau. */
    const THUMB = 400;

    /** Längste Seite der vollen Auflösung (Obergrenze, auch im Browser). */
    const FULL = 4096;

    /** Erste Datei eines Bereichs. */
    public static function first(\context $context, string $area, int $itemid): ?\stored_file {
        $files = get_file_storage()->get_area_files($context->id, 'mod_pinnwand', $area, $itemid, 'filename', false);
        $f = reset($files);
        return $f ?: null;
    }

    /** URL der ersten Datei eines Bereichs ('' wenn leer). */
    public static function url(\context $context, string $area, int $itemid): string {
        $f = self::first($context, $area, $itemid);
        return $f ? (string) \moodle_url::make_pluginfile_url($context->id, 'mod_pinnwand', $area, $itemid, '/', $f->get_filename()) : '';
    }

    /**
     * URL der Vorschau. Der Name enthält einen Teil des Prüfwerts des Anzeigebilds, damit eine
     * geänderte Anzeige auch eine neue Vorschau-URL bekommt (Browser-Cache).
     */
    public static function thumb_url(\context $context, int $photoid, ?\stored_file $photo = null): string {
        $photo = $photo ?: self::first($context, 'photo', $photoid);
        if (!$photo) {
            return '';
        }
        return (string) \moodle_url::make_pluginfile_url($context->id, 'mod_pinnwand', 'photothumb', $photoid, '/',
            self::thumb_name($photo));
    }

    protected static function thumb_name(\stored_file $photo): string {
        $ext = strtolower(pathinfo($photo->get_filename(), PATHINFO_EXTENSION)) ?: 'jpg';
        return 'thumb_' . substr($photo->get_contenthash(), 0, 12) . '.' . $ext;
    }

    /**
     * Vorschau liefern, bei Bedarf (fehlend oder veraltet) neu erzeugen. Kleine Bilder und SVG
     * (Wortfelder) brauchen keine eigene Vorschau: dann das Anzeigebild selbst.
     */
    public static function thumbnail(\context $context, int $photoid): ?\stored_file {
        $photo = self::first($context, 'photo', $photoid);
        if (!$photo) {
            return null;
        }
        $info = $photo->get_imageinfo();
        if (!$info || empty($info['width']) || max($info['width'], $info['height']) <= self::THUMB * 1.25
                || !in_array($photo->get_mimetype(), ['image/jpeg', 'image/png'], true)) {
            return $photo;
        }
        $fs = get_file_storage();
        $name = self::thumb_name($photo);
        $existing = $fs->get_file($context->id, 'mod_pinnwand', 'photothumb', $photoid, '/', $name);
        if ($existing) {
            return $existing;
        }
        $fs->delete_area_files($context->id, 'mod_pinnwand', 'photothumb', $photoid);
        try {
            return $fs->convert_image([
                'contextid' => $context->id, 'component' => 'mod_pinnwand', 'filearea' => 'photothumb',
                'itemid' => $photoid, 'filepath' => '/', 'filename' => $name,
            ], $photo, self::THUMB, self::THUMB, true, 82);
        } catch (\Throwable $e) {
            debugging('mod_pinnwand: Vorschau nicht erzeugt: ' . $e->getMessage(), DEBUG_DEVELOPER);
            return $photo;
        }
    }

    /** Zusätzliche URLs eines Objekts für die Oberfläche. */
    public static function urls(\context $context, int $photoid, ?\stored_file $photo = null): array {
        return [
            'thumburl' => self::thumb_url($context, $photoid, $photo),
            'fullurl' => self::url($context, 'photofull', $photoid),
        ];
    }

    /** Alle Bilddateien eines Objekts auf ein anderes kopieren (z. B. Übernahme auf das eigene Board). */
    public static function copy_photo_files(\context $context, int $fromid, int $toid, ?array $areas = null): void {
        $fs = get_file_storage();
        foreach ($areas ?? layers::PHOTO_AREAS as $area) {
            foreach ($fs->get_area_files($context->id, 'mod_pinnwand', $area, $fromid, 'filename', false) as $f) {
                if ($fs->file_exists($context->id, 'mod_pinnwand', $area, $toid, '/', $f->get_filename())) {
                    continue;
                }
                $fs->create_file_from_storedfile(['filearea' => $area, 'itemid' => $toid, 'filepath' => '/'], $f);
            }
        }
    }

    /**
     * Bild aus einer Data-URL in einen Bereich schreiben (ersetzt den Inhalt).
     *
     * @return \stored_file|null
     */
    public static function store_dataurl(\context $context, string $area, int $itemid, string $dataurl): ?\stored_file {
        if (!preg_match('#^data:image/(png|jpeg|jpg);base64,(.+)$#s', $dataurl, $m)) {
            return null;
        }
        $bin = base64_decode($m[2]);
        if ($bin === false || strlen($bin) < 50) {
            return null;
        }
        $size = @getimagesizefromstring($bin);
        if (!$size || max($size[0], $size[1]) > self::FULL + 8) {
            return null;
        }
        $fs = get_file_storage();
        $fs->delete_area_files($context->id, 'mod_pinnwand', $area, $itemid);
        return $fs->create_file_from_string([
            'contextid' => $context->id, 'component' => 'mod_pinnwand', 'filearea' => $area,
            'itemid' => $itemid, 'filepath' => '/',
            'filename' => $area . '_' . $itemid . '_' . time() . '.' . ($m[1] === 'png' ? 'png' : 'jpg'),
        ], $bin);
    }
}
