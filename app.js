/**
 * Homey app entry point. Delegates to {@link WhiskerApp} so shared logic stays under `lib/`.
 */
const WhiskerApp = require('./lib/WhiskerApp');

module.exports = class App extends WhiskerApp {};
