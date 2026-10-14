import type {
  balanceTypeOpType,
  CategoryEntity,
  CategoryGroupEntity,
  RuleConditionEntity,
} from '@actual-app/core/types/models';
import type { SyncedPrefs } from '@actual-app/core/types/prefs';

import type { QueryDataEntity } from '#components/reports/ReportOptions';
import { aqlQuery } from '#queries/aqlQuery';
// [fork:mc D-015]
import {
  getPeriodDays,
  prepareFlowConversion,
} from '#reports/mcReportValuation';
import type { McValuationConfig } from '#reports/mcReportValuation';

import { fetchBudgetData } from './budgetDataQuery';
import { makeQuery } from './makeQuery';

export async function fetchSpreadsheetQueryData(
  args: Parameters<typeof fetchUpstreamQueryData>[0] & {
    mcValuation?: McValuationConfig | null;
  },
): Promise<{ assets: QueryDataEntity[]; debts: QueryDataEntity[] }> {
  // [fork:mc D-015] In another currency, each row (one period's sum) is
  // converted at that period's rate before the report adds rows up
  const { mcValuation, ...upstreamArgs } = args;
  const result = await fetchUpstreamQueryData(upstreamArgs);
  const conversion = mcValuation
    ? await prepareFlowConversion(
        mcValuation,
        getPeriodDays(args.startDate, args.endDate),
      )
    : null;
  if (!conversion) {
    return result;
  }
  const convert = (rows: QueryDataEntity[]) =>
    rows.map(row => ({
      ...row,
      amount: conversion.convert(row.date, row.amount),
    }));
  return { assets: convert(result.assets), debts: convert(result.debts) };
}

async function fetchUpstreamQueryData({
  balanceTypeOp,
  startDate,
  endDate,
  interval,
  categories,
  categoryGroups,
  conditions,
  conditionsOp,
  conditionsOpKey,
  filters,
  budgetType,
  groupBy,
}: {
  balanceTypeOp: balanceTypeOpType | undefined;
  startDate: string;
  endDate: string;
  interval: string;
  categories: CategoryEntity[];
  categoryGroups: CategoryGroupEntity[];
  conditions: RuleConditionEntity[];
  conditionsOp: string;
  conditionsOpKey: string;
  filters: unknown[];
  budgetType?: SyncedPrefs['budgetType'];
  groupBy?: string;
}): Promise<{ assets: QueryDataEntity[]; debts: QueryDataEntity[] }> {
  if (balanceTypeOp === 'totalBudgeted') {
    return fetchBudgetData({
      startDate,
      endDate,
      interval,
      categories,
      categoryGroups,
      conditions,
      conditionsOp: conditionsOp === 'or' ? 'or' : 'and',
      budgetType,
    });
  }

  const [assets, debts] = await Promise.all([
    aqlQuery(
      makeQuery(
        'assets',
        startDate,
        endDate,
        interval,
        conditionsOpKey,
        filters,
        groupBy,
      ),
    ).then(({ data }) => data),
    aqlQuery(
      makeQuery(
        'debts',
        startDate,
        endDate,
        interval,
        conditionsOpKey,
        filters,
        groupBy,
      ),
    ).then(({ data }) => data),
  ]);

  return { assets, debts };
}
