'use strict';
// Compatible surface consumed by the existing site, backed only by local IPC.
(() => {
  const authListeners = new Set(), channels = new Set();
  const call = request => window.itsoscupPlatform.call(request);
  const preferenceKey = 'tornei_team_follows_v1', nativeSet = Storage.prototype.setItem, nativeRemove = Storage.prototype.removeItem;
  window.ITSOSCUP_PLATFORM_READY = call({ type: 'status' }).then(result => {
    if (result.data?.station_id) nativeSet.call(window.localStorage, 'tornei_device_id', result.data.station_id);
    const value = result.data?.preferences?.[preferenceKey];
    if (typeof value === 'string') nativeSet.call(window.localStorage, preferenceKey, value);
  });
  function persistPreference(key, value) {
    call({ type: 'preferences', method: 'set', key, value }).then(result => {
      if (!result.error) return;
      let notice = document.getElementById('desktop-preference-error');
      if (!notice) { notice = document.createElement('div'); notice.id = 'desktop-preference-error'; notice.className = 'key-pending'; notice.setAttribute('role', 'status'); document.body.prepend(notice); }
      notice.textContent = 'Salvataggio preferiti da completare: ' + result.error.message;
    });
  }
  Storage.prototype.setItem = function(key, value) { nativeSet.call(this, key, value); if (this === window.localStorage && key === preferenceKey) persistPreference(key, String(value)); };
  Storage.prototype.removeItem = function(key) { nativeRemove.call(this, key); if (this === window.localStorage && key === preferenceKey) persistPreference(key, null); };
  const methods = new Set(['select','insert','upsert','update','delete','eq','neq','gt','gte','lt','lte','like','ilike','is','in','contains','containedBy','overlaps','or','not','filter','match','order','limit','range','single','maybeSingle']);
  function query(table, calls = []) {
    let result;
    const execute = () => result ||= call({ type: 'query', table, calls });
    return new Proxy({}, { get(_target, method) {
      if (method === 'then') return (resolve, reject) => execute().then(resolve, reject);
      if (method === 'catch') return reject => execute().catch(reject);
      if (method === 'finally') return callback => execute().finally(callback);
      if (method === Symbol.toStringTag) return 'LocalPlatformQuery';
      if (!methods.has(method)) return undefined;
      return (...args) => query(table, [...calls, { method, args }]);
    } });
  }
  const client = {
    from: table => query(table), rpc: (name, args = {}) => call({ type: 'rpc', name, args }),
    auth: new Proxy({}, { get(_target, method) {
      if (method === 'onAuthStateChange') return callback => { authListeners.add(callback); return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } }; };
      return async (...args) => { const result = await call({ type: 'auth', method, args }); if (!result.error && ['signInWithPassword', 'signOut', 'updateUser'].includes(method)) { const session = result.data?.session || null; for (const callback of authListeners) callback(method === 'signOut' ? 'SIGNED_OUT' : 'SIGNED_IN', session); } return result; };
    } }),
    channel: name => { const c = { name, handlers: [], on(event, filter, callback) { this.handlers.push({ event, filter, callback }); return this; }, subscribe(callback) { channels.add(this); callback?.('SUBSCRIBED'); return this; }, unsubscribe() { channels.delete(this); return Promise.resolve('ok'); } }; return c; },
    removeChannel: channel => { channels.delete(channel); return Promise.resolve('ok'); }
  };
  window.supabase = Object.freeze({ createClient: () => client });
  window.itsoscupPlatform.onChange(change => { for (const channel of channels) for (const h of channel.handlers) if (!h.filter?.table || !change.table || h.filter.table === change.table) h.callback({ eventType: change.event || 'UPDATE', new: change.row || {} }); });
  // These two source modules use fetch for cloud functions. Only their exact
  // configured endpoint is adapted; arbitrary fetches keep their normal denial.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    const match = String(url).match(/^https:\/\/nalxfsbjeinptjflvndp\.supabase\.co\/functions\/v1\/([a-z-]+)$/);
    if (!match) return originalFetch(input, options);
    let body; try { body = JSON.parse(options.body || '{}'); } catch { return new Response('{"error":"Richiesta locale non valida"}', { status: 400 }); }
    const result = await call({ type: 'function', name: match[1], body });
    return new Response(JSON.stringify(result.error ? { error: result.error.message, success: false, sent: false } : result.data), { status: result.error ? 400 : 200, headers: { 'Content-Type': 'application/json' } });
  };
})();
