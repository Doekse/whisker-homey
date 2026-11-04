/** Read-only LR5 diagnostics. Unknown non-clear fault values are retained as faults. */
const HOPPER_CODES = {
  DISABLED: 'HD',
  ENABLED: 'HE',
  EMPTY: 'HEM',
  MOTOR_FAULT_SHORT: 'HMS',
  MOTOR_OT_AMPS: 'HMO',
  MOTOR_DISCONNECTED: 'HMD',
  READY: 'READY',
  LITTER_LOW: 'LITTER_LOW',
  JAMMED: 'JAMMED',
  OFFLINE: 'OFFLINE',
};
const HOPPER_CAPABILITIES = ['litter_hopper_status', 'alarm_litter_hopper_empty', 'alarm_lr5_hopper_low', 'lr5_hopper_enabled'];

function normalized(value) {
  return typeof value === 'string' ? value.replace(/[^a-z0-9]/gi, '').toUpperCase() : '';
}

function isFault(value) {
  if (value == null || value === false) return false;
  if (value === true) return true;
  const code = normalized(value);
  return !!code && !['NONE', 'CLEAR', 'FAULTCLEAR', 'MTRFAULTCLEAR', 'MOTORFAULTCLEAR', 'HOPPERFAULTCLEAR', 'PINCHCLEAR', 'PINCHFAULTCLEAR', 'NOFAULT', 'OFF', 'DISABLED'].includes(code);
}

function getHopper(robot) {
  const state = robot.state || {};
  const raw = state.hopperStatusIndicator?.value ?? state.hopperStatus;
  const status = typeof raw === 'string' ? raw.toUpperCase() : null;
  const installed = state.isHopperInstalled;
  const disabled = installed === false || status === 'DISABLED';
  const hasStatus = status !== null;
  let enabled = null;
  if (disabled) enabled = false;
  else if (HOPPER_CODES[status]) enabled = true;
  return {
    present: installed === true || (installed !== false && status !== null && status !== 'DISABLED'),
    status: installed === false ? 'NOT_INSTALLED' : HOPPER_CODES[status] || 'UNKNOWN',
    enabled,
    empty: hasStatus || installed === false ? installed !== false && status === 'EMPTY' : null,
    low: hasStatus || installed === false ? installed !== false && ['EMPTY', 'LITTER_LOW'].includes(status) : null,
    fault: installed !== false && (['JAMMED', 'MOTOR_FAULT_SHORT', 'MOTOR_OT_AMPS', 'MOTOR_DISCONNECTED', 'OFFLINE'].includes(status)
      || isFault(state.hopperFault)),
  };
}

function getFaults(robot) {
  const state = robot.state || {};
  if (state.isOnline === false) return null;
  const codes = [];
  const flags = {
    isBonnetRemoved: 'bonnet_removed',
    isDrawerRemoved: 'drawer_removed',
    isLaserDirty: 'laser_dirty',
    isUsbFaultDetected: 'usb_fault',
    isGasSensorFaultDetected: 'gas_sensor_fault',
  };
  for (const [field, code] of Object.entries(flags)) if (state[field] === true) codes.push(code);
  if (isFault(state.globeMotorFaultStatus)) codes.push('motor_fault');
  if (isFault(state.globeMotorRetractFaultStatus)) codes.push('retract_motor_fault');
  if (isFault(state.pinchStatus)) codes.push('pinch_fault');
  if (normalized(state.catDetect).includes('FAULT') && isFault(state.catDetect)) codes.push('cat_sensor_fault');
  if (getHopper(robot).fault) codes.push('hopper_fault');
  const hasSignals = Object.keys(flags).some((key) => typeof state[key] === 'boolean')
    || ['globeMotorFaultStatus', 'globeMotorRetractFaultStatus', 'pinchStatus', 'catDetect', 'hopperFault'].some((key) => key in state);
  return hasSignals ? codes : null;
}

module.exports = { getHopper, getFaults, HOPPER_CAPABILITIES };
