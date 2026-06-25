const Homey = require('homey');
const Session = require('./common/session');
const { formatPairListName, getRobotSerial } = require('./common/utils');

/**
 * Shared pairing and repair logic for litter-robot Homey drivers.
 * Flow cards register once from {@link WhiskerApp}.
 */
module.exports = class WhiskerLitterRobotDriver extends Homey.Driver {

  /**
   * Authenticates once per pairing session and lists robots available on the account.
   *
   * @param {Object} session
   * @returns {Promise<void>}
   */
  async onPair(session) {
    let robotList = [];

    session.setHandler('showView', async (viewId) => {
      if (viewId !== 'loading') {
        return;
      }

      const apiSession = await this.homey.app.getSession();
      if (apiSession) {
        robotList = await this._fetchRobotsForAccount(apiSession);
        this.log(`Found ${robotList.length} ${this.constructor.PRODUCT_LABEL} robot(s) for existing session`);
        await session.showView('list_devices');
        return;
      }

      await session.nextView();
    });

    session.setHandler('login', async ({ username, password }) => {
      if (!username || !password) {
        throw new Error(this.homey.__('pairing.credentials_required'));
      }
      this.log(`Attempting login for user: ${username}`);
      const apiSession = await this.homey.app.initializeSession(username, password);
      robotList = await this._fetchRobotsForAccount(apiSession);
      this.log(`Found ${robotList.length} ${this.constructor.PRODUCT_LABEL} robot(s) for account`);
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!robotList.length) {
        this.log(`No ${this.constructor.PRODUCT_LABEL} robots found, cleaning up session...`);
        try {
          await this.homey.app.onUninit();
        } catch (err) {
          this.log(`Failed to cleanup session: ${err.message}`);
        }
        throw new Error(this.homey.__('pairing.no_devices_found', {
          product: this.constructor.PAIR_DEFAULT_NAME,
        }));
      }
      return robotList.map((robotData) => ({
        name: formatPairListName(robotData, this.constructor.PAIR_DEFAULT_NAME),
        data: this._getPairDeviceData(robotData),
      }));
    });
  }

  /**
   * Verifies the robot still exists on the account before replacing the shared app session.
   *
   * @param {Object} session
   * @param {Homey.Device} device
   * @returns {Promise<void>}
   */
  async onRepair(session, device) {
    const { id } = device.getData();
    this.log(`Repairing ${this.constructor.PRODUCT_LABEL} device with serial: ${id}`);

    session.setHandler('login', async ({ username, password }) => {
      if (!username || !password) {
        throw new Error(this.homey.__('pairing.credentials_required_repair'));
      }
      this.log(`Repair login with username: ${username}`);
      await this.homey.app.validateCredentials(username, password);

      const fetchSession = new Session({
        username,
        password,
        homey: this.homey,
        persistTokens: false,
      });
      try {
        await fetchSession.login();

        const robotList = await this._fetchRobotsForAccount(fetchSession);
        const robot = robotList.find((entry) => getRobotSerial(entry) === String(id));
        if (!robot) {
          throw new Error(this.homey.__('pairing.robot_not_found', {
            product: this.constructor.PAIR_DEFAULT_NAME,
            serial: id,
          }));
        }

        await this.homey.app.signOut();
        await this.homey.app.initializeSession(username, password);

        this.log('Re-authentication successful');
      } finally {
        fetchSession.signOut();
        fetchSession.closeAllWebSockets();
      }
      return true;
    });
  }

  /**
   * @param {import('./session')} apiSession
   * @returns {Promise<Array>}
   */
  async _fetchRobotsForAccount(apiSession) {
    throw new Error(`${this.constructor.name} must implement _fetchRobotsForAccount`);
  }

  /**
   * @param {Object} robotData
   * @returns {Object}
   */
  _getPairDeviceData(robotData) {
    throw new Error(`${this.constructor.name} must implement _getPairDeviceData`);
  }
};
