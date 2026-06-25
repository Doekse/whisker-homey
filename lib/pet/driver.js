/**
 * Pet device pairing and repair. Flow cards register from {@link WhiskerApp} so pet and
 * litter-robot drivers stay decoupled.
 */

const Homey = require('homey');
const Session = require('../common/session');
const petApi = require('./api');

module.exports = class PetDriver extends Homey.Driver {

  /**
   * Authenticates once per pairing session and lists pets on the account. Tokens live on the
   * app session rather than in device settings.
   *
   * @param {object} session Homey pairing session
   * @returns {Promise<void>}
   */
  async onPair(session) {
    let pets = [];

    session.setHandler('showView', async (viewId) => {
      if (viewId !== 'loading') {
        return;
      }

      const apiSession = await this.homey.app.getSession();
      if (apiSession) {
        pets = await petApi.getPets(apiSession, apiSession.getUserId());
        this.log(`Found ${pets.length} pet(s) for existing session`);
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
      pets = await petApi.getPets(apiSession, apiSession.getUserId());
      this.log(`Found ${pets.length} pet(s) for account`);
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!pets.length) {
        throw new Error(this.homey.__('pairing.no_pets_found'));
      }
      return pets.map((petData) => {
        return {
          name: petData.name || `Pet ${petData.petId}`,
          data: { id: String(petData.petId) },
        };
      });
    });

    session.setHandler('add_devices', async (selectedDevices) => {
      return selectedDevices;
    });
  }

  /**
   * Confirms the pet still exists before replacing the shared app session during repair.
   *
   * @param {object} session Homey pairing session
   * @param {object} device Homey device instance
   * @returns {Promise<void>}
   */
  async onRepair(session, device) {
    const { id } = device.getData();
    this.log(`Repairing device with ID: ${id}`);

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
        const pets = await petApi.getPets(fetchSession, fetchSession.getUserId());
        const pet = pets.find((p) => String(p.petId) === String(id));
        if (!pet) {
          throw new Error(this.homey.__('pairing.pet_not_found', { id }));
        }

        await this.homey.app.signOut();
        await this.homey.app.initializeSession(username, password);

        device.pet = pet;
        this.log('Re-authentication successful');
      } finally {
        fetchSession.signOut();
        fetchSession.closeAllWebSockets();
      }
      return true;
    });
  }
};
