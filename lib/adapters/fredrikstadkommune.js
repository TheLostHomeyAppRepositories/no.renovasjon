'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class FredrikstadKommuneAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '3107', // Fredrikstad
  ]);

  async _getAllMunicipalities() {
    return FredrikstadKommuneAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Fredrikstad Kommune';
  }

  async coversMunicipality(municipalityCode) {
    return FredrikstadKommuneAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async _getAgreementNumber(addressData) {
    let addrString = addressData.adressenavn.toUpperCase();
    if (addressData.nummer !== '') {
      addrString += ` ${addressData.nummer}`;
    }
    if (addressData.bokstav) {
      addrString += ` ${addressData.bokstav}`;
    }
    const base = 'https://arcgis.fredrikstad.kommune.no/server/rest/services/Renovasjon/MinRenovasjon/MapServer/0/query';
    const where = encodeURIComponent(`UPPER(Adresse) = '${addrString}'`);
    const url = `${base}?f=json&outFields=AvtLnr&where=${where}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    if (respJson.features.length === 0) {
      return null;
    }
    return respJson.features[0].attributes.AvtLnr;
  }

  async getFractionDates(addressData) {
    const fractionMap = {
      glass: [4],
      food: [16],
      paper: [2],
      plastic: [2],
      general: [6],
      hazardous: [1],
    };

    const agreementNumber = await this._getAgreementNumber(addressData);
    if (agreementNumber === null) {
      throw this.addressNotFound(addressData);
    }
    const dateParam = new Date().toISOString().split('T')[0];
    const base = 'https://arcgis.fredrikstad.kommune.no/server/rest/services/Renovasjon/MinRenovasjon/MapServer/1/query';
    const where = `AvtLnr%20=%20${agreementNumber}%20AND%20Dato%20>=%20date%20%27${dateParam}%27`;
    const url = `${base}?f=json&outFields=Dato,AvfallId&where=${where}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const disposals = this.reducedDisposals(respJson.features, fractionMap, 'attributes.AvfallId', 'attributes.Dato');
    return disposals;
  }

  async coversAddress(addressData) {
    const agreementNumber = await this._getAgreementNumber(addressData);
    return agreementNumber !== null;
  }
};
