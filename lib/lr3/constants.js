/**
 * LR3 REST/API enums, command letters, and display maps shared by device formatting and commands.
 * Values align with the LR3 cloud payload fields (`unitStatus`, `powerStatus`, etc.).
 */

/** LR3 REST API base URL. */
const LR3_REST_BASE = 'https://v2.api.whisker.iothings.site';

/** LR3 realtime WebSocket endpoint. */
const LR3_WS_ENDPOINT = 'https://8s1fz54a82.execute-api.us-east-1.amazonaws.com/prod';

/** Default tuning values aligned with legacy LitterRobot3Data defaults */
const Defaults = Object.freeze({
  DEFAULT_WASTE_DRAWER_THRESHOLD: 80,
  MINIMUM_CYCLES_LEFT_DEFAULT: 3,
  CYCLE_CAPACITY_DEFAULT: 30,
  VALID_WAIT_TIMES: Object.freeze([3, 7, 15]),
  SLEEP_DURATION_HOURS: 8,
});

/** LR3 single-letter commands and dispatch metadata */
const Commands = Object.freeze({
  CLEAN: 'C',
  DEFAULT_SETTINGS: 'D',
  LOCK_OFF: 'L0',
  LOCK_ON: 'L1',
  NIGHT_LIGHT_OFF: 'N0',
  NIGHT_LIGHT_ON: 'N1',
  POWER_OFF: 'P0',
  POWER_ON: 'P1',
  WAIT_TIME: 'W',
  PREFIX: '<',
  ENDPOINT: 'dispatch-commands',
});

/** Stable ids for litter_robot_status Flow autocomplete filtering (LR3 subset). */
const LitterRobotStatusCodes = Object.freeze([
  'BR',
  'CCC',
  'CCP',
  'CD',
  'CSF',
  'CSI',
  'CST',
  'DF1',
  'DF2',
  'DFS',
  'DHF',
  'DPF',
  'EC',
  'HPF',
  'OFF',
  'OFFLINE',
  'OTF',
  'P',
  'PD',
  'PPD',
  'PWRD',
  'PWRU',
  'RDY',
  'SCF',
  'SDF',
  'SPF',
  'UNKNOWN',
]);

/** LR3 enum ids for the clean_cycle_status capability (subset of `unitStatus`). */
const CleanCycleStatusCodes = Object.freeze([
  'CST',
  'CCP',
  'CCC',
  'EC',
  'P',
  'RDY',
]);

/** Enum id used when no clean-cycle code applies. */
const CLEAN_CYCLE_UNKNOWN = 'UNKNOWN';

/** Fault codes that should raise alarm_problem when returned by deriveStatusCode. */
const ProblemCodes = Object.freeze([
  'PD',
  'PPD',
  'PF',
  'PFR',
  'MTR',
  'MTRB',
  'MTRH',
  'OTF',
  'OTFTO',
  'CSF',
  'SCF',
  'DPF',
  'HPF',
  'DHF',
]);

module.exports = {
  CLEAN_CYCLE_UNKNOWN,
  CleanCycleStatusCodes,
  Commands,
  Defaults,
  LR3_REST_BASE,
  LR3_WS_ENDPOINT,
  LitterRobotStatusCodes,
  ProblemCodes,
};
