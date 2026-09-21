'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class AvfallSorAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '4204', // Kristiansand
    '4223', // Vennesla
  ]);

  async _getAllMunicipalities() {
    return AvfallSorAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Avfall Sør';
  }

  getShortName() {
    return 'Avfall Sør';
  }

  async coversMunicipality(municipalityCode) {
    return AvfallSorAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async _getAddressUUID(addressData) {
    let addrString = addressData.adressenavn;
    if (addressData.nummer !== '') {
      addrString += ` ${addressData.nummer}`;
    }
    if (addressData.bokstav) {
      addrString += ` ${addressData.bokstav}`;
    }
    const response = await fetch(`https://avfallsor.no/wp-json/addresses/v1/address?lookup_term=${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    if (respJson.length === 0) {
      return null;
    }
    const match = respJson.find((entry) => (
      entry.value.toUpperCase() === addrString.toUpperCase()
      && entry.label.split(', ').pop().toUpperCase() === `${addressData.kommunenavn}`.toUpperCase()
    ));
    const uuidMatch = match?.href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuidMatch?.[0] ?? null;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      glass: ['1322'],
      food: ['1111'],
      paper: ['2499'],
      plastic: ['2499'],
      general: ['9011'],
    };
    const addressUUID = await this._getAddressUUID(addressData);
    if (!addressUUID) {
      throw this.addressNotFound(addressData);
    }

    const response = await fetch(`https://avfallsor.no/wp-json/pickup-calendar/v1/collections?property_id=${addressUUID}/`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const pickups = this.createFractions();
    const respJson = await response.json();
    const pickupArr = Object.values(respJson?.collections || {});
    for (const element of pickupArr) {
      const items = element?.items || [];
      for (const item of items) {
        const date = new Date(item.dato);
        for (const [ourFrac, apiFracs] of Object.entries(fractionMap)) {
          if (apiFracs.includes(item.fraksjonId)) {
            if (!pickups[ourFrac] || date < pickups[ourFrac]) {
              pickups[ourFrac] = date;
            }
          }
        }
      }
    }
    return pickups;
  }

  async coversAddress(addressData) {
    const uuid = await this._getAddressUUID(addressData);
    return uuid !== null;
  }
};
