import type { Options, PostgresType } from 'postgres';

/**
 * Connection strings are parsed here rather than handed to the driver as a URL.
 *
 * Two failure modes forced this, both hit with a real Supabase password:
 *
 *   - A password containing "/" makes `new URL()` throw, because the slash
 *     terminates the authority component. The driver parses URLs with
 *     `new URL()`, so the connection never opens.
 *   - Percent-encoding the slash as %2F makes the URL parse, but the driver
 *     reads `url.password` without decoding it, so the literal text
 *     "…%2F…" is sent as the password and the server rejects it.
 *
 * Between those two, any password containing a character that needs encoding
 * is unusable. Parsing here removes the trap: both the raw and the encoded
 * form produce the same credentials, so whatever Supabase generated works
 * without the operator having to know URL escaping rules.
 */

export type ConnectionConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: 'require' | false;
};

/** Percent-decodes, tolerating a stray "%" that is not a valid escape. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export function parseConnectionString(raw: string): ConnectionConfig {
  const withoutScheme = raw.trim().replace(/^[a-z+]+:\/\//i, '');

  // The credential section runs to the LAST "@": a password may contain one.
  const at = withoutScheme.lastIndexOf('@');
  if (at === -1) {
    throw new Error(
      'Connection string tidak memuat "@" yang memisahkan kredensial dari host.\n' +
        'Bentuk yang benar: postgresql://pengguna:katasandi@host:port/database',
    );
  }

  const credentials = withoutScheme.slice(0, at);
  const remainder = withoutScheme.slice(at + 1);

  // The user name cannot contain ":", so the FIRST colon splits the pair and
  // everything after it — colons included — belongs to the password.
  const colon = credentials.indexOf(':');
  const username = decode(colon === -1 ? credentials : credentials.slice(0, colon));
  const password = colon === -1 ? '' : decode(credentials.slice(colon + 1));

  const slash = remainder.indexOf('/');
  const hostPort = slash === -1 ? remainder : remainder.slice(0, slash);
  const afterSlash = slash === -1 ? '' : remainder.slice(slash + 1);

  const [databaseRaw = '', queryRaw = ''] = afterSlash.split('?');
  const database = decode(databaseRaw) || 'postgres';

  // A bracketed IPv6 literal keeps its colons; everything else splits on the last one.
  let host: string;
  let port = 5432;
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    host = hostPort.slice(1, close);
    const tail = hostPort.slice(close + 1);
    if (tail.startsWith(':')) port = Number(tail.slice(1));
  } else {
    const lastColon = hostPort.lastIndexOf(':');
    if (lastColon === -1) {
      host = hostPort;
    } else {
      host = hostPort.slice(0, lastColon);
      port = Number(hostPort.slice(lastColon + 1));
    }
  }

  if (!host) {
    throw new Error('Connection string tidak memuat host yang valid.');
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Port pada connection string tidak valid: "${hostPort}".`);
  }

  const sslMode = new URLSearchParams(queryRaw).get('sslmode');
  const ssl: 'require' | false =
    sslMode === 'disable' ? false : sslMode ? 'require' : LOCAL_HOSTS.has(host) ? false : 'require';

  return { host, port, database, username, password, ssl };
}

/** Driver options for a connection string, merged with per-caller settings. */
export function connectionOptions(
  raw: string,
  overrides: Options<Record<string, PostgresType>> = {},
): Options<Record<string, PostgresType>> {
  const config = parseConnectionString(raw);
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    ssl: config.ssl,
    ...overrides,
  };
}

/** Host and port for log lines. Never includes credentials. */
export function describeTarget(raw: string): string {
  try {
    const { host, port } = parseConnectionString(raw);
    return `${host}:${port}`;
  } catch {
    return '(connection string tidak dapat dibaca)';
  }
}
