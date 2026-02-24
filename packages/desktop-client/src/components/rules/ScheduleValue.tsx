import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { View } from '@actual-app/components/view';

import { q } from 'loot-core/shared/query';
import { describeSchedule } from 'loot-core/shared/schedules';
import type { ScheduleEntity } from 'loot-core/types/models';

import { Value } from './Value';

import { usePayeesById } from '@desktop-client/hooks/usePayees';
import { useSchedules } from '@desktop-client/hooks/useSchedules';

type ScheduleValueProps = {
  value: ScheduleEntity['id'];
};

export function ScheduleValue({ value }: ScheduleValueProps) {
  const { t } = useTranslation();
  const { data: byId = {} } = usePayeesById();
  const schedulesQuery = useMemo(() => q('schedules').select('*'), []);
  const { schedules = [], isLoading } = useSchedules({ query: schedulesQuery });

  if (isLoading) {
    return (
      <View aria-label={t('Loading...')} style={{ display: 'inline-flex' }}>
        <AnimatedLoading width={10} height={10} />
      </View>
    );
  }

  return (
    <Value
      value={value}
      field="rule"
      describe={val => {
        const schedule = schedules.find(s => s.id === val);
        if (!schedule) {
          return t('(deleted)');
        }
        return describeSchedule(schedule, byId[schedule._payee]);
      }}
    />
  );
}
