import type Database from 'better-sqlite3';

export interface Settings {
  includePrereleaseFirmware: boolean;
  homeLatitude: number | null;
  homeLongitude: number | null;
  discoveryRescanIntervalMinutes: number;
  scheduleImportDisableOnDeviceDefault: boolean;
  controllerStatusPollIntervalMinutes: number;
  livePollIntervalSeconds: number;
  gameDayEnabled: boolean;
  gameGroupId: string | null;
  gameLeftControllerId: string | null;
  gameRightControllerId: string | null;
  gameArkansasThemeId: string | null;
  gameLsuThemeId: string | null;
}

const DEFAULTS: Settings = {
  includePrereleaseFirmware: false,
  homeLatitude: null,
  homeLongitude: null,
  discoveryRescanIntervalMinutes: 5,
  scheduleImportDisableOnDeviceDefault: false,
  controllerStatusPollIntervalMinutes: 5,
  livePollIntervalSeconds: 2,
  gameDayEnabled: false,
  gameGroupId: null,
  gameLeftControllerId: null,
  gameRightControllerId: null,
  gameArkansasThemeId: null,
  gameLsuThemeId: null
};

function fromRow(row: any): Settings {
  return {
    includePrereleaseFirmware: !!row.include_prerelease_firmware,
    homeLatitude: row.home_latitude,
    homeLongitude: row.home_longitude,
    discoveryRescanIntervalMinutes: row.discovery_rescan_interval_minutes,
    scheduleImportDisableOnDeviceDefault: !!row.schedule_import_disable_on_device_default,
    controllerStatusPollIntervalMinutes: row.controller_status_poll_interval_minutes,
    livePollIntervalSeconds: row.live_poll_interval_seconds,
    gameDayEnabled: !!row.game_day_enabled,
    gameGroupId: row.game_group_id ?? null,
    gameLeftControllerId: row.game_left_controller_id ?? null,
    gameRightControllerId: row.game_right_controller_id ?? null,
    gameArkansasThemeId: row.game_arkansas_theme_id ?? null,
    gameLsuThemeId: row.game_lsu_theme_id ?? null
  };
}

export function createSettingsRepository(db: Database.Database) {
  function ensureRow(): Settings {
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (row) return fromRow(row);
    db.prepare(
      `INSERT INTO settings (id, include_prerelease_firmware, home_latitude, home_longitude,
         discovery_rescan_interval_minutes, schedule_import_disable_on_device_default,
         controller_status_poll_interval_minutes, live_poll_interval_seconds,
         game_day_enabled, game_group_id, game_left_controller_id, game_right_controller_id,
         game_arkansas_theme_id, game_lsu_theme_id)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      DEFAULTS.includePrereleaseFirmware ? 1 : 0,
      DEFAULTS.homeLatitude,
      DEFAULTS.homeLongitude,
      DEFAULTS.discoveryRescanIntervalMinutes,
      DEFAULTS.scheduleImportDisableOnDeviceDefault ? 1 : 0,
      DEFAULTS.controllerStatusPollIntervalMinutes,
      DEFAULTS.livePollIntervalSeconds,
      DEFAULTS.gameDayEnabled ? 1 : 0,
      DEFAULTS.gameGroupId,
      DEFAULTS.gameLeftControllerId,
      DEFAULTS.gameRightControllerId,
      DEFAULTS.gameArkansasThemeId,
      DEFAULTS.gameLsuThemeId
    );
    return { ...DEFAULTS };
  }

  return {
    get(): Settings {
      return ensureRow();
    },
    update(patch: Partial<Settings>): Settings {
      const next = { ...ensureRow(), ...patch };
      db.prepare(
        `UPDATE settings SET include_prerelease_firmware = ?, home_latitude = ?, home_longitude = ?,
          discovery_rescan_interval_minutes = ?, schedule_import_disable_on_device_default = ?,
          controller_status_poll_interval_minutes = ?, live_poll_interval_seconds = ?,
          game_day_enabled = ?, game_group_id = ?, game_left_controller_id = ?,
          game_right_controller_id = ?, game_arkansas_theme_id = ?, game_lsu_theme_id = ?
         WHERE id = 1`
      ).run(
        next.includePrereleaseFirmware ? 1 : 0,
        next.homeLatitude,
        next.homeLongitude,
        next.discoveryRescanIntervalMinutes,
        next.scheduleImportDisableOnDeviceDefault ? 1 : 0,
        next.controllerStatusPollIntervalMinutes,
        next.livePollIntervalSeconds,
        next.gameDayEnabled ? 1 : 0,
        next.gameGroupId,
        next.gameLeftControllerId,
        next.gameRightControllerId,
        next.gameArkansasThemeId,
        next.gameLsuThemeId
      );
      return next;
    }
  };
}
