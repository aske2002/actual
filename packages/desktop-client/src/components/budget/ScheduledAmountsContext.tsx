import React, { createContext, useContext } from 'react';
import type { PropsWithChildren } from 'react';

import { useLocalPref } from '@desktop-client/hooks/useLocalPref';
import type { ScheduledAmountsByCategory } from '@desktop-client/hooks/useScheduledAmountsForBudget';
import { useScheduledAmountsForBudget } from '@desktop-client/hooks/useScheduledAmountsForBudget';

type ScheduledAmountsContextValue = {
  showScheduled: boolean;
  toggleShowScheduled: () => void;
  /** Get the total scheduled amount for a category in a given month (in cents) */
  getScheduledAmount: (categoryId: string, month: string) => number;
  scheduledAmounts: ScheduledAmountsByCategory;
  isLoading: boolean;
};

const ScheduledAmountsContext = createContext<
  ScheduledAmountsContextValue | undefined
>(undefined);

type ScheduledAmountsProviderProps = PropsWithChildren<{
  months: string[];
}>;

export function ScheduledAmountsProvider({
  months,
  children,
}: ScheduledAmountsProviderProps) {
  const [showScheduled = false, setShowScheduled] = useLocalPref(
    'budget.showScheduled',
  );

  const { scheduledAmounts, isLoading } = useScheduledAmountsForBudget(months);

  const toggleShowScheduled = () => {
    setShowScheduled(!showScheduled);
  };

  const getScheduledAmount = (categoryId: string, month: string): number => {
    if (!showScheduled) return 0;
    return scheduledAmounts.get(categoryId)?.get(month) || 0;
  };

  return (
    <ScheduledAmountsContext.Provider
      value={{
        showScheduled,
        toggleShowScheduled,
        getScheduledAmount,
        scheduledAmounts,
        isLoading,
      }}
    >
      {children}
    </ScheduledAmountsContext.Provider>
  );
}

export function useScheduledAmounts() {
  const context = useContext(ScheduledAmountsContext);
  if (!context) {
    throw new Error(
      'useScheduledAmounts must be used within a ScheduledAmountsProvider',
    );
  }
  return context;
}
