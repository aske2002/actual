// @ts-strict-ignore
import { useTranslation } from 'react-i18next';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
} from '@desktop-client/components/common/Modal';
import { ManageRules } from '@desktop-client/components/ManageRules';
import type { Modal as ModalType } from '@desktop-client/modals/modalsSlice';

type ManageRulesModalProps = Extract<
  ModalType,
  { name: 'manage-rules' }
>['options'];

export function ManageRulesModal({ payeeId }: ManageRulesModalProps) {
  const { t } = useTranslation();

  return (
    <Modal name="manage-rules">
      {({ state: { close } }) => (
        <>
          <ModalHeader
            title={t('Rules')}
            rightContent={<ModalCloseButton onPress={close} />}
          />
          <ManageRules isModal payeeId={payeeId} />
        </>
      )}
    </Modal>
  );
}
