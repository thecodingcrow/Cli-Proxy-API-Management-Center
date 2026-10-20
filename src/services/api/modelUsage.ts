import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

const MODEL_USAGE_TIMEOUT_MS = 15 * 1000;

/** One backend row per (provider, model, subagent). */
export interface ModelUsageRow {
  provider: string;
  model: string;
  subagent: boolean;
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** Cost and quota fields are undefined when the server predates them. */
  cacheWriteTokens?: number;
  /** API-equivalent cost of priced requests, millionths of a USD. */
  costUsdMicros?: number;
  unpricedRequests?: number;
  costPartial?: boolean;
  quotaWeeklyPct?: number;
  quotaFablePct?: number;
}

export const MODEL_USAGE_RANGES = ['window', 'today', '7d', 'total'] as const;
export type ModelUsageRange = (typeof MODEL_USAGE_RANGES)[number];

export const isModelUsageRange = (value: unknown): value is ModelUsageRange =>
  typeof value === 'string' && (MODEL_USAGE_RANGES as readonly string[]).includes(value);

/** One pooled account's weekly window; position in the list is its "account N". */
export interface ModelUsageQuotaAccount {
  authIndex: string;
  usedPct: number;
  windowStart: string;
  resetsAt: string;
  costUsdMicros: number;
}

/**
 * One pooled quota window with the cost-per-percent rate derived for it. Windows are per
 * account (`accounts`) or, under `windowRule` "common", one shared span (`windowStart`/`resetsAt`).
 */
export interface ModelUsageQuotaWindow {
  usedPct: number;
  costUsdMicros: number;
  pctPerUsd: number;
  windowRule: string;
  accounts: ModelUsageQuotaAccount[];
  windowStart: string;
  resetsAt: string;
  /** Fable sub-block only: model ids in the Fable scope. */
  models: string[];
}

export interface ModelUsageQuota {
  provider: string;
  accounts: number;
  pooling: string;
  weeklyAll?: ModelUsageQuotaWindow;
  fable?: ModelUsageQuotaWindow;
  observedAt: string;
  stale: boolean;
}

export interface ModelUsageResponse {
  /** Range the server answered for; null when the server predates range support. */
  range: ModelUsageRange | null;
  /** RFC3339 start of the covered span; empty when unreported. */
  since: string;
  /** IANA name of the server timezone behind `today`; empty when unreported. */
  timezone: string;
  bucketSeconds: number;
  windowMinutes: number;
  generatedAt: string;
  models: ModelUsageRow[];
  /** Undefined when the server has no quota data. */
  quota?: ModelUsageQuota;
}

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Absent, negative or non-numeric stays undefined so the UI can tell "none" from zero. */
const readOptionalCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const normalizeQuotaAccount = (raw: unknown): ModelUsageQuotaAccount | undefined => {
  if (!isRecord(raw)) return undefined;
  const usedPct = readOptionalCount(raw.used_pct);
  if (usedPct === undefined) return undefined;
  return {
    authIndex: readText(raw.auth_index),
    usedPct,
    windowStart: readText(raw.window_start),
    resetsAt: readText(raw.resets_at),
    costUsdMicros: readCount(raw.cost_usd_micros),
  };
};

const normalizeQuotaWindow = (raw: unknown): ModelUsageQuotaWindow | undefined => {
  if (!isRecord(raw)) return undefined;
  const usedPct = readOptionalCount(raw.used_pct);
  if (usedPct === undefined) return undefined;
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : [])
    .map(normalizeQuotaAccount)
    .filter((account): account is ModelUsageQuotaAccount => account !== undefined)
    .sort((a, b) => a.authIndex.localeCompare(b.authIndex, undefined, { numeric: true }));
  return {
    usedPct,
    costUsdMicros: readCount(raw.cost_usd_micros),
    pctPerUsd: readCount(raw.pct_per_usd),
    windowRule: readText(raw.window_rule),
    accounts,
    windowStart: readText(raw.window_start),
    resetsAt: readText(raw.resets_at),
    models: Array.isArray(raw.models)
      ? raw.models.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
      : [],
  };
};

const normalizeQuota = (raw: unknown): ModelUsageQuota | undefined => {
  if (!isRecord(raw)) return undefined;
  return {
    provider: readText(raw.provider).toLowerCase(),
    accounts: readCount(raw.accounts),
    pooling: readText(raw.pooling),
    weeklyAll: normalizeQuotaWindow(raw.weekly_all),
    fable: normalizeQuotaWindow(raw.fable),
    observedAt: readText(raw.observed_at),
    stale: raw.stale === true,
  };
};

/** Returns null when the payload is not a usage envelope; malformed rows are dropped. */
export function normalizeModelUsage(raw: unknown): ModelUsageResponse | null {
  if (!isRecord(raw) || !Array.isArray(raw.models)) return null;

  const models: ModelUsageRow[] = [];
  raw.models.forEach((item) => {
    if (!isRecord(item)) return;
    const model = readText(item.model);
    if (!model) return;
    const inputTokens = readCount(item.input_tokens);
    const outputTokens = readCount(item.output_tokens);
    models.push({
      provider: readText(item.provider).toLowerCase() || 'unknown',
      model,
      subagent: item.subagent === true,
      requests: readCount(item.requests),
      failed: readCount(item.failed),
      inputTokens,
      outputTokens,
      cachedTokens: readCount(item.cached_tokens),
      reasoningTokens: readCount(item.reasoning_tokens),
      totalTokens: readCount(item.total_tokens) || inputTokens + outputTokens,
      cacheWriteTokens: readOptionalCount(item.cache_write_tokens),
      costUsdMicros: readOptionalCount(item.cost_usd_micros),
      unpricedRequests: readOptionalCount(item.unpriced_requests),
      costPartial: typeof item.cost_partial === 'boolean' ? item.cost_partial : undefined,
      quotaWeeklyPct: readOptionalCount(item.quota_weekly_pct),
      quotaFablePct: readOptionalCount(item.quota_fable_pct),
    });
  });

  return {
    range: isModelUsageRange(raw.range) ? raw.range : null,
    since: readText(raw.since),
    timezone: readText(raw.timezone),
    bucketSeconds: readCount(raw.bucket_seconds),
    windowMinutes: readCount(raw.window_minutes),
    generatedAt: readText(raw.generated_at),
    models,
    quota: normalizeQuota(raw.quota),
  };
}

export const modelUsageApi = {
  /** Resolves null on any failure: older servers lack the endpoint, and the UI hides the section. */
  getModelUsage: async (range: ModelUsageRange = 'window'): Promise<ModelUsageResponse | null> => {
    try {
      const raw = await apiClient.get<unknown>('/observability/usage/models', {
        timeout: MODEL_USAGE_TIMEOUT_MS,
        params: { range },
      });
      return normalizeModelUsage(raw);
    } catch {
      return null;
    }
  },
};
