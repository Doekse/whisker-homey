const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  normalizeVisit, reconcileVisits, summarizeVisits, fetchVisitHistory, formatVisitTime, MAX_VISITS,
} = require('../lib/lr5/activities');
const {
  buildSleepSchedules, parseTime, getScheduleInfo, getMaintenance,
} = require('../lib/lr5/schedule');
const { getHopper, getFaults } = require('../lib/lr5/diagnostics');
const { getCapabilities } = require('../lib/lr5/state');
const api = require('../lib/lr5/api');
const petApi = require('../lib/pet/api');
const Lr5Support = require('../lib/lr5/app');
const { applyVisitSummary } = require('../lib/pet/lr5');
const { harness } = require('./helpers/device.cjs');
const standard = require('./fixtures/litter_robot_5_data.json');

const now = Date.parse('2026-11-04T12:00:00Z');
const turn = () => new Promise(setImmediate);
function visit(id, minutesAgo = 0, extra = {}) {
  return {
    eventId: id,
    type: 'PET_VISIT',
    timestamp: new Date(now - minutesAgo * 60000).toISOString(),
    petIds: ['pet-a'],
    petWeight: 937,
    duration: 31,
    wasteType: 'Urine',
    ...extra,
  };
}
function historyHarness() {
  const h = harness();
  const connection = {
    historyRegistered: true,
    historyGeneration: 1,
    polling: h.polling,
    resolve() {},
    reject() {},
  };
  h.device._connection = connection;
  h.device.robot = standard;
  const triggers = [];
  h.device._triggerFlowCard = (...args) => triggers.push(JSON.parse(JSON.stringify(args)));
  return { ...h, connection, triggers };
}

// Public reference data uses pounds × 100, and unavailable measurements are never fabricated.
test('visit normalization preserves units and explicit attribution and rejects invalid events', () => {
  const v = normalizeVisit(visit('one', 0, { isWasteWeightValid: true, wasteWeight: 40 }), now);
  assert.equal(v.weight, 4250);
  assert.equal(v.wasteWeight, 181);
  assert.equal(v.duration, 31);
  assert.equal(v.petId, 'pet-a');
  assert.equal(normalizeVisit(visit('two', 0, { petWeight: 0, duration: -1, wasteWeight: 40 }), now).weight, null);
  assert.equal(normalizeVisit(visit('two', 0, { wasteWeight: 40 }), now).wasteWeight, null);
  assert.equal(normalizeVisit(visit('two', 0, { petIds: ['pet-a', 'pet-b'] }), now).petId, null);
  assert.equal(normalizeVisit(visit('two', 0, { petIds: ['pet-a', 'pet-a'] }), now).petId, 'pet-a');
  assert.equal(normalizeVisit(visit('old', 49 * 60), now), null);
  assert.equal(normalizeVisit(visit('future', -10), now), null);
  assert.equal(normalizeVisit({ ...visit('bad'), timestamp: 'bad date' }, now), null);
  assert.equal(normalizeVisit({ type: 'CYCLE_COMPLETED', timestamp: new Date(now).toISOString() }, now), null);
});

test('initial history establishes a baseline; new, duplicate and delayed visits are handled separately', () => {
  const initial = reconcileVisits(null, [visit('old', 10)], { now });
  assert.equal(initial.newVisits.length, 0);
  const raw = [visit('new', -1), visit('new', -1), visit('old', 10)];
  const updated = reconcileVisits(initial.state, raw, { now: now + 120000 });
  assert.equal(updated.newVisits.length, 1);
  assert.equal(updated.state.visits.length, 2);
  assert.equal(reconcileVisits(updated.state, raw, { now: now + 120000 }).newVisits.length, 0);
  const late = visit('late', -0.5);
  assert.equal(reconcileVisits(updated.state, [...raw, late], { now: now + 3600000 }).newVisits.length, 1);
});

test('pet reassignments update counts without emitting a second visit', () => {
  const initial = reconcileVisits(null, [visit('one')], { now });
  const corrected = reconcileVisits(initial.state, [visit('one', 0, { petIds: ['pet-b'] })], { now });
  assert.equal(corrected.newVisits.length, 0);
  assert.equal(summarizeVisits(corrected.state.visits, { now, petId: 'pet-a' }).today, 0);
  assert.equal(summarizeVisits(corrected.state.visits, { now, petId: 'pet-b' }).today, 1);
  const latest = reconcileVisits(initial.state, [visit('new', -1), visit('new', -1, { petIds: ['pet-b'] })], { now: now + 120000 });
  assert.equal(latest.newVisits[0].petId, 'pet-b', 'the final version of an event wins within a page');
});

test('visit storage is bounded; counters reset by local calendar day including DST', () => {
  const many = Array.from({ length: MAX_VISITS + 20 }, (_, i) => visit(`v${i}`, i));
  const result = reconcileVisits(null, many, { now });
  assert.equal(result.state.visits.length, MAX_VISITS);
  assert.equal(result.complete, false);
  const boundary = Date.parse('2026-10-25T23:30:00Z');
  const visits = [
    normalizeVisit({ ...visit('today'), timestamp: '2026-10-25T23:10:00Z' }, boundary),
    normalizeVisit({ ...visit('yesterday'), timestamp: '2026-10-25T21:59:00Z' }, boundary),
  ];
  assert.equal(summarizeVisits(visits, { now: boundary, timeZone: 'Europe/Amsterdam' }).today, 1);
  assert.equal(summarizeVisits(visits, { now: boundary + 86400000, timeZone: 'Europe/Amsterdam' }).today, 0);
});

test('mixed activities are paginated even when the API ignores a visit filter', async () => {
  const calls = [];
  const mixed = Array.from({ length: 100 }, (_, i) => ({ type: 'CYCLE_COMPLETED', timestamp: new Date(now - i * 1000).toISOString() }));
  const fake = {
    getActivities: async (session, serial, args) => {
      calls.push(args); return args.offset === 0 ? mixed : [visit('one', 2)];
    },
  };
  const history = await fetchVisitHistory({}, 'serial', fake, now);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { limit: 100, offset: 100 });
  assert.equal(history.complete, true);
  assert.equal(reconcileVisits(null, history.activities, { now }).state.visits.length, 1);
});

test('history fetch is bounded and reports incomplete coverage rather than a false zero', async () => {
  let pages = 0;
  const fake = {
    getActivities: async () => {
      pages++; return Array.from({ length: 100 }, (_, i) => visit(`${pages}:${i}`, i / 100));
    },
  };
  const result = await fetchVisitHistory({}, 'serial', fake, now);
  assert.equal(pages, 10);
  assert.equal(result.complete, false);
});

test('activities API validates responses and constructs encoded paging URLs', async () => {
  const calls = [];
  const session = {
    homey: { __: (key) => key },
    _makeRestRequest: async (...args) => {
      calls.push(args); return [];
    },
  };
  await api.getActivities(session, 'a/b', { limit: 100, offset: 200 });
  assert.match(calls[0][1], /robots\/a%2Fb\/activities\?limit=100&offset=200$/);
  assert.equal(calls[0][2].apiType, 'LR5');
  await assert.rejects(api.getActivities(session, 'serial', { limit: -1 }));
  session._makeRestRequest = async () => ({ items: [] });
  await assert.rejects(api.getActivities(session, 'serial'), /invalid_api_response/);
});

test('history processing does not replay old visits and emits one attributed Flow with typed tokens', async () => {
  const {
    device, connection, triggers, values,
  } = historyHarness();
  const stamp = Date.now();
  const old = { ...visit('old'), timestamp: new Date(stamp - 60000).toISOString() };
  await device._applyHistory({ activities: [old], complete: true, names: { 'pet-a': 'Minoes' } }, connection, 1);
  assert.equal(triggers.length, 0);
  const fresh = { ...visit('fresh'), timestamp: new Date(stamp + 1000).toISOString() };
  await device._applyHistory({ activities: [fresh, old], complete: true, names: { 'pet-a': 'Minoes' } }, connection, 1);
  assert.deepEqual(triggers.map(([id]) => id), ['lr5_visit', 'lr5_pet_visit', 'lr5_urine_visit']);
  assert.equal(triggers[0][1].pet_name, 'Minoes');
  assert.equal(triggers[0][1].weight, 4250);
  assert.equal(triggers[0][1].has_waste_weight, false);
  assert.equal(triggers[0][1].waste_weight, 0);
  assert.equal(values.lr5_history_status, 'up_to_date');
  await device._applyHistory({ activities: [fresh, old], complete: true, names: {} }, connection, 1);
  assert.equal(triggers.length, 3);
});

test('ambiguous visits never claim an individual pet and missing measurements carry availability flags', async () => {
  const { device, connection, triggers } = historyHarness();
  await device._applyHistory({ activities: [], complete: true, names: {} }, connection, 1);
  const raw = {
    ...visit('fresh', 0, {
      petIds: ['pet-a', 'pet-b'], petWeight: null, duration: null, wasteType: 'Feces',
    }),
    timestamp: new Date(Date.now() + 1000).toISOString(),
  };
  await device._applyHistory({ activities: [raw], complete: true, names: {} }, connection, 1);
  assert.deepEqual(triggers.map(([id]) => id), ['lr5_visit', 'lr5_feces_visit']);
  assert.equal(triggers[0][1].pet_identified, false);
  assert.equal(triggers[0][1].has_weight, false);
  assert.equal(triggers[0][1].has_duration, false);
});

test('history failure does not mark the robot unavailable; the independent poll recovers', async () => {
  const originalState = api.getState;
  const originalActivities = api.getActivities;
  const {
    device, polling, events, values,
  } = harness();
  api.getState = async () => standard;
  api.getActivities = async () => {
    throw new Error('history down');
  };
  try {
    const ready = device.onSessionReady();
    await turn();
    await polling._executeGroupPoll(polling._groups.get(device._pollKey()));
    await ready;
    const group = polling._groups.get(device._historyPollKey());
    await polling._executeGroupPoll(group);
    assert.equal(values.lr5_history_status, 'unavailable');
    assert.deepEqual(events, ['available']);
    api.getActivities = async () => [];
    await polling._executeGroupPoll(group);
    assert.equal(values.lr5_history_status, 'up_to_date');
  } finally {
    device.onUninit();
    api.getState = originalState;
    api.getActivities = originalActivities;
  }
});

test('disabling history invalidates an in-flight request without emitting visits', async () => {
  const originalActivities = api.getActivities;
  const {
    device, connection, polling, triggers, values,
  } = historyHarness();
  connection.historyRegistered = false;
  let finish;
  api.getActivities = async () => new Promise((resolve) => {
    finish = resolve;
  });
  try {
    device._startHistoryPolling(connection, true);
    const poll = polling._executeGroupPoll(polling._groups.get(device._historyPollKey()));
    await turn();
    await device.onSettings({ newSettings: { lr5_history_enabled: false }, changedKeys: ['lr5_history_enabled'] });
    finish([visit('late')]);
    await poll;
    assert.equal(values.lr5_history_status, 'disabled');
    assert.equal(device.getStoreValue('lr5_activity_state'), undefined);
    assert.equal(triggers.length, 0);
  } finally {
    device.onUninit();
    api.getActivities = originalActivities;
  }
});

test('sleep schedule edits preserve other days and metadata, with strict time/day validation', () => {
  const source = standard.sleepSchedules.map((entry) => ({ ...entry, custom: 'keep' }));
  const before = JSON.stringify(source);
  const edited = buildSleepSchedules(source, {
    day: 3, enabled: true, start: '23:00', end: '07:00',
  });
  assert.equal(edited[3].sleepTime, 1380);
  assert.equal(edited[3].wakeTime, 420);
  assert.equal(edited[3].custom, 'keep');
  assert.deepEqual(edited[2], source[2]);
  assert.equal(JSON.stringify(source), before);
  assert.throws(() => buildSleepSchedules(source, { enabled: true }), /sleep_schedule_required/);
  for (const start of ['24:00', '7:00', '', '12:60']) assert.throws(() => buildSleepSchedules(source, { enabled: true, start, end: '08:00' }));
  assert.throws(() => buildSleepSchedules(source, { day: 7, enabled: false }));
  assert.throws(() => buildSleepSchedules(source, { enabled: true, start: '08:00', end: '08:00' }));
  assert.equal(parseTime('00:00'), 0);
  assert.equal(buildSleepSchedules(source, { day: 'all', enabled: false }).every((entry) => !entry.isEnabled), true);
});

test('sleep display uses the robot timezone and API Sunday-zero weekday', () => {
  const robot = {
    timezone: 'Europe/Amsterdam',
    sleepSchedules: buildSleepSchedules([], {
      day: 1, enabled: true, start: '23:00', end: '07:00',
    }),
  };
  const info = getScheduleInfo(robot, new Date('2026-11-01T23:30:00Z'));
  assert.equal(info.scheduledToday, true, 'already Monday in Amsterdam');
  assert.equal(info.start, '23:00');
  assert.equal(info.end, '07:00');
  assert.equal(getScheduleInfo(robot, new Date('2026-11-01T12:00:00Z')).scheduledToday, false);
});

test('filter reminders compare calendar days and reject invalid dates', () => {
  assert.deepEqual(getMaintenance({ nextFilterReplacementDate: '2026-11-05', timezone: 'Europe/Amsterdam' }, new Date('2026-11-04T12:00:00Z')), { date: '2026-11-05', days: 1, due: false });
  assert.equal(getMaintenance({ nextFilterReplacementDate: '2026-11-04' }, new Date(now)).due, true);
  assert.equal(getMaintenance({ nextFilterReplacementDate: '2026-11-01' }, new Date(now)).days, -3);
  assert.equal(getMaintenance({ nextFilterReplacementDate: '2026-02-30' }, new Date(now)), null);
  assert.equal(getMaintenance({ nextFilterReplacementDate: 'not a date' }), null);
});

test('hardware diagnostics recognize LR5 clear/fault values without treating disabled hoppers as failures', () => {
  assert.deepEqual(getFaults(standard), []);
  const broken = {
    ...standard,
    state: {
      ...standard.state, isBonnetRemoved: true, globeMotorFaultStatus: 'MtrFaultOvertorqueAmp', pinchStatus: 'PinchDetect',
    },
  };
  assert.deepEqual(getFaults(broken), ['bonnet_removed', 'motor_fault', 'pinch_fault']);
  assert.equal(getCapabilities(broken).alarm_problem, true);
  assert.equal(getFaults({ state: { isOnline: false } }), null);
  assert.equal(getFaults({ state: {} }), null);
});

test('hopper reporting prefers the LR5 indicator and remains read-only with attachment/unknown states', () => {
  const robot = { state: { isHopperInstalled: true, hopperStatus: 'ENABLED', hopperStatusIndicator: { value: 'LITTER_LOW' } } };
  robot.state.hopperFault = 'HopperFaultClear';
  assert.equal(getHopper(robot).fault, false);
  assert.equal(getHopper(robot).status, 'LITTER_LOW');
  assert.equal(getHopper(robot).low, true);
  assert.equal(getHopper(robot).empty, false);
  robot.state.hopperStatusIndicator.value = 'JAMMED';
  assert.equal(getHopper(robot).fault, true);
  robot.state.hopperStatusIndicator.value = 'DISABLED';
  assert.equal(getHopper(robot).enabled, false);
  assert.equal(getHopper(robot).fault, false);
  robot.state.hopperStatusIndicator.value = 'NEW_UNKNOWN_STATE';
  assert.equal(getHopper(robot).enabled, null);
  robot.state.isHopperInstalled = false;
  assert.equal(getHopper(robot).status, 'NOT_INSTALLED');
});

test('pet summaries combine robots, report incomplete sources, and never overwrite profile weight', async () => {
  const snapshots = [];
  const support = new Lr5Support({
    drivers: {
      getDriver: (id) => ({
        getDevices: () => (id === 'pet'
          ? [{ onLr5ActivitySummary: async (summary) => snapshots.push(summary) }]
          : [{ getData: () => ({ id: 'a' }) }, { getData: () => ({ id: 'b' }) }]),
      }),
    },
  });
  const raw = visit('one');
  await support.updateSummary('a', { visits: [normalizeVisit(raw, now)], complete: true, enabled: true });
  assert.equal(snapshots.at(-1).complete, false);
  await support.updateSummary('b', { visits: [], complete: true, enabled: false });
  assert.equal(snapshots.at(-1).complete, true);
  const values = { measure_weight: 9999 };
  const capabilities = new Set();
  const device = {
    homey: { __: (key) => key, clock: { getTimezone: () => 'UTC' } },
    getData: () => ({ id: 'pet-a' }),
    hasCapability: (id) => capabilities.has(id),
    addCapability: async (id) => capabilities.add(id),
    getCapabilityValue: (id) => values[id],
    setCapabilityValue: async (id, value) => {
      values[id] = value;
    },
  };
  await applyVisitSummary(device, { visits: [normalizeVisit(visit('recent', 0, { timestamp: new Date().toISOString() }), Date.now())], complete: true, enabled: true });
  assert.equal(values.measure_lr5_visits_today, 1);
  assert.equal(values.measure_lr5_last_visit_weight, 4250);
  assert.equal(values.measure_weight, 9999);
  await applyVisitSummary(device, { visits: [], complete: true, enabled: true });
  assert.equal(values.measure_lr5_visits_today, 0);
  assert.equal(values.measure_lr5_last_visit_weight, null);
});

test('concurrent sleep edits are serialized and preserve both edited weekdays', async () => {
  const { getState } = api;
  const { setSettings } = api;
  const { device } = harness();
  let robot = JSON.parse(JSON.stringify(standard));
  const writes = [];
  api.getState = async () => JSON.parse(JSON.stringify(robot));
  api.setSettings = async (session, serial, settings) => {
    writes.push(settings);
    robot = { ...robot, ...settings };
  };
  try {
    await Promise.all([
      device.setSleepSchedule({
        day: 1, enabled: true, start: '22:00', end: '07:00',
      }),
      device.setSleepSchedule({
        day: 2, enabled: true, start: '23:00', end: '08:00',
      }),
    ]);
    assert.equal(writes.length, 2);
    assert.equal(robot.sleepSchedules[1].sleepTime, 1320);
    assert.equal(robot.sleepSchedules[2].sleepTime, 1380);
    assert.equal(robot.sleepSchedules[3].isEnabled, false);
    await assert.rejects(device.setSleepSchedule({ day: 8, enabled: false }), /invalid_sleep_schedule/);
    assert.equal(writes.length, 2);
  } finally {
    api.getState = getState;
    api.setSettings = setSettings;
  }
});

test('the sleep switch resumes configured days without enabling empty schedules', () => {
  const schedules = buildSleepSchedules([], {
    day: 2, enabled: true, start: '23:00', end: '07:00',
  });
  const disabled = buildSleepSchedules(schedules, { enabled: false });
  const resumed = buildSleepSchedules(disabled, { enabled: true });
  assert.deepEqual(resumed.map((entry) => entry.isEnabled), [false, false, true, false, false, false, false]);
});

test('optional hopper capabilities appear only when attached and survive removal for existing Flows', async () => {
  const { device } = harness();
  assert.equal(device.hasCapability('litter_hopper_status'), false);
  await device._syncHopperCapabilities(standard);
  assert.equal(device.hasCapability('litter_hopper_status'), false);
  const attached = { state: { isHopperInstalled: true, hopperStatusIndicator: { value: 'READY' } } };
  await device._syncHopperCapabilities(attached);
  assert.equal(device.hasCapability('litter_hopper_status'), true);
  await device._syncHopperCapabilities(standard);
  assert.equal(device.hasCapability('litter_hopper_status'), true);
  assert.equal(getCapabilities(standard).litter_hopper_status, 'NOT_INSTALLED');
});

test('fault changes include stable codes and filter counters reset only on explicit action', async () => {
  const { device, values } = harness();
  const events = [];
  device._triggerFlowCard = (...args) => events.push(args);
  const commands = [];
  const listeners = {};
  device.registerCapabilityListener = (id, listener) => {
    listeners[id] = listener;
  };
  device._runCommand = async (command) => commands.push(command);
  device._registerCapabilityListeners();
  await device._applySnapshot(standard);
  assert.equal(events.length, 0);
  await device._applySnapshot({ ...standard, state: { ...standard.state, isBonnetRemoved: true } });
  assert.equal(values.alarm_problem, true);
  assert.equal(events[0][0], 'lr5_fault_changed');
  assert.equal(events[0][1].codes, 'bonnet_removed');
  await device._applySnapshot(standard);
  assert.equal(values.alarm_problem, false);
  assert.equal(events.length, 2);
  assert.deepEqual(commands, []);
  await listeners.lr5_reset_filter(true);
  assert.deepEqual(commands, ['CHANGE_FILTER']);
});

test('pet-name lookups are shared per session and refreshed for a replacement account', async () => {
  const original = petApi.getPets;
  let calls = 0;
  petApi.getPets = async () => {
    calls++; return [{ petId: 'a', name: 'Test cat', isActive: true }];
  };
  const support = new Lr5Support({ __: (key) => key });
  const session = { getUserId: () => 'test-user' };
  try {
    await Promise.all([support.getPetNames(session), support.getPetNames(session)]);
    assert.equal(calls, 1);
    await support.getPetNames(session);
    assert.equal(calls, 1);
    await support.getPetNames({ getUserId: () => 'another-test-user' });
    assert.equal(calls, 2);
  } finally {
    petApi.getPets = original;
  }
});

test('pet-specific Flow filters match explicit IDs and incomplete history cannot prove absence', () => {
  const cards = new Map();
  const get = (id) => {
    if (!cards.has(id)) {
      cards.set(id, {
        registerRunListener(fn) {
          this.run = fn; return this;
        },
        registerArgumentAutocompleteListener(name, fn) {
          this.autocomplete = fn; return this;
        },
      });
    }
    return cards.get(id);
  };
  const support = new Lr5Support({ __: (key) => key, flow: { getDeviceTriggerCard: get, getConditionCard: get, getActionCard: get } });
  support.registerFlowCards();
  assert.equal(cards.get('lr5_pet_visit').run({ pet: { id: 'a' } }, { petId: 'a' }), true);
  assert.equal(cards.get('lr5_pet_visit').run({ pet: { id: 'a' } }, { petId: 'b' }), false);
  const condition = cards.get('lr5_pet_visited_today').run;
  const args = { pet: { id: 'a' }, device: { getPetVisitSummary: () => ({ today: 0, complete: false }) } };
  assert.throws(() => condition(args), /activity_history_unavailable/);
  args.device.getPetVisitSummary = () => ({ today: 1, complete: false });
  assert.equal(condition(args), true);
  args.device.getPetVisitSummary = () => ({ today: 0, complete: true });
  assert.equal(condition(args), false);
});

test('removing the last LR5 source disables pet activity summaries', async () => {
  let latest;
  const support = new Lr5Support({
    drivers: {
      getDriver: (id) => ({
        getDevices: () => (id === 'pet'
          ? [{
            onLr5ActivitySummary: async (summary) => {
              latest = summary;
            },
          }]
          : [{ getData: () => ({ id: 'a' }) }]),
      }),
    },
  });
  await support.updateSummary('a', { visits: [], complete: true, enabled: true });
  await support.removeSummary('a');
  assert.equal(latest.enabled, false);
  assert.deepEqual(latest.visits, []);
});

test('visit labels are localized while malformed timezones cannot fabricate daily totals', () => {
  assert.match(formatVisitTime(now, 'Europe/Amsterdam', 'nl'), /13:00/);
  assert.match(formatVisitTime(now, 'UTC', 'en'), /12:00/);
  assert.throws(() => summarizeVisits([], { now, timeZone: 'Invalid/Timezone' }), /timezone/);
});

test('disabling history clears stored visits and expired records are pruned on startup/refresh', async () => {
  const { device, connection, values } = historyHarness();
  await device.setStoreValue('lr5_activity_state', { version: 1, baseline: now, visits: [{ id: 'old', timestamp: Date.now() - 49 * 3600000 }] });
  await device._pruneStoredHistory();
  assert.equal(device.getStoreValue('lr5_activity_state').visits.length, 0);
  await device._disableHistory(connection);
  assert.equal(device.getStoreValue('lr5_activity_state'), undefined);
  assert.equal(values.lr5_history_status, 'disabled');
});
