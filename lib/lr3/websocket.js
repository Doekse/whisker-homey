const WebSocket = require('ws');
const { safeParse } = require('../common/utils');
const { WhiskerTokenException } = require('../common/exceptions');
const { LR3_WS_ENDPOINT } = require('./constants');

/**
 * Opens an LR3 realtime socket authenticated with the Cognito id token.
 * Connection timeout rejections ignore close errors when the socket is already dead.
 *
 * @param {import('../session')} session
 * @param {string} deviceId
 * @param {Object} [options={}]
 * @returns {Promise<WebSocket>}
 */
async function createConnection(session, deviceId, options = {}) {
  const serial = options.serial || deviceId;
  const state = session._createConnState(deviceId, { serial });
  state.options = { ...options, serial };

  if (!session.isSessionValid()) {
    await session.refreshSession();
  }
  const tokens = session.getTokens();
  if (!tokens?.id_token) {
    throw new WhiskerTokenException('Missing ID token for LR3 WebSocket connection');
  }
  const idToken = tokens.id_token;

  session.homey.log(`[Session] Creating LR3 WebSocket connection for device ${deviceId}`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(LR3_WS_ENDPOINT, {
      headers: { authorization: `Bearer ${idToken}` },
    });

    let connectionTimeout = null;

    ws.on('open', () => {
      session.homey.log(`[Session] LR3 WebSocket connected for device ${deviceId}`);
      if (connectionTimeout) {
        session.homey.clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
      session.websocketConnections.set(deviceId, ws);
      state.reconnectAttempts = 0;

      ws.send(JSON.stringify({ action: 'ping' }));
      resolve(ws);
    });

    ws.on('message', (data) => {
      const st = session._getConnState(deviceId);
      if (st) st.lastMessageAt = Date.now();

      try {
        const json = safeParse(data, session._logUtilErr);
        if (!json) {
          return;
        }
        session._logWebSocketMessage(deviceId, json);

        session._dispatchData(deviceId, json);
      } catch (error) {
        session.homey.error(`[Session] Failed to handle LR3 WebSocket message for device ${deviceId}:`, error);
      }
    });

    const onSocketFailure = (where, errOrCode, reason) => {
      session.homey.log(`[Session] LR3 WebSocket ${where} for device ${deviceId}${reason ? `: ${reason}` : ''}`, errOrCode || '');
      session.websocketConnections.delete(deviceId);
      session.homey.log(`[Session] LR3 WebSocket disconnected for device ${deviceId}: ${reason || where}`);
    };

    ws.on('error', (error) => {
      onSocketFailure('error', error);
      session._scheduleReconnect(deviceId);
    });

    ws.on('close', (code, reason) => {
      onSocketFailure(`closed (${code})`, null, reason || 'connection_closed');
      const connState = session.connectionState.get(deviceId);
      if (connState) {
        session._scheduleReconnect(deviceId);
      } else {
        session.homey.log(`[Session] Connection ${deviceId} was manually closed, skipping reconnect`);
      }
    });

    connectionTimeout = session.homey.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN && !session.websocketConnections.has(deviceId)) {
        try {
          ws.close(1000, 'Connection timeout');
        } catch (_err) {
        }
        session.homey.log(`[Session] LR3 WebSocket disconnected for device ${deviceId}: connection_timeout`);
        reject(new Error('LR3 WebSocket connection timeout'));
      }
      connectionTimeout = null;
    }, session.timeout);
  });
}

module.exports = { createConnection };
