const WebSocket = require('ws');
const lr4WebSocket = require('../lr4/websocket');
const lr3WebSocket = require('../lr3/websocket');

/**
 * WebSocket lifecycle helpers mixed into {@link Session}.
 * Device-specific connection setup lives in {@link module:lr4/websocket} and {@link module:lr3/websocket}.
 */
const websocketMethods = {
  /**
   * Skips keep-alive traffic in logs so realtime updates remain readable.
   *
   * @param {string} deviceId
   * @param {Object} message
   * @private
   */
  _logWebSocketMessage(deviceId, message) {
    const messageType = message.type || 'unknown';

    if (messageType === 'ka' || messageType === 'ping' || messageType === 'pong') {
      return;
    }

    const logHandlers = {
      data: () => {
        this.homey.log(`[Session] WebSocket data received for device ${deviceId}`);
      },
      connection_ack: () => {
        this.homey.log(`[Session] WebSocket connection acknowledged for device ${deviceId}`);
      },
      start_ack: () => {
        this.homey.log(`[Session] WebSocket subscription started for device ${deviceId}`);
      },
      error: () => {
        this.homey.error(`[Session] WebSocket error for device ${deviceId}:`, message);
      },
      MODIFY: () => {
        this.homey.log(`[Session] LR3 device state update received for device ${deviceId}`);
      },
      INSERT: () => {
        this.homey.log(`[Session] LR3 ${messageType} event received for device ${deviceId}`);
      },
      DELETE: () => {
        this.homey.log(`[Session] LR3 ${messageType} event received for device ${deviceId}`);
      },
    };

    const handler = logHandlers[messageType];
    if (handler) {
      handler();
    } else {
      this.homey.log(`[Session] WebSocket ${messageType} message for device ${deviceId}`);
    }
  },

  /**
   * Opens or reuses a product-specific WebSocket through the LR3/LR4 connection helpers.
   *
   * @param {string} deviceId
   * @param {Object} [options={}]
   * @returns {Promise<WebSocket>}
   */
  async createWebSocket(deviceId, options = {}) {
    const existing = this.websocketConnections.get(deviceId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      this.homey.log(`[Session] WebSocket connection already open for device ${deviceId}`);
      return existing;
    }

    const deviceType = options.deviceType || 'litter_robot_4';
    const wsHandlers = {
      litter_robot_4: (id, opts) => lr4WebSocket.createConnection(this, id, opts),
      litter_robot_3: (id, opts) => lr3WebSocket.createConnection(this, id, opts),
    };

    const handler = wsHandlers[deviceType];
    if (!handler) {
      throw new Error(`Unsupported device type for WebSocket: ${deviceType}`);
    }
    return handler(deviceId, options);
  },

  /**
   * Closes a device WebSocket and clears reconnect timers. Close errors are ignored when the
   * socket is already dead.
   *
   * @param {string} deviceId
   */
  closeWebSocket(deviceId) {
    if (lr4WebSocket.removeSubscriber(this, deviceId)) {
      const lr4State = this.connectionState.get(lr4WebSocket.USER_CONN_KEY);
      if (lr4State.subscribers.size > 0) {
        this.homey.log(`[Session] Removed LR4 subscriber ${deviceId} (${lr4State.subscribers.size} remaining)`);
        return;
      }
      deviceId = lr4WebSocket.USER_CONN_KEY;
    }

    const ws = this.websocketConnections.get(deviceId);
    if (ws) {
      this.homey.log(`[Session] Closing WebSocket connection for device ${deviceId}`);
      try {
        ws.close(1000, 'Device cleanup');
      } catch (_err) {
      }
      this.websocketConnections.delete(deviceId);
    }
    this._clearAllTimers(deviceId);
    const state = this.connectionState.get(deviceId);
    if (state?.subscribers) {
      state.subscribers.clear();
    }
    this.connectionState.delete(deviceId);
  },

  /**
   * Tears down every WebSocket during app shutdown. Close errors are ignored when sockets are
   * already dead.
   */
  closeAllWebSockets() {
    this.homey.log('[Session] Closing all WebSocket connections');
    for (const [deviceId, ws] of this.websocketConnections) {
      try {
        ws.close(1000, 'App shutdown');
      } catch (_err) {
      }
      this._clearAllTimers(deviceId);
    }
    for (const state of this.connectionState.values()) {
      if (state.subscribers) {
        state.subscribers.clear();
      }
    }
    this.websocketConnections.clear();
    this.connectionState.clear();
  },

  /**
   * @param {string} deviceId
   * @param {Object} [defaults={}]
   * @returns {Object}
   * @private
   */
  _createConnState(deviceId, defaults = {}) {
    let state = this.connectionState.get(deviceId);
    if (!state) {
      state = { reconnectAttempts: 0, ...defaults };
      this.connectionState.set(deviceId, state);
    }
    return state;
  },

  /**
   * @param {string} deviceId
   * @returns {Object|undefined}
   * @private
   */
  _getConnState(deviceId) {
    return this.connectionState.get(deviceId);
  },

  /**
   * @param {string} deviceId
   * @private
   */
  _clearReconnectTimer(deviceId) {
    const state = this.connectionState.get(deviceId);
    if (state?.reconnectTimer) {
      this.homey.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  },

  /**
   * @param {string} deviceId
   * @private
   */
  _clearHeartbeat(deviceId) {
    const state = this.connectionState.get(deviceId);
    if (state?.heartbeatTimer) {
      this.homey.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  },

  /**
   * @param {string} deviceId
   * @private
   */
  _clearAllTimers(deviceId) {
    this._clearReconnectTimer(deviceId);
    this._clearHeartbeat(deviceId);
  },

  /**
   * @param {number} attempt
   * @returns {number}
   * @private
   */
  _computeBackoffDelay(attempt) {
    const base = Math.min(30000, 1000 * (2 ** attempt));
    const jitter = Math.floor(Math.random() * 500);
    return base + jitter;
  },

  /**
   * Forces reconnect when no frames arrive within the idle window. Uses terminate because
   * reserved close codes such as 1006 are rejected by ws.close().
   *
   * @param {string} deviceId
   * @param {WebSocket} ws
   * @param {number} [idleMs=90000]
   * @param {number} [checkEveryMs=45000]
   * @private
   */
  _setupHeartbeat(deviceId, ws, idleMs = 90000, checkEveryMs = 45000) {
    const state = this._getConnState(deviceId);
    if (!state) return;
    state.lastMessageAt = Date.now();
    this._clearHeartbeat(deviceId);
    const displayId = state.logLabel || deviceId;
    this.homey.log(`[Session] Setting up heartbeat monitoring for ${displayId} (idle timeout: ${idleMs}ms, check interval: ${checkEveryMs}ms)`);
    state.heartbeatTimer = this.homey.setInterval(() => {
      const currentWs = this.websocketConnections.get(deviceId);
      if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
        this._clearHeartbeat(deviceId);
        return;
      }
      const now = Date.now();
      const timeSinceLastMessage = now - (state.lastMessageAt || 0);
      if (timeSinceLastMessage > idleMs) {
        this.homey.log(`[Session] Heartbeat stale for ${displayId} (${Math.round(timeSinceLastMessage / 1000)}s since last message), forcing reconnect`);
        try {
          currentWs.terminate();
        } catch (_err) {
        }
      }
    }, checkEveryMs);
  },

  /**
   * @param {string} deviceId
   * @private
   */
  async _scheduleReconnect(deviceId) {
    const state = this._getConnState(deviceId);
    if (!state) return;
    if (state.reconnectTimer) return;
    const delay = this._computeBackoffDelay(state.reconnectAttempts || 0);
    this.homey.log(`[Session] Scheduling WebSocket reconnect for device ${deviceId} `
      + `in ${Math.round(delay / 1000)}s (attempt ${(state.reconnectAttempts || 0) + 1})`);
    state.reconnectTimer = this.homey.setTimeout(async () => {
      if (!this.connectionState.has(deviceId)) return;
      const st = this._getConnState(deviceId);
      if (!st) return;
      st.reconnectTimer = null;
      st.reconnectAttempts = (st.reconnectAttempts || 0) + 1;
      try {
        if (!this.isSessionValid()) {
          await this.refreshSession();
        }
        if (deviceId === lr4WebSocket.USER_CONN_KEY) {
          await lr4WebSocket.createConnection(this, lr4WebSocket.USER_CONN_KEY, st.options || {});
        } else {
          await this.createWebSocket(deviceId, st.options || {});
        }
      } catch (err) {
        this.homey.error(`[Session] Reconnect attempt failed for device ${deviceId}:`, err);
        this._scheduleReconnect(deviceId);
      }
    }, delay);
  },
};

/**
 * Attaches WebSocket methods to the Session prototype.
 * @param {Function} SessionClass
 */
function applyWebSocketMethods(SessionClass) {
  Object.assign(SessionClass.prototype, websocketMethods);
}

module.exports = { applyWebSocketMethods };
