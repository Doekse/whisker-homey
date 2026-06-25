const WhiskerLitterRobotDriver = require('../WhiskerLitterRobotDriver');
const lr4Api = require('./api');
const { getRobotSerial } = require('../common/utils');

/**
 * Litter-Robot 4 driver: supplies LR4 robot discovery data for the shared pairing flow.
 */
module.exports = class LitterRobot4Driver extends WhiskerLitterRobotDriver {

  static PRODUCT_LABEL = 'LR4';

  static PAIR_DEFAULT_NAME = 'Litter-Robot 4';

  /**
   * @param {import('../common/session')} apiSession
   * @returns {Promise<Array>}
   */
  async _fetchRobotsForAccount(apiSession) {
    return lr4Api.getRobots(apiSession, apiSession.getUserId());
  }

  /**
   * @param {Object} robotData
   * @returns {Object}
   */
  _getPairDeviceData(robotData) {
    return { id: getRobotSerial(robotData) };
  }
};
