'use strict';

const BaseAdapter = require('./baseadapter');

module.exports = class NorconsultBaseAdapter extends BaseAdapter {
  constructor(domain, applikasjonsId, oppdragsgiverId, fractionMap) {
    super();
    this.config = {
      domain,
      applikasjonsId,
      oppdragsgiverId,
      fractionMap,
    };
  }

  // All requests go through here so a provider can override how they are made.
  async _fetch(url, options) {
    return fetch(url, options);
  }

  async getAndStoreToken() {
    const response = await this._fetch(`${this.config.domain}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        applikasjonsId: this.config.applikasjonsId,
        oppdragsgiverId: this.config.oppdragsgiverId,
      }),
    });
    this.token = response.headers.get('Token');
    if (!this.token) {
      throw new Error(`Login failed with status ${response.status}`);
    }
  }

  async _getAddressUUID(addressData) {
    const addrString = this.createAddrString(addressData);
    if (!this.token) {
      await this.getAndStoreToken();
    }

    let response = await this._fetch(`${this.config.domain}/api/eiendommer?adresse=${encodeURIComponent(addrString)}`, {
      headers: {
        'Content-Type': 'application/json',
        Token: this.token,
      },
    });
    if (response.status === 500) { // Token may have expired, get a new one and try again
      await this.getAndStoreToken();
      response = await this._fetch(`${this.config.domain}/api/eiendommer?adresse=${encodeURIComponent(addrString)}`, {
        headers: {
          'Content-Type': 'application/json',
          Token: this.token,
        },
      });
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const match = this._findProperty(respJson, addressData, addrString);
    return match?.id ?? null;
  }

  // Matches on the address, then on the cadastral fields, as the provider sometimes lists a
  // property under another name that includes the address. A property split into sections is
  // listed once per section with the same cadastral fields, and then the first one is used.
  _findProperty(properties, addressData, addrString) {
    const inMunicipality = properties.filter((entry) => (
      String(entry.kommuneNr) === String(addressData.kommunenummer)
    ));
    const byAddress = inMunicipality.find((entry) => (
      entry.adresse.toUpperCase() === addrString.toUpperCase()
    ));
    if (byAddress) {
      return byAddress;
    }
    if (!Number.isInteger(addressData.gardsnummer) || !Number.isInteger(addressData.bruksnummer)) {
      return undefined;
    }
    return inMunicipality.find((entry) => (
      Number(entry.gNr) === addressData.gardsnummer
      && Number(entry.bNr) === addressData.bruksnummer
      && Number(entry.fNr) === (addressData.festenummer || 0)
    ));
  }

  async getFractionDates(addressData) {
    const addressUUID = await this._getAddressUUID(addressData);
    if (!addressUUID) {
      throw this.addressNotFound(addressData);
    }

    const today = new Date();
    const future = new Date(today);
    future.setMonth(today.getMonth() + 3);

    const fromDateStr = today.toISOString().split('T')[0];
    const toDateStr = future.toISOString().split('T')[0];

    let response = await this._fetch(`${this.config.domain}/api/tomminger?eiendomId=${addressUUID}&datoFra=${fromDateStr}&datoTil=${toDateStr}`, {
      headers: {
        Token: this.token,
      },
    });
    if (response.status === 500) { // Token may have expired, get a new one and try again
      await this.getAndStoreToken();
      response = await this._fetch(`${this.config.domain}/api/tomminger?eiendomId=${addressUUID}&datoFra=${fromDateStr}&datoTil=${toDateStr}`, {
        headers: {
          Token: this.token,
        },
      });
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    const pickups = this.reducedDisposals(respJson, this.config.fractionMap, 'fraksjonId', 'dato');
    return pickups;
  }

  async coversAddress(addressData) {
    const uuid = await this._getAddressUUID(addressData);
    return uuid !== null;
  }
};
