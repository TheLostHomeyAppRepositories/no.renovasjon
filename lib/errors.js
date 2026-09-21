'use strict';

// Thrown when the provider has no matching address, as opposed to network or service errors
class AddressNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AddressNotFoundError';
  }
}

// Thrown when a request gets an HTTP error status back. The status is kept so a caller can tell
// e.g. rate limiting (429) from a broken service (500).
class HttpError extends Error {
  constructor(status) {
    super(`HTTP error! status: ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

module.exports = { AddressNotFoundError, HttpError };
