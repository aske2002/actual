import { createPrivateKey, createSign } from 'node:crypto';

import { SecretName, secretsService } from '../services/secrets-service';

const API_BASE = 'https://api.enablebanking.com';

/**
 * Generate a JWT signed with the private key for EnableBanking API auth.
 * EnableBanking requires a JWT with:
 *   - iss: application ID
 *   - aud: "enablebanking.com"
 *   - iat: current timestamp
 *   - exp: current timestamp + 10 minutes
 * Signed with RS256 using the application's private key.
 */
function generateJwt(applicationId, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT', kid: applicationId };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: applicationId,
    aud: 'api.enablebanking.com',
    iat: now,
    exp: now + 600, // 10 minutes
  };

  const encode = obj =>
    Buffer.from(JSON.stringify(obj)).toString('base64url').replace(/=+$/, '');

  const headerEncoded = encode(header);
  const payloadEncoded = encode(payload);
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const key = createPrivateKey(privateKeyPem);
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(key, 'base64url').replace(/=+$/, '');

  return `${signingInput}.${signature}`;
}

function getAuthHeaders() {
  const applicationId = secretsService.get(
    SecretName.enablebanking_applicationId,
  );
  const privateKey = secretsService.get(SecretName.enablebanking_privateKey);

  if (!applicationId || !privateKey) {
    throw new Error('EnableBanking is not configured');
  }

  const jwt = generateJwt(applicationId, privateKey);
  return {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  };
}

async function apiRequest(method, path, body) {
  const headers = getAuthHeaders();

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, options);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `EnableBanking API error (${method} ${path}): ${response.status} ${errorBody}`,
    );
  }

  return response.json();
}

export const enableBankingService = {
  isConfigured: () => {
    return !!(
      secretsService.get(SecretName.enablebanking_applicationId) &&
      secretsService.get(SecretName.enablebanking_privateKey)
    );
  },

  /**
   * List available ASPSPs (banks) for a given country.
   * @param {string} country - ISO 3166-1 alpha-2 country code
   * @returns {Promise<object>} List of ASPSPs
   */
  getAspsps: async country => {
    return apiRequest('GET', `/aspsps?country=${encodeURIComponent(country)}`);
  },

  /**
   * Start authorization by getting a redirect URL for bank consent.
   * Uses POST /auth to initiate the flow.
   * @param {object} params
   * @param {string} params.aspspName - The ASPSP (bank) name
   * @param {string} params.aspspCountry - The ASPSP country code
   * @param {string} params.redirectUrl - URL to redirect to after consent
   * @param {string} params.state - Arbitrary state string returned in callback
   * @returns {Promise<object>} { url, authorization_id }
   */
  startAuth: async ({ aspspName, aspspCountry, redirectUrl, state }) => {
    const validUntil = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    return apiRequest('POST', '/auth', {
      access: {
        valid_until: validUntil,
      },
      aspsp: {
        name: aspspName,
        country: aspspCountry,
      },
      redirect_url: redirectUrl,
      psu_type: 'personal',
      state: state || 'actual-budget',
    });
  },

  /**
   * Create a session by exchanging an authorization code.
   * Called after the user completes bank consent and is redirected back with a code.
   * @param {string} code - The authorization code from the callback
   * @returns {Promise<object>} Session with accounts
   */
  createSession: async code => {
    return apiRequest('POST', '/sessions', { code });
  },

  /**
   * Get the status and details of an existing session.
   * @param {string} sessionId - The EnableBanking session ID
   * @returns {Promise<object>} Session data including status and accounts
   */
  getSession: async sessionId => {
    return apiRequest('GET', `/sessions/${encodeURIComponent(sessionId)}`);
  },

  /**
   * Fetch accounts for a given session.
   * @param {string} sessionId - The EnableBanking session ID
   * @returns {Promise<object>} List of accounts
   */
  getAccounts: async sessionId => {
    return apiRequest(
      'GET',
      `/sessions/${encodeURIComponent(sessionId)}/accounts`,
    );
  },

  /**
   * Fetch account balances.
   * @param {string} accountId - The EnableBanking account ID
   * @returns {Promise<object>} Account balances
   */
  getBalances: async accountId => {
    return apiRequest(
      'GET',
      `/accounts/${encodeURIComponent(accountId)}/balances`,
    );
  },

  /**
   * Fetch transactions for an account.
   * @param {string} accountId - The EnableBanking account ID
   * @param {string} dateFrom - Start date in YYYY-MM-DD format
   * @param {string} [dateTo] - End date in YYYY-MM-DD format
   * @returns {Promise<object>} Transactions
   */
  getTransactions: async (accountId, dateFrom, dateTo) => {
    const params = new URLSearchParams({ date_from: dateFrom });
    if (dateTo) {
      params.set('date_to', dateTo);
    }

    return apiRequest(
      'GET',
      `/accounts/${encodeURIComponent(accountId)}/transactions?${params.toString()}`,
    );
  },
};
