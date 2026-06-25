/**
 * LR4 GraphQL client. Transport, retry, and token refresh live on {@link module:session}.
 */
const { WhiskerTokenException } = require('../common/exceptions');
const {
  LR4_GRAPHQL_ENDPOINT,
  LR4_GET_ROBOTS_BY_USER_QUERY,
  LR4_GET_STATE_BY_SERIAL_QUERY,
  LR4_SEND_COMMAND_MUTATION,
} = require('./constants');

/**
 * Fetches LR4 devices for a user via GraphQL.
 * @param {import('../session')} session
 * @param {string} userId
 * @returns {Promise<Array<Object>>}
 */
async function getRobots(session, userId) {
  if (!userId) {
    throw new WhiskerTokenException('Unable to get user ID from token');
  }

  const response = await session._makeGraphQLRequest(LR4_GRAPHQL_ENDPOINT, {
    query: LR4_GET_ROBOTS_BY_USER_QUERY,
    variables: { userId },
  }, 'LR4');

  if (!response?.data?.getLitterRobot4ByUser) {
    session.homey.log('[Session] Found 0 LR4 robots');
    return [];
  }

  const result = response.data.getLitterRobot4ByUser.map((robot) => ({
    ...robot,
    robotType: 'LR4',
  }));

  session.homey.log(`[Session] Found ${result.length} LR4 robots`);
  return result;
}

/**
 * Retrieves a full LR4 state snapshot by serial.
 * @param {import('../session')} session
 * @param {string} serial
 * @returns {Promise<Object|null>}
 */
async function getState(session, serial) {
  if (!serial) {
    throw new Error('Robot serial is required');
  }

  const response = await session._makeGraphQLRequest(LR4_GRAPHQL_ENDPOINT, {
    query: LR4_GET_STATE_BY_SERIAL_QUERY,
    variables: { serial },
  }, 'LR4');

  if (response?.errors?.length) {
    return null;
  }

  return response?.data?.getLitterRobot4BySerial || null;
}

/**
 * Sends a command to an LR4 device via GraphQL mutation.
 * @param {import('../session')} session
 * @param {string} robotSerial
 * @param {string} command
 * @param {Object|string|null} payload
 * @returns {Promise<Object>}
 */
async function sendCommand(session, robotSerial, command, payload) {
  let value = null;
  if (payload) {
    value = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
  }

  session.homey.log(`[Session] Sending LR4 command: ${command}${payload ? ' with payload' : ''}`);

  try {
    const response = await session._makeGraphQLRequest(LR4_GRAPHQL_ENDPOINT, {
      query: LR4_SEND_COMMAND_MUTATION,
      variables: {
        serial: robotSerial,
        command,
        value,
      },
    }, 'LR4');

    session.homey.log(`[Session] Successfully sent LR4 command: ${command}`);
    return response;
  } catch (err) {
    session.homey.error(`[Session] Failed to send LR4 command ${command}:`, err);
    throw err;
  }
}

module.exports = {
  getRobots,
  getState,
  sendCommand,
};
