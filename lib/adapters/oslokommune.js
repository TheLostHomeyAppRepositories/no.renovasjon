'use strict';

const { v4: uuidv4 } = require('uuid');

const BaseAdapter = require('./baseadapter');

module.exports = class OsloKommuneAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '0301', // Oslo
  ]);

  async _getAllMunicipalities() {
    return OsloKommuneAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Oslo Kommune';
  }

  async coversMunicipality(municipalityCode) {
    return OsloKommuneAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async fetchAddressUUID(addressData) {
    // Oslo Kommune does not use address UUIDs. Generate a random one.
    return uuidv4();
  }

  reducedDisposals(disposalArray) {
    // NOTE: Reversed fractionMap for convenience
    const fractionMap = {
      3: 'paper',
      4: 'general',
    };
    const nearest = this.createFractions();

    for (const d of disposalArray) {
      const [day, month, year] = d.TommeDato.split('.');
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      const key = fractionMap[d.Fraksjon.Id];
      if (!key) {
        continue;
      }
      if (!nearest[key] || date < nearest[key]) {
        nearest[key] = date;
      }
    }

    return nearest;
  }

  async fetchFractionDates(addressData, addressUUID) {
    const url = 'https://www.oslo.kommune.no/actions/snap-lib-waste-complaint/search-by-address?'
                + `street=${encodeURIComponent(addressData.adressenavn)}`
                + `&number=${addressData.nummer}`
                + `&letter=${addressData.bokstav}`
                + `&street_id=${addressData.adressekode}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();

    // Try to match exact address first, otherwise take the first one
    const matchesAddress = (entry) => (
      String(entry.Gatekode) == addressData.adressekode
      && String(entry.Husnummer) == addressData.nummer
      && (entry.Bokstav || '') == (addressData.bokstav || '')
    );

    const matchesStreetNumber = (entry) => (
      String(entry.Gatekode) == addressData.adressekode
      && String(entry.Husnummer) == addressData.nummer
    );

    const result = respJson.result.find(matchesAddress)
      || respJson.result.find(matchesStreetNumber)
      || respJson.result[0];

    const match = result.HentePunkts.find(matchesAddress)
      || result.HentePunkts.find(matchesStreetNumber)
      || result.HentePunkts[0];

    const pickups = this.reducedDisposals(match.Tjenester);

    pickups.plastic = pickups.general; // Map plastic to general as they are collected together
    pickups.food = pickups.general; // Map food to general as they are collected together
    return pickups;
  }
};
