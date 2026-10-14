'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const initSqlJs = require('sql.js');
const { VAULT_LIMIT, passwordKey, encryptBytes, decryptBytes } = require('./crypto.cjs');
const VAULT_FORMAT = 'itsoscup-key-vault';
// SQLite stays in RAM. Only AES-GCM ciphertext crosses the filesystem boundary.
class Vault {
  constructor(directory, { io = fs, maxBytes = VAULT_LIMIT } = {}) { this.directory = path.resolve(directory); this.io = io; this.dirty = false; this.generation = 0; this.maxBytes = maxBytes; }
  async init() { this.SQL = await initSqlJs({ locateFile: file => require.resolve('sql.js/dist/' + file) }); }
  get filename() { return path.join(this.directory, 'archive.keyvault'); }
  exists() { return this.io.existsSync(this.filename); }
  async unlock(password, { create = false, recover = false } = {}) {
    if (!this.SQL) await this.init();
    if (this.db) throw new Error('Archivio già aperto');
    if (create) {
      if (this.exists()) throw new Error('Esiste già un archivio: utilizzare Sblocca');
      // Never create the parent: a removed USB must not turn into a host directory.
      if (!this.io.statSync(path.dirname(this.directory)).isDirectory()) throw new Error('Chiavetta non disponibile');
      if (!this.io.existsSync(this.directory)) this.io.mkdirSync(this.directory, { recursive: false });
      this.marker = randomUUID();
      this.atomicFile(path.join(this.directory, 'volume.id'), this.marker, false);
      this.salt = randomBytes(16); this.key = passwordKey(password, this.salt);
      this.db = new this.SQL.Database();
      this.db.run('CREATE TABLE vault (id INTEGER PRIMARY KEY CHECK (id=1), generation INTEGER NOT NULL, state TEXT NOT NULL)');
      this.db.run('INSERT INTO vault VALUES (1, 0, ?)', [JSON.stringify({ version: 1, station_id: randomUUID(), preparations: [], matches: {}, operators: [], receipts: [], audit: [] })]);
      this.dirty = true;
      // Preserve initialized RAM when the drive disappears; retry must remain possible.
      this.persist();
      return { recovered: false };
    }
    this.marker = this.io.readFileSync(path.join(this.directory, 'volume.id'), 'utf8');
    if (!/^[0-9a-f-]{36}$/.test(this.marker)) throw new Error('Identità della chiavetta non valida');
    const candidates = recover ? [this.filename, this.filename + '.bak', this.filename + '.pending'] : [this.filename];
    let last, selected = null;
    for (const file of candidates) {
      let result;
      try {
        if (this.io.statSync(file).size > VAULT_LIMIT * 2.1) throw new Error('Archivio troppo grande');
        result = decryptBytes(this.io.readFileSync(file, 'utf8'), password, VAULT_FORMAT);
        const database = new this.SQL.Database(new Uint8Array(result.plain));
        const row = database.exec('SELECT generation, state FROM vault WHERE id=1')[0]?.values?.[0];
        if (!row || !Number.isSafeInteger(row[0])) { database.close(); throw new Error('Archivio SQLite non valido'); }
        const state = JSON.parse(row[1]);
        if (state.version !== 1 || !state.matches || !Array.isArray(state.preparations) || !Array.isArray(state.operators)) { database.close(); throw new Error('Archivio non riconosciuto'); }
        result.plain.fill(0);
        if (!selected || row[0] > selected.generation) {
          selected?.database.close(); selected?.key.fill(0);
          selected = { database, key: result.key, salt: result.salt, generation: row[0], file };
        } else { database.close(); result.key.fill(0); }
      } catch (error) { result?.key.fill(0); result?.plain.fill(0); last = error; }
    }
    if (selected) {
      this.db = selected.database; this.key = selected.key; this.salt = selected.salt; this.generation = selected.generation;
      this.dirty = recover; if (recover) this.persist({ preserveBackup: true });
      return { recovered: recover, generation: this.generation, recovered_from: path.basename(selected.file) };
    }
    throw last || new Error('Nessun backup recuperabile');
  }
  assertVolume() {
    try {
      if (!this.io.statSync(this.directory).isDirectory() || this.io.readFileSync(path.join(this.directory, 'volume.id'), 'utf8') !== this.marker) throw new Error();
    } catch { throw new Error('Chiavetta assente o diversa. Dati ancora in memoria: reinserire la stessa chiavetta e premere Riprova salvataggio.'); }
  }
  atomicFile(file, content, backup = true) {
    const pending = file + '.pending';
    let handle;
    try {
      handle = this.io.openSync(pending, 'w', 0o600);
      this.io.writeFileSync(handle, content, 'utf8'); this.io.fsyncSync(handle); this.io.closeSync(handle); handle = null;
      if (backup && this.io.existsSync(file)) {
        this.io.copyFileSync(file, file + '.bak');
        const fd = this.io.openSync(file + '.bak', 'r+'); try { this.io.fsyncSync(fd); } finally { this.io.closeSync(fd); }
      }
      this.io.renameSync(pending, file);
      // Directory fsync is unsupported by Windows; every file is fsynced first.
      try { const fd = this.io.openSync(path.dirname(file), 'r'); try { this.io.fsyncSync(fd); } finally { this.io.closeSync(fd); } } catch (error) { if (process.platform !== 'win32') throw error; }
    } finally { if (handle != null) this.io.closeSync(handle); }
  }
  read() {
    if (!this.db) throw new Error('Sbloccare prima l’archivio');
    return JSON.parse(this.db.exec('SELECT state FROM vault WHERE id=1')[0].values[0][0]);
  }
  write(state) {
    if (this.dirty) throw new Error('Salvataggio in sospeso: reinserire la chiavetta e riprovare prima di altre operazioni');
    this.db.run('BEGIN IMMEDIATE');
    try {
      this.db.run('UPDATE vault SET state=?, generation=? WHERE id=1', [JSON.stringify(state), this.generation + 1]);
      // Check allocated SQLite pages while rollback is still possible. sql.js
      // export is called only AFTER COMMIT, because export reopens the database.
      const pages = this.db.exec('PRAGMA page_count')[0].values[0][0], pageSize = this.db.exec('PRAGMA page_size')[0].values[0][0];
      if (pages * pageSize > this.maxBytes) {
        throw new Error('Archivio pieno: questa modifica non è stata registrata. Esportare i referti già chiusi e creare una nuova chiavetta per altre partite');
      }
      this.db.run('COMMIT');
    } catch (error) { this.db.run('ROLLBACK'); throw error; }
    this.dirty = true;
    this.persist();
  }
  persist({ preserveBackup = false } = {}) {
    this.assertVolume();
    const bytes = Buffer.from(this.db.export());
    try { this.atomicFile(this.filename, encryptBytes(bytes, this.key, this.salt, VAULT_FORMAT), !preserveBackup); } finally { bytes.fill(0); }
    this.generation = this.db.exec('SELECT generation FROM vault WHERE id=1')[0].values[0][0];
    this.dirty = false;
  }
  backup(destination) {
    if (this.dirty) throw new Error('Completare prima il salvataggio in sospeso');
    this.assertVolume();
    const resolved = path.resolve(destination), normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(path.dirname(resolved)) === normalize(this.directory)
        && /^(archive\.keyvault|volume\.id)(\.|$)/i.test(path.basename(resolved))) throw new Error('Il backup non può sostituire i file dell’archivio o l’identità della chiavetta');
    const content = this.io.readFileSync(this.filename, 'utf8');
    this.atomicFile(resolved, content);
  }
  async restoreBackup(text, password) {
    if (this.db || this.exists()) throw new Error('Il recupero su una nuova chiavetta richiede un archivio assente. Nessun archivio esistente è stato sovrascritto');
    if (!this.SQL) await this.init();
    const result = decryptBytes(text, password, VAULT_FORMAT);
    let database;
    try {
      database = new this.SQL.Database(new Uint8Array(result.plain));
      const row = database.exec('SELECT generation, state FROM vault WHERE id=1')[0]?.values?.[0], state = row && JSON.parse(row[1]);
      if (!row || !Number.isSafeInteger(row[0]) || state?.version !== 1 || !state.matches || !Array.isArray(state.preparations) || !Array.isArray(state.operators)) throw new Error('Backup SQLite non valido');
      if (!this.io.statSync(path.dirname(this.directory)).isDirectory()) throw new Error('Chiavetta non disponibile');
      if (!this.io.existsSync(this.directory)) this.io.mkdirSync(this.directory);
      this.marker = randomUUID(); this.atomicFile(path.join(this.directory, 'volume.id'), this.marker, false);
      this.db = database; this.key = result.key; this.salt = result.salt; this.generation = row[0]; this.dirty = true;
      this.persist({ preserveBackup: true });
      return { restored: true, generation: this.generation };
    } catch (error) {
      if (!this.db) { database?.close(); result.key.fill(0); }
      throw error;
    } finally { result.plain.fill(0); }
  }
  lock() {
    if (this.dirty) throw new Error('Dati non salvati: reinserire la chiavetta e riprovare prima di bloccare o chiudere');
    this.db?.close(); this.db = null; this.key?.fill(0); this.key = null; this.salt = null;
  }
}
module.exports = { Vault, VAULT_FORMAT };
