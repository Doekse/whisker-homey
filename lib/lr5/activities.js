/** Bounded visit history, stable event IDs, and explicit (never weight-guessed) pet attribution. */
const { convertLbsToGrams } = require('../common/utils');
const { localDateKey } = require('./schedule');

const RETENTION_MS = 48 * 60 * 60 * 1000;
const MAX_VISITS = 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function finiteNumber(value, min = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : null;
}

function normalizeVisit(raw, now = Date.now()) {
  if (!raw || raw.type !== 'PET_VISIT') return null;
  const timestamp = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60 * 1000 || timestamp < now - RETENTION_MS) return null;
  const ids = Array.isArray(raw.petIds) ? [...new Set(raw.petIds.filter((id) => typeof id === 'string' && id.length > 0))] : [];
  // Reassigning a visit must update its attribution without creating a second event.
  const externalId = raw.eventId || raw.messageId;
  const id = typeof externalId === 'string' && externalId
    ? externalId : `timestamp:${timestamp}`;
  const petWeight = finiteNumber(raw.petWeight, Number.MIN_VALUE);
  const wasteWeight = raw.isWasteWeightValid === true ? finiteNumber(raw.wasteWeight) : null;
  return {
    id,
    timestamp,
    petId: ids.length === 1 ? ids[0] : null,
    ambiguous: ids.length > 1,
    weight: petWeight === null ? null : convertLbsToGrams(petWeight / 100),
    duration: finiteNumber(raw.duration),
    wasteType: ['Urine', 'Feces'].includes(raw.wasteType) ? raw.wasteType : 'Unknown',
    wasteWeight: wasteWeight === null ? null : convertLbsToGrams(wasteWeight / 100),
  };
}

/** Build the next stored state without mutating the previous one. */
function reconcileVisits(previous, rawActivities, { now = Date.now(), complete = true } = {}) {
  const validPrevious = previous?.version === 1 && Array.isArray(previous.visits);
  const baseline = validPrevious && Number.isFinite(previous.baseline) ? previous.baseline : now;
  const retained = validPrevious ? previous.visits.filter((visit) => visit.timestamp >= now - RETENTION_MS) : [];
  const visits = new Map(retained.map((visit) => [visit.id, visit]));
  const oldIds = new Set(visits.keys());
  const incoming = rawActivities.map((raw) => normalizeVisit(raw, now)).filter(Boolean);
  for (const visit of incoming) visits.set(visit.id, visit);
  const ordered = [...visits.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  const truncated = ordered.length > MAX_VISITS;
  const stored = ordered.slice(-MAX_VISITS);
  const incomingIds = new Set(incoming.map((visit) => visit.id));
  const newVisits = validPrevious
    ? stored.filter((visit) => incomingIds.has(visit.id) && !oldIds.has(visit.id) && visit.timestamp >= baseline)
    : [];
  return { state: { version: 1, baseline, visits: stored }, newVisits, complete: complete && !truncated };
}

function summarizeVisits(visits, { now = Date.now(), timeZone = 'UTC', petId } = {}) {
  const retained = visits.filter((visit) => visit && Number.isFinite(visit.timestamp)
    && visit.timestamp >= now - RETENTION_MS && visit.timestamp <= now + 300000);
  const selected = petId === undefined ? retained : retained.filter((visit) => visit.petId === petId);
  const today = localDateKey(now, timeZone);
  if (!today) throw new Error('Invalid visit history timezone');
  const todayVisits = selected.filter((visit) => localDateKey(visit.timestamp, timeZone) === today);
  const last = [...selected].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id))[0] || null;
  return {
    today: todayVisits.length,
    urineToday: todayVisits.filter((visit) => visit.wasteType === 'Urine').length,
    fecesToday: todayVisits.filter((visit) => visit.wasteType === 'Feces').length,
    last,
  };
}

/** Localized display text; Flow timestamps remain ISO strings for automation. */
function formatVisitTime(timestamp, timeZone = 'UTC', language = 'en') {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(language, {
      timeZone, dateStyle: 'medium', timeStyle: 'short', hour12: false,
    }).format(date);
  } catch (err) {
    return date.toISOString();
  }
}

/** API filters can be ignored. Filter visits locally and paginate the mixed activity stream. */
async function fetchVisitHistory(session, serial, api, now = Date.now()) {
  const activities = [];
  let previousTimestamp = Infinity;
  let ordered = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const entries = await api.getActivities(session, serial, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    let crossedCutoff = false;
    for (const entry of entries) {
      const timestamp = typeof entry?.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(timestamp)) {
        ordered = false;
      } else {
        if (timestamp > previousTimestamp) ordered = false;
        previousTimestamp = timestamp;
        if (timestamp < now - RETENTION_MS) crossedCutoff = true;
      }
    }
    activities.push(...entries);
    if (entries.length < PAGE_SIZE || (ordered && crossedCutoff)) return { activities, complete: true };
  }
  return { activities, complete: false };
}

module.exports = {
  normalizeVisit, reconcileVisits, summarizeVisits, fetchVisitHistory, formatVisitTime, RETENTION_MS, MAX_VISITS,
};
