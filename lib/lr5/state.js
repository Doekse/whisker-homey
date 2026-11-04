/** Pure mappings for LR5's nested REST state. Percent fields already use 0–100. */
const { getHopper, getFaults } = require('./diagnostics');
const { getScheduleInfo, getMaintenance } = require('./schedule');
const { convertLbsToGrams } = require('../common/utils');

const STATUS_MAP = {
  StRobotBonnet: 'BR',
  StRobotCatDetect: 'CD',
  StRobotCatDetectDelay: 'CST',
  StRobotClean: 'CCP',
  StRobotEmpty: 'EC',
  StRobotFindDump: 'CCP',
  StRobotIdle: 'RDY',
  StRobotPowerDown: 'PWRD',
  StRobotPowerOff: 'OFF',
  StRobotPowerUp: 'PWRU',
  DcCatDetect: 'CD',
  DcDfiFull: 'DFS',
  DcModeCycle: 'CCP',
  DcModeIdle: 'RDY',
  DcxLampTest: 'PWRU',
  DcxSuspend: 'PWRD',
  READY: 'RDY',
  DRAWER_FULL: 'DFS',
  CYCLING: 'CCP',
  LITTER_LOW: 'RDY',
  CAT_DETECTED: 'CD',
  BONNET_REMOVED: 'BR',
  OFF: 'OFF',
  OFFLINE: 'OFFLINE',
  ROBOT_IDLE: 'RDY',
  ROBOT_CLEAN: 'CCP',
  ROBOT_EMPTY: 'EC',
  ROBOT_FIND_DUMP: 'CCP',
  ROBOT_CAT_DETECT: 'CD',
  ROBOT_CAT_DETECT_DELAY: 'CST',
  ROBOT_BONNET: 'BR',
  ROBOT_POWER_OFF: 'OFF',
  ROBOT_POWER_UP: 'PWRU',
  ROBOT_POWER_DOWN: 'PWRD',
};
const CYCLE_CODES = ['RDY', 'CCP', 'EC', 'P', 'CST', 'UNKNOWN'];
const STATUS_CODES = [...new Set([...Object.values(STATUS_MAP), 'P', 'CSI', 'UNKNOWN'])];

function deriveStatusCode(state) {
  if (state.isOnline === false) return 'OFFLINE';
  const cycle = state.cycleState || state.robotCycleState;
  if (['StCatDetect', 'CYCLE_STATE_CAT_DETECT'].includes(cycle)) return 'CSI';
  if (['StPause', 'CYCLE_STATE_PAUSE'].includes(cycle)) return 'P';
  const status = STATUS_MAP[state.state] || STATUS_MAP[state.displayCode]
    || STATUS_MAP[state.statusIndicator?.type] || STATUS_MAP[state.robotStatus]
    || STATUS_MAP[state.status] || 'UNKNOWN';
  return status === 'RDY' && state.isDrawerFull === true ? 'DFS' : status;
}

function percent(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

function getCapabilities(robot, { now = new Date(), translate = (key) => key } = {}) {
  const state = robot.state || {};
  const status = deriveStatusCode(state);
  const panel = robot.panelSettings || {};
  const light = robot.nightLightSettings || {};
  const settings = robot.litterRobotSettings || {};
  const brightness = percent(light.brightness);
  const faults = getFaults(robot);
  const hopper = getHopper(robot);
  const schedule = getScheduleInfo(robot, now);
  const maintenance = getMaintenance(robot, now);
  return {
    alarm_problem: faults === null ? null : faults.length > 0,
    lr5_fault_details: faults === null ? null
      : faults.map((code) => translate(`lr5.faults.${code}`)).join(', ') || translate('lr5.no_faults'),
    sleep_mode_enabled: schedule?.enabled,
    alarm_sleep_mode_scheduled: schedule?.scheduledToday,
    sleep_mode_start_time: schedule?.start || translate('state.not_set'),
    sleep_mode_end_time: schedule?.end || translate('state.not_set'),
    alarm_lr5_filter_due: maintenance?.due,
    measure_lr5_filter_days_remaining: maintenance?.days,
    lr5_filter_replacement_date: maintenance?.date || translate('state.not_set'),
    litter_hopper_status: hopper.status,
    lr5_hopper_enabled: hopper.enabled,
    alarm_litter_hopper_empty: hopper.empty,
    alarm_lr5_hopper_low: hopper.low,
    onoff: typeof state.powerStatus === 'string' ? state.powerStatus === 'On' : null,
    litter_robot_status: status,
    clean_cycle_status: CYCLE_CODES.includes(status) ? status : 'UNKNOWN',
    alarm_cat_detected: ['UNKNOWN', 'OFFLINE'].includes(status) ? null : ['CD', 'CSI'].includes(status),
    alarm_waste_drawer_full: typeof state.isDrawerFull === 'boolean' ? state.isDrawerFull : null,
    alarm_connectivity: typeof state.isOnline === 'boolean' ? !state.isOnline : null,
    alarm_sleep_mode_active: typeof state.isSleeping === 'boolean' ? state.isSleeping : null,
    measure_litter_level_percentage: percent(state.litterLevelPercent),
    measure_waste_drawer_level_percentage: percent(state.dfiLevelPercent),
    measure_odometer_clean_cycles: state.odometerCleanCycles,
    measure_scoops_saved_count: state.scoopsSaved,
    measure_weight: typeof state.weightSensor === 'number' && state.weightSensor > 0
      ? convertLbsToGrams(state.weightSensor / 100) : null,
    clean_cycle_wait_time: settings.cycleDelay == null ? null : String(settings.cycleDelay),
    key_pad_lock_out: panel.isKeypadLocked,
    panel_brightness: ['Low', 'Medium', 'High'].includes(panel.displayIntensity)
      ? panel.displayIntensity.toLowerCase() : null,
    night_light_mode: ['On', 'Off', 'Auto'].includes(light.mode) ? light.mode.toLowerCase() : null,
    'dim.night_light': brightness === null ? null : brightness / 100,
  };
}

module.exports = {
  deriveStatusCode, getCapabilities, CYCLE_CODES, STATUS_CODES,
};
