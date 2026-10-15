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
}

export const MODEL_USAGE_RANGES = ['window', 'today', '7d', 'total'] as const;
export type ModelUsageRange = (typeof MODEL_USAGE_RANGES)[number];

export const isModelUsageRange = (value: unknown): value is ModelUsageRange =>
  typeof value === 'string' && (MODEL_USAGE_RANGES as readonly string[]).includes(value);

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
}

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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
