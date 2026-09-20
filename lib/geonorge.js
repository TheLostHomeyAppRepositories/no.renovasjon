'use strict';

// Cadastral (matrikkel) fields that are stored together with a device's address data.
const CADASTRAL_FIELDS = ['gardsnummer', 'bruksnummer', 'festenummer'];

const SEARCH_URL = 'https://ws.geonorge.no/adresser/v1/sok';

// A number when the value is numeric, otherwise null. The pair view provides strings and
// Geonorge provides numbers, so this keeps the stored type the same either way.
function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCadastral(source) {
  const result = {};
  for (const field of CADASTRAL_FIELDS) {
    result[field] = toNumberOrNull(source[field]);
  }
  return result;
}

// MIGRATION (cadastral fields): everything from here down to module.exports is only used by the
// device migration and can be deleted with it. Keep CADASTRAL_FIELDS, toNumberOrNull() and
// normalizeCadastral() above, which the driver uses when pairing.

// A field that is null still counts as present: it means the address has no value for it.
// Only a missing key means the address data was stored before these fields were added.
function hasCadastralFields(addressData) {
  return CADASTRAL_FIELDS.every((field) => addressData[field] !== undefined);
}

const text = (value) => String(value === undefined || value === null ? '' : value).trim().toUpperCase();
const cadastralKey = (entry) => CADASTRAL_FIELDS.map((field) => String(toNumberOrNull(entry[field]))).join('/');

// Finds the cadastral fields for an address that was stored without them. Resolves to
//   { status: 'found', fields }  when exactly one cadastral identity matches,
//   { status: 'notFound' }       when nothing matches,
//   { status: 'ambiguous' }      when the address matches several different properties.
// Rejects on network and HTTP errors, so callers can tell "try again later" from "no such address".
async function lookupCadastral(addressData, { fetchFn = fetch, timeoutMs = 10000 } = {}) {
  const {
    adressenavn,
    nummer,
    bokstav,
    adressekode,
    kommunenummer,
  } = addressData;
  if (!adressenavn || !kommunenummer) {
    return { status: 'notFound' };
  }

  const params = [
    ['adressenavn', adressenavn],
    ['kommunenummer', kommunenummer],
    ['treffPerSide', 50],
  ];
  if (nummer !== undefined && nummer !== null && nummer !== '') params.push(['nummer', nummer]);
  if (bokstav) params.push(['bokstav', bokstav]);
  if (adressekode) params.push(['adressekode', adressekode]);
  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');

  const options = {};
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    options.signal = AbortSignal.timeout(timeoutMs);
  }
  const response = await fetchFn(`${SEARCH_URL}?${query}`, options);
  if (!response.ok) {
    throw new Error(`Geonorge lookup failed with status ${response.status}`);
  }
  const json = await response.json();

  // The query is not exact, so only accept results that match the stored address on every field.
  const matches = (json.adresser || []).filter((entry) => (
    text(entry.adressenavn) === text(adressenavn)
    && (nummer === undefined || nummer === null || nummer === ''
      ? entry.nummer === undefined || entry.nummer === null || entry.nummer === 0
      : String(entry.nummer) === String(nummer))
    && text(entry.bokstav) === text(bokstav)
    && String(entry.kommunenummer) === String(kommunenummer)
    && (!adressekode || String(entry.adressekode) === String(adressekode))
  ));

  const identities = new Set(matches.map(cadastralKey));
  if (identities.size === 0) {
    return { status: 'notFound' };
  }
  if (identities.size > 1) {
    return { status: 'ambiguous' };
  }
  return { status: 'found', fields: normalizeCadastral(matches[0]) };
}

module.exports = {
  CADASTRAL_FIELDS,
  normalizeCadastral,
  hasCadastralFields,
  lookupCadastral,
};
