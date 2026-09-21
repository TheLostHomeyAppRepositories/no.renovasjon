'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class VKRAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '3451', // Nord-Aurdal
    '3449', // Sør-Aurdal
    '3452', // Vestre Slidre
    '3453', // Øystre Slidre
    '3454', // Vang
    '3450', // Etnedal
  ]);

  async _getAllMunicipalities() {
    return VKRAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Valdres Kommunale Renovasjon IKS (VKR)';
  }

  getShortName() {
    return 'VKR';
  }

  async coversMunicipality(municipalityCode) {
    return VKRAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async _getAddressUUID(addressData) {
    let addrString = addressData.adressenavn;
    if (addressData.nummer !== '') {
      addrString += ` ${addressData.nummer}`;
    }
    if (addressData.bokstav) {
      addrString += ` ${addressData.bokstav}`;
    }
    const response = await fetch('https://www.vkr.no/Umbraco/Api/SearchApi/FindAddress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: addrString }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    if (!Array.isArray(respJson)) {
      throw new Error('Unexpected response from VKR');
    }
    const match = respJson.find((entry) => (
      entry.Address.toUpperCase() === addressData.adressenavn.toUpperCase()
      && String(entry.Number) === String(addressData.nummer)
      && entry.Municipality.toUpperCase() === addressData.kommunenavn
    ));
    return match?.Guid ?? null;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      food: ['Matavfall'],
      paper: ['Papir'],
      plastic: ['Plast'],
      general: ['Avfall til forbrenning'],
    };

    const addressUUID = await this._getAddressUUID(addressData);
    if (!addressUUID) {
      throw this.addressNotFound(addressData);
    }

    const response = await fetch(`https://www.vkr.no/Umbraco/Api/SearchApi/GetSixWeeks?id=${addressUUID}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    if (!Array.isArray(respJson?.PickupEvents)) {
      throw new Error('Unexpected response from VKR');
    }
    const pickups = this.reducedDisposals(respJson.PickupEvents, fractionMap, 'Name', 'Date');
    return pickups;
  }

  async coversAddress(addressData) {
    const uuid = await this._getAddressUUID(addressData);
    return uuid !== null;
  }
};
