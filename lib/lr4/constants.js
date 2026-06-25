/**
 * LR4 GraphQL-aligned enums and UI/command maps shared by device formatting and session code.
 * Values mirror Whisker API enums so robot payloads compare reliably without string drift.
 */

/** Sleep Status Enum — GraphQL SleepStatusEnum */
const SleepStatus = Object.freeze({
  NONE: 'NONE',
  WAKE: 'WAKE',
  SLEEPING: 'SLEEPING',
});

/** Hopper Status Enum — GraphQL HopperStatusEnum */
const HopperStatus = Object.freeze({
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
  MOTOR_FAULT_SHORT: 'MOTOR_FAULT_SHORT',
  MOTOR_OT_AMPS: 'MOTOR_OT_AMPS',
  MOTOR_DISCONNECTED: 'MOTOR_DISCONNECTED',
  EMPTY: 'EMPTY',
});

/** Canonical weekday labels aligned with `Date#getDay()` (0 = Sunday). */
const DAYS_OF_WEEK = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

/** Maps hopper status codes to short letter codes for consistent status reporting */
const HOPPER_STATUS_MAP = Object.freeze({
  ENABLED: 'HE',
  DISABLED: 'HD',
  MOTOR_FAULT_SHORT: 'HMS',
  MOTOR_OT_AMPS: 'HMO',
  MOTOR_DISCONNECTED: 'HMD',
  EMPTY: 'HEM',
});

/** Stable ids for litter_robot_status Flow autocomplete filtering (includes hopper codes). */
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
  'DF3',
  'DFS',
  'DHF',
  'DPF',
  'EC',
  'HD',
  'HE',
  'HEM',
  'HMD',
  'HMO',
  'HMS',
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

/** LR4 enum ids for the clean_cycle_status capability (`robotCycleStatus` / `robotStatus`). */
const CleanCycleStatusCodes = Object.freeze([
  'ROBOT_CAT_DETECT_DELAY',
  'CYCLE_PENDING',
  'CYCLE_DUMP',
  'CYCLE_DFI',
  'CYCLE_LEVEL',
  'CYCLE_HOME',
  'CYCLE_IDLE',
  'CYCLE_CAT_RELEASE',
  'CYCLE_CAT_REL_DFI',
  'CYCLE_CAT_REL_LEVEL',
  'CYCLE_EMPTY',
  'CYCLE_EMPTY_HOME',
  'CYCLE_EMPTY_ABORT',
  'CYCLE_FIND_DUMP',
  'CYCLE_COMPLETE',
  'CYCLE_CHANGE_FILTER',
  'CYCLE_CHANGE_FILTER2',
]);

/** Enum id used when no clean-cycle code applies. */
const CLEAN_CYCLE_UNKNOWN = 'UNKNOWN';

/** Hopper statuses that should raise alarm_problem (checked separately from deriveStatusCode). */
const HopperProblemStatuses = Object.freeze([
  HopperStatus.MOTOR_FAULT_SHORT,
  HopperStatus.MOTOR_OT_AMPS,
  HopperStatus.MOTOR_DISCONNECTED,
  HopperStatus.EMPTY,
]);

/** Fault codes that should raise alarm_problem when returned by deriveStatusCode. */
const ProblemCodes = Object.freeze([
  'PD',
  'PPD',
  'PF',
  'PFR',
  'SPF',
  'MTR',
  'MTRB',
  'MTRH',
  'OTF',
  'OTFTO',
  'DPF',
  'HPF',
  'DHF',
  'CSF',
  'SCF',
  'LSD',
  'USB',
]);

/** Internal command names mapped to API endpoint commands */
const Commands = Object.freeze({
  CLEAN_CYCLE: 'cleanCycle',
  EMPTY_CYCLE: 'emptyCycle',
  KEY_PAD_LOCK_OUT_OFF: 'keyPadLockOutOff',
  KEY_PAD_LOCK_OUT_ON: 'keyPadLockOutOn',
  NIGHT_LIGHT_MODE_AUTO: 'nightLightModeAuto',
  NIGHT_LIGHT_MODE_OFF: 'nightLightModeOff',
  NIGHT_LIGHT_MODE_ON: 'nightLightModeOn',
  PANEL_BRIGHTNESS_LOW: 'panelBrightnessLow',
  PANEL_BRIGHTNESS_MEDIUM: 'panelBrightnessMed',
  PANEL_BRIGHTNESS_HIGH: 'panelBrightnessHigh',
  POWER_OFF: 'powerOff',
  POWER_ON: 'powerOn',
  REQUEST_STATE: 'requestState',
  SET_CLUMP_TIME: 'setClumpTime',
  SET_NIGHT_LIGHT_VALUE: 'setNightLightValue',
  SHORT_RESET_PRESS: 'shortResetPress',
  ENABLE_HOPPER: 'enableHopper',
  DISABLE_HOPPER: 'disableHopper',
});

/**
 * Indents a multi-line GraphQL selection for embedding under `operation { field(serial) { ... } }`.
 *
 * @param {string} body - Unindented field block (relative nesting only)
 * @param {number} spaces - Leading spaces for the shallowest field lines
 * @returns {string}
 */
function padGraphQLSelection(body, spaces) {
  const pad = ' '.repeat(spaces);
  return body
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

/**
 * Shared `LitterRobot4` field selection for realtime subscription and HTTP snapshot query.
 * Keep this aligned with the LR4 AppSync schema so both paths return comparable payloads.
 */
const LR4_LITTER_ROBOT4_STATE_SELECTION = `
unitId
name
serial
userId
espFirmware
picFirmwareVersion
picFirmwareVersionHex
laserBoardFirmwareVersion
laserBoardFirmwareVersionHex
wifiRssi
unitPowerType
catWeight
displayCode
unitTimezone
unitTime
cleanCycleWaitTime
isKeypadLockout
nightLightMode
nightLightBrightness
isPanelSleepMode
panelSleepTime
panelWakeTime
unitPowerStatus
sleepStatus
robotStatus
globeMotorFaultStatus
pinchStatus
catDetect
isBonnetRemoved
isNightLightLEDOn
odometerPowerCycles
odometerCleanCycles
panelBrightnessHigh
panelBrightnessLow
smartWeightEnabled
odometerEmptyCycles
odometerFilterCycles
isDFIResetPending
DFINumberOfCycles
DFILevelPercent
isDFIFull
DFIFullCounter
DFITriggerCount
litterLevel
DFILevelMM
isCatDetectPending
globeMotorRetractFaultStatus
robotCycleStatus
robotCycleState
weightSensor
isOnline
isOnboarded
isProvisioned
isDebugModeActive
lastSeen
sessionId
setupDateTime
isFirmwareUpdateTriggered
firmwareUpdateStatus
wifiModeStatus
isUSBPowerOn
USBFaultStatus
isDFIPartialFull
isLaserDirty
surfaceType
scoopsSavedCount
optimalLitterLevel
litterLevelPercentage
litterLevelState
weekdaySleepModeEnabled {
  Sunday {
    sleepTime
    wakeTime
    isEnabled
  }
  Monday {
    sleepTime
    wakeTime
    isEnabled
  }
  Tuesday {
    sleepTime
    wakeTime
    isEnabled
  }
  Wednesday {
    sleepTime
    wakeTime
    isEnabled
  }
  Thursday {
    sleepTime
    wakeTime
    isEnabled
  }
  Friday {
    sleepTime
    wakeTime
    isEnabled
  }
  Saturday {
    sleepTime
    wakeTime
    isEnabled
  }
}
hopperStatus
isHopperRemoved
`.trim();

/** LR4 GraphQL HTTP endpoint. */
const LR4_GRAPHQL_ENDPOINT = 'https://lr4.iothings.site/graphql';

/** LR4 GraphQL WebSocket endpoint (AppSync realtime). */
const LR4_WS_ENDPOINT = 'wss://lr4.iothings.site/graphql';

/** Hostname for LR4 WS auth headers; kept aligned with {@link LR4_WS_ENDPOINT}. */
const LR4_WS_HOST = new URL(LR4_WS_ENDPOINT).host;

/** GraphQL query document for listing LR4 robots by user id (`getRobots`). */
const LR4_GET_ROBOTS_BY_USER_QUERY = `
query GetLR4($userId: String!) {
  getLitterRobot4ByUser(userId: $userId) {
    id: unitId, serial: serial, nickname: name, status: robotStatus,
    lastSeen, hopperStatus, isHopperRemoved
  }
}
`.trim();

/** GraphQL mutation document for dispatching an LR4 command (`sendCommand`). */
const LR4_SEND_COMMAND_MUTATION = `
mutation sendCommand($serial: String!, $command: String!, $value: String) {
  sendLitterRobot4Command(input: {
    serial: $serial,
    command: $command,
    value: $value
  })
}
`.trim();

/** GraphQL subscription document for per-user LR4 state over the realtime WebSocket (`graphql-ws`). */
const LR4_USER_STATE_SUBSCRIPTION = `
subscription litterRobot4StateSubscriptionByUser($userId: String!) {
  litterRobot4StateSubscriptionByUser(userId: $userId) {
    userId
    robotCount
    robots {
${padGraphQLSelection(LR4_LITTER_ROBOT4_STATE_SELECTION, 6)}
    }
  }
}
`.trim();

/** GraphQL query document for a one-shot LR4 state snapshot (`getLR4State`). */
const LR4_GET_STATE_BY_SERIAL_QUERY = `
query GetLitterRobot4BySerial($serial: String!) {
  getLitterRobot4BySerial(serial: $serial) {
${padGraphQLSelection(LR4_LITTER_ROBOT4_STATE_SELECTION, 4)}
  }
}
`.trim();

module.exports = {
  CLEAN_CYCLE_UNKNOWN,
  CleanCycleStatusCodes,
  Commands,
  SleepStatus,
  HopperProblemStatuses,
  HopperStatus,
  LitterRobotStatusCodes,
  ProblemCodes,
  HOPPER_STATUS_MAP,
  DAYS_OF_WEEK,
  LR4_GRAPHQL_ENDPOINT,
  LR4_WS_ENDPOINT,
  LR4_WS_HOST,
  LR4_GET_ROBOTS_BY_USER_QUERY,
  LR4_SEND_COMMAND_MUTATION,
  LR4_USER_STATE_SUBSCRIPTION,
  LR4_GET_STATE_BY_SERIAL_QUERY,
};
