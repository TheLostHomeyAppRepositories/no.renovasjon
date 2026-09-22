'use strict';

const BaseAdapter = require('./baseadapter');

// Each municipality assigns its own local FraksjonId numbers, so the same id can mean a different
// fraction elsewhere. NorkartStandardFraksjonId is the provider's own cross-municipality id, from
// /api/fraksjoner. Verified against several municipalities; 6 covers municipalities that collect
// paper and cardboard together.
const STANDARD_FRACTION_MAP = {
  1: 'general',
  2: 'food',
  3: 'paper',
  4: 'plastic',
  5: 'glass',
  6: 'paper',
  7: 'hazardous',
};

module.exports = class MinRenovasjonAdapter extends BaseAdapter {
  async _getAllMunicipalities() {
    const baseUrl = 'https://www.webatlas.no/wacloud/servicerepository/CatalogueService.svc/json/GetRegisteredAppCustomers';
    const response = await fetch(`${baseUrl}?Appid=MobilOS-NorkartRenovasjon`);
    this.assertOk(response);
    const respJson = await response.json();
    const fetched = respJson.map((m) => m.Number);
    const additions = new Set([
      // RfD:
      '3301', // Drammen
      '3312', // Lier
      '3316', // Modum
      '3332', // Sigdal
      '3314', // Øvre Eiker
      // Follo Ren:
      '3214', // Frogn
      '3212', // Nesodden
      '3207', // Nordre Follo
      '3218', // Ås
      // Fimil:
      '5620', // Nordkapp
      '5618', // Måsøy
      '5622', // Porsanger
      '5610', // Karasjok
      '5626', // Gamvik
      '5624', // Lebesby
      // RIR:
      '1547', // Aukra
      '1579', // Hustadvika
      '1557', // Gjemnes
      '1506', // Molde
      '1539', // Rauma
    ]);
    return new Set([...fetched, ...additions]);
  }

  getName() {
    return 'Min Renovasjon';
  }

  getShortName() {
    return 'Min Renovasjon';
  }

  async coversMunicipality(municipalityCode) {
    const municipalities = await this._getAllMunicipalities();
    return municipalities.has(String(municipalityCode));
  }

  // GETs a path under the provider's Komtek API, through the proxy and with the headers it
  // requires. Every endpoint used here returns a JSON array.
  async _fetchKomtek(path, kommunenummer) {
    const proxyUrl = 'https://norkartrenovasjon.azurewebsites.net/proxyserver.ashx?server=';
    const baseUrl = 'https://komteksky.norkart.no/MinRenovasjon.Api/api/';
    const response = await fetch(`${proxyUrl}${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        RenovasjonAppKey: 'AE13DEEC-804F-4615-A74E-B4FAC11F0A30',
        Kommunenr: kommunenummer,
      },
    });
    this.assertOk(response);
    const respJson = await response.json();
    if (!Array.isArray(respJson)) {
      throw new Error('Unexpected response from Min Renovasjon');
    }
    return respJson;
  }

  // The provider's schedule entries for the address, empty if it has no data for it. It matches
  // on municipality, street and house number, and ignores any letter.
  async _fetchDisposals(addressData) {
    const params = `kommunenr=${encodeURIComponent(addressData.kommunenummer)}&`
                   + `gatenavn=${encodeURIComponent(addressData.adressenavn)}&`
                   + `gatekode=${encodeURIComponent(addressData.adressekode)}&`
                   + `husnr=${encodeURIComponent(addressData.nummer)}`;
    return this._fetchKomtek(`tommekalender?${params}`, addressData.kommunenummer);
  }

  async coversAddress(addressData) {
    const disposals = await this._fetchDisposals(addressData);
    return disposals.length > 0;
  }

  // Maps the municipality's local FraksjonId to one of our fractions, via its
  // NorkartStandardFraksjonId. Ids with no entry in STANDARD_FRACTION_MAP, e.g. fractions we don't
  // track, are left out, the same as an id missing from the map entirely.
  async _fetchFractionMap(kommunenummer) {
    const respJson = await this._fetchKomtek(`fraksjoner?kommunenr=${encodeURIComponent(kommunenummer)}`, kommunenummer);
    const fractionMap = {};
    for (const entry of respJson) {
      const key = STANDARD_FRACTION_MAP[entry.NorkartStandardFraksjonId];
      if (key) {
        fractionMap[entry.Id] = key;
      }
    }
    return fractionMap;
  }

  _nearestDates(disposals, fractionMap) {
    const nearest = this.createFractions();
    for (const d of disposals) {
      const key = fractionMap[d.FraksjonId];
      if (!key) continue;
      const date = new Date(d.Tommedatoer[0]);
      if (!nearest[key] || date < nearest[key]) {
        nearest[key] = date;
      }
    }
    return nearest;
  }

  async getFractionDates(addressData) {
    const disposals = await this._fetchDisposals(addressData);
    if (disposals.length === 0) {
      throw this.addressNotFound(addressData);
    }
    const fractionMap = await this._fetchFractionMap(addressData.kommunenummer);
    return this._nearestDates(disposals, fractionMap);
  }
};
