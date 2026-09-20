'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class KarmoyAdapter extends BaseAdapter {
  async _fetchWithKey(url) {
    const response = await fetch(url, {
      headers: {
        iks_pkey: '39',
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

  getName() {
    return 'Karmøy Kommune';
  }

  async coversMunicipality(municipalityCode) {
    const municipalities = await this._getAllMunicipalities();
    return municipalities.has(String(municipalityCode));
  }

  async fetchAddressUUID(addressData) {
    // Slightly roundabout way to get data for lookup. It looks like it's possible to look up
    // pickup dates without the address ID, and only the cadastral address and municpality ID. An
    // alternative to this approach would be to store the cadastral address address with the other fields in
    // addressData when looking it up on geonorge, but opted to do it the way the API seems to expect.
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
      entry.Number == addressData.nummer
      && entry.Letter == (addressData.bokstav || null)
    ));
    if (!addressMatch) {
      return null;
    }
    const addressId = addressMatch.Id;
    const addressInfo = await this._fetchWithKey(`https://api.miljoid.no/v1.0/MyRenovation/GetAddressInfo/${addressId}`);
    const addressInfoJson = await addressInfo.json();
    const cadestralAddress = addressInfoJson.StreetAddresses[0].CadastralAddress;

    return `las-${cadestralAddress}-${addressId}`;
  }

  async fetchFractionDates(addressData, addressUUID) {
    const fractionMap = {
      glass: ['4'],
      food: ['3'],
      paper: ['2'],
      plastic: ['7'],
      general: ['1'],
    };
    const pickups = this.createFractions();

    const [, cadastralAddress, addressId] = addressUUID.split('-');

    const query = [
      `matrikkelAdresse=${encodeURIComponent(cadastralAddress)}`,
      `municipalNo=${addressData.kommunenummer}`,
      `streetAddressId=${addressId}`,
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
};
