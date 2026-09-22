'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('node:util');
const { Listr } = require('listr2');
const { adapters } = require('./adapters-config');
const { normalizeCadastral } = require('../lib/geonorge');
const report = require('./report');

// How many adapters run at the same time. They mostly talk to different providers, but in update
// mode they all share Geonorge, so this is kept low.
const CONCURRENCY = 4;

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

const unknownAdapters = (adapterFilter || []).filter((name) => !Object.hasOwn(adapters, name));
if (unknownAdapters.length > 0) {
  console.error(`Error: Unknown adapter: ${unknownAdapters.join(', ')}`);
  console.log(`Available adapters: ${Object.keys(adapters).join(', ')}`);
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

function formatAddress(address) {
  return `${address.adressenavn} ${address.nummer}${address.bokstav}`.trim();
}

function municipalityLabel(muni, address) {
  return address && address.kommunenavn ? `${muni} ${address.kommunenavn}` : String(muni);
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

function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// --- Update logic ---
// The update and test functions don't print anything. They report how it is going through the
// `update` callback (which changes the adapter's row) and return the failures they found, each
// as { reason, label?, address? }, so an adapter has passed when it returns none.

// Municipalities some adapter is looking for an address in right now. Several adapters can cover
// the same municipality, and the first one to store an address gets it, as it did when the
// adapters ran one after the other.
const claimedMunicipalities = new Set();

// Returns { addr } when an address was stored, otherwise { reason, label }.
async function updateMunicipality(adapter, muni, progress, maxRetries = 8) {
  let label = String(muni);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    progress(`${muni}, attempt ${attempt}/${maxRetries}`);
    const addr = await getRandomAddress(muni);
    if (!addr) return { reason: 'Failed to get a random address', label };
    label = municipalityLabel(muni, addr);

    let covered;
    try {
      covered = await adapter.adapter.coversAddress(addr);
    } catch (e) {
      return { reason: `coversAddress failed: ${e.message}`, label };
    }
    if (!covered) continue;

    let fetchedDates;
    try {
      fetchedDates = await adapter.adapter.getFractionDates(addr);
    } catch (e) {
      return { reason: `getFractionDates failed: ${e.message}`, label };
    }
    const hasDate = fetchedDates && Object.values(fetchedDates).some((f) => f && f instanceof Date);
    if (!hasDate) continue;
    // OK – store
    addressStore.set(muni, addr);
    return { addr };
  }
  return { reason: `No working address found in ${maxRetries} attempts`, label };
}

async function updateAdapter(adapter, update) {
  update({ progress: 'Getting municipalities' });
  let supportedMunicipalities;
  try {
    supportedMunicipalities = await adapter.adapter._getAllMunicipalities();
  } catch (e) {
    return { failures: [{ reason: `Failed to get supported municipalities: ${e.message}` }] };
  }

  // Skip municipalities that already have an address in the file. If a previously working
  // address stops working, manually remove it from the file.
  let todo = [...supportedMunicipalities].filter((m) => !addressStore.has(m));
  // When testAll.. is false, one of the municipalities missing from the file is enough.
  if (!adapter.testAllMunicipalities && todo.length > 0) todo = [randomElement(todo)];
  if (todo.length === 0) {
    update({ progress: 'All municipalities already have an address' });
    return { failures: [] };
  }

  const failures = [];
  let saved = 0;
  for (const [i, muni] of todo.entries()) {
    // Another adapter may have stored an address since the list was made
    if (addressStore.has(muni) || claimedMunicipalities.has(muni)) continue;
    claimedMunicipalities.add(muni);
    let outcome;
    try {
      outcome = await updateMunicipality(adapter, muni, (text) => {
        update({ progress: `${i + 1}/${todo.length}: ${text}` });
      });
    } catch (e) {
      outcome = { reason: e.message, label: String(muni) };
    } finally {
      claimedMunicipalities.delete(muni);
    }
    if (outcome.addr) {
      saved++;
    } else {
      failures.push({ label: outcome.label, reason: outcome.reason });
    }
  }
  update({ progress: `${saved} saved, ${failures.length} failed` });
  return { failures };
}

// --- Test logic ---
// Returns { nextPickup } when the address works, otherwise { failure }.
async function testMunicipality(adapter, muni) {
  const addr = addressStore.get(muni);
  if (!addr) {
    return { failure: { label: municipalityLabel(muni), reason: 'No address stored for the municipality' } };
  }
  const fail = (reason) => ({
    failure: { label: municipalityLabel(muni, addr), address: formatAddress(addr), reason },
  });

  let covered;
  try {
    covered = await adapter.adapter.coversAddress(addr);
  } catch (e) {
    return fail(`coversAddress failed: ${e.message}`);
  }
  if (!covered) return fail('The address is not covered by the provider');

  let fetchedDates;
  try {
    fetchedDates = await adapter.adapter.getFractionDates(addr);
  } catch (e) {
    return fail(`getFractionDates failed: ${e.message}`);
  }
  const dates = Object.values(fetchedDates || {}).filter((f) => f instanceof Date);
  if (dates.length === 0) return fail('Failed to get valid fraction dates');
  const now = new Date();
  const futureDates = dates.filter((date) => date > now);
  if (futureDates.length === 0) return fail('No future fraction dates');
  return { nextPickup: new Date(Math.min(...futureDates)) };
}

// Test the interfacing from the driver
async function testInterfacing(adapter, supportedMunicipalities) {
  const randomSupportedMuni = randomElement([...supportedMunicipalities]);
  const nonSupportedMuni = '5000'; // Not supported because it doesn't exist

  const supportsSupported = await adapter.adapter.coversMunicipality(randomSupportedMuni);
  const supportsNonSupported = await adapter.adapter.coversMunicipality(nonSupportedMuni);
  return supportsSupported && !supportsNonSupported;
}

async function testAdapter(adapter, update) {
  update({ interface: 'running' });
  const interfaceFailure = (reason) => {
    update({ interface: 'fail', fetch: 'skip' });
    return { failures: [{ reason }] };
  };

  let supportedMunicipalities;
  try {
    supportedMunicipalities = await adapter.adapter._getAllMunicipalities();
  } catch (e) {
    return interfaceFailure(`Failed to get supported municipalities: ${e.message}`);
  }
  let interfaceOk;
  try {
    interfaceOk = await testInterfacing(adapter, supportedMunicipalities);
  } catch (e) {
    return interfaceFailure(`coversMunicipality failed: ${e.message}`);
  }
  if (!interfaceOk) {
    return interfaceFailure('coversMunicipality does not agree with the municipality list');
  }
  update({ interface: 'ok', fetch: 'running' });

  let toTest;
  if (adapter.testAllMunicipalities && fullMode) {
    toTest = [...supportedMunicipalities];
  } else {
    const candidates = [...supportedMunicipalities].filter((m) => addressStore.has(m));
    if (candidates.length === 0) {
      update({ fetch: 'skip' });
      return { failures: [{ reason: 'No municipalities in address store' }] };
    }
    toTest = [randomElement(candidates)];
  }
  const many = toTest.length > 1;

  const failures = [];
  let nextPickup = null;
  for (const [i, muni] of toTest.entries()) {
    update({
      municipality: many
        ? `${i + 1}/${toTest.length} municipalities`
        : municipalityLabel(muni, addressStore.get(muni)),
    });
    const outcome = await testMunicipality(adapter, muni);
    if (outcome.failure) failures.push(outcome.failure);
    else nextPickup = outcome.nextPickup;
  }

  const patch = { fetch: failures.length > 0 ? 'fail' : 'ok' };
  if (many) {
    const failedText = failures.length > 0 ? `, ${failures.length} failed` : '';
    patch.municipality = `${toTest.length} municipalities${failedText}`;
  } else {
    patch.pickup = report.formatPickup(nextPickup);
  }
  update(patch);
  return { failures };
}

async function runAllTests() {
  const selected = Object.entries(adapters)
    .filter(([name]) => !adapterFilter || adapterFilter.includes(name));
  const nameWidth = Math.max('Adapter'.length, ...selected.map(([name]) => name.length));
  const table = updateMode ? report.updateTable : report.testTable;
  const runAdapter = updateMode ? updateAdapter : testAdapter;
  // Listr2 redraws the rows in place on a terminal. Otherwise (piped output, CI) it stays silent
  // and each row is printed once, when its adapter is done.
  const live = Boolean(process.stdout.isTTY);

  const results = new Map();
  const tasks = selected.map(([name, adapter]) => {
    const view = table.newView(name);
    return {
      title: table.row(nameWidth, view),
      task: async (ctx, task) => {
        const update = (patch) => {
          Object.assign(view, patch);
          task.title = table.row(nameWidth, view);
        };
        const started = Date.now();
        update({ queued: false });
        let outcome;
        try {
          outcome = await runAdapter(adapter, update);
        } catch (e) {
          outcome = { failures: [{ reason: e.message }] };
        }
        update({ ms: Date.now() - started });

        results.set(name, { name, failures: outcome.failures });
        const ok = outcome.failures.length === 0;
        if (!live) console.log(`${report.icon(ok)} ${table.row(nameWidth, view)}`);
        // The reason is shown in the summary, but Listr2 needs the error to mark the row failed
        if (!ok) throw new Error(outcome.failures[0].reason);
      },
    };
  });

  const started = Date.now();
  console.log(table.header(nameWidth));
  await new Listr(tasks, {
    concurrent: CONCURRENCY,
    exitOnError: false,
    renderer: live ? 'default' : 'silent',
    fallbackRenderer: 'silent',
    fallbackRendererCondition: false,
    rendererOptions: { formatOutput: 'truncate', showErrorMessage: false },
  }).run();

  // In the order of the adapters, not of when they finished
  const ordered = selected.map(([name]) => results.get(name));
  report.printSummary(ordered, Date.now() - started, updateMode ? 'complete' : 'passed');
  const failed = ordered.filter((result) => result.failures.length > 0).length;
  return { passed: ordered.length - failed, failed };
}

// Run all test if executed directly
if (require.main === module) {
  runAllTests()
    .then(({ failed }) => {
      process.exitCode = failed > 0 ? 1 : 0;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

module.exports = { runAllTests };
