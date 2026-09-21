'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class SIMAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '4625', // Austevoll
    '4613', // Bømlo
    '4615', // Fitjar
    '4617', // Kvinnherad
    '4614', // Stord
    '4612', // Sveio
    '4616', // Tysnes
  ]);

  async _getAllMunicipalities() {
    return SIMAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Sunnhordland Interkommunale Miljøverk IKS (SIM)';
  }

  getShortName() {
    return 'SIM';
  }

  async coversMunicipality(municipalityCode) {
    return SIMAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async _getRouteId(addressData) {
    const addrString = this.createAddrString(addressData);
    const response = await fetch(`https://sim.as/wp-json/tommekalender/v1/address_search?address=${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const match = respJson.data.routes.find((entry) => (
      entry.address.toUpperCase() === addrString.toUpperCase()
      && entry.area.toUpperCase() === addressData.kommunenavn.toUpperCase()
    ));
    if (!match) {
      return null;
    }
    return match.id;
  }

  modifyWasteKeys(array) {
    for (const entry of array) {
      if (entry.waste_types.toLowerCase().includes('glas/metall')) {
        entry.waste_types = 'glas/metall';
      } else {
        entry.waste_types = entry.waste_types.toLowerCase();
      }
    }
    return array;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      glass: ['glas/metall'],
      food: ['rest/bio'],
      paper: ['papir/plast'],
      plastic: ['papir/plast'],
      general: ['rest/bio'],
    };

    const routeId = await this._getRouteId(addressData);
    if (routeId === null) {
      throw this.addressNotFound(addressData);
    }
    const fromDateParam = new Date().toISOString().split('T')[0];
    const toDate = new Date();
    toDate.setMonth(toDate.getMonth() + 2);
    const toDateParam = toDate.toISOString().split('T')[0];
    const response = await fetch(`https://sim.as/wp-json/tommekalender/v1/route_search?route=${routeId}&from=${fromDateParam}&to=${toDateParam}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    // Inconsistent names in the API, so we modify the keys to match our fractionMap
    const disposals = this.modifyWasteKeys(respJson.data.collections);
    const pickups = this.reducedDisposals(disposals, fractionMap, 'waste_types', 'collection_date');
    return pickups;
  }

  async coversAddress(addressData) {
    const routeId = await this._getRouteId(addressData);
    return routeId !== null;
  }
};
