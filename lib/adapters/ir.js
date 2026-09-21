'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class IRAdapter extends BaseAdapter {

  async _getAllMunicipalities() {
    const response = await fetch('https://innherredrenovasjon.no/wp-json/ir/v1/municipalities');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    return new Set(respJson.map((m) => m.municipality_number));
  }

  getName() {
    return 'Innherred Renovasjon IKS (IR)';
  }

  getShortName() {
    return 'IR';
  }

  async coversMunicipality(municipalityCode) {
    const municipalities = await this._getAllMunicipalities();
    return municipalities.has(String(municipalityCode));
  }

  async coversAddress(addressData) {
    const addrString = this.createAddrString(addressData);
    const response = await fetch(`https://innherredrenovasjon.no/wp-json/ir/v1/addresses/${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    return respJson.data.results.some((entry) => (
      entry.address.toUpperCase() === addrString.toUpperCase()
      && entry.municipality.toUpperCase() === addressData.kommunenavn.toUpperCase()
    ));
  }

  reducedDisposals(disposals) {
    // NOTE: Reversed fractionMap for convenience
    const fractionMap = {
      5: 'glass',
      1111: 'food',
      1222: 'paper',
      4: 'plastic',
      9991: 'general',
    };
    const nearest = this.createFractions();
    for (const id of Object.keys(disposals || {})) {
      const date = new Date(disposals[id].dates[0]);
      const key = fractionMap[id];
      if (!key) continue;
      nearest[key] = date;
    }
    return nearest;
  }

  async getFractionDates(addressData) {
    const addrString = this.createAddrString(addressData);
    const response = await fetch(`https://innherredrenovasjon.no/wp-json/ir/v1/garbage-disposal-dates-by-address?address=${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      // The provider answers 404 with this code when it has no such address
      const error = await response.json().catch(() => null);
      if (response.status === 404 && error?.code === 'address_not_found') {
        throw this.addressNotFound(addressData);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    return this.reducedDisposals(respJson);
  }
};
