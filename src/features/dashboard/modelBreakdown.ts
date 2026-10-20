import type {
  ModelUsageQuota,
  ModelUsageRange,
  ModelUsageResponse,
} from '@/services/api/modelUsage';

export interface ModelBreakdownRow {
  model: string;
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  mainTokens: number;
  subagentTokens: number;
  /** 0–100 of the provider's total tokens */
  share: number;
  /** 0–100 of this model's own tokens; null when it has none */
  subagentShare: number | null;
  /** API-equivalent USD; undefined when the server sends no cost. */
  costUsd?: number;
  cacheWriteTokens?: number;
  unpricedRequests: number;
  costPartial: boolean;
  quotaWeeklyPct?: number;
  quotaFablePct?: number;
  /** Model sits in the Fable quota scope, so its Fable share is exact. */
  fable: boolean;
}

export interface ProviderBreakdown {
  id: string;
  requests: number;
  totalTokens: number;
  subagentTokens: number;
  models: ModelBreakdownRow[];
  costUsd?: number;
  unpricedRequests: number;
  costPartial: boolean;
  quotaWeeklyPct?: number;
  quotaFablePct?: number;
  /** Quota block when it belongs to this provider. */
  quota?: ModelUsageQuota;
}

export interface ModelBreakdown {
  /** Range the data covers; the live window when the server reports none. */
  range: ModelUsageRange;
  since: string;
  timezone: string;
  windowMinutes: number;
  providers: ProviderBreakdown[];
}

/** Sums optional figures; stays undefined while no addend is defined. */
const addOptional = (total: number | undefined, value: number | undefined): number | undefined =>
  value === undefined ? total : (total ?? 0) + value;

type MutableRow = Omit<ModelBreakdownRow, 'share' | 'subagentShare' | 'fable'>;

/**
 * Merges the main and subagent backend rows of one model, drops providers without
 * requests, and derives token shares. Providers and models sort by tokens, then name.
 */
export function buildModelBreakdown(usage: ModelUsageResponse | null): ModelBreakdown | null {
  if (!usage) return null;

  const byProvider = new Map<string, { requests: number; rows: Map<string, MutableRow> }>();

  usage.models.forEach((row) => {
    let provider = byProvider.get(row.provider);
    if (!provider) {
      provider = { requests: 0, rows: new Map() };
      byProvider.set(row.provider, provider);
    }
    provider.requests += row.requests;

    let merged = provider.rows.get(row.model);
    if (!merged) {
      merged = {
        model: row.model,
        requests: 0,
        failed: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        mainTokens: 0,
        subagentTokens: 0,
        unpricedRequests: 0,
        costPartial: false,
      };
      provider.rows.set(row.model, merged);
    }
    merged.requests += row.requests;
    merged.failed += row.failed;
    merged.inputTokens += row.inputTokens;
    merged.outputTokens += row.outputTokens;
    merged.cachedTokens += row.cachedTokens;
    merged.reasoningTokens += row.reasoningTokens;
    merged.totalTokens += row.totalTokens;
    merged.costUsd = addOptional(
      merged.costUsd,
      row.costUsdMicros === undefined ? undefined : row.costUsdMicros / 1e6
    );
    merged.cacheWriteTokens = addOptional(merged.cacheWriteTokens, row.cacheWriteTokens);
    merged.unpricedRequests += row.unpricedRequests ?? 0;
    merged.costPartial ||= row.costPartial === true;
    merged.quotaWeeklyPct = addOptional(merged.quotaWeeklyPct, row.quotaWeeklyPct);
    merged.quotaFablePct = addOptional(merged.quotaFablePct, row.quotaFablePct);
    if (row.subagent) merged.subagentTokens += row.totalTokens;
    else merged.mainTokens += row.totalTokens;
  });

  const providers: ProviderBreakdown[] = [];
  byProvider.forEach((provider, id) => {
    if (provider.requests <= 0) return;
    const rows = Array.from(provider.rows.values());
    const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0);
    const subagentTokens = rows.reduce((sum, row) => sum + row.subagentTokens, 0);
    const quota = usage.quota?.provider === id ? usage.quota : undefined;
    const fableModels = new Set(quota?.fable?.models ?? []);
    const models = rows
      .map<ModelBreakdownRow>((row) => ({
        ...row,
        fable: fableModels.has(row.model),
        share: totalTokens > 0 ? (row.totalTokens / totalTokens) * 100 : 0,
        subagentShare: row.totalTokens > 0 ? (row.subagentTokens / row.totalTokens) * 100 : null,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));
    const sum = (pick: (row: ModelBreakdownRow) => number | undefined) =>
      models.reduce<number | undefined>((total, row) => addOptional(total, pick(row)), undefined);
    providers.push({
      id,
      requests: provider.requests,
      totalTokens,
      subagentTokens,
      models,
      costUsd: sum((row) => row.costUsd),
      unpricedRequests: models.reduce((total, row) => total + row.unpricedRequests, 0),
      costPartial: models.some((row) => row.costPartial),
      quotaWeeklyPct: sum((row) => row.quotaWeeklyPct),
      quotaFablePct: sum((row) => row.quotaFablePct),
      quota,
    });
  });

  providers.sort(
    (a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests || a.id.localeCompare(b.id)
  );

  return {
    range: usage.range ?? 'window',
    since: usage.since,
    timezone: usage.timezone,
    windowMinutes: usage.windowMinutes,
    providers,
  };
}
