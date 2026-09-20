'use strict';

module.exports = {
  async getNext({ homey, query }) {
    const driver = await homey.drivers.getDriver('tommeplan');
    const devices = driver.getDevices();
    const device = devices.find((d) => d.getId() === query.deviceId);
    return device ? device.nextPickup : null;
  },
};
