import type { TFunction } from 'i18next';
import {
  isModelUsageRange,
  type ModelUsageRange,
  type ModelUsageResponse,
} from '@/services/api/modelUsage';
import { formatWindowLabel } from './utils';

export const MODEL_USAGE_RANGE_STORAGE_KEY = 'dashboard.modelUsageRange';
export const DEFAULT_MODEL_USAGE_RANGE: ModelUsageRange = 'window';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

const browserStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function readSavedModelUsageRange(
  storage: StorageReader | null = browserStorage()
): ModelUsageRange {
  try {
    const raw = storage?.getItem(MODEL_USAGE_RANGE_STORAGE_KEY);
    return isModelUsageRange(raw) ? raw : DEFAULT_MODEL_USAGE_RANGE;
  } catch {
    return DEFAULT_MODEL_USAGE_RANGE;
  }
}

export function saveModelUsageRange(
  range: ModelUsageRange,
  storage: StorageWriter | null = browserStorage()
): void {
  try {
    storage?.setItem(MODEL_USAGE_RANGE_STORAGE_KEY, range);
  } catch {
    // Persistence is a convenience; private mode or a full quota must not break the page.
  }
}

/** A server without range support echoes nothing and always answers the live window. */
export function isRangeMismatch(
  requested: ModelUsageRange,
  answered: ModelUsageResponse['range']
): boolean {
  return (answered ?? 'window') !== requested;
}

export interface RangeSpan {
  range: ModelUsageRange;
  since: string;
  timezone: string;
  windowMinutes: number;
}

const safeFormat = (
  date: Date,
  language: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions
): string => {
  try {
    return new Intl.DateTimeFormat(language, {
      ...options,
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(language, options).format(date);
  }
};

/** Span sentence for the section subtitle, derived from the response rather than the range id. */
export function formatRangeSpan(span: RangeSpan, t: TFunction, language: string): string {
  const since = span.since ? new Date(span.since) : null;
  const sinceValid = since !== null && !Number.isNaN(since.getTime());

  if (span.range === 'today' && sinceValid) {
    const time = safeFormat(since, language, span.timezone, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return t('dashboard.models_span_today', {
      time,
      timezone: span.timezone || t('dashboard.models_span_local_time'),
    });
  }
  if (span.range === '7d' && span.windowMinutes > 0) {
    return t('dashboard.models_span_days', {
      count: Math.max(1, Math.round(span.windowMinutes / 1440)),
    });
  }
  if (span.range === 'total') {
    if (!sinceValid) return t('dashboard.models_span_total_unknown');
    const date = safeFormat(since, language, span.timezone, { dateStyle: 'medium' });
    return t('dashboard.models_span_total', { date });
  }
  return t('dashboard.models_span_window', {
    window: formatWindowLabel(span.windowMinutes, t, '—'),
  });
}
