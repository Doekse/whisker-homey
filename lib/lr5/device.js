const WhiskerDevice = require('../WhiskerDevice');
const api = require('./api');
const { getCapabilities } = require('./state');
const { getFaults, getHopper, HOPPER_CAPABILITIES } = require('./diagnostics');
const { buildSleepSchedules } = require('./schedule');
const {
  reconcileVisits, summarizeVisits, fetchVisitHistory, formatVisitTime, RETENTION_MS,
} = require('./activities');
const DRIVER_CAPABILITIES = require('../../app.json').drivers.find((driver) => driver.id === 'litter-robot5').capabilities;
const { WhiskerNetworkException } = require('../common/exceptions');

const POLL_INTERVAL = 30000;

module.exports = class LitterRobot5Device extends WhiskerDevice {

  async onInit() {
    this._destroyed = false;
    if (!this.getData().id) {
      throw new Error(this.homey.__('errors.invalid_device_data_missing_serial'));
    }
    // Existing test installations used the LR4 preset picker. Migrate to an exact slider.
    for (const capability of DRIVER_CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
    if (this.hasCapability('night_light_brightness')) await this.removeCapability('night_light_brightness');
    this._registerCapabilityListeners();
    await this._queueHistoryTask(() => this._pruneStoredHistory());
    try {
      await this.onSessionReady();
    } catch (err) {
      await this._markUnavailable(err);
    }
  }

  async onSessionReady() {
    if (this._destroyed) return;
    const session = await this.homey.app.getSession();
    if (this._destroyed) return;
    if (!session) throw new Error(this.homey.__('errors.session_unavailable'));
    const { polling } = this.homey.app;
    if (!polling) throw new Error(this.homey.__('errors.session_unavailable'));
    if (this._connection?.session === session && this._connection.polling === polling) {
      await this._connection.ready;
      return;
    }
    this._stopPolling();

    const connection = { session, polling };
    connection.ready = new Promise((resolve, reject) => {
      connection.resolve = resolve;
      connection.reject = reject;
    });
    this._connection = connection;
    // Registration schedules the first request. There is no parallel initial fetch.
    this._registerForPolling(this._pollKey(), {
      pollInterval: POLL_INTERVAL,
      pollFn: async (activeSession) => {
        try {
          const robot = await api.getState(activeSession, this.getData().id);
          return this._isCurrentConnection(connection) ? robot : null;
        } catch (err) {
          if (this._isCurrentConnection(connection)) {
            connection.reject(err);
            await this._markUnavailable(err);
          }
          throw err;
        }
      },
      onDataUpdate: async (robot) => {
        if (!robot || !this._isCurrentConnection(connection)) return;
        try {
          await this._queueSnapshot(robot, connection);
          connection.resolve();
          connection.ready = Promise.resolve();
        } catch (err) {
          if (this._isCurrentConnection(connection)) {
            connection.reject(err);
            await this._markUnavailable(err);
          }
          throw err;
        }
      },
    });
    await connection.ready;
  }

  _isCurrentConnection(connection) {
    return !this._destroyed && this._connection === connection;
  }

  _stopPolling() {
    const connection = this._connection;
    this._connection = null;
    if (!connection) return;
    connection.polling.unregisterPolling(this._pollKey(), this.getData().id);
    connection.polling.unregisterPolling(this._historyPollKey(), this.getData().id);
    // Release callers awaiting the first update if the device is removed or reconnected.
    connection.resolve();
  }

  async _markUnavailable(err) {
    this.error('LR5 update failed:', err);
    await this.setUnavailable(err instanceof WhiskerNetworkException
      ? this.homey.__('errors.network_unreachable') : err.message);
  }

  _pollKey() {
    return `lr5:${this.getData().id}`;
  }

  /** Preserve update order even when a replacement session overtakes an old response. */
  _queueSnapshot(robot, connection) {
    this._snapshotQueue = (this._snapshotQueue || Promise.resolve())
      .catch(() => undefined)
      .then(() => this._applySnapshot(robot, connection));
    return this._snapshotQueue;
  }

  async _applySnapshot(robot, connection = this._connection) {
    if (!this._isCurrentConnection(connection)) return;
    await this._syncHopperCapabilities(robot);
    if (!this._isCurrentConnection(connection)) return;
    const values = getCapabilities(robot, { translate: this.homey.__.bind(this.homey) });
    const previousCycles = this.getStoreValue('lr5_previous_clean_cycles');
    for (const [capability, value] of Object.entries(values)) {
      if (!this._isCurrentConnection(connection)) return;
      if (!this.hasCapability(capability)) continue;
      const previous = this.getCapabilityValue(capability);
      if (value === null || value === undefined || value === previous) continue;
      // Propagate write failures: do not emit a Flow for a value Homey rejected.
      await this.setCapabilityValue(capability, value);
      if (!this._isCurrentConnection(connection)) return;
      // Initial population must not fire historical status-change events.
      if (previous != null) {
        if (capability === 'litter_robot_status' || capability === 'clean_cycle_status') {
          this._triggerFlowCard(`${capability}_changed`, { [capability]: value });
        } else if (capability === 'lr5_fault_details') {
          this._triggerFlowCard('lr5_fault_changed', { faults: value, codes: (getFaults(robot) || []).join(', ') });
        } else if (capability === 'alarm_litter_hopper_empty') {
          this._triggerFlowCard(value ? 'litter_hopper_empty' : 'litter_hopper_not_empty');
        } else if (capability === 'alarm_lr5_filter_due' && value) {
          this._triggerFlowCard('lr5_filter_due');
        } else if (capability === 'alarm_lr5_hopper_low' && value) {
          this._triggerFlowCard('lr5_hopper_low');
        } else if (['alarm_cat_detected', 'alarm_waste_drawer_full', 'alarm_sleep_mode_active'].includes(capability)) {
          this._triggerFlowCard(`${capability}_${value}`);
        }
      }
    }
    if (!this._isCurrentConnection(connection)) return;
    const cycles = values.measure_odometer_clean_cycles;
    if (Number.isSafeInteger(cycles) && cycles >= 0) {
      if (cycles !== previousCycles) await this.setStoreValue('lr5_previous_clean_cycles', cycles);
      if (!this._isCurrentConnection(connection)) return;
      if (typeof previousCycles === 'number' && cycles > previousCycles) {
        this._triggerFlowCard('clean_cycle_finished', { total_clean_cycles: cycles });
        this._triggerFlowCard('clean_cycle_multiple', { total_cycles: cycles });
      }
    }
    if (!this._isCurrentConnection(connection)) return;
    this.robot = robot;
    await this.setAvailable();
    if (connection) this._startHistoryPolling(connection);
  }

  async _runCommand(command) {
    const session = await this.homey.app.getSession();
    if (!session) throw new Error(this.homey.__('errors.session_unavailable'));
    await api.sendCommand(session, this.getData().id, command);
    this.homey.app.polling.triggerDebouncedPoll(this._pollKey(), { debounceMs: 2000 });
  }

  _enqueueSettings(operation) {
    this._settingsQueue = (this._settingsQueue || Promise.resolve()).catch(() => undefined).then(operation);
    return this._settingsQueue;
  }

  _setRobotSettings(settings) {
    return this._enqueueSettings(async () => {
      const session = await this.homey.app.getSession();
      if (!session) throw new Error(this.homey.__('errors.session_unavailable'));
      await api.setSettings(session, this.getData().id, settings);
      this.homey.app.polling.triggerDebouncedPoll(this._pollKey(), { debounceMs: 2000 });
    });
  }

  setSleepSchedule(options) {
    return this._enqueueSettings(async () => {
      const session = await this.homey.app.getSession();
      if (!session) throw new Error(this.homey.__('errors.session_unavailable'));
      const robot = await api.getState(session, this.getData().id);
      let schedules;
      try {
        schedules = buildSleepSchedules(robot.sleepSchedules, options);
      } catch (err) {
        throw new Error(this.homey.__(err.message));
      }
      await api.setSettings(session, this.getData().id, { sleepSchedules: schedules });
      this.homey.app.polling.triggerDebouncedPoll(this._pollKey(), { debounceMs: 2000 });
    });
  }

  async _syncHopperCapabilities(robot) {
    if (!getHopper(robot).present) return;
    for (const capability of HOPPER_CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
  }

  _historyPollKey() {
    return `lr5-history:${this.getData().id}`;
  }

  _startHistoryPolling(connection, enabled = this.getSetting('lr5_history_enabled')) {
    if (!this._isCurrentConnection(connection) || connection.historyRegistered || connection.historyDisabled) return;
    if (enabled === false) {
      this._disableHistory(connection).catch(this.error.bind(this));
      return;
    }
    connection.historyRegistered = true;
    connection.historyGeneration = (connection.historyGeneration || 0) + 1;
    const generation = connection.historyGeneration;
    this._registerForPolling(this._historyPollKey(), {
      pollInterval: 60000,
      pollFn: async (session) => {
        try {
          const history = await fetchVisitHistory(session, this.getData().id, api);
          if (!this._isHistoryCurrent(connection, generation)) return null;
          let names = {};
          try {
            names = await this.homey.app.lr5.getPetNames(session);
          } catch (err) {
            this.error('Unable to refresh pet names for LR5 history:', err);
          }
          return this._isHistoryCurrent(connection, generation) ? { ...history, names } : null;
        } catch (err) {
          if (this._isHistoryCurrent(connection, generation)) {
            await this._queueHistoryTask(async () => {
              if (!this._isHistoryCurrent(connection, generation)) return;
              await this._pruneStoredHistory();
              await this._setHistoryStatus('unavailable');
              await this._publishPetSummary(false);
            });
          }
          throw err;
        }
      },
      onDataUpdate: async (history) => {
        if (!history || !this._isHistoryCurrent(connection, generation)) return;
        try {
          await this._queueHistoryTask(() => this._applyHistory(history, connection, generation));
        } catch (err) {
          if (this._isHistoryCurrent(connection, generation)) await this._setHistoryStatus('unavailable');
          throw err;
        }
      },
    });
  }

  _isHistoryCurrent(connection, generation) {
    return this._isCurrentConnection(connection) && connection.historyRegistered
      && connection.historyGeneration === generation;
  }

  _queueHistoryTask(operation) {
    this._historyQueue = (this._historyQueue || Promise.resolve()).catch(() => undefined).then(operation);
    return this._historyQueue;
  }

  async _pruneStoredHistory() {
    const state = this.getStoreValue('lr5_activity_state');
    if (state?.version !== 1 || !Array.isArray(state.visits)) return;
    const visits = state.visits.filter((visit) => visit && visit.timestamp >= Date.now() - RETENTION_MS);
    if (visits.length !== state.visits.length) await this.setStoreValue('lr5_activity_state', { ...state, visits });
  }

  async _disableHistory(connection) {
    connection.polling.unregisterPolling(this._historyPollKey(), this.getData().id);
    connection.historyRegistered = false;
    connection.historyDisabled = true;
    const generation = (connection.historyGeneration || 0) + 1;
    connection.historyGeneration = generation;
    await this._queueHistoryTask(async () => {
      if (!this._isCurrentConnection(connection) || connection.historyGeneration !== generation) return;
      await this.unsetStoreValue('lr5_activity_state');
      await this._setHistoryStatus('disabled');
      await this._publishPetSummary(false, [], false);
    });
  }

  async _setHistoryStatus(status) {
    if (this.getCapabilityValue('lr5_history_status') !== status) {
      await this.setCapabilityValue('lr5_history_status', status);
    }
  }

  async _publishPetSummary(complete, visits = this.getStoreValue('lr5_activity_state')?.visits || [], enabled = true) {
    await this.homey.app.lr5.updateSummary(this.getData().id, { visits, complete, enabled });
  }

  async _applyHistory({ activities, complete, names }, connection, generation) {
    if (!this._isHistoryCurrent(connection, generation)) return;
    const now = Date.now();
    const result = reconcileVisits(this.getStoreValue('lr5_activity_state'), activities, { now, complete });
    const summary = summarizeVisits(result.state.visits, { now, timeZone: this.robot?.timezone || 'UTC' });
    const { last } = summary;
    const values = {
      measure_lr5_visits_today: summary.today,
      measure_lr5_urine_visits_today: summary.urineToday,
      measure_lr5_feces_visits_today: summary.fecesToday,
      lr5_last_visit_time: last ? formatVisitTime(last.timestamp, this.robot?.timezone || 'UTC', this.homey.i18n?.getLanguage?.() || 'en')
        : this.homey.__('state.not_set'),
      lr5_last_pet_name: last?.petId && names[last.petId] ? names[last.petId] : this.homey.__('lr5.unknown_pet'),
      lr5_last_waste_type: this.homey.__(`lr5.waste.${last?.wasteType || 'Unknown'}`),
      lr5_history_status: result.complete ? 'up_to_date' : 'partial',
    };
    for (const [capability, value] of Object.entries(values)) {
      if (!this._isHistoryCurrent(connection, generation)) return;
      if (this.getCapabilityValue(capability) !== value) await this.setCapabilityValue(capability, value);
    }
    if (!this._isHistoryCurrent(connection, generation)) return;
    await this.setStoreValue('lr5_activity_state', result.state);
    if (!this._isHistoryCurrent(connection, generation)) return;
    for (const visit of result.newVisits) {
      const tokens = {
        pet_id: visit.petId || '',
        pet_name: visit.petId && names[visit.petId] ? names[visit.petId] : this.homey.__('lr5.unknown_pet'),
        pet_identified: visit.petId !== null,
        weight: visit.weight ?? 0,
        has_weight: visit.weight !== null,
        duration: visit.duration ?? 0,
        has_duration: visit.duration !== null,
        waste_type: visit.wasteType,
        waste_weight: visit.wasteWeight ?? 0,
        has_waste_weight: visit.wasteWeight !== null,
        visit_time: new Date(visit.timestamp).toISOString(),
        delayed: now - visit.timestamp > 120000,
      };
      this._triggerFlowCard('lr5_visit', tokens);
      if (visit.petId) this._triggerFlowCard('lr5_pet_visit', tokens, { petId: visit.petId });
      if (visit.wasteType === 'Urine') this._triggerFlowCard('lr5_urine_visit', tokens);
      if (visit.wasteType === 'Feces') this._triggerFlowCard('lr5_feces_visit', tokens);
    }
    await this._publishPetSummary(result.complete, result.state.visits);
  }

  getPetVisitSummary(petId) {
    const visits = this.getStoreValue('lr5_activity_state')?.visits || [];
    return {
      ...summarizeVisits(visits, { petId, timeZone: this.robot?.timezone || 'UTC' }),
      complete: this.getCapabilityValue('lr5_history_status') === 'up_to_date',
    };
  }

  async onSettings({ newSettings, changedKeys }) {
    if (!changedKeys.includes('lr5_history_enabled')) return;
    const connection = this._connection;
    if (!connection) return;
    if (newSettings.lr5_history_enabled === false) {
      await this._disableHistory(connection);
    } else {
      connection.polling.unregisterPolling(this._historyPollKey(), this.getData().id);
      connection.historyRegistered = false;
      connection.historyDisabled = false;
      connection.historyGeneration = (connection.historyGeneration || 0) + 1;
      this._startHistoryPolling(connection, true);
    }
  }

  _registerCapabilityListeners() {
    if (this._listenersRegistered) return;
    this._listenersRegistered = true;
    this.registerCapabilityListener('onoff', (value) => {
      if (typeof value !== 'boolean') throw new Error(this.homey.__('errors.invalid_boolean_value'));
      return this._runCommand(value ? 'POWER_ON' : 'POWER_OFF');
    });
    this.registerCapabilityListener('start_clean_cycle', () => this._runCommand('CLEAN_CYCLE'));
    this.registerCapabilityListener('short_reset_press', () => this._runCommand('REMOTE_RESET'));
    this.registerCapabilityListener('reset_waste_drawer', () => this._runCommand('RESET_WASTE_LEVEL'));
    this.registerCapabilityListener('lr5_reset_filter', () => this._runCommand('CHANGE_FILTER'));
    this.registerCapabilityListener('sleep_mode_enabled', (enabled) => this.setSleepSchedule({ enabled }));
    this.registerCapabilityListener('key_pad_lock_out', (value) => {
      if (typeof value !== 'boolean') throw new Error(this.homey.__('errors.invalid_boolean_value'));
      return this._setRobotSettings({ panelSettings: { isKeypadLocked: value } });
    });
    this.registerCapabilityListener('clean_cycle_wait_time', (value) => {
      const cycleDelay = Number(value);
      if (![3, 7, 15, 25, 30].includes(cycleDelay)) throw new Error(this.homey.__('errors.invalid_wait_time'));
      return this._setRobotSettings({ litterRobotSettings: { cycleDelay } });
    });
    this.registerCapabilityListener('night_light_mode', (value) => {
      const mode = { on: 'On', off: 'Off', auto: 'Auto' }[value];
      if (!mode) throw new Error(this.homey.__('errors.invalid_night_light_mode'));
      return this._setRobotSettings({ nightLightSettings: { mode } });
    });
    this.registerCapabilityListener('panel_brightness', (value) => {
      const displayIntensity = { low: 'Low', medium: 'Medium', high: 'High' }[value];
      if (!displayIntensity) throw new Error(this.homey.__('errors.invalid_panel_brightness'));
      return this._setRobotSettings({ panelSettings: { displayIntensity } });
    });
    this.registerCapabilityListener('dim.night_light', (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(this.homey.__('errors.invalid_night_light_brightness'));
      }
      return this._setRobotSettings({ nightLightSettings: { brightness: Math.round(value * 100) } });
    });
  }

  onUninit() {
    this._destroyed = true;
    this._stopPolling();
  }

  onDeleted() {
    this.onUninit();
    this.homey.app.lr5.removeSummary(this.getData().id).catch(this.error.bind(this));
  }

};
