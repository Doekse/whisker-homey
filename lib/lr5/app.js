const petApi = require('../pet/api');

/** Shared LR5 pet-name cache, Flow routing and summaries across multiple robots. */
module.exports = class Lr5Support {

  constructor(homey) {
    this.homey = homey;
    this.summaries = new Map();
    this.removed = new Set();
  }

  async getPetNames(session) {
    if (this._petCache?.session === session && this._petCache.expires > Date.now()) return this._petCache.names;
    if (this._petRequest?.session === session) return this._petRequest.promise;
    const request = { session };
    request.promise = petApi.getPets(session, session.getUserId()).then((pets) => {
      const names = Object.fromEntries(pets.filter((pet) => pet.petId && pet.isActive !== false)
        .map((pet) => [String(pet.petId), String(pet.name || this.homey.__('lr5.unknown_pet'))]));
      this._petCache = { session, names, expires: Date.now() + 300000 };
      return names;
    }).finally(() => {
      if (this._petRequest === request) this._petRequest = null;
    });
    this._petRequest = request;
    return request.promise;
  }

  async autocompletePets(query) {
    const session = await this.homey.app.getSession();
    if (!session) throw new Error(this.homey.__('errors.session_unavailable'));
    const names = await this.getPetNames(session);
    const match = (query || '').toLowerCase();
    return Object.entries(names).filter(([, name]) => name.toLowerCase().includes(match))
      .map(([id, name]) => ({ id, name }));
  }

  async updateSummary(serial, summary) {
    this.removed.delete(serial);
    this.summaries.set(serial, summary);
    await this._queuePetRefresh();
  }

  async removeSummary(serial) {
    this.removed.add(serial);
    this.summaries.delete(serial);
    await this._queuePetRefresh();
  }

  _queuePetRefresh() {
    this._petRefresh = (this._petRefresh || Promise.resolve()).catch(() => undefined).then(() => this._refreshPetDevices());
    return this._petRefresh;
  }

  async _refreshPetDevices() {
    const pets = this.homey.drivers.getDriver('pet').getDevices();
    const robots = this.homey.drivers.getDriver('litter-robot5').getDevices();
    const active = robots.filter((device) => !this.removed.has(device.getData().id))
      .map((device) => this.summaries.get(device.getData().id));
    const enabled = active.filter((summary) => summary?.enabled !== false);
    const summary = {
      visits: enabled.flatMap((source) => source?.visits || []),
      complete: enabled.every((source) => source?.complete === true),
      enabled: enabled.length > 0,
    };
    const results = await Promise.allSettled(pets.map((device) => device.onLr5ActivitySummary(summary)));
    for (const result of results) {
      if (result.status === 'rejected') this.homey.error('Unable to update pet visit summary:', result.reason);
    }
  }

  registerFlowCards() {
    const { flow } = this.homey;
    const parseDay = (day) => {
      if (day === 'all') return day;
      return typeof day === 'string' && /^[0-6]$/.test(day) ? Number(day) : NaN;
    };
    flow.getDeviceTriggerCard('lr5_pet_visit')
      .registerRunListener((args, state) => args.pet?.id === state?.petId)
      .registerArgumentAutocompleteListener('pet', (query) => this.autocompletePets(query));
    flow.getConditionCard('lr5_pet_visited_today')
      .registerRunListener(({ device, pet }) => {
        if (!pet?.id) throw new Error(this.homey.__('errors.activity_history_unavailable'));
        const summary = device.getPetVisitSummary(pet.id);
        if (summary.today > 0) return true;
        if (!summary.complete) throw new Error(this.homey.__('errors.activity_history_unavailable'));
        return false;
      })
      .registerArgumentAutocompleteListener('pet', (query) => this.autocompletePets(query));
    for (const [id, capability] of [
      ['lr5_filter_due_condition', 'alarm_lr5_filter_due'],
      ['lr5_hopper_enabled_condition', 'lr5_hopper_enabled'],
      ['lr5_hopper_low_condition', 'alarm_lr5_hopper_low'],
    ]) {
      flow.getConditionCard(id).registerRunListener(({ device }) => device.getCapabilityValue(capability) === true);
    }
    flow.getActionCard('lr5_set_sleep_schedule').registerRunListener(({
      device, day, start, end,
    }) => device.setSleepSchedule({
      day: parseDay(day), enabled: true, start, end,
    }));
    flow.getActionCard('lr5_disable_sleep_schedule').registerRunListener(({ device, day }) => device.setSleepSchedule({
      day: parseDay(day), enabled: false,
    }));
    flow.getActionCard('lr5_confirm_filter_replacement')
      .registerRunListener(({ device }) => device.triggerCapabilityListener('lr5_reset_filter', true));
  }

};
