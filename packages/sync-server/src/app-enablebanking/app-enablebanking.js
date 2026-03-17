import { v4 as uuidv4 } from 'uuid';
import express from 'express';

import { handleError } from '../app-gocardless/util/handle-error';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from '../util/middlewares';

import { enableBankingService } from './enablebanking-service';

const app = express();
export { app as handlers };
app.use(requestLoggerMiddleware);
app.use(express.json());

// In-memory store for authorization codes received from bank redirects.
// Keyed by state parameter, value is the authorization code.
const pendingCodes = new Map();

// In-memory store for session IDs after code exchange.
// Keyed by state parameter, value is { sessionId, aspspName }.
const pendingSessions = new Map();

// The /link callback doesn't require session validation (it's a bank redirect).
// All other endpoints do.

// Simple HTML page that the bank redirects back to after consent.
// It captures the `code` query param and stores it for the polling endpoint.
app.get('/link', function (req, res) {
  const { code, state } = req.query;

  console.log('[EnableBanking] /link callback received', {
    hasCode: !!code,
    hasState: !!state,
    query: req.query,
  });

  if (code && state) {
    pendingCodes.set(state, code);
    console.log(
      `[EnableBanking] Stored authorization code for state=${state}`,
    );
    // Clean up after 10 minutes
    setTimeout(() => pendingCodes.delete(state), 10 * 60 * 1000);
  } else {
    console.warn('[EnableBanking] /link callback missing code or state');
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>EnableBanking - Bank Linked</title></head>
    <body style="font-family: system-ui; text-align: center; padding: 40px;">
      <h2>Bank account linked successfully!</h2>
      <p>You can close this window and return to Actual Budget.</p>
    </body>
    </html>
  `);
});

// All remaining endpoints require session validation
app.use(validateSessionMiddleware);

app.post(
  '/status',
  handleError(async (req, res) => {
    const configured = enableBankingService.isConfigured();
    console.log('[EnableBanking] /status', { configured });

    res.send({
      status: 'ok',
      data: {
        configured,
      },
    });
  }),
);

app.post(
  '/get-banks',
  handleError(async (req, res) => {
    const { country } = req.body || {};
    console.log('[EnableBanking] /get-banks', { country });

    if (!country) {
      res.send({
        status: 'ok',
        data: { error: 'country is required' },
      });
      return;
    }

    try {
      const result = await enableBankingService.getAspsps(country);
      console.log(
        `[EnableBanking] Got ${(result.aspsps || []).length} banks for ${country}`,
      );

      // Normalize to a list with id/name for the autocomplete
      const aspsps = (result.aspsps || []).map(aspsp => ({
        id: aspsp.name,
        name: aspsp.name,
        country: aspsp.country,
        logo: aspsp.logo || null,
      }));

      res.send({
        status: 'ok',
        data: aspsps,
      });
    } catch (error) {
      console.error('[EnableBanking] /get-banks error:', error.message);
      res.send({
        status: 'ok',
        data: {
          error_type: error.message,
          error_code: 'ENABLEBANKING_ERROR',
        },
      });
    }
  }),
);

app.post(
  '/create-web-token',
  handleError(async (req, res) => {
    const { aspspName, aspspCountry } = req.body || {};
    const { origin } = req.headers;
    console.log('[EnableBanking] /create-web-token', {
      aspspName,
      aspspCountry,
      origin,
    });

    if (!aspspName || !aspspCountry) {
      res.send({
        status: 'ok',
        data: { error: 'aspspName and aspspCountry are required' },
      });
      return;
    }

    try {
      // Generate a unique state to correlate the callback code
      const state = uuidv4();

      // The redirect URL points back to our server's link page
      const redirectUrl = `${origin}/enablebanking/link`;
      console.log('[EnableBanking] Starting auth', {
        state,
        redirectUrl,
      });

      const authResult = await enableBankingService.startAuth({
        aspspName,
        aspspCountry,
        redirectUrl,
        state,
      });

      console.log('[EnableBanking] Auth started successfully', {
        state,
        hasUrl: !!authResult.url,
        authorizationId: authResult.authorization_id,
      });

      res.send({
        status: 'ok',
        data: {
          // The URL where the user needs to go to authenticate with their bank
          link: authResult.url,
          // The state is used to retrieve the code after redirect
          state,
        },
      });
    } catch (error) {
      console.error(
        '[EnableBanking] /create-web-token error:',
        error.message,
      );
      res.send({
        status: 'ok',
        data: {
          error_type: error.message,
          error_code: 'ENABLEBANKING_ERROR',
        },
      });
    }
  }),
);

app.post(
  '/get-accounts',
  handleError(async (req, res) => {
    const { state } = req.body || {};
    console.log('[EnableBanking] /get-accounts polling', {
      state,
      pendingCodesKeys: [...pendingCodes.keys()],
    });

    if (!state) {
      res.send({
        status: 'ok',
        data: null,
      });
      return;
    }

    try {
      // Phase 1: Wait for the authorization code from the bank redirect
      const code = pendingCodes.get(state);
      const existingSession = pendingSessions.get(state);

      if (!code && !existingSession) {
        console.log(
          `[EnableBanking] No code yet for state=${state}, still waiting for bank redirect...`,
        );
        res.send({ status: 'ok', data: null });
        return;
      }

      // Phase 2: Exchange code for session (once)
      let sessionId;
      let aspspName;

      if (existingSession) {
        sessionId = existingSession.sessionId;
        aspspName = existingSession.aspspName;
        console.log(
          `[EnableBanking] Already have session=${sessionId}, polling for accounts...`,
        );
      } else {
        console.log(
          `[EnableBanking] Found code for state=${state}, exchanging for session...`,
        );

        const session = await enableBankingService.createSession(code);
        pendingCodes.delete(state);

        sessionId = session.session_id;
        aspspName = session.aspsp?.name || 'EnableBanking';

        console.log('[EnableBanking] Session created:', {
          sessionId,
          aspspName,
          immediateAccountCount: (session.accounts || []).length,
        });

        // If accounts came back immediately, return them
        if (session.accounts && session.accounts.length > 0) {
          const accounts = mapAccounts(session.accounts, aspspName);
          console.log(`[EnableBanking] Got ${accounts.length} accounts immediately`);
          res.send({ status: 'ok', data: { accounts } });
          return;
        }

        // Otherwise store the session for polling
        pendingSessions.set(state, { sessionId, aspspName });
        // Clean up after 10 minutes
        setTimeout(() => pendingSessions.delete(state), 10 * 60 * 1000);
      }

      // Phase 3: Poll GET /sessions/{id}/accounts
      try {
        const accountsResult =
          await enableBankingService.getAccounts(sessionId);
        console.log(
          '[EnableBanking] Polled accounts:',
          JSON.stringify(accountsResult, null, 2),
        );

        const rawAccounts = accountsResult.accounts || [];
        if (rawAccounts.length === 0) {
          console.log(
            `[EnableBanking] No accounts yet for session=${sessionId}, keep polling...`,
          );
          res.send({ status: 'ok', data: null });
          return;
        }

        // Got accounts — clean up and return
        pendingSessions.delete(state);
        const accounts = mapAccounts(rawAccounts, aspspName);
        console.log(
          `[EnableBanking] Returning ${accounts.length} accounts:`,
          JSON.stringify(accounts, null, 2),
        );
        res.send({ status: 'ok', data: { accounts } });
      } catch (pollError) {
        // Session might not be ready yet (some banks return errors while processing)
        console.log(
          `[EnableBanking] Accounts not ready yet for session=${sessionId}: ${pollError.message}`,
        );
        res.send({ status: 'ok', data: null });
      }
    } catch (error) {
      console.error('[EnableBanking] /get-accounts error:', error.message);
      res.send({
        status: 'ok',
        data: {
          error_type: error.message,
          error_code: 'ENABLEBANKING_ERROR',
        },
      });
    }
  }),
);

app.post(
  '/transactions',
  handleError(async (req, res) => {
    const { accountId, startDate } = req.body || {};
    console.log('[EnableBanking] /transactions', { accountId, startDate });

    if (!accountId) {
      res.send({
        status: 'ok',
        data: { error: 'accountId is required' },
      });
      return;
    }

    try {
      const dateFrom =
        startDate || getDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
      console.log('[EnableBanking] Fetching transactions', {
        accountId,
        dateFrom,
      });

      const transactionsResult = await enableBankingService.getTransactions(
        accountId,
        dateFrom,
      );

      console.log('[EnableBanking] Raw transactions response:', {
        transactionCount: (transactionsResult.transactions || []).length,
        keys: Object.keys(transactionsResult),
      });

      const balancesResult = await enableBankingService.getBalances(accountId);

      console.log('[EnableBanking] Raw balances response:', {
        balanceCount: (balancesResult.balances || []).length,
        keys: Object.keys(balancesResult),
      });

      const all = [];
      const booked = [];
      const pending = [];

      const today = getDate(new Date());
      const transactions = transactionsResult.transactions || [];
      for (const trans of transactions) {
        const transDate = trans.booking_date || trans.value_date;

        // Some banks return future recurring transactions as BOOK.
        // Treat anything with a future date as pending, not booked.
        const isBooked = trans.status === 'BOOK' && transDate <= today;

        if (trans.status === 'BOOK' && transDate > today) {
          console.log(
            `[EnableBanking] Demoting future BOOK transaction to pending: date=${transDate} today=${today} amount=${trans.transaction_amount?.amount} ref=${trans.entry_reference}`,
          );
        }

        const remittance = Array.isArray(trans.remittance_information)
          ? trans.remittance_information.join(' ')
          : trans.remittance_information || '';
        const creditorName = Array.isArray(trans.creditor_name)
          ? trans.creditor_name.join(' ')
          : trans.creditor_name || '';
        const debtorName = Array.isArray(trans.debtor_name)
          ? trans.debtor_name.join(' ')
          : trans.debtor_name || '';

        const newTrans = {
          booked: isBooked,
          date: trans.booking_date || trans.value_date,
          payeeName: creditorName || debtorName || remittance,
          notes: remittance,
          transactionAmount: {
            amount:
              trans.credit_debit_indicator === 'DBIT'
                ? '-' + trans.transaction_amount?.amount
                : trans.transaction_amount?.amount,
            currency: trans.transaction_amount?.currency,
          },
          transactionId: trans.entry_reference || trans.transaction_id || '',
        };

        if (isBooked) {
          booked.push(newTrans);
        } else {
          pending.push(newTrans);
        }
        all.push(newTrans);
      }

      // Log a sample transaction for debugging
      if (all.length > 0) {
        console.log(
          '[EnableBanking] Sample normalized transaction:',
          JSON.stringify(all[0], null, 2),
        );
      }
      // Log a sample raw transaction for debugging
      if (transactions.length > 0) {
        console.log(
          '[EnableBanking] Sample raw transaction:',
          JSON.stringify(transactions[0], null, 2),
        );
      }

      const balances = (balancesResult.balances || []).map(bal => ({
        balanceAmount: {
          amount: bal.balance_amount?.amount,
          currency: bal.balance_amount?.currency,
        },
        balanceType: bal.balance_type || 'expected',
        referenceDate: bal.reference_date,
      }));

      let startingBalance = 0;
      if (balances.length > 0) {
        const balAmount = parseFloat(balances[0].balanceAmount.amount);
        startingBalance = Math.round(balAmount * 100);
      }

      console.log('[EnableBanking] /transactions result', {
        totalTransactions: all.length,
        bookedCount: booked.length,
        pendingCount: pending.length,
        balanceCount: balances.length,
        startingBalance,
      });

      res.send({
        status: 'ok',
        data: {
          balances,
          startingBalance,
          transactions: {
            all,
            booked,
            pending,
          },
        },
      });
    } catch (error) {
      console.error('[EnableBanking] /transactions error:', error.message);
      res.send({
        status: 'ok',
        data: {
          error: error.message,
        },
      });
    }
  }),
);

function mapAccounts(rawAccounts, aspspName) {
  return rawAccounts.map(account => ({
    account_id: account.uid || account.resource_id,
    name:
      account.account_name ||
      account.product ||
      account.iban ||
      account.uid,
    institution: aspspName,
    mask: account.iban ? account.iban.slice(-4) : null,
    official_name:
      account.account_name || account.product || account.iban || '',
  }));
}

function getDate(date) {
  return date.toISOString().split('T')[0];
}
