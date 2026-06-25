/**
 * LR3 REST client. Transport, retry, and token refresh live on {@link module:session}.
 */
const { WhiskerTokenException } = require('../common/exceptions');
const { LR3_REST_BASE, Commands } = require('./constants');

/**
 * Fetches a single LR3 robot by id.
 *
 * @param {import('../session')} session
 * @param {string} robotId
 * @returns {Promise<Object>}
 */
async function getRobot(session, robotId) {
  const userId = session.getUserId();
  if (!userId) {
    throw new WhiskerTokenException('Unable to get user ID from token');
  }
  if (!robotId) {
    throw new Error('Robot ID is required');
  }

  const endpoint = `${LR3_REST_BASE}/users/${userId}/robots/${robotId}`;
  const robot = await session._makeRestRequest('GET', endpoint, { label: `get LR3 robot ${robotId}` });

  return {
    ...robot,
    robotType: 'LR3',
  };
}

/**
 * Fetches LR3 devices for a user via REST API.
 * @param {import('../session')} session
 * @param {string} userId
 * @returns {Promise<Array<Object>>}
 */
async function getRobots(session, userId) {
  if (!userId) {
    throw new WhiskerTokenException('Unable to get user ID from token');
  }

  const endpoint = `${LR3_REST_BASE}/users/${userId}/robots`;
  const robots = await session._makeRestRequest('GET', endpoint, { label: 'get LR3 robots' });
  const result = robots.map((robot) => ({
    ...robot,
    robotType: 'LR3',
  }));

  session.homey.log(`[Session] Found ${result.length} LR3 robots`);
  return result;
}

/**
 * Sends a command to an LR3 device via REST API.
 * @param {import('../session')} session
 * @param {string} robotSerial
 * @param {string} command
 * @param {string} robotId
 * @returns {Promise<{ success: boolean }>}
 */
async function sendCommand(session, robotSerial, command, robotId) {
  session.homey.log(`[Session] Sending LR3 command: ${command}`);

  try {
    const userId = session.getUserId();
    if (!userId) {
      throw new Error('Unable to get user ID from token');
    }

    if (!robotId) {
      throw new Error('Robot ID is required for LR3 commands');
    }

    const endpoint = `${LR3_REST_BASE}/users/${userId}/robots/${robotId}/${Commands.ENDPOINT}`;

    await session._makeRestRequest('POST', endpoint, {
      body: { command: `${Commands.PREFIX}${command}` },
      label: `LR3 command ${command}`,
      parseJson: false,
    });

    session.homey.log(`[Session] Successfully sent LR3 command: ${command}`);
    return { success: true };
  } catch (err) {
    session.homey.error(`[Session] Failed to send LR3 command ${command}:`, err);
    throw err;
  }
}

/**
 * Updates LR3 robot settings via REST PATCH request.
 * @param {import('../session')} session
 * @param {string} robotId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
async function updateRobot(session, robotId, payload) {
  const userId = session.getUserId();
  if (!userId) {
    throw new Error('Unable to get user ID from token');
  }

  const endpoint = `${LR3_REST_BASE}/users/${userId}/robots/${robotId}`;

  return session._makeRestRequest('PATCH', endpoint, {
    body: payload,
    label: `update LR3 robot ${robotId}`,
  });
}

module.exports = {
  getRobots,
  getRobot,
  sendCommand,
  updateRobot,
};
