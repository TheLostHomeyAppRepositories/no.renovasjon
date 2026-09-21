'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class HRAAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '3305', // Ringerike
    '3446', // Gran
    '3234', // Lunner
    '3236', // Jevnaker
    '3310', // Hole
  ]);

  async _getAllMunicipalities() {
    return HRAAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Hadeland og Ringerike Avfallsselskap AS (HRA)';
  }

  getShortName() {
    return 'HRA';
  }

  async coversMunicipality(municipalityCode) {
    return HRAAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async _getAddressUUID(addressData) {
    const addrString = this.createAddrString(addressData);
    const response = await fetch(`https://api.hra.no/search/address?query=${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const match = respJson.find((entry) => (
      entry.propertyName.toUpperCase() === addrString.toUpperCase()
      && entry.municipality.toUpperCase() === addressData.kommunenavn.toUpperCase()
    ));
    return match?.agreementGuid ?? null;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      food: [2110],
      paper: [2400],
      plastic: [3200],
      general: [9999],
    };

    const addressUUID = await this._getAddressUUID(addressData);
    if (!addressUUID) {
      throw this.addressNotFound(addressData);
    }

    const response = await fetch(`https://api.hra.no/Renovation/UpcomingGarbageDisposals/${addressUUID}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    return this.reducedDisposals(respJson, fractionMap, 'fractionId', 'date');
  }

  async coversAddress(addressData) {
    const uuid = await this._getAddressUUID(addressData);
    return uuid !== null;
  }
};
