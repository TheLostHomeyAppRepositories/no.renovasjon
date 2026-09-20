'use strict';

const Homey = require('homey');
// Node.js v12 (Homey 2019) does not have fetch built-in
if (typeof fetch === 'undefined') {
  // eslint-disable-next-line global-require
  global.fetch = require('node-fetch');
}

module.exports = class RenovasjonApp extends Homey.App {
};
