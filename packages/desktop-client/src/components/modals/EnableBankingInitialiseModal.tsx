// @ts-strict-ignore
import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { css } from '@emotion/css';

import { send } from 'loot-core/platform/client/connection';
import { getSecretsError } from 'loot-core/shared/errors';

import { Error } from '@desktop-client/components/alerts';
import { Link } from '@desktop-client/components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '@desktop-client/components/common/Modal';
import { FormField, FormLabel } from '@desktop-client/components/forms';
import type { Modal as ModalType } from '@desktop-client/modals/modalsSlice';

type EnableBankingInitialiseProps = Extract<
  ModalType,
  { name: 'enablebanking-init' }
>['options'];

export const EnableBankingInitialiseModal = ({
  onSuccess,
}: EnableBankingInitialiseProps) => {
  const { t } = useTranslation();
  const [applicationId, setApplicationId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(
    t('It is required to provide both the application ID and private key.'),
  );

  const onSubmit = async (close: () => void) => {
    if (!applicationId || !privateKey) {
      setIsValid(false);
      setError(
        t('It is required to provide both the application ID and private key.'),
      );
      return;
    }

    setIsLoading(true);

    let { error, reason } =
      (await send('secret-set', {
        name: 'enablebanking_applicationId',
        value: applicationId,
      })) || {};

    if (error) {
      setIsLoading(false);
      setIsValid(false);
      setError(getSecretsError(error, reason));
      return;
    } else {
      ({ error, reason } =
        (await send('secret-set', {
          name: 'enablebanking_privateKey',
          value: privateKey,
        })) || {});
      if (error) {
        setIsLoading(false);
        setIsValid(false);
        setError(getSecretsError(error, reason));
        return;
      }
    }

    setIsValid(true);
    onSuccess();
    setIsLoading(false);
    close();
  };

  return (
    <Modal
      name="enablebanking-init"
      containerProps={{ style: { width: '30vw' } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Set-up EnableBanking')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                In order to enable bank sync via EnableBanking (European banks
                via PSD2) you will need to create access credentials. This can
                be done by creating an account with{' '}
                <Link
                  variant="external"
                  to="https://enablebanking.com"
                  linkColor="purple"
                >
                  EnableBanking
                </Link>
                .
              </Trans>
            </Text>

            <FormField>
              <FormLabel
                title={t('Application ID:')}
                htmlFor="application-id-field"
              />
              <InitialFocus>
                <Input
                  id="application-id-field"
                  type="text"
                  value={applicationId}
                  onChangeValue={value => {
                    setApplicationId(value);
                    setIsValid(true);
                  }}
                />
              </InitialFocus>
            </FormField>

            <FormField>
              <FormLabel
                title={t('Private Key (PEM):')}
                htmlFor="private-key-field"
              />
              <textarea
                id="private-key-field"
                className={css({
                  border: '1px solid ' + theme.buttonNormalBorder,
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  padding: 8,
                  minHeight: 120,
                  resize: 'vertical',
                  backgroundColor: theme.tableBackground,
                  color: theme.tableText,
                })}
                placeholder={t('Paste the contents of your .pem file here...')}
                value={privateKey}
                onChange={e => {
                  setPrivateKey(e.target.value);
                  setIsValid(true);
                }}
              />
            </FormField>

            {!isValid && <Error>{error}</Error>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              isLoading={isLoading}
              onPress={() => {
                void onSubmit(() => state.close());
              }}
            >
              <Trans>Save and continue</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
};
