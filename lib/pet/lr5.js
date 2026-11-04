const { summarizeVisits, formatVisitTime } = require('../lr5/activities');

const CAPABILITIES = [
  'measure_lr5_visits_today', 'measure_lr5_urine_visits_today', 'measure_lr5_feces_visits_today',
  'lr5_last_visit_time', 'lr5_last_waste_type', 'measure_lr5_last_visit_weight', 'lr5_history_status',
];

/** LR5 activity supplements pet profiles without overwriting their profile weight. */
async function applyVisitSummary(device, { visits, complete, enabled }) {
  if (device._destroyed || (!enabled && !device.hasCapability('lr5_history_status'))) return;
  for (const capability of CAPABILITIES) {
    if (!device.hasCapability(capability)) await device.addCapability(capability);
  }
  const summary = summarizeVisits(visits, {
    petId: String(device.petId || device.getData().id),
    timeZone: device.homey.clock.getTimezone(),
  });
  const status = complete ? 'up_to_date' : 'partial';
  const values = {
    measure_lr5_visits_today: summary.today,
    measure_lr5_urine_visits_today: summary.urineToday,
    measure_lr5_feces_visits_today: summary.fecesToday,
    lr5_last_visit_time: summary.last
      ? formatVisitTime(summary.last.timestamp, device.homey.clock.getTimezone(), device.homey.i18n?.getLanguage?.() || 'en')
      : device.homey.__('state.not_set'),
    lr5_last_waste_type: device.homey.__(`lr5.waste.${summary.last?.wasteType || 'Unknown'}`),
    measure_lr5_last_visit_weight: summary.last?.weight ?? null,
    lr5_history_status: enabled ? status : 'disabled',
  };
  for (const [capability, value] of Object.entries(values)) {
    if (device._destroyed) return;
    if (device.getCapabilityValue(capability) !== value) await device.setCapabilityValue(capability, value);
  }
}

module.exports = { applyVisitSummary };
