const WebSocket = require('ws');
const { encodeBase64, safeStringify, safeParse } = require('../common/utils');
const { WhiskerTokenException } = require('../common/exceptions');
const { LR4_USER_STATE_SUBSCRIPTION, LR4_WS_ENDPOINT, LR4_WS_HOST } = require('./constants');

/** Shared connection map key for the per-user LR4 realtime subscription. */
const USER_CONN_KEY = '__lr4_user__';

/**
 * Removes an LR4 serial from the shared user subscription without closing the socket.
 * @param {import('../session')} session
 * @param {string} serial
 * @returns {boolean}
 */
function removeSubscriber(session, serial) {
  const lr4State = session.connectionState.get(USER_CONN_KEY);
  if (!lr4State?.subscribers?.has(serial)) {
    return false;
  }
  lr4State.subscribers.delete(serial);
  return true;
}

/**
 * Creates or reuses the per-user LR4 WebSocket and registers the caller serial as a subscriber.
 * Connection timeout rejections ignore close errors when the socket is already dead.
 *
 * @param {import('../session')} session
 * @param {string} deviceId - LR4 serial, or {@link USER_CONN_KEY} during reconnect
 * @param {Object} [options={}]
 * @returns {Promise<WebSocket>}
 */
async function createConnection(session, deviceId, options = {}) {
  const connKey = USER_CONN_KEY;
  const subscriberSerial = deviceId !== connKey ? (options.serial || deviceId) : null;
  const logLabel = subscriberSerial || 'LR4 user stream';

  let state = session._getConnState(connKey);
  if (!state) {
    state = session._createConnState(connKey, { subscribers: new Set() });
  }
  if (subscriberSerial) {
    state.subscribers.add(subscriberSerial);
  }

  const userId = session.getUserId() || state.userId;
  if (!userId) {
    throw new WhiskerTokenException('Missing user ID for LR4 WebSocket connection');
  }
  state.userId = userId;
  state.options = { ...options, deviceType: 'litter_robot_4' };

  const existingWs = session.websocketConnections.get(connKey);
  if (existingWs && existingWs.readyState === WebSocket.OPEN) {
    session.homey.log(`[Session] Reusing LR4 user WebSocket (${state.subscribers.size} subscriber(s))`);
    return existingWs;
  }
  if (state.connectPromise) {
    return state.connectPromise;
  }

  if (!session.isSessionValid()) {
    await session.refreshSession();
  }
  const tokens = session.getTokens();
  if (!tokens?.id_token) {
    throw new WhiskerTokenException('Missing ID token for LR4 WebSocket connection');
  }
  const idToken = tokens.id_token;

  const params = {
    header: encodeBase64(safeStringify({
      Authorization: `Bearer ${idToken}`,
      host: LR4_WS_HOST,
    }, 0, session._logUtilErr), session._logUtilErr),
    payload: encodeBase64(safeStringify({}, 0, session._logUtilErr), session._logUtilErr),
  };

  const urlObj = new URL(`${LR4_WS_ENDPOINT}/realtime`);
  Object.entries(params).forEach(([key, value]) => urlObj.searchParams.append(key, value));
  const fullWsUrl = urlObj.toString();

  session.homey.log(`[Session] Creating LR4 user WebSocket (${state.subscribers.size} subscriber(s))`);

  state.connectPromise = new Promise((resolve, reject) => {
    const ws = new WebSocket(fullWsUrl, 'graphql-ws', { headers: { 'sec-websocket-protocol': 'graphql-ws' } });

    let connectionTimeout = null;

    const finishConnect = (resultWs) => {
      state.connectPromise = null;
      resolve(resultWs);
    };

    const failConnect = (err) => {
      state.connectPromise = null;
      reject(err);
    };

    ws.on('open', () => {
      session.homey.log('[Session] LR4 user WebSocket connected');
      ws.send(safeStringify({ type: 'connection_init', payload: {} }, 0, session._logUtilErr));
    });

    ws.on('message', (data) => {
      const st = session._getConnState(connKey);
      if (st) st.lastMessageAt = Date.now();

      try {
        const json = safeParse(data, session._logUtilErr);
        if (!json) {
          return;
        }
        if (json.type !== 'ka') {
          session._logWebSocketMessage(logLabel, json);
        }

        switch (json.type) {
          case 'connection_ack':
            if (!st) break;
            session.homey.log('[Session] LR4 user WebSocket acknowledged, starting by-user subscription');
            if (connectionTimeout) {
              session.homey.clearTimeout(connectionTimeout);
              connectionTimeout = null;
            }
            session.websocketConnections.set(connKey, ws);
            st.reconnectAttempts = 0;
            st.logLabel = 'LR4 user WebSocket';
            session._setupHeartbeat(connKey, ws);
            session.homey.log(`[Session] LR4 WebSocket connected for ${logLabel}`);

            ws.send(safeStringify({
              id: '1',
              type: 'start',
              payload: {
                data: safeStringify({
                  query: LR4_USER_STATE_SUBSCRIPTION,
                  variables: { userId: st.userId || userId },
                }, 0, session._logUtilErr),
                extensions: {
                  authorization: {
                    Authorization: `Bearer ${idToken}`,
                    host: LR4_WS_HOST,
                  },
                },
              },
            }, 0, session._logUtilErr));
            finishConnect(ws);
            break;

          case 'data': {
            const userPayload = json.payload?.data?.litterRobot4StateSubscriptionByUser;
            if (userPayload) {
              for (const robot of userPayload.robots ?? []) {
                if (!robot?.serial) continue;
                session.homey.log(`[Session] LR4 WebSocket data for device ${robot.serial}:`, JSON.stringify(robot, null, 2));
                session._dispatchData(robot.serial, robot);
              }
            }
            break;
          }

          case 'error':
            session.homey.error('[Session] LR4 user WebSocket subscription error:', json.payload);
            break;

          case 'start_ack':
            break;

          case 'ka':
            break;

          default:
            session.homey.log(`[Session] Received unknown WebSocket message type: ${json.type}`);
            break;
        }
      } catch (error) {
        session.homey.error('[Session] Failed to handle LR4 user WebSocket message:', error);
      }
    });

    const onSocketFailure = (where, errOrCode, reason) => {
      session.homey.log(`[Session] LR4 user WebSocket ${where}${reason ? `: ${reason}` : ''}`, errOrCode || '');
      session.websocketConnections.delete(connKey);
      session._clearHeartbeat(connKey);
      session.homey.log(`[Session] LR4 WebSocket disconnected for ${logLabel}: ${reason || where}`);
    };

    ws.on('error', (error) => {
      onSocketFailure('error', error);
      session._scheduleReconnect(connKey);
    });

    ws.on('close', (code, reason) => {
      onSocketFailure(`closed (${code})`, null, reason || 'connection_closed');
      const connState = session.connectionState.get(connKey);
      if (connState) {
        session._scheduleReconnect(connKey);
      } else {
        session.homey.log('[Session] LR4 user WebSocket was manually closed, skipping reconnect');
      }
    });

    connectionTimeout = session.homey.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN && !session.websocketConnections.has(connKey)) {
        try {
          ws.close(1000, 'Connection timeout');
        } catch (_err) {
        }
        session.homey.log(`[Session] LR4 WebSocket disconnected for ${logLabel}: connection_timeout`);
        failConnect(new Error('LR4 WebSocket connection timeout'));
      }
      connectionTimeout = null;
    }, session.timeout);
  });

  return state.connectPromise;
}

module.exports = {
  USER_CONN_KEY,
  createConnection,
  removeSubscriber,
};
