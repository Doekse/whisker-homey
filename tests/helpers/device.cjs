const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const Polling = require('../../lib/common/polling');
const standard = require('../fixtures/litter_robot_5_data.json');
const manifest = require('../../app.json');

const homey = { __: (key) => key, log() {}, error() {} };
class HomeyBase {}
const filename = path.resolve(__dirname, '../../lib/lr5/device.js');
const nativeRequire = createRequire(filename);
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  require: (id) => (id === '../WhiskerDevice' ? HomeyBase : nativeRequire(id)), module: mod,
});
const LitterRobot5Device = mod.exports;
function harness() {
  const device = new LitterRobot5Device();
  const capabilities = new Set(manifest.drivers.find((driver) => driver.id === 'litter-robot5').capabilities);
  device.hasCapability = (id) => capabilities.has(id);
  device.addCapability = async (id) => capabilities.add(id);
  device.removeCapability = async (id) => capabilities.delete(id);
  device.getSetting = () => undefined;
  const values = {};
  const store = {};
  const events = [];
  const timers = new Map();
  let nextTimer = 0;
  const fakeHomey = {
    ...homey,
    setTimeout: (fn) => {
      timers.set(++nextTimer, fn); return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => {
      timers.set(++nextTimer, fn); return nextTimer;
    },
    clearInterval: (id) => timers.delete(id),
  };
  const session = {};
  const polling = new Polling(session, fakeHomey);
  fakeHomey.app = {
    getSession: async () => session,
    polling,
    lr5: { getPetNames: async () => ({}), updateSummary: async () => {}, removeSummary: async () => {} },
  };
  device.homey = fakeHomey;
  device.getData = () => ({ id: standard.serial });
  device.error = () => {};
  device.getCapabilityValue = (id) => values[id];
  device.setCapabilityValue = async (id, value) => {
    values[id] = value;
  };
  device.getStoreValue = (id) => store[id];
  device.setStoreValue = async (id, value) => {
    store[id] = value;
  };
  device.unsetStoreValue = async (id) => {
    delete store[id];
  };
  device.setAvailable = async () => events.push('available');
  device.setUnavailable = async (message) => events.push(message);
  device._triggerFlowCard = (id) => events.push(id);
  device._registerForPolling = (key, options) => polling.registerPolling(key, standard.serial, options);
  return {
    device, polling, values, events, timers,
  };
}

module.exports = { harness, LitterRobot5Device };
