import type Database from 'better-sqlite3';

export interface Settings {
  includePrereleaseFirmware: boolean;
  homeLatitude: number | null;
  homeLongitude: number | null;
  discoveryRescanIntervalMinutes: number;
  scheduleImportDisableOnDeviceDefault: boolean;
  controllerStatusPollIntervalMinutes: number;
}

const DEFAULTS: Settings = {
  includePrereleaseFirmware: false,
  homeLatitude: null,
  homeLongitude: null,
  discoveryRescanIntervalMinutes: 5,
  scheduleImportDisableOnDeviceDefault: false,
  controllerStatusPollIntervalMinutes: 5
};

function fromRow(row: any): Settings {
  return {
    includePrereleaseFirmware: !!row.include_prerelease_firmware,
    homeLatitude: row.home_latitude,
    homeLongitude: row.home_longitude,
    discoveryRescanIntervalMinutes: row.discovery_rescan_interval_minutes,
    scheduleImportDisableOnDeviceDefault: !!row.schedule_import_disable_on_device_default,
    controllerStatusPollIntervalMinutes: row.controller_status_poll_interval_minutes
  };
}

export function createSettingsRepository(db: Database.Database) {
  function ensureRow(): Settings {
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (row) return fromRow(row);
    db.prepare(
      `INSERT INTO settings (id, include_prerelease_firmware, home_latitude, home_longitude, discovery_rescan_interval_minutes, schedule_import_disable_on_device_default, controller_status_poll_interval_minutes)
       VALUES (1, ?, ?, ?, ?, ?, ?)`
    ).run(
      DEFAULTS.includePrereleaseFirmware ? 1 : 0,
      DEFAULTS.homeLatitude,
      DEFAULTS.homeLongitude,
      DEFAULTS.discoveryRescanIntervalMinutes,
      DEFAULTS.scheduleImportDisableOnDeviceDefault ? 1 : 0,
      DEFAULTS.controllerStatusPollIntervalMinutes
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
          controller_status_poll_interval_minutes = ? WHERE id = 1`
      ).run(
        next.includePrereleaseFirmware ? 1 : 0,
        next.homeLatitude,
        next.homeLongitude,
        next.discoveryRescanIntervalMinutes,
        next.scheduleImportDisableOnDeviceDefault ? 1 : 0,
        next.controllerStatusPollIntervalMinutes
      );
      return next;
    }
  };
}
