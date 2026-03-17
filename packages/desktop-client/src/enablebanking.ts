import { send } from 'loot-core/platform/client/connection';

import { pushModal } from './modals/modalsSlice';
import type { AppDispatch } from './redux/store';

function _authorize(
  dispatch: AppDispatch,
  {
    onSuccess,
    onClose,
  }: {
    onSuccess: (data: {
      accounts: Array<{
        account_id: string;
        name: string;
        institution: string;
        mask: string | null;
        official_name: string;
      }>;
    }) => Promise<void>;
    onClose?: () => void;
  },
) {
  dispatch(
    pushModal({
      modal: {
        name: 'enablebanking-external-msg',
        options: {
          onMoveExternal: async ({ aspspName, aspspCountry }) => {
            const resp = await send('enablebanking-create-web-token', {
              aspspName,
              aspspCountry,
            });

            if ('error' in resp) return resp;
            const { link, state } = resp;
            window.Actual.openURLInBrowser(link);

            return send('enablebanking-poll-web-token', {
              state,
            });
          },
          onClose,
          onSuccess,
        },
      },
    }),
  );
}

export async function authorizeEnableBank(dispatch: AppDispatch) {
  _authorize(dispatch, {
    onSuccess: async data => {
      dispatch(
        pushModal({
          modal: {
            name: 'select-linked-accounts',
            options: {
              externalAccounts: data.accounts.map(account => ({
                ...account,
                balance: 0,
                orgDomain: null,
                orgId: account.account_id,
              })),
              syncSource: 'enableBanking',
            },
          },
        }),
      );
    },
  });
}
