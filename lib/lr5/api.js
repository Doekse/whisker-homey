/** LR5 REST protocol, based on natekspencer/pylitterbot (MIT). */
const { WhiskerApiException } = require('../common/exceptions');

const ENDPOINT = 'https://ub.prod.iothings.site';
const COMMANDS = new Set(['CLEAN_CYCLE', 'POWER_ON', 'POWER_OFF', 'REMOTE_RESET', 'RESET_WASTE_LEVEL', 'CHANGE_FILTER']);

function robotPath(serial) {
  if (!serial) throw new Error('Robot serial is required');
  return `${ENDPOINT}/robots/${encodeURIComponent(serial)}`;
}

async function getRobots(session) {
  const robots = await session._makeRestRequest('GET', `${ENDPOINT}/robots`, { apiType: 'LR5' });
  if (!Array.isArray(robots)) throw new WhiskerApiException(session.homey.__('errors.invalid_api_response'));
  return robots.filter((robot) => robot && ['LR5', 'LR5_PRO'].includes(robot.type) && robot.serial);
}

async function getState(session, serial) {
  const robot = await session._makeRestRequest('GET', robotPath(serial), { apiType: 'LR5' });
  if (!robot || robot.serial !== serial || !robot.state || typeof robot.state !== 'object') {
    throw new WhiskerApiException(session.homey.__('errors.invalid_api_response'));
  }
  return robot;
}

/** The API can ignore type filters; callers must filter mixed events locally. */
async function getActivities(session, serial, { limit = 100, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw new Error('Invalid activity page');
  }
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const activities = await session._makeRestRequest('GET', `${robotPath(serial)}/activities?${query}`, { apiType: 'LR5' });
  if (!Array.isArray(activities)) throw new WhiskerApiException(session.homey.__('errors.invalid_api_response'));
  return activities;
}

async function sendCommand(session, serial, command) {
  if (!COMMANDS.has(command)) throw new Error(`Unsupported LR5 command: ${command}`);
  return session._makeRestRequest('POST', `${robotPath(serial)}/commands`, {
    body: { type: command }, apiType: 'LR5', parseJson: false, maxRetries: 0,
  });
}

async function setSettings(session, serial, settings) {
  return session._makeRestRequest('PATCH', robotPath(serial), {
    body: settings, apiType: 'LR5', parseJson: false, maxRetries: 0,
  });
}

module.exports = {
  getRobots, getState, getActivities, sendCommand, setSettings,
};
