'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class FosenRenovasjonAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '5054', // Indre Fosen
    '5057', // Ørland
    '5058', // Åfjord
  ]);

  async _getAllMunicipalities() {
    return FosenRenovasjonAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Fosen Renovasjon IKS';
  }

  getShortName() {
    return 'Fosen Renovasjon';
  }

  async coversMunicipality(municipalityCode) {
    return FosenRenovasjonAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async _getAddressUUID(addressData) {
    const addrString = this.createAddrString(addressData);
    const response = await fetch(`https://fosen.renovasjonsportal.no/api/address/${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const match = respJson.searchResults.find((entry) => (
      entry.title.toUpperCase() === addrString.toUpperCase()
      && entry.subTitle.toUpperCase() === addressData.kommunenavn.toUpperCase()
    ));
    return match?.id ?? null;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      food: ['Matavfall'],
      paper: ['Papir og plastemballasje'],
      plastic: ['Papir og plastemballasje'],
      general: ['Restavfall til forbrenning'],
    };

    const addressUUID = await this._getAddressUUID(addressData);
    if (!addressUUID) {
      throw this.addressNotFound(addressData);
    }

    const response = await fetch(`https://fosen.renovasjonsportal.no/api/address/${addressUUID}/details`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const pickups = this.reducedDisposals(respJson.disposals, fractionMap, 'fraction', 'date');
    return pickups;
  }

  async coversAddress(addressData) {
    const uuid = await this._getAddressUUID(addressData);
    return uuid !== null;
  }
};
