'use strict';
/**
 * Simple key-value store with TTL expiry for the first-slice fixture.
 */

class Store {
  constructor(initialData = {}) {
    this._data = new Map();
    this._expiries = new Map();
    for (const [k, v] of Object.entries(initialData)) {
      this.set(k, v);
    }
  }

  set(key, value, ttlMs = null) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('Key must be a non-empty string');
    }
    this._data.set(key, value);
    if (typeof ttlMs === 'number' && ttlMs > 0) {
      this._expiries.set(key, Date.now() + ttlMs);
    } else {
      this._expiries.delete(key);
    }
    return true;
  }

  get(key) {
    if (!this._data.has(key)) {
      return null;
    }
    if (this._isExpired(key)) {
      this.delete(key);
      return null;
    }
    return this._data.get(key);
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this._expiries.delete(key);
    return this._data.delete(key);
  }

  list() {
    this.purgeExpired();
    const result = {};
    for (const [k, v] of this._data.entries()) {
      result[k] = v;
    }
    return result;
  }

  purgeExpired() {
    let count = 0;
    for (const key of this._expiries.keys()) {
      if (this._isExpired(key)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  _isExpired(key) {
    const expiry = this._expiries.get(key);
    if (!expiry) return false;
    return Date.now() >= expiry;
  }

  size() {
    this.purgeExpired();
    return this._data.size;
  }
}

module.exports = { Store };
