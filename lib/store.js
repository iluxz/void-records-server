'use strict';

// Tiny debounced JSON store. One write per burst of PATCHes, atomic rename,
// so shared settings/achievements never churn the disk.

const fs = require('fs');
const path = require('path');

const SAFE_CLIENT = /^[a-zA-Z0-9_-]{1,64}$/;

class Store {
  constructor(file, debounceMs = 1500) {
    this.file = file;
    this.debounceMs = debounceMs;
    this.data = { version: 1, clients: {} };
    this.timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.clients) this.data = parsed;
      } catch (err) {
        console.warn('[store] ignoring unreadable state file:', err.message);
      }
    }
  }

  valid(client) { return SAFE_CLIENT.test(String(client || '')); }

  get(client) {
    if (!this.valid(client)) return null;
    return this.data.clients[client] || {};
  }

  all() { return this.data.clients; }

  patch(client, patch) {
    if (!this.valid(client)) return null;
    const current = this.data.clients[client] || {};
    this.data.clients[client] = Object.assign({}, current, patch);
    this.schedule();
    return this.data.clients[client];
  }

  replace(client, value) {
    if (!this.valid(client)) return null;
    this.data.clients[client] = value && typeof value === 'object' ? value : {};
    this.schedule();
    return this.data.clients[client];
  }

  remove(client) {
    if (!this.valid(client)) return false;
    const existed = Object.prototype.hasOwnProperty.call(this.data.clients, client);
    delete this.data.clients[client];
    if (existed) this.schedule();
    return existed;
  }

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), this.debounceMs);
  }

  saveNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = this.file + '.tmp';
    this.data.updatedAt = new Date().toISOString();
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
