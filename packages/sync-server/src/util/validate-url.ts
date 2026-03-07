import dns from 'dns';
import http from 'http';
import https from 'https';

import ipaddr from 'ipaddr.js';

const BLOCKED_RANGES = [
  'private',
  'loopback',
  'linkLocal',
  'uniqueLocal',
  'unspecified',
  'broadcast',
  'reserved',
  'carrierGradeNat',
] as const;

const DEFAULT_TIMEOUT_MS = 30_000;

function isBlockedIP(ip: string): boolean {
  if (!ipaddr.isValid(ip)) {
    return false;
  }
  const parsed = ipaddr.process(ip);
  return (BLOCKED_RANGES as readonly string[]).includes(parsed.range());
}

/**
 * Synchronous check for literal IP addresses only.
 * For hostname validation with DNS resolution, use isPrivateHost().
 */
export function isPrivateIP(hostname: string): boolean {
  return isBlockedIP(hostname);
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

async function safeResolve(
  resolver: (hostname: string) => Promise<string[]>,
  hostname: string,
): Promise<string[]> {
  try {
    return await resolver(hostname);
  } catch (err: unknown) {
    if (isErrnoException(err)) {
      const { code } = err;
      if (code === 'ENODATA' || code === 'ENOTFOUND') {
        return [];
      }
    }
    throw err;
  }
}

/**
 * Async DNS-aware check that resolves hostnames and validates
 * all resolved addresses (both IPv4 and IPv6) against blocked IP ranges.
 */
export async function isPrivateHost(hostname: string): Promise<boolean> {
  if (ipaddr.isValid(hostname)) {
    return isBlockedIP(hostname);
  }
  try {
    const [ipv4Results, ipv6Results] = await Promise.all([
      safeResolve(dns.promises.resolve4, hostname),
      safeResolve(dns.promises.resolve6, hostname),
    ]);
    const allAddresses = [...ipv4Results, ...ipv6Results];
    if (allAddresses.length === 0) {
      // No DNS records found at all — block to be safe
      return true;
    }
    return allAddresses.some(address => isBlockedIP(address));
  } catch {
    // If DNS resolution fails, block the request to be safe
    return true;
  }
}

type ValidatedUrl = {
  url: URL;
  resolvedAddress: string;
  family: 4 | 6;
};

function toAddressFamily(family: number): 4 | 6 {
  if (family === 4 || family === 6) {
    return family;
  }
  throw new Error(`Unexpected DNS address family: ${family}`);
}

/**
 * Resolves and validates a URL, returning the pinned resolved address.
 * Throws if the URL resolves to a private/internal IP.
 */
export async function validateUrl(urlString: string): Promise<ValidatedUrl> {
  const url = new URL(urlString);
  const { hostname } = url;

  if (ipaddr.isValid(hostname)) {
    if (isBlockedIP(hostname)) {
      throw new Error(
        `Request to private/internal IP address is not allowed: ${hostname}`,
      );
    }
    return {
      url,
      resolvedAddress: hostname,
      family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4,
    };
  }

  const results = await dns.promises.lookup(hostname, { all: true });
  for (const entry of results) {
    if (isBlockedIP(entry.address)) {
      throw new Error(
        `Request to hostname resolving to private/internal IP is not allowed: ${hostname} -> ${entry.address}`,
      );
    }
  }
  const first = results[0];
  return {
    url,
    resolvedAddress: first.address,
    family: toAddressFamily(first.family),
  };
}

type PinnedLookup = (
  _hostname: string,
  _options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) => void;

function createPinnedLookup(
  resolvedAddress: string,
  family: 4 | 6,
): PinnedLookup {
  return (_hostname, _options, callback) => {
    callback(null, resolvedAddress, family);
  };
}

type PinnedFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  timeout?: number;
};

/**
 * Performs an HTTP/HTTPS request using a pinned resolved address to prevent
 * TOCTOU DNS attacks. Works like fetch() but uses http/https.request with
 * a custom agent that forces the pre-validated IP.
 */
export type PinnedFetchResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function pinnedFetch(
  urlString: string,
  resolvedAddress: string,
  family: 4 | 6,
  options: PinnedFetchOptions = {},
): Promise<PinnedFetchResponse> {
  const url = new URL(urlString);

  // Enforce safe protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol in URL: ${url.protocol}`);
  }

  // Block direct access to localhost by hostname
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  ) {
    throw new Error('Requests to localhost are not allowed');
  }

  const isHttps = url.protocol === 'https:';
  const mod = isHttps ? https : http;
  const lookup = createPinnedLookup(resolvedAddress, family);
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  const agent = isHttps
    ? new https.Agent({ lookup })
    : new http.Agent({ lookup });

  return new Promise((resolve, reject) => {
    let settled = false;

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      req.destroy();
      agent.destroy();
      reject(err);
    }

    const req = mod.request(
      url,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
        agent,
        timeout: timeoutMs,
      },
      res => {
        res.setTimeout(timeoutMs, () => {
          fail(new Error(`Socket timeout after ${timeoutMs}ms`));
        });
        const responseHeaders = res.headers;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          settled = true;
          agent.destroy();
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 0,
            headers: {
              get(name: string): string | null {
                const val = responseHeaders[name.toLowerCase()];
                if (val == null) return null;
                return Array.isArray(val) ? val[0] : val;
              },
            },
            text: () => Promise.resolve(buf.toString()),
            arrayBuffer: () =>
              Promise.resolve(
                buf.buffer.slice(
                  buf.byteOffset,
                  buf.byteOffset + buf.byteLength,
                ),
              ),
          });
        });
        res.on('error', (err: Error) => fail(err));
      },
    );
    req.on('timeout', () => {
      fail(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.on('error', (err: Error) => fail(err));
    req.end();
  });
}

/**
 * Backward-compatible wrapper that validates and throws on private URLs.
 */
export async function assertNotPrivateUrl(urlString: string): Promise<void> {
  await validateUrl(urlString);
}
