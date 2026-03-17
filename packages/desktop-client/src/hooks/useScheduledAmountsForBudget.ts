import { useEffect, useMemo, useState } from 'react';

import * as monthUtils from 'loot-core/shared/months';
import { q } from 'loot-core/shared/query';
import { getScheduledAmount } from 'loot-core/shared/schedules';
import type {
  CategoryEntity,
  RecurConfig,
  ScheduleEntity,
} from 'loot-core/types/models';

import { useCachedSchedules } from './useCachedSchedules';

import { aqlQuery } from '@desktop-client/queries/aqlQuery';

type ScheduleCategoryMap = Map<ScheduleEntity['id'], CategoryEntity['id']>;

// Map<categoryId, Map<month, amount>>
export type ScheduledAmountsByCategory = Map<string, Map<string, number>>;

/**
 * Determines which months a schedule has occurrences in, and how many.
 * Returns a map of month -> number of occurrences.
 */
function getScheduleOccurrencesPerMonth(
  schedule: ScheduleEntity,
  months: string[],
): Map<string, number> {
  const result = new Map<string, number>();

  if (schedule.completed) {
    return result;
  }

  const dateConfig = schedule._date;

  if (typeof dateConfig === 'string') {
    // Non-recurring: single date
    const month = monthUtils.getMonth(dateConfig);
    if (months.includes(month)) {
      result.set(month, 1);
    }
    return result;
  }

  // Recurring schedule
  const config = dateConfig as RecurConfig;
  const interval = config.interval || 1;

  for (const month of months) {
    const count = countOccurrencesInMonth(config, month, interval);
    if (count > 0) {
      result.set(month, count);
    }
  }

  return result;
}

function countOccurrencesInMonth(
  config: RecurConfig,
  month: string,
  interval: number,
): number {
  const startMonth = monthUtils.getMonth(config.start);

  // If schedule hasn't started yet for this month
  if (month < startMonth) {
    return 0;
  }

  // Check end date
  if (config.endMode === 'on_date' && config.endDate) {
    const endMonth = monthUtils.getMonth(config.endDate);
    if (month > endMonth) {
      return 0;
    }
  }

  switch (config.frequency) {
    case 'monthly': {
      // Check if this month aligns with the interval
      const monthDiff = monthUtils.differenceInCalendarMonths(month, startMonth);
      if (monthDiff % interval !== 0) {
        return 0;
      }
      // For monthly schedules with patterns, count patterns
      if (config.patterns && config.patterns.length > 0) {
        return config.patterns.length;
      }
      return 1;
    }

    case 'weekly': {
      // Approximate: 4-5 weeks per month, adjusted for interval
      const weeksInMonth = 4.33;
      return Math.round(weeksInMonth / interval);
    }

    case 'daily': {
      // Days in month divided by interval
      const daysInMonth = getDaysInMonth(month);
      return Math.ceil(daysInMonth / interval);
    }

    case 'yearly': {
      if (interval !== 1) {
        // For multi-year intervals, check if this year aligns
        const startYear = parseInt(config.start.substring(0, 4), 10);
        const thisYear = parseInt(month.substring(0, 4), 10);
        if ((thisYear - startYear) % interval !== 0) {
          return 0;
        }
      }
      // Only occurs in the month matching the start date's month
      const startMonthNum = parseInt(config.start.substring(5, 7), 10);
      const thisMonthNum = parseInt(month.substring(5, 7), 10);
      return startMonthNum === thisMonthNum ? 1 : 0;
    }

    default:
      return 0;
  }
}

function getDaysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon, 0).getDate();
}

/**
 * Extracts category from a schedule's rule actions.
 * Returns the category ID if found, null otherwise.
 */
function getCategoryFromActions(
  schedule: ScheduleEntity,
): CategoryEntity['id'] | null {
  if (!schedule._actions) {
    return null;
  }

  for (const action of schedule._actions) {
    const a = action as { op: string; field?: string; value?: unknown };
    if (a.op === 'set' && a.field === 'category' && typeof a.value === 'string') {
      return a.value;
    }
  }

  return null;
}

/**
 * Queries past transactions linked to schedules to determine their categories.
 * Returns a map of scheduleId -> categoryId.
 */
async function fetchScheduleCategoriesFromTransactions(
  scheduleIds: string[],
): Promise<ScheduleCategoryMap> {
  const map: ScheduleCategoryMap = new Map();

  if (scheduleIds.length === 0) {
    return map;
  }

  const result = await aqlQuery(
    q('transactions')
      .filter({
        schedule: { $oneof: scheduleIds },
        category: { $ne: null },
      })
      .orderBy({ date: 'desc' })
      .select(['schedule', 'category', 'date']),
  );

  if (result?.data) {
    // For each schedule, use the most recent transaction's category
    for (const row of result.data as Array<{
      schedule: string;
      category: string;
      date: string;
    }>) {
      if (!map.has(row.schedule)) {
        map.set(row.schedule, row.category);
      }
    }
  }

  return map;
}

/**
 * Hook that computes scheduled amounts per category per month.
 * Used to show predicted spending in the budget view.
 */
export function useScheduledAmountsForBudget(months: string[]) {
  const { schedules, isLoading: schedulesLoading } = useCachedSchedules();
  const [categoryMap, setCategoryMap] = useState<ScheduleCategoryMap>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // Build category map: first from actions, then query transactions for the rest
  useEffect(() => {
    if (schedulesLoading) {
      return;
    }

    const actionCategories = new Map<string, string>();
    const needsLookup: string[] = [];

    const activeSchedules = schedules.filter(s => !s.completed && !s.tombstone);

    for (const schedule of activeSchedules) {
      const cat = getCategoryFromActions(schedule);
      if (cat) {
        actionCategories.set(schedule.id, cat);
      } else {
        needsLookup.push(schedule.id);
      }
    }

    if (needsLookup.length === 0) {
      setCategoryMap(actionCategories);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    fetchScheduleCategoriesFromTransactions(needsLookup).then(
      transactionMap => {
        if (cancelled) return;
        const combined = new Map([...actionCategories, ...transactionMap]);
        setCategoryMap(combined);
        setIsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [schedules, schedulesLoading]);

  // Compute scheduled amounts per category per month
  const scheduledAmounts = useMemo<ScheduledAmountsByCategory>(() => {
    if (isLoading || schedulesLoading || months.length === 0) {
      return new Map();
    }

    const result: ScheduledAmountsByCategory = new Map();

    const activeSchedules = schedules.filter(s => !s.completed && !s.tombstone);

    for (const schedule of activeSchedules) {
      const categoryId = categoryMap.get(schedule.id);
      if (!categoryId) {
        continue;
      }

      const amount = getScheduledAmount(schedule._amount);
      if (amount === 0) {
        continue;
      }

      const occurrences = getScheduleOccurrencesPerMonth(schedule, months);

      for (const [month, count] of occurrences) {
        if (!result.has(categoryId)) {
          result.set(categoryId, new Map());
        }
        const monthMap = result.get(categoryId)!;
        const current = monthMap.get(month) || 0;
        monthMap.set(month, current + amount * count);
      }
    }

    return result;
  }, [schedules, schedulesLoading, categoryMap, isLoading, months]);

  return { scheduledAmounts, isLoading: isLoading || schedulesLoading };
}
