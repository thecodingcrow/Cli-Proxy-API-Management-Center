import type { ModelUsageRange, ModelUsageResponse } from '@/services/api/modelUsage';

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
}

export interface ProviderBreakdown {
  id: string;
  requests: number;
  totalTokens: number;
  subagentTokens: number;
  models: ModelBreakdownRow[];
}

export interface ModelBreakdown {
  /** Range the data covers; the live window when the server reports none. */
  range: ModelUsageRange;
  since: string;
  timezone: string;
  windowMinutes: number;
  providers: ProviderBreakdown[];
}

type MutableRow = Omit<ModelBreakdownRow, 'share' | 'subagentShare'>;

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
    if (row.subagent) merged.subagentTokens += row.totalTokens;
    else merged.mainTokens += row.totalTokens;
  });

  const providers: ProviderBreakdown[] = [];
  byProvider.forEach((provider, id) => {
    if (provider.requests <= 0) return;
    const rows = Array.from(provider.rows.values());
    const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0);
    const subagentTokens = rows.reduce((sum, row) => sum + row.subagentTokens, 0);
    const models = rows
      .map<ModelBreakdownRow>((row) => ({
        ...row,
        share: totalTokens > 0 ? (row.totalTokens / totalTokens) * 100 : 0,
        subagentShare: row.totalTokens > 0 ? (row.subagentTokens / row.totalTokens) * 100 : null,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));
    providers.push({ id, requests: provider.requests, totalTokens, subagentTokens, models });
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
