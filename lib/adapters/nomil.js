'use strict';

const https = require('https');
const nodeFetch = require('node-fetch');

const NorconsultBase = require('./norconsultbase');

// The NOMIL server presents a self-signed certificate (issued to its internal hostname,
// NOMIL-APP01.nomil.no) that can't be verified, so the adapter can't connect with certificate
// checking on. It is turned off for requests to this provider only. The requests carry no
// personal data, but the responses can't be authenticated. Remove this once NOMIL serves a
// proper certificate.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

module.exports = class NOMILAdapter extends NorconsultBase {
  static MUNICIPALITIES = new Set([
    '4651', // Stryn
    '4650', // Gloppen
    '4648', // Bremanger
    '4649', // Stad
    '4602', // Kinn
  ]);

  constructor() {
    const domain = 'https://tommeplan.nomil.no:9000';
    const applikasjonsId = '380b0118-95ba-4c57-b53c-2f79c3922d65';
    const oppdragsgiverId = '100';
    const fractionMap = {
      general: ['9999'],
      glass: ['2612'],
      paper: ['2410'],
      plastic: ['2410'],
      food: ['2110'],
    };
    super(domain, applikasjonsId, oppdragsgiverId, fractionMap);
  }

  // The built-in fetch can't be given a per-request TLS setting, so use node-fetch here.
  async _fetch(url, options = {}) {
    return nodeFetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      agent: insecureAgent,
    });
  }

  async _getAllMunicipalities() {
    return NOMILAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Nordjord Miljøverk (NOMIL)';
  }

  getShortName() {
    return 'NOMIL';
  }

  async coversMunicipality(municipalityCode) {
    return NOMILAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }
};
