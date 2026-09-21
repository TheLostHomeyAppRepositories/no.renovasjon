'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class GLORAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '3441', // Gausdal
    '3405', // Lillehammer
    '3440', // Øyer
  ]);

  async _getAllMunicipalities() {
    return GLORAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'GLØR IKS';
  }

  getShortName() {
    return 'GLØR';
  }

  async coversMunicipality(municipalityCode) {
    return GLORAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async _getAddressUUID(addressData) {
    const addrString = this.createAddrString(addressData);
    const response = await fetch(`https://proaktiv.glor.offcenit.no/search?q=${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const match = respJson.find((entry) => (
      entry.adresse.toUpperCase() === addrString.toUpperCase()
      && entry.kommune.toUpperCase() === addressData.kommunenavn.toUpperCase()
    ));
    return match?.id ?? null;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      glass: ['1322'],
      food: ['1111'],
      paper: ['1299'],
      plastic: ['1799'],
      general: ['9999'],
    };

    const addressUUID = await this._getAddressUUID(addressData);
    if (!addressUUID) {
      throw this.addressNotFound(addressData);
    }

    const response = await fetch(`https://proaktiv.glor.offcenit.no/details?id=${addressUUID}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    return this.reducedDisposals(respJson, fractionMap, 'fraksjonId', 'dato');
  }

  async coversAddress(addressData) {
    const uuid = await this._getAddressUUID(addressData);
    return uuid !== null;
  }
};
