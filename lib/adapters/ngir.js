'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class NGIRAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '4631', // Alver
    '4632', // Austrheim
    '4633', // Fedje
    '4635', // Gulen
    '4634', // Masfjorden
    '4629', // Modalen
    '4636', // Solund
  ]);

  async _getAllMunicipalities() {
    return NGIRAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Renovasjon i Nordhordland, Gulen og Solund (NGIR)';
  }

  getShortName() {
    return 'NGIR';
  }

  async coversMunicipality(municipalityCode) {
    return NGIRAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  // The description of a search result ends with the municipality and the county, e.g.
  // "5919 FREKHAUG (Alver, Vestland)". Returns the municipality in upper case.
  _municipalityOf(record) {
    const parsed = record.desc.match(/\(([^,]+), [^)]+\)\s*$/);
    return parsed ? parsed[1].toUpperCase() : null;
  }

  async _getAddressPoint(addressData) {
    const addrString = this.createAddrString(addressData);
    // The search covers the whole country, and the same street address exists in many places.
    // The municipality in the query ranks the right one first, and the results are checked for it.
    const searchPayload = {
      request: {
        q: `${addrString} ${addressData.kommunenavn}`,
        layers: 'AdaptiveAddresses',
        start: 0,
        limit: 10,
      },
    };
    const response = await fetch('https://www.ngirkart.no/WebServices/search/SearchProxy.asmx/Search', {
      body: JSON.stringify(searchPayload),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const match = respJson.d.records.find((entry) => (
      entry.title.toUpperCase() === addrString.toUpperCase()
      && this._municipalityOf(entry) === addressData.kommunenavn.toUpperCase()
    ));
    if (!match) {
      return null;
    }
    const [lon, lat] = match.geom
      .replace('POINT (', '')
      .replace(')', '')
      .split(' ')
      .map(Number);
    const [x, y] = this.lonLatToWebMercator(lon, lat);
    return `SRID=3857;POINT(${x} ${y})`;
  }

  lonLatToWebMercator(lon, lat) {
    const maxWebMercator = 20037508.34;
    const x = (lon * maxWebMercator) / 180;
    let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    y = (y * maxWebMercator) / 180;
    return [x, y];
  }

  createRequestBodyStr(addressPoint) {
    return JSON.stringify({
      request: {
        theme_uuid: 'b40744b8-2d70-441e-89c0-0414b4911df6',
        filter: {
          filterColumns: [
            {
              name: 'geom',
              comparisonOperator: 'ST_INTERSECTS',
              netType: 'geometry',
              logicalOperator: 'AND',
              value: addressPoint,
            },
          ],
        },
        columns: [
          'fraksjon_dynamisk',
          'fraksjon_dynamisk_neste',
          'hentedag',
          'hentedag_nesteveke',
          'aktuelluke',
          'nesteuke',
        ],
        srid: '3857',
        start: 0,
        limit: 100,
      },
    });
  }

  // The API writes the weekdays in Nynorsk (Måndag, Tysdag), and Bokmål is accepted as well
  dayStrToIsoNum(dayStr) {
    const days = {
      måndag: 0,
      mandag: 0,
      tysdag: 1,
      tirsdag: 1,
      onsdag: 2,
      torsdag: 3,
      fredag: 4,
      laurdag: 5,
      lørdag: 5,
      sundag: 6,
      søndag: 6,
    };
    const isoDay = days[String(dayStr).toLowerCase()];
    if (!Number.isInteger(isoDay)) {
      throw new Error(`Unexpected weekday from NGIR: ${dayStr}`);
    }
    return isoDay;
  }

  // Slighty strange. This API is a bit awkward, and we need to make some assumptions.
  // If the date of the pickup this week has passed, we assume the next pickup is in two weeks.
  getDateOfThisWeek(isoWeekDay) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = today.getDay(); // 0 (Sun) to 6 (Sat)
    const isoDay = (day + 6) % 7; // Convert to ISO (Mon=0, Sun=6)
    const result = new Date(today);
    result.setDate(today.getDate() + (isoWeekDay - isoDay));
    if (result < today) {
      result.setDate(result.getDate() + 14); // Add two weeks
    }
    return result;
  }

  getDateOfNextWeek(isoWeekDay) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = today.getDay(); // 0 (Sun) to 6 (Sat)
    const isoDay = (day + 6) % 7; // Convert to ISO (Mon=0, Sun=6)
    const result = new Date(today);
    result.setDate(today.getDate() + (isoWeekDay - isoDay) + 7); // Next week
    return result;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      general: ['Restavfall og bioavfall'],
      paper: ['Papir, papp, plast og bioavfall'],
      food: ['Papir, papp, plast og bioavfall', 'Restavfall og bioavfall'],
      plastic: ['Papir, papp, plast og bioavfall'],
    };
    const addressPoint = await this._getAddressPoint(addressData);
    if (!addressPoint) {
      throw this.addressNotFound(addressData);
    }

    const response = await fetch('https://www.ngirkart.no/WebServices/client/DataView.asmx/ReadAny', {
      body: this.createRequestBodyStr(addressPoint),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const pickups = this.createFractions();
    if (respJson.d.records.length === 0) {
      return pickups;
    }
    // Seems like there is only one record per address
    const record = respJson.d.records[0];
    const isoWeekDayThisWeek = this.dayStrToIsoNum(record.hentedag);
    const isoWeekDayNextWeek = this.dayStrToIsoNum(record.hentedag_nesteveke);
    const dateOfThisWeek = this.getDateOfThisWeek(isoWeekDayThisWeek);
    const dateOfNextWeek = this.getDateOfNextWeek(isoWeekDayNextWeek);
    for (const [ourFrac, apiFracs] of Object.entries(fractionMap)) {
      if (apiFracs.includes(record.fraksjon_dynamisk)) {
        if (!pickups[ourFrac] || dateOfThisWeek < pickups[ourFrac]) {
          pickups[ourFrac] = dateOfThisWeek;
        }
      }
      if (apiFracs.includes(record.fraksjon_dynamisk_neste)) {
        if (!pickups[ourFrac] || dateOfNextWeek < pickups[ourFrac]) {
          pickups[ourFrac] = dateOfNextWeek;
        }
      }
    }
    return pickups;
  }

  async coversAddress(addressData) {
    const point = await this._getAddressPoint(addressData);
    return point !== null;
  }
};
