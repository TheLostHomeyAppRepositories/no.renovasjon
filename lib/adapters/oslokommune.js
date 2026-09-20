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

  // The API gives each fraction's first pickup on or after the start of the current week, so a
  // weekly (or rarer) pickup can already be in the past. Those dates are rolled forward by the
  // pickup interval. This is an extrapolation: it assumes the schedule continues unchanged, so
  // holiday shifts aren't accounted for, and the meaning of Faktor is inferred from observed
  // values rather than documented. Several pickups per week can't be extrapolated reliably,
  // since only one weekday is listed, so those dates are left as returned.
  reducedDisposals(disposalArray, today = new Date()) {
    // NOTE: Reversed fractionMap for convenience
    const fractionMap = {
      3: 'paper',
      4: 'general',
    };
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const nearest = this.createFractions();
    // Preference per fraction: confirmed future date (0), extrapolated date (1), past date (2)
    const rank = {};

    for (const d of disposalArray) {
      const key = fractionMap[d.Fraksjon.Id];
      if (!key) {
        continue;
      }
      const [day, month, year] = d.TommeDato.split('.');
      let date = new Date(Number(year), Number(month) - 1, Number(day));
      let dateRank = 0;
      if (date < startOfToday) {
        // Faktor is 10000 per pickup per week: 10000 is weekly, 5000 every 2nd week, and so on.
        const factor = Number(d.Hyppighet && d.Hyppighet.Faktor);
        if (factor > 0 && factor <= 10000) {
          const stepDays = 7 * Math.round(10000 / factor);
          while (date < startOfToday) {
            date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + stepDays);
          }
          dateRank = 1;
        } else {
          dateRank = 2;
        }
      }
      if (!nearest[key] || dateRank < rank[key] || (dateRank === rank[key] && date < nearest[key])) {
        nearest[key] = date;
        rank[key] = dateRank;
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
      String(entry.Gatekode) === String(addressData.adressekode)
      && String(entry.Husnummer) === String(addressData.nummer)
      && (entry.Bokstav || '') === (addressData.bokstav || '')
    );

    const matchesStreetNumber = (entry) => (
      String(entry.Gatekode) === String(addressData.adressekode)
      && String(entry.Husnummer) === String(addressData.nummer)
    );

    const result = respJson.result.find(matchesAddress)
      || respJson.result.find(matchesStreetNumber)
      || respJson.result[0];

    // An address can have separate collection points for different fractions, so use all of the
    // best matching ones rather than just the first.
    const exactPoints = result.HentePunkts.filter(matchesAddress);
    const streetPoints = result.HentePunkts.filter(matchesStreetNumber);
    let points;
    if (exactPoints.length > 0) {
      points = exactPoints;
    } else if (streetPoints.length > 0) {
      points = streetPoints;
    } else {
      points = [result.HentePunkts[0]];
    }

    const pickups = this.reducedDisposals(points.flatMap((point) => point.Tjenester || []));

    pickups.plastic = pickups.general; // Map plastic to general as they are collected together
    pickups.food = pickups.general; // Map food to general as they are collected together
    return pickups;
  }
};
