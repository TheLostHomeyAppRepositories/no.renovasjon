'use strict';

const adapterConfigs = [
  { name: 'remidt', testAll: true },
  { name: 'trv', testAll: true },
  { name: 'ir', testAll: true },
  { name: 'minrenovasjon', testAll: false }, // Too many municipalities to test them all
  { name: 'fosenrenovasjon', testAll: true },
  { name: 'hra', testAll: true },
  { name: 'oslokommune', testAll: true },
  { name: 'fredrikstadkommune', testAll: true },
  { name: 'sim', testAll: true },
  { name: 'ngir', testAll: true },
  { name: 'bir', testAll: true },
  { name: 'him', testAll: true },
  { name: 'hr', testAll: true },
  { name: 'iris', testAll: true },
  { name: 'ivar', testAll: true },
  { name: 'nomil', testAll: true },
  { name: 'shmil', testAll: true },
  { name: 'utsira', testAll: true },
  { name: 'avfallsor', testAll: true },
  { name: 'sandneskommune', testAll: true },
  { name: 'stavangerkommune', testAll: true },
  { name: 'timekommune', testAll: true },
  { name: 'sum', testAll: true },
  { name: 'sor', testAll: true },
  { name: 'las', testAll: true },
  { name: 'karmoykommune', testAll: true },
];

const adapters = {};
for (const cfg of adapterConfigs) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const AdapterClass = require(`../lib/adapters/${cfg.name}`);
  adapters[cfg.name] = {
    adapter: new AdapterClass(),
    testAllMunicipalities: cfg.testAll,
  };
}

module.exports = { adapters };
