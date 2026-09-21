'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class IRISAdapter extends BaseAdapter {
  async _fetchWithKey(url) {
    const response = await fetch(url, {
      headers: {
        iks_pkey: '33',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  }

  async _getAllMunicipalities() {
    const response = await this._fetchWithKey('https://api.miljoid.no/v1.0/MyRenovation/MunicipalCodes');
    const respJson = await response.json();
    const municipalities = respJson.map((m) => m.Code);
    return new Set(municipalities);
  }

  async coversMunicipality(municipalityCode) {
    const municipalities = await this._getAllMunicipalities();
    return municipalities.has(String(municipalityCode));
  }

  getName() {
    return 'IRIS-Salten';
  }

  async _getAddressUUID(addressData) {
    let addrString = addressData.adressenavn;
    if (addressData.nummer !== '') {
      addrString += ` ${addressData.nummer}`;
    }
    if (addressData.bokstav) {
      addrString += ` ${addressData.bokstav}`;
    }

    const response = await this._fetchWithKey(`https://api.miljoid.no/v1.0/PaRenovation/SearchAddress?address=${addrString}`);
    const respJson = await response.json();
    if (respJson.length === 0) {
      return null;
    }

    const match = respJson.find((entry) => (
      entry.StreetAddress.split(',')[0] === addrString
    ));
    if (!match) {
      return null;
    }

    return match.BuildingId;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      glass: ['2612'],
      food: ['2110'],
      paper: ['2400'],
      plastic: ['3200'],
      general: ['9999'],
    };
    const pickups = this.createFractions();

    const addressUUID = await this._getAddressUUID(addressData);
    if (!addressUUID) {
      throw this.addressNotFound(addressData);
    }

    const response = await this._fetchWithKey(`https://api.miljoid.no/v1.0/PaRenovation/${addressUUID}`);
    const respJson = await response.json();
    for (const fraction of respJson) {
      for (const ourFrac of Object.keys(fractionMap)) {
        if (fractionMap[ourFrac].includes(fraction.FractionId.toString())) {
          for (const date of fraction.PickupDates) {
            const pickupDate = new Date(date);
            if (!pickups[ourFrac] || pickupDate < pickups[ourFrac]) {
              pickups[ourFrac] = pickupDate;
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
