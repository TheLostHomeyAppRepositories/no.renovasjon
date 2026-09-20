'use strict';

const Homey = require('homey');

// Adapters are required lazily, so only the ones actually in use get loaded.
/* eslint-disable global-require */
const ADAPTER_FACTORIES = {
  remidt: () => new (require('../../lib/adapters/remidt'))(),
  trv: () => new (require('../../lib/adapters/trv'))(),
  glor: () => new (require('../../lib/adapters/glor'))(),
  ir: () => new (require('../../lib/adapters/ir'))(),
  minrenovasjon: () => new (require('../../lib/adapters/minrenovasjon'))(),
  fosenrenovasjon: () => new (require('../../lib/adapters/fosenrenovasjon'))(),
  hra: () => new (require('../../lib/adapters/hra'))(),
  oslokommune: () => new (require('../../lib/adapters/oslokommune'))(),
  fredrikstadkommune: () => new (require('../../lib/adapters/fredrikstadkommune'))(),
  vkr: () => new (require('../../lib/adapters/vkr'))(),
  sim: () => new (require('../../lib/adapters/sim'))(),
  ngir: () => new (require('../../lib/adapters/ngir'))(),
  bir: () => new (require('../../lib/adapters/bir'))(),
  him: () => new (require('../../lib/adapters/him'))(),
  hr: () => new (require('../../lib/adapters/hr'))(),
  iris: () => new (require('../../lib/adapters/iris'))(),
  ivar: () => new (require('../../lib/adapters/ivar'))(),
  nomil: () => new (require('../../lib/adapters/nomil'))(),
  shmil: () => new (require('../../lib/adapters/shmil'))(),
  utsira: () => new (require('../../lib/adapters/utsira'))(),
  avfallsor: () => new (require('../../lib/adapters/avfallsor'))(),
  sandneskommune: () => new (require('../../lib/adapters/sandneskommune'))(),
  stavangerkommune: () => new (require('../../lib/adapters/stavangerkommune'))(),
  timekommune: () => new (require('../../lib/adapters/timekommune'))(),
  sum: () => new (require('../../lib/adapters/sum'))(),
  sor: () => new (require('../../lib/adapters/sor'))(),
  las: () => new (require('../../lib/adapters/las'))(),
  karmoykommune: () => new (require('../../lib/adapters/karmoykommune'))(),
};
/* eslint-enable global-require */

module.exports = class RenovasjonDriver extends Homey.Driver {

  diffInCalendarDays(dateFuture, datePast) {
    const utcFuture = Date.UTC(
      dateFuture.getFullYear(),
      dateFuture.getMonth(),
      dateFuture.getDate(),
    );

    const utcPast = Date.UTC(
      datePast.getFullYear(),
      datePast.getMonth(),
      datePast.getDate(),
    );

    return Math.floor((utcFuture - utcPast) / 86400000);
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.adapterFactories = ADAPTER_FACTORIES;
    this.adapters = {};

    this.scheduleMidnightUpdate();

    // Flow card registrations
    const cardConditionGarbageIsCollected = this.homey.flow.getConditionCard('garbage-is-collected');
    cardConditionGarbageIsCollected.registerRunListener(async (args, state) => {
      const fractions = await args.device.fractionDates;
      const today = new Date();
      for (const [, fractionDate] of Object.entries(fractions)) {
        if (!fractionDate) {
          continue;
        }
        const diffDays = this.diffInCalendarDays(fractionDate, today);
        if (diffDays === Number(args.days)) {
          return true;
        }
      }
      return false;
    });

    const cardActionGetFractionToken = this.homey.flow.getActionCard('get-fraction-token');
    cardActionGetFractionToken.registerRunListener(async (args, state) => {
      const fractions = await args.device.fractionDates || {};
      const today = new Date();
      // Find all fractions picked up in N days
      const matchingFractions = Object.entries(fractions)
        .filter(([_, fractionDate]) => {
          if (!fractionDate) return false;
          const diffDays = this.diffInCalendarDays(fractionDate, today);
          return diffDays === Number(args.days);
        })
        .map(([key]) => key);

      const translatedFractions = matchingFractions.map((key) => args.device.homey.__(`fractions.${key}.medium`));
      const pickupFractionsString = translatedFractions.join(', ');

      return {
        pickup_fractions: pickupFractionsString,
      };
    });

    const cardConditionGarbageTypeIsCollected = this.homey.flow.getConditionCard('fraction-is-collected');
    cardConditionGarbageTypeIsCollected.registerRunListener(async (args, state) => {
      const fractions = await args.device.fractionDates;
      const fractionDate = fractions[args.fraction];
      if (!fractionDate) {
        return false;
      }
      const today = new Date();
      const diffDays = this.diffInCalendarDays(fractionDate, today);
      return diffDays === Number(args.days);
    });
  }

  async onPair(session) {
    let addressData = null;
    session.setHandler('save_details', async (data) => {
      addressData = data;
    });

    session.setHandler('list_devices', async () => {
      const provider = await this.getProviderForMunicipality(addressData.kommunenummer);
      // If no provider found, notify user
      if (!provider) {
        throw new Error(this.homey.__('pair.errors.unsupported_municipality'));
      }
      const adapter = this.getAdapter(provider);

      let addrString = addressData.adressenavn;
      if (addressData.nummer !== '') {
        addrString += ` ${addressData.nummer}`;
      }
      if (addressData.bokstav) {
        addrString += ` ${addressData.bokstav}`;
      }

      let addressUUID;
      try {
        addressUUID = await adapter.fetchAddressUUID(addressData);
      } catch (error) {
        // Network errors both logged to console and notified to user
        this.error(`${adapter.getName()} could not fetch address UUID:`, error.message);
        throw new Error(this.homey.__('pair.errors.network_error'));
      }
      // If the address lookup failed, notify user
      if (!addressUUID) {
        throw new Error(this.homey.__('pair.errors.unsupported_address'));
      }
      const baseName = this.manifest.name[this.homey.i18n.getLanguage()] || this.manifest.name.en;

      return [
        {
          name: `${baseName} ${addrString}`,
          data: {
            id: addressUUID,
          },
          settings: {
            streetAddress: addrString,
            municipality: addressData.kommunenavn,
            provider: adapter.getName(),
          },
          store: {
            provider,
            addressData,
            addressUUID,
          },
        },
      ];
    });
  }

  async onUninit() {
    if (this._midnightTimer) {
      this.homey.clearTimeout(this._midnightTimer);
    }
  }

  scheduleMidnightUpdate() {
    const now = new Date();
    // Set to five minutes past midnight
    const millisTillMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0) - now;
    this._midnightTimer = this.homey.setTimeout(async () => {
      this.getDevices().forEach((device) => {
        device.update().catch((error) => {
          this.error('Midnight update failed:', error.message);
        });
      });
      this.scheduleMidnightUpdate();
    }, millisTillMidnight);
  }

  // Return a list of available adapters with id and label for pairing UI
  getAdaptersList() {
    return Object.keys(this.adapterFactories).map((id) => {
      const adapter = this.getAdapter(id);
      return {
        id,
        label: adapter.getName() || id,
      };
    });
  }

  getAdapter(provider) {
    if (!provider) {
      return null;
    }

    if (!this.adapters[provider]) {
      const factory = this.adapterFactories[provider];
      if (!factory) {
        return null;
      }
      this.adapters[provider] = factory();
    }

    return this.adapters[provider];
  }

  async getProviderForMunicipality(municipalityCode) {
    for (const id of Object.keys(this.adapterFactories)) {
      const adapter = this.getAdapter(id);
      try {
        if (await adapter.coversMunicipality(municipalityCode)) {
          return id;
        }
      } catch (error) {
        this.error(`Could not check coverage of ${adapter.getName()}:`, error.message);
      }
    }
    return null;
  }

};
