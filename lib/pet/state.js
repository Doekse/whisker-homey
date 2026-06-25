/**
 * Pure pet formatting and capability derivation for API pet objects.
 * Keeps display logic out of devices so capability updates stay deterministic per snapshot.
 */

const {
  hasItems,
  formatSnakeCase,
} = require('../common/utils');

/** Valid API gender enum codes stored on the label_gender capability. */
const GenderCodes = Object.freeze(['MALE', 'FEMALE', 'UNKNOWN']);

/** Valid API environment enum codes stored on the label_environment capability. */
const EnvironmentCodes = Object.freeze(['INDOOR', 'OUTDOOR', 'INDOOR_OUTDOOR', 'UNKNOWN']);

/** Valid API diet enum codes stored on the label_food capability. */
const DietCodes = Object.freeze(['DRY_FOOD', 'WET_FOOD', 'MIXED_FOOD', 'UNKNOWN']);

/** Litter-Robot scale tolerance when matching a visit weight to a pet profile (lbs). */
const WEIGHT_MATCH_TOLERANCE = 0.5;

/**
 * Title-cases API list fields so breed and health concern labels sort consistently in the UI.
 *
 * @param {Array<string>} items - Array of snake_case strings
 * @returns {string[]} Formatted and sorted array of Title Case strings
 */
function formatStringList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items
    .map((item) => formatSnakeCase(item))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Compares calendar month/day only so birthday Flow conditions ignore birth year.
 *
 * @param {string} dateStr - Date string in ISO format
 * @returns {boolean} True if the date is today
 */
function isDateToday(dateStr) {
  if (!dateStr) {
    return false;
  }

  const today = new Date();
  const [, month, day] = dateStr.split(' ')[0].split('-').map(Number);
  return today.getDate() === day && (today.getMonth() + 1) === month;
}

/**
 * Calculates days until the next occurrence of a date.
 * Normalizes “today” and the next anniversary to UTC midnight so whole-day differences stay
 * consistent across local timezone and DST.
 * @param {string} dateStr - Date string in ISO format
 * @returns {number|null} Days until next occurrence or null if invalid
 */
function daysUntilDate(dateStr) {
  if (!dateStr) {
    return null;
  }

  const targetDate = new Date(dateStr);
  const now = new Date();

  const todayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const year = now.getUTCFullYear();
  let nextUtcMs = Date.UTC(year, targetDate.getUTCMonth(), targetDate.getUTCDate());

  if (nextUtcMs < todayUtcMs) {
    nextUtcMs = Date.UTC(year + 1, targetDate.getUTCMonth(), targetDate.getUTCDate());
  }

  const diffMs = nextUtcMs - todayUtcMs;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Maps API gender enum to a stable capability code; compose supplies localized titles.
 *
 * @param {string|undefined|null} gender - Raw gender value
 * @returns {string}
 */
function mapGender(gender) {
  return GenderCodes.includes(gender) ? gender : 'UNKNOWN';
}

/**
 * Maps API environment enum to a stable capability code; compose supplies localized titles.
 *
 * @param {string|undefined|null} env - Raw environment value
 * @returns {string}
 */
function mapEnvironment(env) {
  return EnvironmentCodes.includes(env) ? env : 'UNKNOWN';
}

/**
 * Maps API diet enum to a stable capability code; compose supplies localized titles.
 *
 * @param {string|undefined|null} diet - Raw diet value
 * @returns {string}
 */
function mapDiet(diet) {
  return DietCodes.includes(diet) ? diet : 'UNKNOWN';
}

/**
 * Parses an ISO birthday into a Date, distinguishing missing from invalid input.
 *
 * @param {string|null|undefined} birthdayStr
 * @returns {{ status: 'missing'|'invalid'|'ok', date?: Date }}
 */
function parseBirthday(birthdayStr) {
  if (!birthdayStr) {
    return { status: 'missing' };
  }

  const date = new Date(birthdayStr);
  if (Number.isNaN(date.getTime())) {
    return { status: 'invalid' };
  }

  return { status: 'ok', date };
}

/**
 * Age bucket from birthday for runtime localization in the device layer.
 *
 * @param {string|null|undefined} birthdayStr
 * @returns {{ status: 'missing'|'invalid'|'ok', unit?: 'months'|'years', count?: number }}
 */
function getAgeUnits(birthdayStr) {
  const parsed = parseBirthday(birthdayStr);
  if (parsed.status !== 'ok') {
    return { status: parsed.status };
  }

  const birth = parsed.date;
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();

  if (now.getDate() < birth.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }

  if (years < 1) {
    return { status: 'ok', unit: 'months', count: months };
  }

  return { status: 'ok', unit: 'years', count: years };
}

/**
 * Comma-separated breed labels for display (sorted, title-cased).
 * @param {Array<string>|null|undefined} breeds - Breed ids/names from API
 * @returns {string}
 */
function formatBreeds(breeds) {
  if (!hasItems(breeds)) return null;

  return formatStringList(breeds).join(', ');
}

/**
 * Whether the pet record lists any health concerns (flow triggers / alarms).
 * @param {object|null|undefined} pet
 * @returns {boolean}
 */
function hasHealthConcerns(pet) {
  return hasItems(pet?.healthConcerns);
}

/**
 * Comma-separated health concern labels for flow payloads (sorted, title-cased).
 *
 * @param {object|null|undefined} pet
 * @returns {string}
 */
function formatHealthConcernsLine(pet) {
  return formatStringList(pet?.healthConcerns).join(', ');
}

/**
 * True when days-until-next-birthday equals `threshold` (condition cards).
 *
 * @param {string|null|undefined} birthdayStr
 * @param {number} threshold
 * @returns {boolean}
 */
function isDaysUntilBirthdayThreshold(birthdayStr, threshold) {
  const days = daysUntilDate(birthdayStr);
  return days != null && days === threshold;
}

/**
 * Finds the closest active pet whose profile weight is within tolerance of a robot reading.
 *
 * @param {Array} pets
 * @param {number} weight - Detected weight in pounds
 * @returns {Object|null}
 */
function matchPetByWeight(pets, weight) {
  let closest = null;
  let smallestDifference = Infinity;

  for (const pet of pets) {
    if (!pet.isActive || !(pet.lastWeightReading > 0)) {
      continue;
    }

    const difference = Math.abs(pet.lastWeightReading - weight);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      closest = pet;
    }
  }

  return smallestDifference <= WEIGHT_MATCH_TOLERANCE ? closest : null;
}

module.exports = {
  daysUntilDate,
  formatBreeds,
  formatHealthConcernsLine,
  getAgeUnits,
  hasHealthConcerns,
  isDateToday,
  isDaysUntilBirthdayThreshold,
  mapDiet,
  mapEnvironment,
  mapGender,
  matchPetByWeight,
  parseBirthday,
};
