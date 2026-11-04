const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

const { getCapabilities, deriveStatusCode } = require('../lib/lr5/state');
const api = require('../lib/lr5/api');
const Session = require('../lib/common/session');

class HomeyBase {}

const manifest = require('../app.json');

const homey = { __: (key) => key, log() {}, error() {} };
const standard = require('./fixtures/litter_robot_5_data.json');
const pro = require('./fixtures/litter_robot_5_pro_data.json');

for (const fixture of [standard, pro]) {
  test(`${fixture.type}: upstream data maps units and settings correctly`, () => {
    const v = getCapabilities(fixture);
    assert.equal(v.litter_robot_status, 'RDY');
    assert.equal(v.measure_litter_level_percentage, 100);
    assert.equal(v.measure_waste_drawer_level_percentage, 16);
    assert.equal(v.measure_weight, 5008);
    assert.equal(v.measure_odometer_clean_cycles, 81);
    assert.equal(v.measure_scoops_saved_count, 80);
    assert.equal(v.clean_cycle_wait_time, '7');
    assert.equal(v.panel_brightness, 'low');
    assert.equal(v.night_light_mode, 'auto');
    assert.equal(v['dim.night_light'], 0.7);
    assert.equal(v.alarm_waste_drawer_full, false);
  });
}
test('interrupt/offline priority, unknown state and zero levels', () => {
  const s = { ...standard.state, state: 'StRobotClean' };
  assert.equal(deriveStatusCode(s), 'CCP');
  assert.equal(deriveStatusCode({ ...s, cycleState: 'StPause' }), 'P');
  assert.equal(deriveStatusCode({ ...s, cycleState: 'StCatDetect' }), 'CSI');
  assert.equal(deriveStatusCode({ ...s, cycleState: 'StPause', isOnline: false }), 'OFFLINE');
  assert.equal(deriveStatusCode({ ...standard.state, isDrawerFull: true }), 'DFS');
  assert.equal(deriveStatusCode({}), 'UNKNOWN');
  assert.equal(getCapabilities({ state: {} }).measure_weight, null);
  assert.equal(getCapabilities({ state: { litterLevelPercent: 0 } }).measure_litter_level_percentage, 0);
});
test('discovery filters unrelated products and rejects invalid responses', async () => {
  const session = { homey, _makeRestRequest: async () => [standard, pro, { serial: '4', type: 'LR4' }, null] };
  assert.deepEqual(await api.getRobots(session), [standard, pro]);
  await assert.rejects(api.getRobots({ homey, _makeRestRequest: async () => ({ error: 'invalid' }) }));
  await assert.rejects(api.getState({ homey, _makeRestRequest: async () => ({ serial: 'wrong', state: {} }) }, 'serial'));
});
test('REST operations use LR5 bodies and disable mutation retries', async () => {
  const calls = [];
  const session = { homey, _makeRestRequest: async (...args) => calls.push(args) };
  await api.sendCommand(session, 'serial/escaped', 'CLEAN_CYCLE');
  await api.setSettings(session, 'serial', { panelSettings: { isKeypadLocked: true } });
  assert.equal(calls[0][0], 'POST');
  assert.equal(calls[0][1], 'https://ub.prod.iothings.site/robots/serial%2Fescaped/commands');
  assert.deepEqual(calls[0][2].body, { type: 'CLEAN_CYCLE' });
  assert.equal(calls[0][2].apiType, 'LR5');
  assert.equal(calls[0][2].maxRetries, 0);
  assert.equal(calls[1][0], 'PATCH');
  assert.deepEqual(calls[1][2].body, { panelSettings: { isKeypadLocked: true } });
  await assert.rejects(api.sendCommand(session, 'serial', 'FACTORY_RESET'));
});
test('LR5 ID-token auth has no LR3 API key; existing model auth is preserved', async () => {
  const s = Object.create(Session.prototype);
  s.isSessionValid = () => true;
  s.getTokens = () => ({ id_token: 'id', access_token: 'access' });
  s.homey = { ...homey, manifest: { version: '3.0.5' } };
  const headers = await s.getAuthHeaders('LR5');
  assert.equal(headers.Authorization, 'Bearer id');
  assert.equal(headers['x-api-key'], undefined);
  assert.ok((await s.getAuthHeaders('LR3'))['x-api-key']);
  assert.equal((await s.getAuthHeaders('LR4')).Authorization, 'Bearer access');
});

const { harness, LitterRobot5Device } = require('./helpers/device.cjs');

test('initial sync does not fire historical cycles; new cycle triggers once', async () => {
  const d = new LitterRobot5Device();
  d.homey = homey;
  d.hasCapability = () => true;
  const values = {};
  const store = {};
  const triggers = [];
  d.getCapabilityValue = (id) => values[id];
  d.setCapabilityValue = async (id, value) => {
    values[id] = value;
  };
  d.getStoreValue = (id) => store[id];
  d.setStoreValue = async (id, value) => {
    store[id] = value;
  };
  d.setAvailable = async () => {};
  d._triggerFlowCard = (id) => triggers.push(id);
  await d._applySnapshot(standard);
  await d._applySnapshot(standard);
  assert.equal(triggers.length, 0);
  const next = { ...standard, state: { ...standard.state, odometerCleanCycles: 82 } };
  await d._applySnapshot(next);
  await d._applySnapshot(next);
  assert.deepEqual(triggers, ['clean_cycle_finished', 'clean_cycle_multiple']);
});
test('device settings use nested LR5 fields and reject invalid input', async () => {
  const d = new LitterRobot5Device();
  d.homey = homey;
  const listeners = {};
  const calls = [];
  d.registerCapabilityListener = (id, fn) => {
    listeners[id] = fn;
  };
  d._setRobotSettings = async (data) => calls.push(JSON.parse(JSON.stringify(data)));
  d._registerCapabilityListeners();
  await listeners.key_pad_lock_out(true);
  await listeners.clean_cycle_wait_time('25');
  await listeners.night_light_mode('auto');
  await listeners['dim.night_light'](0.7);
  assert.deepEqual(calls, [
    { panelSettings: { isKeypadLocked: true } },
    { litterRobotSettings: { cycleDelay: 25 } },
    { nightLightSettings: { mode: 'Auto' } },
    { nightLightSettings: { brightness: 70 } },
  ]);
  assert.throws(() => listeners.clean_cycle_wait_time('9'));
  assert.throws(() => listeners.key_pad_lock_out('true'));
  for (const invalid of [-0.1, 1.1, NaN, Infinity, '0.7', null]) {
    assert.throws(() => listeners['dim.night_light'](invalid));
  }
});
test('manifest exposes supported Flow cards only', () => {
  const driver = manifest.drivers.find((d) => d.id === 'litter-robot5');
  assert.ok(driver.capabilities.includes('start_clean_cycle'));
  assert.ok(!driver.capabilities.includes('start_empty_cycle'));
  for (const cards of Object.values(manifest.flow)) {
    for (const card of cards) {
      const filter = card.args?.find((a) => a.name === 'device')?.filter;
      if (filter?.includes('litter-robot5')) assert.ok(card.id !== 'start_empty_cycle');
    }
  }
});
test('REST transport accepts empty responses and does not replay a failed command', async () => {
  const originalFetch = global.fetch;
  const session = Object.create(Session.prototype);
  session.homey = homey;
  session._logUtilErr = () => {};
  session.timeout = 1000;
  session.getAuthHeaders = async (type) => {
    assert.equal(type, 'LR5');
    return { Authorization: 'Bearer test' };
  };
  let calls = 0;
  try {
    global.fetch = async () => {
      calls++; return { ok: true, status: 204 };
    };
    assert.equal(await session._makeRestRequest('PATCH', 'https://test.invalid', { apiType: 'LR5', maxRetries: 0 }), undefined);
    calls = 0;
    global.fetch = async () => {
      calls++; throw new Error('transport failed');
    };
    await assert.rejects(session._makeRestRequest('POST', 'https://test.invalid', { apiType: 'LR5', maxRetries: 0 }));
    assert.equal(calls, 1);
    let refreshed = false;
    session.refreshSession = async () => {
      refreshed = true;
    };
    global.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
    await assert.rejects(session._makeRestRequest('POST', 'https://test.invalid', { apiType: 'LR5', maxRetries: 0 }), /authentication_refreshed_retry/);
    assert.equal(refreshed, true);
  } finally {
    global.fetch = originalFetch;
  }
});

const { WhiskerNetworkException } = require('../lib/common/exceptions');

const turn = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('one initial request; polling stays busy until asynchronous Homey writes finish', async () => {
  const original = api.getState;
  const fetch = deferred();
  const write = deferred();
  const { device, polling, values } = harness();
  let requests = 0;
  api.getState = async () => {
    requests++; return fetch.promise;
  };
  const setValue = device.setCapabilityValue;
  let writing = false;
  device.setCapabilityValue = async (...args) => {
    writing = true;
    await write.promise;
    return setValue(...args);
  };
  try {
    const ready = device.onSessionReady();
    await turn();
    assert.equal(requests, 0, 'registration must not bypass the scheduled poll');
    const group = polling._groups.get(device._pollKey());
    const first = polling._executeGroupPoll(group);
    await polling._executeGroupPoll(group);
    assert.equal(requests, 1);
    fetch.resolve(standard);
    await turn();
    assert.equal(writing, true);
    await polling._executeGroupPoll(group);
    assert.equal(requests, 1, 'a second fetch must not race the first snapshot writes');
    write.resolve();
    await first;
    await ready;
    assert.equal(values['dim.night_light'], 0.7);
    await device.onSessionReady();
    assert.equal(requests, 1, 'duplicate session-ready notifications reuse the active connection');
  } finally {
    device.onUninit();
    api.getState = original;
  }
});

test('initial network failure remains registered and recovers on the next poll', async () => {
  const original = api.getState;
  const { device, polling, events } = harness();
  api.getState = async () => {
    throw new WhiskerNetworkException();
  };
  try {
    const ready = assert.rejects(device.onSessionReady(), WhiskerNetworkException);
    await turn();
    const group = polling._groups.get(device._pollKey());
    await polling._executeGroupPoll(group);
    await ready;
    assert.ok(events.includes('errors.network_unreachable'));
    assert.ok(polling.hasRegistrants(device._pollKey()));
    api.getState = async () => standard;
    await polling._executeGroupPoll(group);
    assert.equal(events.at(-1), 'available');
  } finally {
    device.onUninit();
    api.getState = original;
  }
});

test('deleting a device discards a late API response and clears its polling timers', async () => {
  const original = api.getState;
  const fetch = deferred();
  const {
    device, polling, values, events, timers,
  } = harness();
  api.getState = async () => fetch.promise;
  try {
    const ready = device.onSessionReady();
    await turn();
    const poll = polling._executeGroupPoll(polling._groups.get(device._pollKey()));
    device.onUninit();
    await ready;
    fetch.resolve(standard);
    await poll;
    assert.deepEqual(values, {});
    assert.deepEqual(events, []);
    assert.equal(timers.size, 0);
    assert.equal(polling.hasRegistrants(device._pollKey()), false);
  } finally {
    api.getState = original;
  }
});

test('failed capability writes do not emit false status-change Flows', async () => {
  const { device, values, events } = harness();
  values.litter_robot_status = 'RDY';
  device.setCapabilityValue = async (id) => {
    if (id === 'litter_robot_status') throw new Error('write rejected');
  };
  await assert.rejects(device._applySnapshot({ ...standard, state: { ...standard.state, state: 'StRobotClean' } }), /write rejected/);
  assert.deepEqual(events, []);
});

test('upgrade replaces the old preset picker with the exact brightness capability', async () => {
  const { device } = harness();
  const capabilities = new Set(['night_light_brightness']);
  device.hasCapability = (id) => capabilities.has(id);
  device.addCapability = async (id) => capabilities.add(id);
  device.removeCapability = async (id) => capabilities.delete(id);
  device._registerCapabilityListeners = () => {};
  device.onSessionReady = async () => {};
  await device.onInit();
  assert.equal(capabilities.has('night_light_brightness'), false);
  assert.equal(capabilities.has('dim.night_light'), true);
});

test('shared brightness preset Flow targets the right capability for LR4 and LR5', async () => {
  const filename = path.resolve(__dirname, '../lib/WhiskerApp.js');
  const localRequire = createRequire(filename);
  const appModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: (id) => {
      if (id === 'homey') return { App: HomeyBase };
      if (id === './WhiskerDevice') return HomeyBase;
      return localRequire(id);
    },
    module: appModule,
  });
  const WhiskerApp = appModule.exports;
  const app = new WhiskerApp();
  app.homey = homey;
  const calls = [];
  for (const isLr5 of [false, true]) {
    const device = {
      hasCapability: () => isLr5,
      triggerCapabilityListener: async (...args) => calls.push(args),
    };
    await app._nightLightBrightnessActionRunListener({ device, brightness: 'medium' });
  }
  assert.deepEqual(calls, [['night_light_brightness', 'medium'], ['dim.night_light', 0.5]]);
});

test('brightness changes from another app are exact at 0%, 70%, and 100%', () => {
  for (const brightness of [0, 70, 100]) {
    const snapshot = { ...standard, nightLightSettings: { brightness } };
    assert.equal(getCapabilities(snapshot)['dim.night_light'], brightness / 100);
  }
  assert.equal(getCapabilities({ nightLightSettings: { brightness: NaN } })['dim.night_light'], null);
});

test('a replacement connection waits for an in-flight write before applying newer state', async () => {
  const { device, values, events } = harness();
  const oldConnection = {};
  const newConnection = {};
  const write = deferred();
  const originalSet = device.setCapabilityValue;
  let blocked = false;
  device.setCapabilityValue = async (...args) => {
    if (!blocked) {
      blocked = true;
      await write.promise;
    }
    return originalSet(...args);
  };
  device._connection = oldConnection;
  const old = device._queueSnapshot(standard, oldConnection);
  await turn();
  device._connection = newConnection;
  const next = device._queueSnapshot({ ...standard, state: { ...standard.state, powerStatus: 'Off' } }, newConnection);
  write.resolve();
  await Promise.all([old, next]);
  assert.equal(values.onoff, false);
  assert.equal(events.filter((event) => event === 'available').length, 1);
});

test('cycle counter storage failure does not emit duplicate-prone cycle events', async () => {
  const { device, events } = harness();
  device.getStoreValue = () => 80;
  device.setStoreValue = async () => {
    throw new Error('storage unavailable');
  };
  await assert.rejects(device._applySnapshot(standard), /storage unavailable/);
  assert.deepEqual(events, []);
});

test('initialization preserves the localized network error', async () => {
  const { device, events } = harness();
  device.hasCapability = (id) => id === 'dim.night_light';
  device._registerCapabilityListeners = () => {};
  device.onSessionReady = async () => {
    throw new WhiskerNetworkException();
  };
  await device.onInit();
  assert.deepEqual(events, ['errors.network_unreachable']);
});
