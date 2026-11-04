const WhiskerLitterRobotDriver = require('../WhiskerLitterRobotDriver');
const api = require('./api');

module.exports = class LitterRobot5Driver extends WhiskerLitterRobotDriver {

  static PRODUCT_LABEL = 'LR5';

  static PAIR_DEFAULT_NAME = 'Litter-Robot 5';

  async _fetchRobotsForAccount(session) {
    return api.getRobots(session);
  }

  _getPairDeviceData(robot) {
    return { id: robot.serial };
  }

};
