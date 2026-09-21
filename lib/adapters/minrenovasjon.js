'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class MinRenovasjonAdapter extends BaseAdapter {
  async _getAllMunicipalities() {
    const baseUrl = 'https://www.webatlas.no/wacloud/servicerepository/CatalogueService.svc/json/GetRegisteredAppCustomers';
    const response = await fetch(`${baseUrl}?Appid=MobilOS-NorkartRenovasjon`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
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

  // The provider's schedule entries for the address, empty if it has no data for it. It matches
  // on municipality, street and house number, and ignores any letter.
  async _fetchDisposals(addressData) {
    const proxyUrl = 'https://norkartrenovasjon.azurewebsites.net/proxyserver.ashx?server=';
    const baseUrl = 'https://komteksky.norkart.no/MinRenovasjon.Api/api/tommekalender?';
    const params = `kommunenr=${encodeURIComponent(addressData.kommunenummer)}&`
                   + `gatenavn=${encodeURIComponent(addressData.adressenavn)}&`
                   + `gatekode=${encodeURIComponent(addressData.adressekode)}&`
                   + `husnr=${encodeURIComponent(addressData.nummer)}`;
    const fullUrl = proxyUrl + baseUrl + params;

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        RenovasjonAppKey: 'AE13DEEC-804F-4615-A74E-B4FAC11F0A30',
        Kommunenr: addressData.kommunenummer,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    if (!Array.isArray(respJson)) {
      throw new Error('Unexpected response from Min Renovasjon');
    }
    return respJson;
  }

  async coversAddress(addressData) {
    const disposals = await this._fetchDisposals(addressData);
    return disposals.length > 0;
  }

  reducedDisposals(disposals) {
    // NOTE: Reversed fractionMap for convenience
    const fractionMap = {
      1: 'general',
      2: 'paper',
      3: 'food',
      4: 'glass',
      7: 'plastic',
      15: 'hazardous',
    };
    const nearest = this.createFractions();
    for (const d of disposals) {
      const date = new Date(d.Tommedatoer[0]);
      const key = fractionMap[d.FraksjonId];
      if (!key) continue;
      nearest[key] = date;
    }
    return nearest;
  }

  async getFractionDates(addressData) {
    const disposals = await this._fetchDisposals(addressData);
    if (disposals.length === 0) {
      throw this.addressNotFound(addressData);
    }
    return this.reducedDisposals(disposals);
  }
};
