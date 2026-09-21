'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('node:util');
const { adapters } = require('./adapters-config');
const { normalizeCadastral } = require('../lib/geonorge');

// --- Parse command line arguments ---
let updateMode = false;
let fullMode = false;
let adapterFilter = null;

const options = {
  'update-addresses': {
    type: 'boolean',
  },
  full: {
    type: 'boolean',
  },
  adapters: {
    type: 'string',
  },
};

try {
  const { values } = parseArgs({
    options,
    strict: true,
    allowPositionals: false,
  });

  updateMode = !!values['update-addresses'];
  fullMode = !!values['full'];
  adapterFilter = values.adapters ? values.adapters.split(',') : null;
} catch (e) {
  console.error(`Error: ${e.message}`);
  console.log('Allowed flags: --update-addresses, --full, --adapters <adapter1,adapter2,...>');
  process.exit(1);
}

const addressesFile = path.join(__dirname, 'valid-addresses.json');

// The address data as the pair view and driver produce it, which is what the adapters get in
// production: the address fields as strings, empty when missing, and the cadastral fields as
// numbers or null. Geonorge results and older stored addresses have numbers for some of them.
function toPairedAddress(address) {
  const text = (value) => (value === undefined || value === null ? '' : String(value));
  const paired = {
    adressenavn: text(address.adressenavn),
    nummer: text(address.nummer),
    bokstav: text(address.bokstav),
    adressekode: address.adressekode ? String(address.adressekode) : '',
    kommunenavn: text(address.kommunenavn),
    kommunenummer: text(address.kommunenummer),
  };
  return Object.assign(paired, normalizeCadastral(address));
}

// --- Address storage ---
function loadValidAddresses() {
  if (!fs.existsSync(addressesFile)) return {};
  return JSON.parse(fs.readFileSync(addressesFile, 'utf-8'));
}

function saveValidAddresses(data) {
  fs.writeFileSync(addressesFile, JSON.stringify(data, null, 2));
}

const addressStore = {
  data: loadValidAddresses(),
  get(muni) {
    return this.data[muni] && toPairedAddress(this.data[muni]);
  },
  set(muni, addr) {
    this.data[muni] = addr;
    saveValidAddresses(this.data);
  },
  has(muni) {
    return Boolean(this.data[muni]);
  },
};

// --- Address generation ---
async function getRandomAddress(municipalityNumber, maxRetries = 5) {
  const url = `https://ws.geonorge.no/adresser/v1/sok?kommunenummer=${municipalityNumber}&treffPerSide=1`;
  const initialResp = await fetch(url);
  const initialRespJson = await initialResp.json();
  const addrCount = initialRespJson.metadata.totaltAntallTreff;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const randomPage = Math.floor(Math.random() * addrCount);
    const addrResp = await fetch(`${url}&side=${randomPage}`);
    if (!addrResp.ok) continue;
    const addrRespJson = await addrResp.json();
    const addrElement = addrRespJson.adresser[0];
    if (addrElement && addrElement.adressenavn) {
      return toPairedAddress(addrElement);
    }
  }
  return null;
}

// --- Update and test logic ---
async function updateMunicipality(adapter, muni, maxRetries = 8) {
  console.log(`Updating address for ${adapter.adapter.getName()} kommune ${muni}...`);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    console.log(`  Attempt number ${attempt + 1}...`);
    const addr = await getRandomAddress(muni);
    if (!addr) {
      console.log(`  Failed to get random address for ${muni}`);
      return false;
    }

    let covered;
    try {
      covered = await adapter.adapter.coversAddress(addr);
    } catch (e) {
      console.log(`  coversAddress failed: ${e.message}`);
      return false;
    }
    if (!covered) continue;

    let fetchedDates;
    try {
      fetchedDates = await adapter.adapter.getFractionDates(addr);
    } catch (e) {
      console.log(`  getFractionDates failed: ${e.message}`);
      return false;
    }
    const hasDate = fetchedDates && Object.values(fetchedDates).some((f) => f && f instanceof Date);
    if (!hasDate) continue;
    // OK – store
    addressStore.set(muni, addr);
    console.log(`  Saved valid address for ${muni}: ${addr.adressenavn} ${addr.nummer}${addr.bokstav || ''}`);
    return true;
  }
  console.log(`  Failed to get random address for ${muni}`);
  return false;
}

async function testMunicipality(adapter, muni) {
  const addr = addressStore.get(muni);
  if (!addr) {
    console.log(`  Missing address for ${muni}, test fails.`);
    return false;
  }
  let covered;
  try {
    covered = await adapter.adapter.coversAddress(addr);
  } catch (e) {
    console.log(`  coversAddress failed: ${e.message}`);
    return false;
  }
  if (!covered) {
    console.log(`  Address in ${muni} is not covered by the provider, test fails.`);
    return false;
  }
  let fetchedDates;
  try {
    fetchedDates = await adapter.adapter.getFractionDates(addr);
  } catch (e) {
    console.log(`  getFractionDates failed: ${e.message}`);
    return false;
  }
  const hasDate = fetchedDates && Object.values(fetchedDates).some((f) => f && f instanceof Date);
  if (!hasDate) {
    console.log(`  Failed to get valid fraction dates for address in ${muni}, test fails.`);
    return false;
  }
  const hasDateInFuture = Object.values(fetchedDates).some((f) => f && f > new Date());
  if (!hasDateInFuture) {
    console.log(`  No future fraction dates for address in ${muni}, test fails.`);
    return false;
  }
  return true;
}

// Test the interfacing from the driver
async function testInterfacing(adapter, supportedMunicipalities) {
  const randomIndex = Math.floor(Math.random() * supportedMunicipalities.size);
  const randomSupportedMuni = [...supportedMunicipalities][randomIndex];
  const nonSupportedMuni = '5000'; // Not supported because it doesn't exist

  const supportsSupported = await adapter.adapter.coversMunicipality(randomSupportedMuni);
  const supportsNonSupported = await adapter.adapter.coversMunicipality(nonSupportedMuni);
  return supportsSupported && !supportsNonSupported;
}

async function runTest(adapter) {
  console.log(`\n=== Testing adapter: ${adapter.adapter.getName()} ===`);
  let supportedMunicipalities;
  try {
    supportedMunicipalities = await adapter.adapter._getAllMunicipalities();
  } catch (e) {
    console.log(`Failed to get supported municipalities: ${e.message}`);
    return false;
  }

  if (updateMode) {
    if (adapter.testAllMunicipalities) {
      for (const muni of supportedMunicipalities) {
        // Skip if municipality already has an address in file. If a previously working
        // address stops working, manually remove it from the file.
        if (!addressStore.has(muni)) {
          await updateMunicipality(adapter, muni);
        }
      }
    } else {
      // When testAll.. is false, find one of the supported municipalities that is
      // missing from the file (if any).
      const candidates = [...supportedMunicipalities].filter((m) => !addressStore.has(m));
      if (candidates.length > 0) {
        const randomMuni = candidates[Math.floor(Math.random() * candidates.length)];
        await updateMunicipality(adapter, randomMuni);
      } else {
        console.log(`All municipalities already covered for ${adapter.adapter.getName()}`);
      }
    }
    return true;
  }
  const interfaceOk = await testInterfacing(adapter, supportedMunicipalities);
  console.log(`Interface check: ${interfaceOk ? 'PASSED' : 'FAILED'}`);
  if (!interfaceOk) {
    return false;
  }
  if (adapter.testAllMunicipalities && fullMode) {
    let success = true;
    for (const muni of supportedMunicipalities) {
      const ok = await testMunicipality(adapter, muni);
      console.log(`Municipality ${muni}: ${ok ? 'PASSED' : 'FAILED'}`);
      success = success && ok;
    }
    return success;
  }
  const candidates = [...supportedMunicipalities].filter((m) => addressStore.has(m));
  if (candidates.length === 0) {
    console.log(`${adapter.adapter.getName()}: No municipalities in address store!`);
    return false;
  }
  const randomMuni = candidates[Math.floor(Math.random() * candidates.length)];
  const ok = await testMunicipality(adapter, randomMuni);
  console.log(`${adapter.adapter.getName()} ${randomMuni}: ${ok ? 'PASSED' : 'FAILED'}`);
  return ok;
}

async function runAllTests() {
  let passed = 0;
  let failed = 0;
  for (const [name, adapter] of Object.entries(adapters)) {
    if (adapterFilter && !adapterFilter.includes(name)) continue;
    const result = await runTest(adapter);
    if (result) passed++;
    else failed++;
  }
  console.log(`Total adapters tested: ${passed + failed}`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
}

// Run all test if executed directly
if (require.main === module) {
  runAllTests().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { runAllTests };
