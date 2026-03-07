import express from 'express';
import rateLimit from 'express-rate-limit';

import { config } from './load-config';
import { requestLoggerMiddleware } from './util/middlewares';
import { isPrivateHost, pinnedFetch, validateUrl } from './util/validate-url';
import { validateSession } from './util/validate-user';

const app = express();

app.use(express.json());
app.use(requestLoggerMiddleware);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 25,
    legacyHeaders: false,
    standardHeaders: true,
  }),
);

// Cache for the allowlist to avoid fetching it on every request
let allowlistedRepos = [];
let lastAllowlistFetch = 0;
const ALLOWLIST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Export cache clearing function for testing
export const clearAllowlistCache = () => {
  allowlistedRepos = [];
  lastAllowlistFetch = 0;
};

async function fetchAllowlist() {
  const now = Date.now();
  if (
    now - lastAllowlistFetch < ALLOWLIST_CACHE_TTL &&
    allowlistedRepos.length > 0
  ) {
    return allowlistedRepos;
  }

  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/actualbudget/plugin-store/refs/heads/main/plugins.json',
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch allowlist: ${response.status}`);
    }
    const plugins = await response.json();
    allowlistedRepos = plugins.map(plugin => plugin.url);
    lastAllowlistFetch = now;
    console.log('Updated plugin allowlist:', allowlistedRepos);
    return allowlistedRepos;
  } catch (error) {
    console.error('Failed to fetch plugin allowlist:', error);
    // Return empty array if fetch fails to be safe
    allowlistedRepos = [];
    return allowlistedRepos;
  }
}

/**
 * Return true only if the URL is on an allowlist and not a local/private address.
 * When isRedirect is true, also allows known GitHub CDN hosts that serve
 * release assets (these use opaque signed URLs without repo path structure).
 */
async function isUrlAllowed(targetUrl, isRedirect = false) {
  try {
    const url = new URL(targetUrl);
    const hostname = url.hostname;

    // Enforce HTTPS protocol
    if (url.protocol !== 'https:') {
      console.warn(`Blocked non-HTTPS request: ${url.protocol}//${hostname}`);
      return false;
    }

    // Block private/local IP addresses (DNS-aware, resolves hostnames)
    if (await isPrivateHost(hostname)) {
      console.warn(`Blocked request to private/localhost address: ${hostname}`);
      return false;
    }

    // Always allow the specific plugin-store URL
    if (
      targetUrl ===
      'https://raw.githubusercontent.com/actualbudget/plugin-store/refs/heads/main/plugins.json'
    ) {
      return true;
    }

    // Check against allowlisted repositories
    for (const repoUrl of allowlistedRepos) {
      try {
        const { pathname } = new URL(repoUrl);
        const [, repoOwner, repoName] = pathname.split('/');

        if (
          targetUrl === repoUrl ||
          targetUrl.startsWith(repoUrl + '/') ||
          (hostname === 'api.github.com' &&
            url.pathname.startsWith(`/repos/${repoOwner}/${repoName}`)) ||
          (hostname === 'raw.githubusercontent.com' &&
            url.pathname.startsWith(`/${repoOwner}/${repoName}/`)) ||
          (hostname === 'github.com' &&
            url.pathname.startsWith(`/${repoOwner}/${repoName}/releases/`))
        ) {
          return true;
        }
      } catch (e) {
        console.warn(
          'Invalid repository URL in allowlist:',
          repoUrl,
          e.message,
        );
      }
    }

    // Allow known GitHub CDN hosts for redirect targets (release asset downloads)
    if (isRedirect && hostname.endsWith('.githubusercontent.com')) {
      return true;
    }

    return false;
  } catch (e) {
    console.warn('Invalid target URL:', targetUrl, e.message);
    return false;
  }
}

app.use('/', async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Actual-Token');
    res.set('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }

  const targetUrlString = req.query.url;

  if (!targetUrlString) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Validate session/token
  const session = await validateSession(req, res);
  if (!session) {
    return; // validateSession already sent the response
  }

  let url;
  try {
    url = new URL(targetUrlString);
  } catch {
    return res.status(400).json({ error: 'Invalid url parameter' });
  }

  // Fetch the latest allowlist
  try {
    await fetchAllowlist();
  } catch (error) {
    console.error('Failed to fetch allowlist:', error);
    return res.status(403).json({
      error: 'URL not allowed',
      message: 'Unable to verify allowlist',
    });
  }

  // Check if the URL is allowed
  if (!(await isUrlAllowed(url.href))) {
    console.warn('Blocked request to unauthorized URL:', url.href);
    return res.status(403).json({
      error: 'URL not allowed',
      message:
        'Only allowlisted plugin repositories are allowed (localhost only in development)',
    });
  }

  try {
    // Extract method, body, and headers from the request body (sent by loot-core)
    const {
      method = 'GET',
      body,
      headers: customHeaders = {},
    } = req.body || {};

    const methodNormalized =
      typeof method === 'string' ? method.toUpperCase() : 'GET';
    if (!['GET', 'HEAD'].includes(methodNormalized)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const requestHeaders = {
      ...req.headers,
      ...customHeaders,
    };

    // Remove headers that shouldn't be forwarded
    delete requestHeaders['x-actual-token'];
    delete requestHeaders['content-length'];
    delete requestHeaders['cookie'];
    delete requestHeaders['cookie2'];
    delete requestHeaders['accept-encoding'];
    delete requestHeaders['host'];

    // Add GitHub authentication if token is configured and request is to GitHub
    const githubToken = config.get('github.token');
    if (
      githubToken &&
      (url.hostname === 'api.github.com' ||
        url.hostname === 'raw.githubusercontent.com' ||
        (url.hostname === 'github.com' && url.pathname.includes('/releases/')))
    ) {
      requestHeaders['Authorization'] = `Bearer ${githubToken}`;
      requestHeaders['User-Agent'] = 'Actual-Budget-Plugin-System';
      console.log(
        `Using GitHub authentication for request to: ${url.hostname}`,
      );
    }

    // Pinned fetch with per-hop redirect validation
    const MAX_REDIRECTS = 5;
    let currentUrl = url.href;
    const originalOrigin = url.origin;
    let currentHeaders = { ...requestHeaders };
    let response;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const { resolvedAddress, family } = await validateUrl(currentUrl);

      response = await pinnedFetch(currentUrl, resolvedAddress, family, {
        method: methodNormalized,
        headers: currentHeaders,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          break;
        }
        const nextUrl = new URL(location, currentUrl);

        // Enforce HTTPS on redirect hops
        if (nextUrl.protocol !== 'https:') {
          return res
            .status(502)
            .json({ error: 'Redirect to non-HTTPS URL is not allowed' });
        }

        // Re-check allowlist for redirect target
        if (!(await isUrlAllowed(nextUrl.href, true))) {
          return res
            .status(403)
            .json({ error: 'Redirect target is not on the allowlist' });
        }

        currentUrl = nextUrl.toString();

        // Strip auth headers on cross-origin redirects
        if (nextUrl.origin !== originalOrigin) {
          currentHeaders = { ...currentHeaders };
          delete currentHeaders['Authorization'];
        }

        if (i === MAX_REDIRECTS) {
          return res.status(502).json({ error: 'Too many redirects' });
        }
        continue;
      }
      break;
    }

    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    res.set('Access-Control-Allow-Origin', '*');
    res.status(response.status);

    // Try to detect if this might be JSON content based on URL or content
    const urlString = url.toString().toLowerCase();
    const isLikelyJson =
      contentType?.includes('application/json') ||
      urlString.includes('.json') ||
      urlString.includes('/manifest') ||
      urlString.includes('manifest.json') ||
      urlString.includes('package.json');

    if (isLikelyJson) {
      // For JSON responses, return the actual content
      res.set('Content-Type', 'application/json');
      const text = await response.text();
      try {
        res.json(JSON.parse(text));
      } catch {
        // If it's not valid JSON, treat as text
        res.set('Content-Type', contentType || 'text/plain');
        res.send(text);
      }
    } else if (contentType?.includes('text/')) {
      // For text responses, return as plain text
      res.set('Content-Type', contentType);
      const text = await response.text();
      res.send(text);
    } else {
      // For actual binary responses, return as JSON format
      res.set('Content-Type', 'application/json');
      const buffer = await response.arrayBuffer();
      const binaryData = {
        data: Array.from(new Uint8Array(buffer)),
        contentType,
        isBinary: true,
      };
      res.json(binaryData);
    }
  } catch (err) {
    res
      .status(500)
      .json({ error: 'Error proxying request', details: err.message });
  }
});

export { app as handlers };
