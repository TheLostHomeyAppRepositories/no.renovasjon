'use strict';

// Thrown when the provider has no matching address, as opposed to network or service errors
class AddressNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AddressNotFoundError';
  }
}

module.exports = { AddressNotFoundError };
