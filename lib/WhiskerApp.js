const Homey = require('homey');
const appManifest = require('../app.json');
const WhiskerDevice = require('./WhiskerDevice');
const Session = require('./common/session');
const Polling = require('./common/polling');
const { WhiskerLoginException } = require('./common/exceptions');
const {
  isDateToday,
  isDaysUntilBirthdayThreshold,
} = require('./pet/state');
const {
  CLEAN_CYCLE_UNKNOWN,
  CleanCycleStatusCodes: LR3_CLEAN_CYCLE_CODES,
  LitterRobotStatusCodes: LR3_STATUS_CODES,
} = require('./lr3/constants');
const {
  CleanCycleStatusCodes: LR4_CLEAN_CYCLE_CODES,
  LitterRobotStatusCodes: LR4_STATUS_CODES,
} = require('./lr4/constants');

/** Driver-specific clean_cycle_status codes for Flow autocomplete filtering. */
const CLEAN_CYCLE_CODES_BY_DRIVER = {
  'litter-robot3': new Set([...LR3_CLEAN_CYCLE_CODES, CLEAN_CYCLE_UNKNOWN]),
  'litter-robot4': new Set([...LR4_CLEAN_CYCLE_CODES, CLEAN_CYCLE_UNKNOWN]),
};

/** Driver-specific litter_robot_status codes for Flow autocomplete filtering. */
const LITTER_ROBOT_STATUS_CODES_BY_DRIVER = {
  'litter-robot3': new Set(LR3_STATUS_CODES),
  'litter-robot4': new Set(LR4_STATUS_CODES),
};

/**
 * App wrapper for shared session, polling, and cross-driver device coordination.
 *
 * Keeps the Homey entry point (`app.js`) minimal while centralizing auth and
 * lifecycle logic as more Whisker products are added.
 */
module.exports = class WhiskerApp extends Homey.App {

  /**
   * Initializes shared session state and registers Flow cards before restoring stored tokens.
   *
   * @returns {Promise<void>}
   */
  async onInit() {
    this.log('Initializing Whisker app...');
    this._session = null;
    this._polling = null;
    this._registerFlowCards();
    await this._restoreSession();
    this.log('Whisker app initialization completed successfully');
  }

  /**
   * Keeps Flow card registration in one place so capability-based checks stay consistent across drivers.
   */
  _registerFlowCards() {
    this._registerLitterRobotFlowCards();
    this._registerPetFlowCards();
  }

  /**
   * Registers litter-robot condition, action, and trigger card listeners shared across LR3 and LR4.
   */
  _registerLitterRobotFlowCards() {
    this.homey.flow
      .getConditionCard('is_cat_detected')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_cat_detected'));

    this.homey.flow
      .getConditionCard('is_waste_drawer_full')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_waste_drawer_full'));

    this.homey.flow
      .getConditionCard('is_sleep_mode_active')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_sleep_mode_active'));

    this.homey.flow
      .getConditionCard('is_sleep_mode_scheduled')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_sleep_mode_scheduled'));

    this.homey.flow
      .getConditionCard('is_litter_hopper_empty')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_litter_hopper_empty'));

    this.homey.flow
      .getConditionCard('is_litter_hopper_enabled')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'litter_hopper_enabled'));

    this.homey.flow
      .getConditionCard('is_cleaning_status')
      .registerRunListener(this._capabilityArgConditionRunListener.bind(this, 'clean_cycle_status', 'status'))
      .registerArgumentAutocompleteListener(
        'status',
        this._flowEnumAutocompleteListener.bind(this, 'clean_cycle_status', CLEAN_CYCLE_CODES_BY_DRIVER),
      );

    this.homey.flow
      .getConditionCard('is_litter_robot_status')
      .registerRunListener(this._capabilityArgConditionRunListener.bind(this, 'litter_robot_status', 'status'))
      .registerArgumentAutocompleteListener(
        'status',
        this._flowEnumAutocompleteListener.bind(this, 'litter_robot_status', LITTER_ROBOT_STATUS_CODES_BY_DRIVER),
      );

    this.homey.flow
      .getActionCard('lock_keypad')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'key_pad_lock_out', true));

    this.homey.flow
      .getActionCard('unlock_keypad')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'key_pad_lock_out', false));

    this.homey.flow
      .getActionCard('start_clean_cycle')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'start_clean_cycle', true));

    this.homey.flow
      .getActionCard('set_cycle_delay')
      .registerRunListener(this._litterRobotArgActionRunListener.bind(this, 'cycle_delay', 'minutes', String, true));

    this.homey.flow
      .getActionCard('turn_on_night_light')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'night_light_enabled', true));

    this.homey.flow
      .getActionCard('turn_off_night_light')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'night_light_enabled', false));

    this.homey.flow
      .getActionCard('toggle_night_light')
      .registerRunListener(this._litterRobotToggleActionRunListener.bind(this, 'night_light_enabled'));

    this.homey.flow
      .getActionCard('reset_waste_drawer')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'reset_waste_drawer', true));

    this.homey.flow
      .getActionCard('set_night_light_mode')
      .registerRunListener(this._litterRobotArgActionRunListener.bind(this, 'night_light_mode', 'mode'));

    this.homey.flow
      .getActionCard('short_reset_press')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'short_reset_press', true));

    this.homey.flow
      .getActionCard('start_empty_cycle')
      .registerRunListener(this._litterRobotCapabilityActionRunListener.bind(this, 'start_empty_cycle', true));

    this.homey.flow
      .getActionCard('set_clean_cycle_wait_time')
      .registerRunListener(this._litterRobotArgActionRunListener.bind(this, 'clean_cycle_wait_time', 'wait_time'));

    this.homey.flow
      .getActionCard('set_panel_brightness')
      .registerRunListener(this._litterRobotArgActionRunListener.bind(this, 'panel_brightness', 'brightness'));

    this.homey.flow
      .getActionCard('set_night_light_brightness')
      .registerRunListener(this._litterRobotArgActionRunListener.bind(this, 'night_light_brightness', 'brightness'));

    this.homey.flow
      .getDeviceTriggerCard('clean_cycle_multiple')
      .registerRunListener(this._cleanCycleMultipleRunListener.bind(this));
  }

  /**
   * Keeps pet birthday conditions in the app layer so pet drivers stay decoupled from litter-robot code.
   */
  _registerPetFlowCards() {
    this.homey.flow
      .getConditionCard('birthday_today')
      .registerRunListener(this._petBirthdayTodayRunListener.bind(this));

    this.homey.flow
      .getConditionCard('days_until_birthday')
      .registerRunListener(this._petDaysUntilBirthdayRunListener.bind(this));
  }

  /**
   * Shared boolean condition handler so alarm capabilities use one registration pattern.
   *
   * @param {string} capabilityId
   * @param {{ device: Homey.Device }} args
   * @returns {boolean}
   */
  _booleanCapabilityConditionRunListener(capabilityId, args) {
    return args.device.getCapabilityValue(capabilityId) === true;
  }

  /**
   * Shared enum/string condition handler for capabilities compared against Flow arguments.
   *
   * @param {string} capabilityId
   * @param {string} argName
   * @param {{ device: Homey.Device }} args
   * @returns {boolean}
   */
  _capabilityArgConditionRunListener(capabilityId, argName, args) {
    const arg = args[argName];
    const expected = arg != null && typeof arg === 'object' ? arg.id : arg;
    return args.device.getCapabilityValue(capabilityId) === expected;
  }

  /**
   * Autocomplete options from capability enum definitions, filtered by driver and query.
   *
   * @param {string} capabilityId
   * @param {Record<string, Set<string>>} codesByDriver
   * @param {string} query
   * @param {{ device?: Homey.Device }} args
   * @returns {{ id: string, name: string }[]}
   */
  _flowEnumAutocompleteListener(capabilityId, codesByDriver, query, args) {
    const allowed = codesByDriver[args.device?.driver?.id] ?? null;
    const lang = this.homey.__language || 'en';
    const normalizedQuery = (query || '').toLowerCase();

    return (appManifest.capabilities?.[capabilityId]?.values ?? [])
      .filter((entry) => !allowed || allowed.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        name: entry.title?.[lang] || entry.title?.en || entry.id,
      }))
      .filter((option) => option.name.toLowerCase().includes(normalizedQuery));
  }

  /**
   * Routes Flow actions through capability listeners so device command logic stays centralized.
   *
   * @param {string} capabilityId
   * @param {boolean} value
   * @param {{ device: Homey.Device }} args
   * @returns {Promise<void>}
   */
  async _litterRobotCapabilityActionRunListener(capabilityId, value, args) {
    await args.device.triggerCapabilityListener(capabilityId, value);
  }

  /**
   * Reads the current capability value before toggling so Flow does not need a separate state card.
   *
   * @param {string} capabilityId
   * @param {{ device: Homey.Device }} args
   * @returns {Promise<void>}
   */
  async _litterRobotToggleActionRunListener(capabilityId, args) {
    const nextValue = !args.device.getCapabilityValue(capabilityId);
    await args.device.triggerCapabilityListener(capabilityId, nextValue);
  }

  /**
   * Routes parameterized Flow actions through capability listeners; optionally mirrors the value
   * on the capability when the robot does not echo it back promptly.
   *
   * @param {string} capabilityId
   * @param {string} argName
   * @param {Function|undefined} transform
   * @param {boolean|undefined} syncCapability
   * @param {{ device: Homey.Device }} args
   * @returns {Promise<void>}
   */
  async _litterRobotArgActionRunListener(capabilityId, argName, transform, syncCapability, args) {
    const raw = args[argName];
    const nextValue = transform ? transform(raw) : raw;
    await args.device.triggerCapabilityListener(capabilityId, nextValue);

    if (syncCapability) {
      await args.device.setCapabilityValue(capabilityId, nextValue).catch((err) => {
        this.error(`[Capability] Failed to update capability ${capabilityId}:`, err);
      });
    }
  }

  /**
   * Fires on every Nth clean cycle using the odometer capability as the source of truth.
   *
   * @param {{ device: Homey.Device, count: number }} args
   * @returns {boolean}
   */
  _cleanCycleMultipleRunListener(args) {
    const { device, count } = args;
    const totalCycles = device.getCapabilityValue('measure_odometer_clean_cycles');
    return count > 0 && totalCycles % count === 0;
  }

  /**
   * Uses the cached pet snapshot populated by polling rather than a separate API round-trip.
   *
   * @param {{ device: Homey.Device }} args
   * @returns {boolean}
   */
  _petBirthdayTodayRunListener(args) {
    const { device } = args;
    if (!device?.pet) {
      this.error('Device or pet data not available for birthday check');
      return false;
    }
    return isDateToday(device.pet.birthday);
  }

  /**
   * Compares days-until-birthday against a Flow argument for upcoming birthday automations.
   *
   * @param {{ device: Homey.Device, days: string }} args
   * @returns {boolean}
   */
  _petDaysUntilBirthdayRunListener(args) {
    const { device, days } = args;
    if (!device?.pet) {
      this.error('Device or pet data not available for days until birthday check');
      return false;
    }

    const threshold = parseInt(days, 10);
    if (Number.isNaN(threshold)) {
      this.error(`Invalid days threshold provided: ${days}`);
      return false;
    }

    return isDaysUntilBirthdayThreshold(device.pet.birthday, threshold);
  }

  /**
   * Attempts to restore user session from stored authentication tokens.
   * This enables seamless app restarts without requiring re-authentication
   * when valid tokens are available.
   */
  async _restoreSession() {
    try {
      const storedTokens = this.homey.settings.get('cognito_tokens');
      if (storedTokens) {
        this.log('Found stored tokens, attempting to restore session...');
        this._session = new Session({
          tokens: storedTokens,
          homey: this.homey,
          onTokensRefreshed: (tokens) => this.homey.settings.set('cognito_tokens', tokens),
          onTokensCleared: () => this.homey.settings.unset('cognito_tokens'),
        });

        if (!this._session.isSessionValid()) {
          await this._session.refreshSession();
        }

        this._polling = new Polling(this._session, this.homey);
        await this._notifySessionReady();
        this.log('Session restored successfully from stored tokens');
      } else {
        this.log('No valid stored session found, user will need to authenticate');
      }
    } catch (error) {
      this.error('Error restoring session from storage:', error.message);
      this.homey.settings.unset('cognito_tokens');
    }
  }

  /**
   * Validates credentials by creating a temporary session and testing authentication.
   * Does not modify app state, allowing safe validation before committing to new credentials.
   *
   * @param {string} username
   * @param {string} password
   * @returns {Promise<void>}
   * @throws {WhiskerLoginException}
   */
  async validateCredentials(username, password) {
    this.log('Validating credentials...');

    const tempSession = new Session({
      username,
      password,
      homey: this.homey,
      persistTokens: false,
    });

    try {
      await tempSession.login();
      this.log('Credentials validated successfully');
    } catch (error) {
      if (error instanceof WhiskerLoginException) {
        this.log(`Credential validation failed: ${error.message}`);
      } else {
        this.error('Failed to validate credentials:', error);
      }
      throw error;
    } finally {
      tempSession.signOut();
      tempSession.closeAllWebSockets();
    }
  }

  /**
   * Initializes a new API session using user credentials.
   * Creates the polling helper and re-registers all devices to ensure
   * they have access to the new session and can communicate properly.
   *
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Session>}
   */
  async initializeSession(username, password) {
    if (this._session && this._session.isSessionValid()) {
      this.log('Session already initialized');
      return this._session;
    }

    this.log('Initializing session with credentials...');

    const session = new Session({
      username,
      password,
      homey: this.homey,
      onTokensRefreshed: (tokens) => this.homey.settings.set('cognito_tokens', tokens),
      onTokensCleared: () => this.homey.settings.unset('cognito_tokens'),
    });

    try {
      await session.login();

      this._session = session;
      this._polling = new Polling(this._session, this.homey);
      await this._notifySessionReady();
      this.log('Session initialized successfully');
      return this._session;
    } catch (error) {
      if (error instanceof WhiskerLoginException) {
        this.log(`Authentication failed: ${error.message}`);
      } else {
        this.error('Failed to initialize session:', error);
      }
      throw error;
    }
  }

  /**
   * Notifies all Whisker devices that a valid session is available so they can connect.
   * Called after token restore or re-authentication when devices already exist (e.g. repair).
   */
  async _notifySessionReady() {
    this.log('Notifying devices that session is ready...');

    try {
      const drivers = await this.homey.drivers.getDrivers();

      for (const driver of Object.values(drivers)) {
        const driverDevices = await driver.getDevices();

        for (const device of driverDevices) {
          if (!(device instanceof WhiskerDevice)) {
            continue;
          }

          try {
            this.log(`Connecting device ${device.getName()} to session...`);
            await device.onSessionReady();
            this.log(`Device ${device.getName()} connected successfully`);
          } catch (error) {
            this.error(`Failed to connect device ${device.getName()} to session:`, error);
          }
        }
      }

      this.log('Session ready notification completed');
    } catch (error) {
      this.error('Error notifying devices of session readiness:', error);
    }
  }

  /**
   * Returns the current app session when tokens are usable, refreshing first when needed.
   * Pairing uses this to skip login when the user is already authenticated.
   *
   * @returns {Promise<Session|null>}
   */
  async getSession() {
    if (!this._session) {
      return null;
    }

    if (!this._session.isSessionValid()) {
      try {
        await this._session.refreshSession();
      } catch (error) {
        this.log(`Failed to refresh session: ${error.message}`);
        return null;
      }
    }

    return this._session.isSessionValid() ? this._session : null;
  }

  /** @returns {Session|null} */
  get session() {
    return this._session;
  }

  /** @returns {Polling|null} */
  get polling() {
    return this._polling;
  }

  /**
   * Signs out the current user session, clearing authentication and cleaning up resources.
   * Used during repair flows to ensure fresh authentication.
   */
  async signOut() {
    this.log('Signing out current session...');
    try {
      if (this._session) {
        this._session.signOut();
        this._session.closeAllWebSockets();
      }
      this._session = null;
      if (this._polling) {
        this._polling.destroy();
        this._polling = null;
      }
      this.log('Sign out completed successfully');
    } catch (error) {
      this.error('Error during sign out:', error);
      throw error;
    }
  }

  /**
   * Explicitly handles app teardown so cloud instance recycling releases
   * sessions and polling.
   */
  async onUninit() {
    this.log('Whisker app is being destroyed, cleaning up resources...');
    try {
      if (this._session) {
        this._session.signOut();
        this._session.closeAllWebSockets();
      }
      if (this._polling) {
        this._polling.destroy();
        this._polling = null;
      }
      this.log('Whisker app cleanup completed successfully');
    } catch (error) {
      this.error('Error during app cleanup:', error);
    }
  }

};
