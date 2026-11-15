<?php
// This file is part of Moodle - http://moodle.org/
namespace mod_pinnwand\local;

defined('MOODLE_INTERNAL') || die();

/**
 * Schichten einer Pinnwand: alles, was einer Person gehört (Objekte und ihre
 * Platzierungen, Roter Faden, Stift auf dem Board, eigene Board-Titel,
 * Hintergrund). Gemeinsame Grundlage für den Export einzelner Schichten
 * (layers.php) und für Sicherung/Wiederherstellung (backup/moodle2).
 *
 * Eine Schicht als Array:
 *   userid, teacher, username, fullname, bg, bgfx,
 *   photos[], placements[], threads[] (jeweils mit items[]), inks[], names[]
 * Die Zeilen sind Arrays mit den Spalten der Tabellen (inklusive alter id).
 */
class layers {

    /** Dateibereiche eines Objekts (itemid = Objekt-id). photothumb entsteht bei Bedarf neu. */
    const PHOTO_AREAS = ['photo', 'photoorig', 'photomask', 'photofull'];

    /** Dateibereiche einer Person (itemid = Nutzer-id). */
    const USER_AREAS = ['background', 'backgroundpdf'];

    /** Alle Personen, denen in dieser Pinnwand etwas gehört. */
    public static function owners(int $pinnwandid): array {
        global $DB;
        $sql = "SELECT userid FROM {pinnwand_photos} WHERE pinnwandid = :a
                 UNION SELECT userid FROM {pinnwand_threads} WHERE pinnwandid = :b
                 UNION SELECT userid FROM {pinnwand_board_ink} WHERE pinnwandid = :c
                 UNION SELECT userid FROM {pinnwand_board_names} WHERE pinnwandid = :d";
        $ids = $DB->get_fieldset_sql($sql, ['a' => $pinnwandid, 'b' => $pinnwandid, 'c' => $pinnwandid, 'd' => $pinnwandid]);
        $ids = array_values(array_unique(array_map('intval', $ids)));
        sort($ids);
        return array_values(array_filter($ids));
    }

    /** Lehrkraft-ähnlich (wie im Rest des Plugins: mod/pinnwand:viewall). */
    public static function is_teacher(\context $context, int $userid): bool {
        return has_capability('mod/pinnwand:viewall', $context, $userid);
    }

    /** Personen der Lehrkraft-Schichten (für die Sicherung ohne Nutzerdaten). */
    public static function teacher_owners(int $pinnwandid, \context $context): array {
        return array_values(array_filter(self::owners($pinnwandid), function ($uid) use ($context) {
            return self::is_teacher($context, $uid);
        }));
    }

    /** Zeilen einer Tabelle als Arrays. */
    protected static function rows(string $table, array $conditions, string $sort = 'id ASC'): array {
        global $DB;
        return array_map(function ($r) { return (array) $r; }, array_values($DB->get_records($table, $conditions, $sort)));
    }

    /**
     * Schichten sammeln.
     *
     * @param \stdClass $instance Pinnwand
     * @param \context $context Modulkontext
     * @param int[] $userids Personen
     * @return array Schichten nach Nutzer-id
     */
    public static function collect(\stdClass $instance, \context $context, array $userids): array {
        global $DB;
        $out = [];
        foreach ($userids as $uid) {
            $uid = (int) $uid;
            $user = $DB->get_record('user', ['id' => $uid], 'id, username, firstname, lastname, firstnamephonetic, lastnamephonetic, middlename, alternatename');
            $photos = self::rows('pinnwand_photos', ['pinnwandid' => $instance->id, 'userid' => $uid]);
            $photoids = array_column($photos, 'id');
            $placements = [];
            if ($photoids) {
                [$insql, $params] = $DB->get_in_or_equal($photoids);
                $placements = array_map(function ($r) { return (array) $r; },
                    array_values($DB->get_records_select('pinnwand_object_placements', "photoid $insql", $params, 'id ASC')));
            }
            $threads = [];
            foreach (self::rows('pinnwand_threads', ['pinnwandid' => $instance->id, 'userid' => $uid]) as $t) {
                $t['items'] = self::rows('pinnwand_thread_items', ['threadid' => $t['id']], 'sortorder ASC, id ASC');
                $threads[] = $t;
            }
            $out[$uid] = [
                'userid' => $uid,
                'teacher' => self::is_teacher($context, $uid),
                'username' => $user ? (string) $user->username : '',
                'fullname' => $user ? fullname($user) : '',
                'bg' => get_user_preferences('mod_pinnwand_bg_' . $instance->id, null, $uid),
                'bgfx' => get_user_preferences('mod_pinnwand_bgfx_' . $instance->id, null, $uid),
                'photos' => $photos,
                'placements' => $placements,
                'threads' => $threads,
                'inks' => self::rows('pinnwand_board_ink', ['pinnwandid' => $instance->id, 'userid' => $uid]),
                'names' => self::rows('pinnwand_board_names', ['pinnwandid' => $instance->id, 'userid' => $uid]),
            ];
        }
        return $out;
    }

    /** Kurzer Überblick einer Schicht (für die Auswahl). */
    public static function summary(array $layer): array {
        $boards = [];
        foreach ($layer['photos'] as $p) {
            $boards[(int) $p['boardid']] = true;
        }
        foreach ($layer['placements'] as $p) {
            $boards[(int) $p['boardid']] = true;
        }
        foreach ($layer['names'] as $n) {
            $boards[(int) $n['boardid']] = true;
        }
        unset($boards[0]);
        $items = 0;
        foreach ($layer['threads'] as $t) {
            $items += count($t['items']);
        }
        $active = array_filter($layer['photos'], function ($p) { return ($p['status'] ?? 'active') === 'active'; });
        return ['objects' => count($active), 'boards' => max(1, count($boards)), 'threaditems' => $items];
    }

    /** Größte Board-Nummer, die eine Person in dieser Pinnwand schon nutzt (0 = nichts vorhanden). */
    protected static function max_board(int $pinnwandid, int $userid): int {
        global $DB;
        $sql = "SELECT MAX(b) FROM (
                    SELECT MAX(boardid) AS b FROM {pinnwand_photos} WHERE pinnwandid = :a AND userid = :ua
                    UNION ALL
                    SELECT MAX(pl.boardid) AS b FROM {pinnwand_object_placements} pl
                      JOIN {pinnwand_photos} p ON p.id = pl.photoid WHERE pl.pinnwandid = :b AND p.userid = :ub
                    UNION ALL
                    SELECT MAX(boardid) AS b FROM {pinnwand_board_names} WHERE pinnwandid = :c AND userid = :uc
                    UNION ALL
                    SELECT MAX(boardid) AS b FROM {pinnwand_board_ink} WHERE pinnwandid = :d AND userid = :ud
                ) m";
        return (int) $DB->get_field_sql($sql, ['a' => $pinnwandid, 'ua' => $userid, 'b' => $pinnwandid, 'ub' => $userid,
            'c' => $pinnwandid, 'uc' => $userid, 'd' => $pinnwandid, 'ud' => $userid]);
    }

    /** Besitzt die Person in dieser Pinnwand schon irgendetwas? */
    protected static function has_data(int $pinnwandid, int $userid): bool {
        global $DB;
        foreach (['pinnwand_photos', 'pinnwand_threads', 'pinnwand_board_ink', 'pinnwand_board_names'] as $t) {
            if ($DB->record_exists($t, ['pinnwandid' => $pinnwandid, 'userid' => $userid])) {
                return true;
            }
        }
        return false;
    }

    /** Nur die Spalten, die es in der Tabelle gibt (ältere Sicherungen/Exporte haben weniger, neuere evtl. mehr). */
    protected static function clean(string $table, array $row): \stdClass {
        global $DB;
        static $cols = [];
        if (!isset($cols[$table])) {
            $cols[$table] = array_keys($DB->get_columns($table));
        }
        $out = new \stdClass();
        foreach ($cols[$table] as $c) {
            if ($c !== 'id' && array_key_exists($c, $row)) {
                $out->$c = $row[$c];
            }
        }
        return $out;
    }

    /**
     * Eine Schicht einer Person zuordnen und einfügen. Hat die Person in dieser
     * Pinnwand schon etwas, wird zusammengeführt: eigene Boards (außer Board 0)
     * bekommen neue Nummern hinter den vorhandenen, Stationen hängen am
     * vorhandenen Faden, Stift auf demselben Board wird ergänzt, ein schon
     * gesetzter Hintergrund bleibt.
     *
     * @return array ['photos' => [alt => neu], 'bg' => bool (Hintergrund übernommen)]
     */
    public static function insert_layer(\stdClass $instance, int $targetuserid, array $layer): array {
        global $DB;
        $now = time();
        $pid = (int) $instance->id;
        $offset = self::has_data($pid, $targetuserid) ? self::max_board($pid, $targetuserid) : 0;
        $board = function ($b) use ($offset) {
            $b = (int) $b;
            return $b === 0 ? 0 : $b + $offset;
        };

        // Objekte.
        $sortbase = $DB->count_records('pinnwand_photos', ['pinnwandid' => $pid, 'userid' => $targetuserid]);
        $map = [];
        $refs = [];
        foreach ($layer['photos'] ?? [] as $i => $p) {
            $rec = self::clean('pinnwand_photos', $p);
            $rec->pinnwandid = $pid;
            $rec->userid = $targetuserid;
            $rec->boardid = $board($p['boardid'] ?? 0);
            $rec->sortorder = $sortbase + (int) ($p['sortorder'] ?? $i);
            $rec->sourcephotoid = null;
            $rec->backphotoid = null;
            if (empty($rec->timecreated)) {
                $rec->timecreated = $now;
            }
            $newid = $DB->insert_record('pinnwand_photos', $rec);
            $map[(int) $p['id']] = (int) $newid;
            $refs[(int) $newid] = $p;
        }
        // Verweise innerhalb der Schicht (Vorlage, Rückseite) erst jetzt, wenn alle neuen ids feststehen.
        foreach ($refs as $newid => $p) {
            $src = !empty($p['sourcephotoid']) ? ($map[(int) $p['sourcephotoid']] ?? null) : null;
            $back = !empty($p['backphotoid']) ? ($map[(int) $p['backphotoid']] ?? null) : null;
            if ($src || $back) {
                $DB->update_record('pinnwand_photos', (object) ['id' => $newid, 'sourcephotoid' => $src, 'backphotoid' => $back,
                    'showingback' => $back ? (int) ($p['showingback'] ?? 0) : 0]);
            } else if (!empty($p['showingback'])) {
                $DB->set_field('pinnwand_photos', 'showingback', 0, ['id' => $newid]);
            }
        }

        // Weitere Platzierungen.
        foreach ($layer['placements'] ?? [] as $pl) {
            if (!isset($map[(int) $pl['photoid']])) {
                continue;
            }
            $rec = self::clean('pinnwand_object_placements', $pl);
            $rec->pinnwandid = $pid;
            $rec->photoid = $map[(int) $pl['photoid']];
            $rec->boardid = $board($pl['boardid'] ?? 0);
            $rec->timecreated = $rec->timecreated ?? $now;
            $rec->timemodified = $now;
            $DB->insert_record('pinnwand_object_placements', $rec);
        }

        // Roter Faden: einer je Person; ein mitgebrachter Faden hängt sich an einen vorhandenen an.
        $own = $DB->get_record('pinnwand_threads', ['pinnwandid' => $pid, 'userid' => $targetuserid], '*', IGNORE_MULTIPLE);
        foreach ($layer['threads'] ?? [] as $t) {
            if ($own) {
                $threadid = (int) $own->id;
                $sort = (int) $DB->get_field_sql('SELECT COALESCE(MAX(sortorder), -1) + 1 FROM {pinnwand_thread_items} WHERE threadid = ?',
                    [$threadid]);
            } else {
                $rec = self::clean('pinnwand_threads', $t);
                $rec->pinnwandid = $pid;
                $rec->userid = $targetuserid;
                $rec->timecreated = $rec->timecreated ?? $now;
                $threadid = (int) $DB->insert_record('pinnwand_threads', $rec);
                $own = $DB->get_record('pinnwand_threads', ['id' => $threadid]);
                $sort = 0;
            }
            foreach ($t['items'] ?? [] as $it) {
                $rec = self::clean('pinnwand_thread_items', $it);
                $rec->threadid = $threadid;
                if (!empty($it['photoid'])) {
                    if (!isset($map[(int) $it['photoid']])) {
                        if (($it['itemtype'] ?? '') === 'photo') {
                            continue;
                        }
                        $rec->photoid = null;
                    } else {
                        $rec->photoid = $map[(int) $it['photoid']];
                    }
                }
                if (isset($it['boardid']) && $it['boardid'] !== null) {
                    $rec->boardid = $board($it['boardid']);
                }
                $rec->sortorder = $sort++;
                $rec->timecreated = $rec->timecreated ?? $now;
                $DB->insert_record('pinnwand_thread_items', $rec);
            }
        }

        // Stift auf dem Board (ein Datensatz je Person und Board).
        foreach ($layer['inks'] ?? [] as $ink) {
            $b = $board($ink['boardid'] ?? 0);
            $existing = $DB->get_record('pinnwand_board_ink', ['pinnwandid' => $pid, 'userid' => $targetuserid, 'boardid' => $b],
                '*', IGNORE_MULTIPLE);
            if ($existing) {
                $a = json_decode((string) $existing->strokedata, true);
                $n = json_decode((string) ($ink['strokedata'] ?? ''), true);
                if (is_array($a) && is_array($n) && $n) {
                    $existing->strokedata = json_encode(array_merge($a, $n));
                    $existing->timemodified = $now;
                    $DB->update_record('pinnwand_board_ink', $existing);
                }
                continue;
            }
            $rec = self::clean('pinnwand_board_ink', $ink);
            $rec->pinnwandid = $pid;
            $rec->userid = $targetuserid;
            $rec->boardid = $b;
            $rec->timecreated = $rec->timecreated ?? $now;
            $rec->timemodified = $now;
            $DB->insert_record('pinnwand_board_ink', $rec);
        }

        // Eigene Board-Titel.
        foreach ($layer['names'] ?? [] as $nm) {
            $b = $board($nm['boardid'] ?? 0);
            if ($DB->record_exists('pinnwand_board_names', ['pinnwandid' => $pid, 'userid' => $targetuserid, 'boardid' => $b])) {
                continue;
            }
            $rec = self::clean('pinnwand_board_names', $nm);
            $rec->pinnwandid = $pid;
            $rec->userid = $targetuserid;
            $rec->boardid = $b;
            $rec->timemodified = $now;
            $DB->insert_record('pinnwand_board_names', $rec);
        }

        // Hintergrund (Einstellung der Person je Pinnwand), nur wenn noch keiner gesetzt ist.
        $bgset = false;
        if (!empty($layer['bg']) && get_user_preferences('mod_pinnwand_bg_' . $pid, null, $targetuserid) === null) {
            $bg = json_decode((string) $layer['bg'], true);
            if (is_array($bg)) {
                if (($bg['type'] ?? '') === 'image') {
                    $old = (int) ($bg['photoid'] ?? 0);
                    if (isset($map[$old])) {
                        $bg['photoid'] = $map[$old];
                    } else {
                        $bg['type'] = 'color';
                        unset($bg['photoid']);
                    }
                }
                set_user_preference('mod_pinnwand_bg_' . $pid, json_encode($bg), $targetuserid);
                if (!empty($layer['bgfx'])) {
                    set_user_preference('mod_pinnwand_bgfx_' . $pid, (string) $layer['bgfx'], $targetuserid);
                }
                $bgset = true;
            }
        }

        return ['photos' => $map, 'bg' => $bgset];
    }

    // ------------------------------------------------------------------
    // Export-Datei (.pinnwand): ZIP mit layers.json und den Dateien.
    // ------------------------------------------------------------------

    const FORMAT = 'mod_pinnwand-layers';

    /**
     * Ausgewählte Schichten als ZIP-Datei schreiben.
     *
     * @param bool $full auch Originale in voller Auflösung (photoorig, photofull)
     * @return string Pfad der ZIP-Datei (im Anfrage-Verzeichnis)
     */
    public static function export_file(\stdClass $instance, \context $context, array $userids, bool $full): string {
        $layers = self::collect($instance, $context, $userids);
        $fs = get_file_storage();
        $files = [];
        $areas = $full ? self::PHOTO_AREAS : ['photo', 'photomask'];
        foreach ($layers as &$layer) {
            $layer['files'] = [];
            foreach ($layer['photos'] as $p) {
                foreach ($areas as $area) {
                    foreach ($fs->get_area_files($context->id, 'mod_pinnwand', $area, $p['id'], 'filename', false) as $f) {
                        $path = 'files/' . $area . '/' . $p['id'] . '/' . $f->get_filename();
                        $files[$path] = $f;
                        $layer['files'][] = ['area' => $area, 'itemid' => (int) $p['id'], 'filename' => $f->get_filename(), 'path' => $path];
                    }
                }
            }
            foreach (self::USER_AREAS as $area) {
                foreach ($fs->get_area_files($context->id, 'mod_pinnwand', $area, $layer['userid'], 'filename', false) as $f) {
                    $path = 'files/' . $area . '/u' . $layer['userid'] . '/' . $f->get_filename();
                    $files[$path] = $f;
                    $layer['files'][] = ['area' => $area, 'itemid' => 0, 'filename' => $f->get_filename(), 'path' => $path];
                }
            }
        }
        unset($layer);
        $manifest = [
            'format' => self::FORMAT,
            'version' => 1,
            'plugin' => get_config('mod_pinnwand', 'version'),
            'created' => time(),
            'source' => ['name' => format_string($instance->name), 'wwwroot' => (new \moodle_url('/'))->out(false)],
            'layers' => array_values($layers),
        ];
        $files['layers.json'] = [json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
        $dir = make_request_directory();
        $zip = $dir . '/layers.zip';
        $packer = get_file_packer('application/zip');
        if (!$packer->archive_to_pathname($files, $zip)) {
            throw new \moodle_exception('layers_error_zip', 'pinnwand');
        }
        return $zip;
    }

    /**
     * Export-Datei entpacken und prüfen.
     *
     * @return array [Verzeichnis, Manifest]
     */
    public static function read_file(string $zip, string $dir): array {
        $packer = get_file_packer('application/zip');
        $packer->extract_to_pathname($zip, $dir);
        $json = @file_get_contents($dir . '/layers.json');
        $manifest = $json !== false ? json_decode($json, true) : null;
        if (!is_array($manifest) || ($manifest['format'] ?? '') !== self::FORMAT || !is_array($manifest['layers'] ?? null)) {
            throw new \moodle_exception('layers_error_file', 'pinnwand');
        }
        return [$dir, $manifest];
    }

    /**
     * Schichten aus einer entpackten Export-Datei übernehmen.
     *
     * @param array $targets alte Nutzer-id => neue Nutzer-id (0 = nicht übernehmen)
     * @return int Anzahl übernommener Schichten
     */
    public static function import(\stdClass $instance, \context $context, string $dir, array $manifest, array $targets): int {
        $fs = get_file_storage();
        $count = 0;
        $root = realpath($dir);
        foreach ($manifest['layers'] as $layer) {
            $target = (int) ($targets[(int) ($layer['userid'] ?? 0)] ?? 0);
            if ($target <= 0) {
                continue;
            }
            $res = self::insert_layer($instance, $target, $layer);
            foreach ($layer['files'] ?? [] as $f) {
                $area = (string) ($f['area'] ?? '');
                $real = realpath($dir . '/' . ($f['path'] ?? ''));
                if (!$real || strpos($real, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($real)) {
                    continue;
                }
                if (in_array($area, self::PHOTO_AREAS, true)) {
                    $itemid = $res['photos'][(int) ($f['itemid'] ?? 0)] ?? 0;
                } else if (in_array($area, self::USER_AREAS, true) && $res['bg']) {
                    $itemid = $target;
                } else {
                    continue;
                }
                if (!$itemid) {
                    continue;
                }
                $filename = clean_param((string) ($f['filename'] ?? ''), PARAM_FILE);
                if ($filename === '' || $fs->file_exists($context->id, 'mod_pinnwand', $area, $itemid, '/', $filename)) {
                    continue;
                }
                $fs->create_file_from_pathname([
                    'contextid' => $context->id, 'component' => 'mod_pinnwand', 'filearea' => $area,
                    'itemid' => $itemid, 'filepath' => '/', 'filename' => $filename,
                ], $real);
            }
            $count++;
        }
        return $count;
    }
}
