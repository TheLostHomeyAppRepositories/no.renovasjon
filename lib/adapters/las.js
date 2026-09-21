'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class LASAdapter extends BaseAdapter {
  async _fetchWithKey(url) {
    const response = await fetch(url, {
      headers: {
        iks_pkey: '29',
      },
    });
    this.assertOk(response);
    return response;
  }

  async _getAllMunicipalities() {
    const response = await this._fetchWithKey('https://api.miljoid.no/v1.0/MyRenovation/MunicipalCodes');
    const respJson = await response.json();
    const municipalities = respJson.map((m) => m.Code);
    return new Set(municipalities);
  }

  getName() {
    return 'Lofoten Avfallsselskap IKS (LAS)';
  }

  getShortName() {
    return 'LAS';
  }

  async coversMunicipality(municipalityCode) {
    const municipalities = await this._getAllMunicipalities();
    return municipalities.has(String(municipalityCode));
  }

  // The provider's ID for the street address, or null if it has no such address
  async _getStreetAddressId(addressData) {
    const query = [
      `query=${addressData.adressenavn}`,
      `municipalCode=${addressData.kommunenummer}`,
    ].join('&');
    const streetSearch = await this._fetchWithKey(`https://api.miljoid.no/v1.0/MyRenovation/SearchStreetName?${query}`);
    const streetSearchJson = await streetSearch.json();
    if (streetSearchJson.length === 0) {
      return null;
    }
    const streetId = streetSearchJson[0].Id;
    const addressSearch = await this._fetchWithKey(`https://api.miljoid.no/v1.0/MyRenovation/GetStreetAddresses?streetId=${streetId}`);
    const addressSearchJson = await addressSearch.json();
    const addressMatch = addressSearchJson[0].StreetAddresses.find((entry) => (
      String(entry.Number) === String(addressData.nummer)
      && (entry.Letter || null) === (addressData.bokstav || null)
    ));
    return addressMatch?.Id ?? null;
  }

  // The cadastral address (gnr/bnr/fnr/snr) that the schedule lookup needs. It is built from the
  // cadastral fields stored with the device when they are there, which saves a request, and
  // otherwise the provider is asked. The fields don't include the section number, so 0 is used,
  // which is what the provider has had for every address checked.
  async _getCadastralAddress(addressData, streetAddressId) {
    const { gardsnummer, bruksnummer, festenummer } = addressData;
    if (Number.isInteger(gardsnummer) && Number.isInteger(bruksnummer)) {
      return `${gardsnummer}/${bruksnummer}/${festenummer || 0}/0`;
    }
    const addressInfo = await this._fetchWithKey(`https://api.miljoid.no/v1.0/MyRenovation/GetAddressInfo/${streetAddressId}`);
    const addressInfoJson = await addressInfo.json();
    return addressInfoJson.StreetAddresses[0].CadastralAddress;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      glass: ['4'],
      food: ['3'],
      paper: ['2'],
      plastic: ['7'],
      general: ['1'],
    };
    const pickups = this.createFractions();

    const streetAddressId = await this._getStreetAddressId(addressData);
    if (streetAddressId === null) {
      throw this.addressNotFound(addressData);
    }
    const cadastralAddress = await this._getCadastralAddress(addressData, streetAddressId);
    const query = [
      `matrikkelAdresse=${encodeURIComponent(cadastralAddress)}`,
      `municipalNo=${addressData.kommunenummer}`,
      `streetAddressId=${streetAddressId}`,
    ].join('&');
    const response = await this._fetchWithKey(`https://api.miljoid.no/v1.0/MyRenovation?${query}`);
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
    const streetAddressId = await this._getStreetAddressId(addressData);
    return streetAddressId !== null;
  }
};
