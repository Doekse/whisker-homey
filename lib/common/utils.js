/**
 * Cross-cutting helpers for auth timing, robot identity labels, and safe serialization.
 */

const jwt = require('jsonwebtoken');

/**
 * Token refresh timing shared by session validation and expiry logging.
 */
const TOKEN_CONFIG = {
  /** Proactive refresh window so requests finish before Cognito rejects expired tokens. */
  EXPIRATION_BUFFER_SECONDS: 300,
};

/**
 * Serial from LR3 (`litterRobotSerial`) or LR4 (`serial`) robot payloads.
 *
 * @param {Object} robot
 * @returns {string}
 */
function getRobotSerial(robot) {
  const serial = robot?.serial ?? robot?.litterRobotSerial;
  return serial != null && String(serial) ? String(serial) : '';
}

/**
 * Best label for logs and notifications (nickname, then serial, then fallback).
 * LR4 GraphQL uses `name`; LR3 REST uses `litterRobotNickname`.
 *
 * @param {Object} robot
 * @param {string} [fallback='']
 * @returns {string}
 */
function getRobotDisplayName(robot, fallback = '') {
  const name = robot?.litterRobotNickname ?? robot?.name;
  if (name != null && String(name).trim()) {
    return String(name).trim();
  }
  return getRobotSerial(robot) || fallback;
}

/**
 * Homey pair-list title: `Nickname (SERIAL)` with product default when nickname is missing.
 *
 * @param {Object} robot
 * @param {string} defaultProductName
 * @returns {string}
 */
function formatPairListName(robot, defaultProductName) {
  const serial = getRobotSerial(robot) || 'Unknown';
  const name = robot?.litterRobotNickname ?? robot?.name;
  const nickname = (name != null && String(name).trim())
    ? String(name).trim()
    : defaultProductName;
  return `${nickname} (${serial})`;
}

/**
 * Formats {@link Date} values with consistent locale options for UI display.
 *
 * @param {Date} dateObj
 * @param {{ use12hFormat?: boolean }} [opts]
 * @returns {string}
 */
function formatDateForDisplay(dateObj, { use12hFormat = false, invalidDateLabel = null } = {}) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
    return invalidDateLabel;
  }

  return dateObj.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: use12hFormat,
  });
}

/**
 * Exponential backoff for transient API and transport failures without hammering Whisker endpoints.
 *
 * @param {Function} fn - Function to retry (can receive attempt number as parameter)
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} - Promise that resolves with function result
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        break;
      }

      const delay = baseDelay * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Normalizes API enum strings for Homey label capabilities.
 *
 * @param {string} str - Snake case string to format
 * @returns {string} Title case formatted string
 */
function formatSnakeCase(str) {
  if (!str || typeof str !== 'string') {
    return str;
  }

  return str
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Converts Whisker weight readings (lbs) to grams for Homey measure capabilities.
 *
 * @param {number} weightInLbs - Weight in pounds
 * @returns {number|null} Weight in grams (rounded) or null if invalid
 */
function convertLbsToGrams(weightInLbs) {
  if (typeof weightInLbs !== 'number' || Number.isNaN(weightInLbs)) {
    return null;
  }

  return Math.round(weightInLbs * 453.59237);
}

/**
 * Guards list formatting helpers against null API arrays.
 *
 * @param {Array} array - Array to validate
 * @returns {boolean} True if array exists and has items
 */
function hasItems(array) {
  return Array.isArray(array) && array.length > 0;
}

/**
 * Reads JWT claims without verifying signatures because Cognito expiry checks happen separately.
 *
 * @param {string} token - JWT token to decode
 * @returns {Object|null} Decoded token payload or null if failed
 */
function decodeJwt(token) {
  if (!token) {
    return null;
  }

  return jwt.decode(token, {
    verify_signature: false,
    verify_exp: false,
  }) || null;
}

/**
 * Unix seconds anchor for token expiry comparisons independent of local timezone.
 *
 * @returns {number} Current Unix timestamp in seconds
 */
function getUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Safely encodes data to base64 string.
 * @param {string|Object} data - Data to encode (string or object to JSON.stringify)
 * @param {(err: Error) => void} [onError] - Invoked on failure so callers can log instead of failing silently
 * @returns {string} Base64 encoded string (empty string on error)
 */
function encodeBase64(data, onError) {
  try {
    const stringData = typeof data === 'string' ? data : JSON.stringify(data);
    return Buffer.from(stringData).toString('base64');
  } catch (err) {
    if (typeof onError === 'function') onError(err);
    return '';
  }
}

/**
 * Named GraphQL operations appear in session logs; anonymous documents stay grouped as `unknown`.
 *
 * @param {string} query - GraphQL query string
 * @returns {string} Operation name or `unknown`
 */
function extractGraphQLOperationName(query) {
  if (!query) {
    return 'unknown';
  }

  const operationMatch = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
  if (operationMatch) {
    return operationMatch[1];
  }

  return 'unknown';
}

/**
 * Human-readable expiry details for session restore and refresh logging.
 *
 * @param {string} token - JWT token string
 * @returns {Object|null} Token expiration details or null if invalid
 */
function getTokenExpirationInfo(token) {
  if (!token) {
    return null;
  }

  const decoded = decodeJwt(token);
  if (!decoded?.exp) {
    return null;
  }

  const now = getUnixTimestamp();
  const expiresAt = decoded.exp;
  const timeUntilExpiry = expiresAt - now;
  const isExpired = timeUntilExpiry <= 0;
  const isExpiringSoon = timeUntilExpiry <= TOKEN_CONFIG.EXPIRATION_BUFFER_SECONDS;

  let formattedTimeUntilExpiry;
  if (timeUntilExpiry <= 0) {
    formattedTimeUntilExpiry = 'expired';
  } else {
    const hours = Math.floor(timeUntilExpiry / 3600);
    const minutes = Math.floor((timeUntilExpiry % 3600) / 60);
    const seconds = timeUntilExpiry % 60;

    if (hours > 0) {
      formattedTimeUntilExpiry = `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      formattedTimeUntilExpiry = `${minutes}m ${seconds}s`;
    } else {
      formattedTimeUntilExpiry = `${seconds}s`;
    }
  }

  return {
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    expiresAtUnix: expiresAt,
    timeUntilExpiry,
    isExpired,
    isExpiringSoon,
    formattedTimeUntilExpiry,
    issuedAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : null,
    tokenType: decoded.token_use || 'unknown',
    audience: decoded.aud,
    issuer: decoded.iss,
  };
}

/**
 * Safely stringifies objects to JSON with error handling.
 * @param {Object} obj - Object to stringify
 * @param {number} [space=0] - Number of spaces for indentation
 * @param {(err: Error) => void} [onError] - Invoked on failure so callers can log instead of failing silently
 * @returns {string|null} JSON string or null if failed
 */
function safeStringify(obj, space = 0, onError) {
  try {
    return JSON.stringify(obj, null, space);
  } catch (err) {
    if (typeof onError === 'function') onError(err);
    return null;
  }
}

/**
 * Safely parses JSON strings with error handling.
 * @param {string} str - JSON string to parse
 * @param {(err: Error) => void} [onError] - Invoked on failure so callers can log instead of failing silently
 * @returns {Object|null} Parsed object or null if failed
 */
function safeParse(str, onError) {
  try {
    return JSON.parse(str);
  } catch (err) {
    if (typeof onError === 'function') onError(err);
    return null;
  }
}

module.exports = {
  TOKEN_CONFIG,
  getRobotSerial,
  getRobotDisplayName,
  formatPairListName,
  formatDateForDisplay,
  retryWithBackoff,
  formatSnakeCase,
  convertLbsToGrams,
  hasItems,
  decodeJwt,
  getUnixTimestamp,
  encodeBase64,
  extractGraphQLOperationName,
  getTokenExpirationInfo,
  safeStringify,
  safeParse,
};
