/** LR5 schedules use API weekday indices (Sunday=0), in the robot's timezone. */
function localDateKey(input, timeZone = 'UTC') {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (type) => parts.find((entry) => entry.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch (err) {
    return null;
  }
}

function parseTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isMinute(value) {
  return Number.isInteger(value) && value >= 0 && value < 1440;
}

function formatTime(value) {
  if (!isMinute(value)) return null;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function getScheduleInfo(robot, now = new Date()) {
  if (!Array.isArray(robot.sleepSchedules)) return null;
  const dayKey = localDateKey(now, robot.timezone || 'UTC');
  if (!dayKey) return null;
  const day = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  const today = robot.sleepSchedules.find((entry) => entry.dayOfWeek === day);
  return {
    enabled: robot.sleepSchedules.some((entry) => entry.isEnabled === true),
    scheduledToday: today?.isEnabled === true,
    start: today?.isEnabled === true ? formatTime(today.sleepTime) : null,
    end: today?.isEnabled === true ? formatTime(today.wakeTime) : null,
  };
}

/** Preserve untouched days and unknown API fields when editing a schedule. */
function buildSleepSchedules(existing, {
  day = 'all', enabled, start, end,
}) {
  if (typeof enabled !== 'boolean') throw new Error('errors.invalid_boolean_value');
  if (day !== 'all' && (!Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('errors.invalid_sleep_schedule');
  }
  const sleepTime = start === undefined ? undefined : parseTime(start);
  const wakeTime = end === undefined ? undefined : parseTime(end);
  if (sleepTime === null || wakeTime === null || ((start === undefined) !== (end === undefined))) {
    throw new Error('errors.invalid_sleep_schedule');
  }
  if (sleepTime !== undefined && sleepTime === wakeTime) throw new Error('errors.invalid_sleep_schedule');
  const entries = Array.isArray(existing) ? existing : [];
  const toggleConfigured = enabled && day === 'all' && sleepTime === undefined;
  let configured = 0;
  const schedules = Array.from({ length: 7 }, (_, index) => {
    const previous = entries.find((entry) => entry.dayOfWeek === index);
    const entry = previous ? { ...previous } : {
      dayOfWeek: index, isEnabled: false, sleepTime: 0, wakeTime: 0,
    };
    if (day !== 'all' && day !== index) return entry;
    if (sleepTime !== undefined) {
      entry.sleepTime = sleepTime;
      entry.wakeTime = wakeTime;
    }
    const validTimes = isMinute(entry.sleepTime) && isMinute(entry.wakeTime) && entry.sleepTime !== entry.wakeTime;
    if (toggleConfigured && !validTimes) return { ...entry, isEnabled: false };
    if (enabled && !validTimes) throw new Error('errors.sleep_schedule_required');
    if (validTimes) configured++;
    entry.isEnabled = enabled;
    return entry;
  });
  if (toggleConfigured && configured === 0) throw new Error('errors.sleep_schedule_required');
  return schedules;
}

function getMaintenance(robot, now = new Date()) {
  const raw = robot.nextFilterReplacementDate;
  if (typeof raw !== 'string') return null;
  // A date-only deadline is a calendar date, not midnight UTC in a different timezone.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDateKey(raw, robot.timezone || 'UTC');
  const today = localDateKey(now, robot.timezone || 'UTC');
  if (!date || !today || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) return null;
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { date, days, due: days <= 0 };
}

module.exports = {
  localDateKey, parseTime, getScheduleInfo, buildSleepSchedules, getMaintenance,
};
