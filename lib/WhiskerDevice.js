const Homey = require('homey');
/**
 * Shared Homey device helpers for flow triggers, capability deduplication, and app polling registration.
 */
module.exports = class WhiskerDevice extends Homey.Device {

  /**
   * Called when the app session becomes valid; subclasses connect to Whisker APIs here.
   *
   * @returns {Promise<void>}
   */
  async onSessionReady() {
    throw new Error(`${this.constructor.name} must implement onSessionReady()`);
  }

  /**
   * Triggers device flow cards without blocking the caller on Flow engine errors.
   *
   * @param {string} cardId
   * @param {Object} [tokens]
   * @param {Object} [state]
   */
  _triggerFlowCard(cardId, tokens = {}, state = {}) {
    this.log(`[Flow] Triggering [${cardId}]`);
    this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens, state)
      .catch((err) => this.error(`Failed to trigger ${cardId}:`, err));
  }

  /**
   * Skips redundant Homey capability writes to avoid unnecessary Flow triggers.
   *
   * @param {string} capability
   * @param {unknown} value
   * @returns {Promise<boolean>} Whether the capability value was updated
   */
  async _setCapability(capability, value) {
    if (value === null || value === undefined) {
      return false;
    }
    if (value === this.getCapabilityValue(capability)) {
      return false;
    }

    await this.setCapabilityValue(capability, value)
      .catch((err) => this.error(`[Capability] Failed to update capability ${capability}:`, err));
    return true;
  }

  /**
   * Registers this device with app-level polling for a shared poll group.
   *
   * @param {string} pollKey
   * @param {Object} options - Passed to `Polling.registerPolling`
   */
  _registerForPolling(pollKey, options) {
    const { polling } = this.homey.app;
    if (!polling) {
      throw new Error(this.homey.__('errors.session_unavailable'));
    }
    polling.registerPolling(pollKey, this.getData().id, options);
  }

  /**
   * Unregisters this device from app-level polling.
   *
   * @param {string} pollKey
   */
  _unregisterFromPolling(pollKey) {
    const { polling } = this.homey.app;
    if (!polling) {
      return;
    }
    polling.unregisterPolling(pollKey, this.getData().id);
  }
};
