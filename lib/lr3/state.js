/**
 * Pure LR3 state helpers: derive codes from REST payloads, format display strings,
 * build update payloads, and emit Homey capability update tuples without wrapper classes.
 */

const { formatDateForDisplay } = require('../common/utils');
const {
  CLEAN_CYCLE_UNKNOWN,
  CleanCycleStatusCodes,
  Defaults,
} = require('./constants');

/**
 * Merges device settings with LR3 display defaults (drawer threshold, 12h flag).
 *
 * @param {Object} [settings={}]
 * @returns {{ use12hFormat: boolean, wasteDrawerThreshold: number, homeyTimezone?: string|null }}
 */
function resolveDisplaySettings(settings = {}) {
  const merged = {
    waste_drawer_threshold: Defaults.DEFAULT_WASTE_DRAWER_THRESHOLD,
    ...settings,
  };

  return {
    use12hFormat: merged.use_12h_format === '12h',
    wasteDrawerThreshold: merged.waste_drawer_threshold,
    homeyTimezone: merged.homeyTimezone,
  };
}

/**
 * Minimum cycles-left estimate implied by the current `unitStatus` (matches legacy
 * LitterRobot3Data `_statusMinimumCyclesLeft` after a fresh instance update).
 *
 * @param {Object} robot
 * @returns {number}
 */
function getMinimumCyclesLeftFromStatus(robot) {
  const status = robot?.unitStatus;
  if (status === 'DF1') return 2;
  if (status === 'DF2') return 1;
  if (status === 'DFS') return 0;
  return Defaults.MINIMUM_CYCLES_LEFT_DEFAULT;
}

/**
 * @param {Object} robot
 * @returns {number}
 */
function getCycleCount(robot) {
  return parseInt(robot?.cycleCount || '0', 10);
}

/**
 * @param {Object} robot
 * @returns {number}
 */
function getTotalCleanCycles(robot) {
  return parseInt(robot?.totalCycleCount, 10) || 0;
}

/**
 * Effective cycle capacity used by waste math and drawer reset payloads.
 *
 * @param {Object} robot
 * @returns {number}
 */
function computeCycleCapacity(robot) {
  const apiCapacity = parseInt(robot?.cycleCapacity || Defaults.CYCLE_CAPACITY_DEFAULT, 10);
  const minimumCyclesLeft = getMinimumCyclesLeftFromStatus(robot);
  const cycleCount = getCycleCount(robot);
  const minimumCapacity = cycleCount + minimumCyclesLeft;
  if (minimumCyclesLeft < Defaults.MINIMUM_CYCLES_LEFT_DEFAULT) {
    return minimumCapacity;
  }
  return Math.max(apiCapacity, minimumCapacity);
}

/**
 * @param {Object} robot
 * @returns {number}
 */
function getWasteDrawerLevelRaw(robot) {
  const capacity = computeCycleCapacity(robot);
  if (capacity === 0) return 100;
  const cycleCount = getCycleCount(robot);
  return Math.floor(((cycleCount / capacity) * 1000 + 0.5)) / 10;
}

/**
 * Integer percentage for capability publishing (matches legacy getter rounding).
 *
 * @param {Object} robot
 * @returns {number}
 */
function getWasteDrawerLevelPercentage(robot) {
  return Math.round(getWasteDrawerLevelRaw(robot));
}

/**
 * @param {Object} robot
 * @returns {number|null}
 */
function getCleanCycleWaitTimeMinutes(robot) {
  return parseInt(robot?.cleanCycleWaitTimeMinutes || '7', 16);
}

/**
 * @param {Object} robot
 * @returns {boolean}
 */
function isSleepModeEnabled(robot) {
  return robot?.sleepModeActive !== '0';
}

/**
 * @param {Object} robot
 * @returns {boolean}
 */
function isSleeping(robot) {
  if (!isSleepModeEnabled(robot)) return false;
  const hoursStr = robot.sleepModeActive?.slice(1, 3) || '0';
  const hours = parseInt(hoursStr, 10) || 0;
  return hours < Defaults.SLEEP_DURATION_HOURS;
}

/**
 * @param {Object} robot
 * @returns {boolean}
 */
function isCatDetected(robot) {
  return robot.unitStatus === 'CD';
}

/**
 * @param {Object} robot
 * @returns {boolean}
 */
function hasConnectivityProblem(robot) {
  return robot.powerStatus === 'NC';
}

/**
 * @param {Object} robot
 * @returns {boolean}
 */
function isOnline(robot) {
  return !hasConnectivityProblem(robot);
}

/**
 * Formats ISO timestamps from the LR3 API for display.
 *
 * @param {string|null|undefined} timeInput
 * @param {{ use12hFormat?: boolean, timezone?: string|null }} [opts]
 * @returns {string|null}
 */
function formatTime(timeInput, { use12hFormat = false, timezone = null } = {}) {
  if (!timeInput) return null;

  const dateObj = new Date(timeInput);
  if (Number.isNaN(dateObj.getTime())) return null;

  if (timezone) {
    return dateObj.toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: use12hFormat,
    });
  }

  return formatDateForDisplay(dateObj, { use12hFormat });
}

/**
 * LR3 does not expose a unified firmware string like LR4; reserved for future fields.
 *
 * @param {Object} robot
 * @returns {string|null}
 */
function formatFirmwareVersion(robot) {
  if (robot.litterRobotSerial) {
    return String(robot.litterRobotSerial);
  }
  return null;
}

/**
 * Derives the short status code used for descriptions and alarms from raw robot state.
 *
 * @param {Object} robot
 * @returns {string}
 */
function deriveStatusCode(robot) {
  const {
    unitStatus, powerStatus, isManualReset,
  } = robot;

  if (unitStatus === 'DHF') return 'DHF';
  if (unitStatus === 'DPF') return 'DPF';
  if (unitStatus === 'HPF') return 'HPF';
  if (unitStatus === 'OTF') return 'OTF';

  if (unitStatus === 'SPF') return 'SPF';
  if (unitStatus === 'PD') return 'PD';
  if (unitStatus === 'PPD') return 'PPD';

  if (unitStatus === 'SCF') return 'SCF';
  if (unitStatus === 'SDF') return 'SDF';
  if (unitStatus === 'CSF') return 'CSF';
  if (unitStatus === 'CSI') return 'CSI';

  if (powerStatus === 'NC') return 'OFFLINE';
  if (powerStatus === 'OFF') return 'OFF';
  if (unitStatus === 'PWRD') return 'PWRD';
  if (unitStatus === 'PWRU') return 'PWRU';

  if (unitStatus === 'DFS') return 'DFS';

  if (unitStatus === 'CST') return 'CST';
  if (unitStatus === 'CD') return 'CD';

  if (unitStatus === 'CCP') return 'CCP';
  if (unitStatus === 'CCC') return 'CCC';
  if (unitStatus === 'EC') return 'EC';
  if (unitStatus === 'P') return 'P';
  if (unitStatus === 'RDY') return 'RDY';

  if (unitStatus === 'BR') return 'BR';

  if (isManualReset === true) return 'RDY';

  return unitStatus || 'UNKNOWN';
}

/**
 * Stable clean-cycle enum code for the clean_cycle_status capability.
 *
 * @param {Object} robot
 * @returns {string}
 */
function getCleanCycleStatus(robot) {
  const { unitStatus } = robot;
  if (!unitStatus) {
    return CLEAN_CYCLE_UNKNOWN;
  }
  if (CleanCycleStatusCodes.includes(unitStatus)) {
    return unitStatus;
  }
  return CLEAN_CYCLE_UNKNOWN;
}

/**
 * Parses legacy `sleepModeActive` / `sleepModeTime` into today's window strings.
 *
 * @param {Object} robot
 * @param {{ use12hFormat?: boolean, timezone?: string|null }} [opts]
 * @returns {{ startString: string, endString: string, startTime: Date, endTime: Date }|null}
 */
function computeSleepSchedule(robot, { use12hFormat = false, timezone = null } = {}) {
  if (!robot?.sleepModeActive || robot.sleepModeActive === '0') {
    return null;
  }

  const now = new Date();
  let startTime;

  if (robot.sleepModeTime && robot.sleepModeTime !== '0') {
    const timestamp = parseInt(robot.sleepModeTime, 10);
    if (!Number.isNaN(timestamp)) {
      const sleepTime = new Date(timestamp * 1000);
      startTime = new Date(now);
      startTime.setHours(sleepTime.getHours(), sleepTime.getMinutes(), sleepTime.getSeconds(), 0);

      if (startTime <= new Date(now.getTime() - Defaults.SLEEP_DURATION_HOURS * 60 * 60 * 1000)) {
        startTime.setDate(startTime.getDate() + 1);
      }
    }
  } else if (robot.sleepModeActive && robot.sleepModeActive !== '0') {
    const timeStr = robot.sleepModeActive.slice(1);
    const [hours, minutes, seconds] = timeStr.split(':').map((s) => parseInt(s, 10) || 0);

    startTime = new Date(now);
    startTime.setHours(hours, minutes, seconds, 0);

    if (startTime <= new Date(now.getTime() - Defaults.SLEEP_DURATION_HOURS * 60 * 60 * 1000)) {
      startTime.setDate(startTime.getDate() + 1);
    }
  }

  if (!startTime) return null;

  const endTime = new Date(startTime.getTime() + Defaults.SLEEP_DURATION_HOURS * 60 * 60 * 1000);

  return {
    startTime,
    endTime,
    startString: formatTime(startTime.toISOString(), {
      use12hFormat,
      timezone,
    }),
    endString: formatTime(endTime.toISOString(), {
      use12hFormat,
      timezone,
    }),
  };
}

/**
 * Update payload to reset the waste drawer counters on the LR3 REST API.
 *
 * @param {Object} robot
 * @param {Object} [settings={}]
 * @returns {{ cycleCount: number, cycleCapacity: number, cyclesAfterDrawerFull: number }}
 */
function buildResetUpdate(robot, _settings = {}) {
  return {
    cycleCount: 0,
    cycleCapacity: computeCycleCapacity(robot),
    cyclesAfterDrawerFull: 0,
  };
}

/**
 * Update payload to enable/disable sleep mode on the LR3 REST API.
 *
 * @param {Object} robot
 * @param {boolean} enable
 * @param {Object} [settings={}]
 * @param {number} [nowSeconds=Math.floor(Date.now() / 1000)]
 * @returns {{ sleepModeEnable: boolean, sleepModeTime?: number }}
 */
function buildSleepModeUpdate(robot, enable, _settings = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = { sleepModeEnable: enable };
  if (enable) {
    const existing = robot?.sleepModeTime ? parseInt(robot.sleepModeTime, 10) : NaN;
    if (robot?.sleepModeTime && robot.sleepModeTime !== '0' && !Number.isNaN(existing)) {
      payload.sleepModeTime = existing;
    } else {
      payload.sleepModeTime = nowSeconds;
    }
  }
  return payload;
}

module.exports = {
  buildResetUpdate,
  buildSleepModeUpdate,
  computeSleepSchedule,
  deriveStatusCode,
  formatFirmwareVersion,
  formatTime,
  getCleanCycleStatus,
  getCleanCycleWaitTimeMinutes,
  getCycleCount,
  getTotalCleanCycles,
  getWasteDrawerLevelPercentage,
  isCatDetected,
  isOnline,
  isSleepModeEnabled,
  isSleeping,
  resolveDisplaySettings,
};
