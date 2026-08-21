import { APP_CONFIG } from './app-config.js';

async function loadSupabaseSdk() {
  if (window.supabase?.createClient) {
    return window.supabase;
  }

  throw new Error(
    'Supabase SDK locale non caricato. Verifica vendor/supabase/supabase-js.min.js e ricarica la pagina senza cache.'
  );
}

let dbClientPromise = null;

export async function getDbClient() {
  if (!dbClientPromise) {
    dbClientPromise = loadSupabaseSdk()
      .then((sdk) =>
        sdk.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        })
      )
      .catch((error) => {
        dbClientPromise = null;
        throw error;
      });
  }
  return dbClientPromise;
}

function createDeferredQuery(calls) {
  const execute = async () => {
    const client = await getDbClient();
    return calls.reduce((query, call) => query[call.method](...call.args), client);
  };

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve, reject) => execute().then(resolve, reject);
        }
        if (prop === 'catch') {
          return (reject) => execute().catch(reject);
        }
        if (prop === 'finally') {
          return (onFinally) => execute().finally(onFinally);
        }
        if (prop === Symbol.toStringTag) {
          return 'DeferredSupabaseQuery';
        }
        return (...args) => createDeferredQuery([...calls, { method: prop, args }]);
      },
    }
  );
}

export const db = {
  from(table) {
    return createDeferredQuery([{ method: 'from', args: [table] }]);
  },
  async rpc(fnName, args) {
    const client = await getDbClient();
    return client.rpc(fnName, args);
  },
  auth: new Proxy(
    {},
    {
      get(_target, prop) {
        return async (...args) => {
          const client = await getDbClient();
          return client.auth[prop](...args);
        };
      },
    }
  ),
};

export async function run(queryPromise, context = 'Operazione DB') {
  let result;
  try {
    result = await queryPromise;
  } catch (error) {
    const message = String(error?.message ?? error ?? '');
    const networkHint = /failed to fetch|networkerror|load failed/i.test(message)
      ? ' Verifica connessione, URL Supabase, CORS e che la migrazione sia stata applicata.'
      : '';
    const err = new Error(`${context}: ${message || 'richiesta Supabase fallita.'}${networkHint}`);
    err.cause = error;
    throw err;
  }

  const { data, error, count } = result;
  if (error) {
    const err = new Error(`${context}: ${error.message}`);
    err.cause = error;
    throw err;
  }
  return { data, count };
}

export async function runRpc(fnName, args = {}, context = 'Operazione RPC') {
  let result;
  try {
    result = await db.rpc(fnName, args);
  } catch (error) {
    const message = String(error?.message ?? error ?? '');
    const networkHint = /failed to fetch|networkerror|load failed/i.test(message)
      ? ' Verifica connessione, URL Supabase, CORS e che la migrazione sia stata applicata.'
      : '';
    const err = new Error(`${context}: ${message || 'richiesta Supabase fallita.'}${networkHint}`);
    err.cause = error;
    throw err;
  }

  const { data, error } = result;
  if (error) {
    const err = new Error(`${context}: ${error.message}`);
    err.cause = error;
    throw err;
  }
  return data;
}

export function subscribeTable({
  channelName,
  table,
  event = '*',
  filter,
  onChange,
  schema = 'public',
}) {
  let active = true;
  let channel = null;

  getDbClient()
    .then((client) => {
      if (!active) return;
      channel = client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event,
            schema,
            table,
            ...(filter ? { filter } : {}),
          },
          (payload) => {
            onChange?.(payload);
          }
        )
        .subscribe();
    })
    .catch((error) => {
      console.warn('Realtime non disponibile:', error);
    });

  return () => {
    active = false;
    if (!channel) return;
    getDbClient()
      .then((client) => client.removeChannel(channel))
      .catch((error) => {
        console.warn('Rimozione canale realtime non completata:', error);
      });
  };
}
