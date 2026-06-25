const WhiskerLitterRobotDriver = require('../WhiskerLitterRobotDriver');
const lr3Api = require('./api');
const { getRobotSerial } = require('../common/utils');

/**
 * Litter-Robot 3 driver: supplies LR3 robot discovery data for the shared pairing flow.
 */
module.exports = class LitterRobot3Driver extends WhiskerLitterRobotDriver {

  static PRODUCT_LABEL = 'LR3';

  static PAIR_DEFAULT_NAME = 'Litter-Robot 3';

  /**
   * @param {import('../common/session')} apiSession
   * @returns {Promise<Array>}
   */
  async _fetchRobotsForAccount(apiSession) {
    return lr3Api.getRobots(apiSession, apiSession.getUserId());
  }

  /**
   * @param {Object} robotData
   * @returns {Object}
   */
  _getPairDeviceData(robotData) {
    return {
      id: getRobotSerial(robotData),
      robotId: robotData.litterRobotId,
    };
  }
};
