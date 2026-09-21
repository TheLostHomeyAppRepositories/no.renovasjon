'use strict';

const { AddressNotFoundError } = require('../errors');

module.exports = class BaseAdapter {

  async _getAllMunicipalities() {
    throw new Error('_getAllMunicipalities() must be implemented by adapter subclasses');
  }

  // Override to return the name of the provider
  getName() {
    throw new Error('getName() must be implemented by adapter subclasses');
  }

  // Override to return the short version of the provider name
  getShortName() {
    throw new Error('getShortName() must be implemented by adapter subclasses');
  }

  // Override to return true if the provider covers the given municipality code
  async coversMunicipality(municipalityCode) {
    throw new Error('coversMunicipality() must be implemented by adapter subclasses');
  }

  // Override to return true if the provider covers the given address
  async coversAddress(addressData) {
    throw new Error('coversAddress(addressData) must be implemented by adapter subclasses');
  }

  // The street address as the providers write it: the street name, the number and the letter
  createAddrString(addressData) {
    let addrString = addressData.adressenavn;
    if (addressData.nummer !== '') {
      addrString += ` ${addressData.nummer}`;
    }
    if (addressData.bokstav) {
      addrString += ` ${addressData.bokstav}`;
    }
    return addrString;
  }

  // Returns the error to throw when the provider has no matching address. It names the provider
  // and the municipality, but not the address itself, as it may end up in logs.
  addressNotFound(addressData) {
    return new AddressNotFoundError(
      `${this.getName()} found no matching address in municipality ${addressData.kommunenummer}`,
    );
  }

  // Override to fetch the fraction dates for the given address. The adapter does everything that
  // is needed itself, including any lookup of the address at the provider, so it depends on
  // nothing but the address data.
  async getFractionDates(addressData) {
    throw new Error('getFractionDates(addressData) must be implemented by adapter subclasses');
  }

  createFractions() {
    return {
      general: null,
      food: null,
      paper: null,
      plastic: null,
      glass: null,
      hazardous: null,
      garden: null,
    };
  }

  reducedDisposals(disposalArray, fractionMap, fractionKey, dateKey) {
    const nearest = this.createFractions();

    if (!Array.isArray(disposalArray)) {
      return nearest;
    }

    // Helper function to get nested values
    const getValue = (obj, path) => (
      path.split('.').reduce((acc, part) => acc?.[part], obj)
    );

    for (const d of disposalArray) {
      for (const [ourFrac, apiFracs] of Object.entries(fractionMap)) {
        if (apiFracs.includes(getValue(d, fractionKey))) {
          const date = new Date(getValue(d, dateKey));
          if (!nearest[ourFrac] || date < nearest[ourFrac]) {
            nearest[ourFrac] = date;
          }
        }
      }
    }
    return nearest;
  }
};
