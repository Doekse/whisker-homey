/**
 * Pure LR4 state helpers: derive codes from robot payloads, format display strings,
 * and produce Homey capability update tuples without mutable caches or wrapper classes.
 */

const { convertLbsToGrams, formatDateForDisplay } = require('../common/utils');
const {
  CLEAN_CYCLE_UNKNOWN,
  CleanCycleStatusCodes,
  DAYS_OF_WEEK,
  HOPPER_STATUS_MAP,
} = require('./constants');

/** Default waste-drawer alarm threshold (percent), aligned with legacy LitterRobot4Data defaults */
const DEFAULT_WASTE_DRAWER_THRESHOLD = 80;

/**
 * Merges device settings with LR4 display defaults (12h flag, drawer threshold).
 *
 * @param {Object} [settings={}]
 * @returns {{ use12hFormat: boolean, wasteDrawerThreshold: number }}
 */
function resolveDisplaySettings(settings = {}) {
  const merged = {
    waste_drawer_threshold: DEFAULT_WASTE_DRAWER_THRESHOLD,
    ...settings,
  };

  return {
    use12hFormat: merged.use_12h_format === '12h',
    wasteDrawerThreshold: merged.waste_drawer_threshold,
  };
}

/**
 * Formats time values from ISO strings or minutes-from-midnight, honoring timezone when provided.
 *
 * @param {string|number|null|undefined} timeInput
 * @param {{ use12hFormat?: boolean, timezone?: string|null, baseDate?: Date|null }} [opts]
 * @returns {string|null}
 */
function formatTime(timeInput, {
  use12hFormat = false,
  timezone = null,
  baseDate = null,
} = {}) {
  if (!timeInput) return null;

  let dateObj;

  if (typeof timeInput === 'string') {
    dateObj = new Date(timeInput);
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
  } else if (typeof timeInput === 'number') {
    const minutes = Math.floor(timeInput);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    const base = baseDate || new Date();

    if (timezone) {
      const tzDate = new Date(base.toLocaleString('en-US', { timeZone: timezone }));
      dateObj = new Date(tzDate);
      dateObj.setHours(hours, mins, 0, 0);
    } else {
      dateObj = new Date(base);
      dateObj.setHours(hours, mins, 0, 0);
    }
  } else {
    return null;
  }

  return formatDateForDisplay(dateObj, { use12hFormat });
}

/**
 * Formats firmware fields into the Whisker app style string (e.g. "1175.5021.292").
 *
 * @param {Object} robot
 * @returns {string|null}
 */
function formatFirmwareVersion(robot) {
  const { espFirmware, picFirmwareVersion, laserBoardFirmwareVersion } = robot;

  if (!espFirmware || !picFirmwareVersion || !laserBoardFirmwareVersion) {
    return null;
  }

  const espVersion = espFirmware.replace(/\./g, '');

  const picParts = picFirmwareVersion.split('.');
  const picVersion = picParts.length >= 2
    ? picParts[picParts.length - 2] + picParts[picParts.length - 1]
    : picParts[picParts.length - 1];

  const laserVersion = laserBoardFirmwareVersion.replace(/\./g, '');

  return `${espVersion}.${laserVersion}.${picVersion}`;
}

/**
 * Derives the short status code used for descriptions and alarms from raw robot state.
 *
 * @param {Object} robot
 * @returns {string}
 */
function deriveStatusCode(robot) {
  const {
    robotStatus, displayCode, globeMotorFaultStatus, pinchStatus,
    isBonnetRemoved, isDFIFull, isCatDetectPending, catDetect,
    isOnline, robotCycleStatus, unitPowerStatus, isLaserDirty, USBFaultStatus,
  } = robot;

  if (globeMotorFaultStatus === 'FAULT_DUMP_POSITION'
      || globeMotorFaultStatus === 'DUMP_POSITION_FAULT') return 'DPF';
  if (globeMotorFaultStatus === 'FAULT_HOME_POSITION'
      || globeMotorFaultStatus === 'HOME_POSITION_FAULT') return 'HPF';
  if (typeof globeMotorFaultStatus === 'string'
      && globeMotorFaultStatus.includes('FAULT')
      && globeMotorFaultStatus !== 'FAULT_CLEAR') return 'DHF';
  if (globeMotorFaultStatus === 'FAULT_OVER_TORQUE') return 'OTF';

  if (pinchStatus === 'PINCH_DETECT_STARTUP') return 'SPF';
  if (pinchStatus === 'PINCH_DETECT' || pinchStatus === 'PINCH_DETECT_FAULT') return 'PD';
  if (pinchStatus === 'SWITCH_1_SET' || pinchStatus === 'SWITCH_2_SET') return 'PPD';
  if (pinchStatus === 'SWITCH_FAULT_1' || pinchStatus === 'SWITCH_FAULT_2') return 'PD';

  if (catDetect === 'CAT_SENSOR_FAULT_STARTUP') return 'SCF';
  if (isDFIFull && robotCycleStatus === 'CYCLE_STARTUP') return 'SDF';
  if (isCatDetectPending || catDetect === 'CAT_DETECT_FAULT'
      || catDetect === 'CAT_SENSOR_FAULT') return 'CSF';
  if (typeof catDetect === 'string' && catDetect.includes('FAULT')) return 'CSF';

  if (catDetect === 'CAT_DETECT_INTERRUPTED') return 'CSI';
  if (catDetect === 'CAT_DETECT_TIMING') return 'CST';
  if (catDetect === 'CAT_DETECT') return 'CD';

  if (isOnline === false) return 'OFFLINE';
  if (unitPowerStatus === 'OFF') return 'OFF';
  if (unitPowerStatus === 'POWERING_DOWN') return 'PWRD';
  if (unitPowerStatus === 'POWERING_UP') return 'PWRU';

  if (isLaserDirty === true) return 'LSD';
  if (typeof USBFaultStatus === 'string' && USBFaultStatus !== 'CLEAR') return 'USB';

  if (isBonnetRemoved) return 'BR';
  if (isDFIFull) return 'DFS';

  if (robotCycleStatus === 'CYCLE_DUMP'
      || robotCycleStatus === 'CYCLE_DFI'
      || robotCycleStatus === 'CYCLE_LEVEL') return 'CCP';
  if (robotStatus === 'ROBOT_CYCLE_COMPLETE'
      || robotCycleStatus === 'CYCLE_HOME') return 'CCC';
  if (robotCycleStatus === 'CYCLE_PAUSED') return 'P';

  if (robotStatus === 'ROBOT_IDLE') {
    if (displayCode === 'DC_BONNET_REMOVED') return 'BR';
    if (displayCode === 'DC_DRAWER_FULL') return 'DFS';
    if (displayCode === 'DC_CAT_DETECT') return 'CD';
    return 'RDY';
  }

  if (displayCode === 'DC_MODE_CYCLE') return 'EC';

  return 'RDY';
}

/**
 * Stable clean-cycle enum code for the clean_cycle_status capability.
 *
 * @param {Object} robot
 * @returns {string}
 */
function getCleanCycleStatus(robot) {
  const { robotStatus, robotCycleStatus } = robot;

  if (robotStatus === 'ROBOT_CAT_DETECT_DELAY') {
    return 'ROBOT_CAT_DETECT_DELAY';
  }

  if (robotCycleStatus && CleanCycleStatusCodes.includes(robotCycleStatus)) {
    return robotCycleStatus;
  }
  if (robotStatus && CleanCycleStatusCodes.includes(robotStatus)) {
    return robotStatus;
  }

  return CLEAN_CYCLE_UNKNOWN;
}

/**
 * Whether the cat-present state should raise alarm_cat_detected.
 *
 * @param {Object} robot
 * @returns {boolean}
 */
function isCatDetected(robot) {
  const statusCode = deriveStatusCode(robot);
  return robot.catDetect === 'CAT_DETECT'
         || robot.displayCode === 'DC_CAT_DETECT'
         || statusCode === 'CD';
}

/**
 * Today's sleep window in formatted strings and Date anchors for scheduling logic.
 *
 * @param {Object} robot
 * @param {{ use12hFormat?: boolean }} [opts]
 * @returns {{ startString: string, endString: string, startDate: Date, endDate: Date }|null}
 */
function computeSleepSchedule(robot, { use12hFormat = false } = {}) {
  if (!robot?.unitTimezone || typeof robot.weekdaySleepModeEnabled !== 'object') {
    return null;
  }

  const schedule = robot.weekdaySleepModeEnabled;
  const tz = robot.unitTimezone;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const todayName = DAYS_OF_WEEK[now.getDay()];
  const todayConfig = schedule[todayName];

  if (!todayConfig || !todayConfig.isEnabled) return null;

  const sleepMin = parseInt(todayConfig.sleepTime, 10);
  const wakeMin = parseInt(todayConfig.wakeTime, 10);

  const startString = formatTime(sleepMin, {
    use12hFormat,
    timezone: tz,
    baseDate: now,
  });

  const endBaseDate = new Date(now);
  if (wakeMin < sleepMin) {
    endBaseDate.setDate(endBaseDate.getDate() + 1);
  }

  const endString = formatTime(wakeMin, {
    use12hFormat,
    timezone: tz,
    baseDate: endBaseDate,
  });

  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  startDate.setMinutes(sleepMin);

  const endDate = new Date(startDate);
  if (wakeMin < sleepMin) endDate.setDate(endDate.getDate() + 1);
  endDate.setHours(0, 0, 0, 0);
  endDate.setMinutes(wakeMin);

  return {
    startString, endString, startDate, endDate,
  };
}

/**
 * @param {Object} robot
 * @returns {'off'|'on'|'auto'}
 */
function mapNightLightMode(robot) {
  const mode = robot.nightLightMode;
  switch (mode) {
    case 'OFF': return 'off';
    case 'ON': return 'on';
    case 'AUTO': return 'auto';
    default:
      return 'off';
  }
}

/**
 * @param {Object} robot
 * @returns {'low'|'medium'|'high'|null}
 */
function mapPanelBrightness(robot) {
  const brightness = robot.panelBrightnessHigh;
  if (brightness === 25) return 'low';
  if (brightness === 50) return 'medium';
  if (brightness === 100) return 'high';
  return null;
}

/**
 * @param {Object} robot
 * @returns {'low'|'medium'|'high'|null}
 */
function mapNightLightBrightnessLevel(robot) {
  const brightness = robot.nightLightBrightness;
  if (brightness === 25) return 'low';
  if (brightness === 50) return 'medium';
  if (brightness === 100) return 'high';
  return null;
}

/**
 * @param {Object} robot
 * @returns {number|null}
 */
function getLitterLevelPercentage(robot) {
  const level = robot.litterLevelPercentage;
  return typeof level === 'number' ? Math.round(level * 100) : null;
}

/**
 * @param {Object} robot
 * @returns {string|null}
 */
function getCleanCycleWaitTimeString(robot) {
  return robot.cleanCycleWaitTime ? String(robot.cleanCycleWaitTime) : null;
}

/**
 * @param {Object} robot
 * @returns {number|null}
 */
function getWeightInGrams(robot) {
  const weight = robot.catWeight;
  return weight ? convertLbsToGrams(weight) : null;
}

/**
 * Short hopper status code for the litter_hopper_status capability enum.
 *
 * @param {Object} robot
 * @returns {string|null}
 */
function getHopperStatusCode(robot) {
  const status = robot.hopperStatus;
  if (!status) return null;

  return HOPPER_STATUS_MAP[status] ?? null;
}

module.exports = {
  computeSleepSchedule,
  deriveStatusCode,
  formatFirmwareVersion,
  formatTime,
  getCleanCycleStatus,
  getCleanCycleWaitTimeString,
  getHopperStatusCode,
  getLitterLevelPercentage,
  getWeightInGrams,
  isCatDetected,
  mapNightLightBrightnessLevel,
  mapNightLightMode,
  mapPanelBrightness,
  resolveDisplaySettings,
};
