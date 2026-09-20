'use strict';

const cheerio = require('cheerio');
const BaseAdapter = require('./baseadapter');

module.exports = class SORAdapter extends BaseAdapter {
  static MUNICIPALITIES = new Set([
    '3419', // Våler
    '3418', // Åsnes
    '3417', // Grue
  ]);

  async _getAllMunicipalities() {
    return SORAdapter.MUNICIPALITIES;
  }

  getName() {
    return 'Solør Renovasjon IKS (SOR)';
  }

  async coversMunicipality(municipalityCode) {
    return SORAdapter.MUNICIPALITIES.has(String(municipalityCode));
  }

  async fetchAddressUUID(addressData) {
    let addrString = addressData.adressenavn;
    if (addressData.nummer !== '') {
      addrString += ` ${addressData.nummer}`;
    }
    if (addressData.bokstav) {
      addrString += ` ${addressData.bokstav}`;
    }
    const response = await fetch(`https://www.solorrenovasjon.no/pub/handlers/address_search.ashx?q=${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const respJson = await response.json();
    if (respJson.length === 0) {
      return null;
    }
    const match = respJson.find((entry) => (
      entry.urlquery.toUpperCase() === `${addrString.toUpperCase()}|${addressData.kommunenummer}`
    ));
    return match?.locationid;
  }

  async fetchFractionDates(addressData, addressUUID) {
    const fractionMap = {
      glass: ['Emballasje av glass og metall'],
      food: ['Matavfall'],
      paper: ['Papp, papir og drikkekartong'],
      plastic: ['Plastemballasje'],
      general: ['Restavfall'],
    };

    let addrString = addressData.adressenavn;
    if (addressData.nummer !== '') {
      addrString += ` ${addressData.nummer}`;
    }
    if (addressData.bokstav) {
      addrString += ` ${addressData.bokstav}`;
    }
    addrString += `|${addressData.kommunenummer}`;

    const pickups = this.createFractions();
    const response = await fetch(`https://www.solorrenovasjon.no/tommekalender?a=${encodeURIComponent(addrString)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const html = await response.text();
    const $ = cheerio.load(html);

    const months = [
      'Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Desember',
    ];

    $('.calendar').each((i, table) => {
      const monthYear = $(table).prev('h3').text().trim();
      const [monthStr, yearStr] = monthYear.split(' ');
      const month = months.indexOf(monthStr);
      const year = parseInt(yearStr, 10);
      $(table).find('.bars').each((j, bars) => {
        const day = parseInt($(bars).prev('.date').text().trim(), 10);
        const date = new Date(year, month, day);
        $(bars).find('div').each((k, bar) => {
          for (const ourFrac of Object.keys(fractionMap)) {
            if (fractionMap[ourFrac].includes($(bar).attr('title'))) {
              if (!pickups[ourFrac] || date < pickups[ourFrac]) {
                pickups[ourFrac] = date;
              }
            }
          }
        });
      });
    });
    return pickups;
  }
};
