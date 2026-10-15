import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createInstance } from 'i18next';
import en from '../src/i18n/locales/en.json';
import { apiClient } from '../src/services/api/client';
import { modelUsageApi, normalizeModelUsage } from '../src/services/api/modelUsage';
import {
  MODEL_USAGE_RANGE_STORAGE_KEY,
  formatRangeSpan,
  isRangeMismatch,
  readSavedModelUsageRange,
  saveModelUsageRange,
} from '../src/features/dashboard/modelUsageRange';
import { formatCompactNumber } from '../src/utils/format';

const i18n = createInstance();
await i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});
const t = i18n.t.bind(i18n);

const envelope = (extra: Record<string, unknown> = {}) => ({
  bucket_seconds: 600,
  window_minutes: 200,
  generated_at: '2026-10-15T10:00:00Z',
  models: [],
  ...extra,
});

describe('normalizeModelUsage range fields', () => {
  test('reads range, since, timezone and window_minutes', () => {
    const usage = normalizeModelUsage(
      envelope({
        range: '7d',
        since: '2026-10-08T10:00:00Z',
        timezone: 'Europe/Berlin',
        window_minutes: 10080,
      })
    );
    expect(usage).toMatchObject({
      range: '7d',
      since: '2026-10-08T10:00:00Z',
      timezone: 'Europe/Berlin',
      windowMinutes: 10080,
    });
  });

  test('old backend without the new fields yields null range and empty since/timezone', () => {
    const usage = normalizeModelUsage(envelope());
    expect(usage?.range).toBeNull();
    expect(usage?.since).toBe('');
    expect(usage?.timezone).toBe('');
  });

  test('an unknown range echo is treated as absent', () => {
    expect(normalizeModelUsage(envelope({ range: 'month' }))?.range).toBeNull();
  });
});

describe('getModelUsage range parameter', () => {
  afterEach(() => {
    spyOn(apiClient, 'get').mockRestore();
  });

  test('sends the requested range as a query parameter', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(envelope({ range: 'today' }));
    await modelUsageApi.getModelUsage('today');
    expect(get.mock.calls[0][0]).toBe('/observability/usage/models');
    expect(get.mock.calls[0][1]).toMatchObject({ params: { range: 'today' } });
  });

  test('defaults to the live window', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(envelope());
    await modelUsageApi.getModelUsage();
    expect(get.mock.calls[0][1]).toMatchObject({ params: { range: 'window' } });
  });
});

describe('isRangeMismatch', () => {
  test('matching echo is fine', () => {
    expect(isRangeMismatch('today', 'today')).toBe(false);
    expect(isRangeMismatch('window', 'window')).toBe(false);
  });

  test('old backend (no echo) matches only the live window', () => {
    expect(isRangeMismatch('window', null)).toBe(false);
    expect(isRangeMismatch('today', null)).toBe(true);
    expect(isRangeMismatch('7d', null)).toBe(true);
    expect(isRangeMismatch('total', null)).toBe(true);
  });

  test('a different echo is a mismatch', () => {
    expect(isRangeMismatch('total', 'window')).toBe(true);
  });
});

describe('formatRangeSpan', () => {
  const span = (over: Record<string, unknown>) =>
    formatRangeSpan(
      {
        range: 'window',
        since: '',
        timezone: '',
        windowMinutes: 200,
        ...over,
      } as Parameters<typeof formatRangeSpan>[0],
      t,
      'en'
    );

  test('window derives the duration from window_minutes', () => {
    expect(span({})).toBe('Token share per model over the last 3h 20m.');
    expect(span({ windowMinutes: 180 })).toBe('Token share per model over the last 3h.');
  });

  test('today reads the start time in the server timezone', () => {
    expect(
      span({
        range: 'today',
        since: '2026-10-14T22:00:00Z',
        timezone: 'Europe/Berlin',
        windowMinutes: 600,
      })
    ).toBe('Token share per model since 00:00 (Europe/Berlin).');
  });

  test('7d derives the day count from window_minutes', () => {
    expect(span({ range: '7d', windowMinutes: 10080 })).toBe(
      'Token share per model over the last 7 days.'
    );
    expect(span({ range: '7d', windowMinutes: 1440 })).toBe(
      'Token share per model over the last 1 day.'
    );
  });

  test('total names the tracking start date', () => {
    expect(span({ range: 'total', since: '2026-03-02T12:00:00Z', timezone: 'Europe/Berlin' })).toBe(
      'Token share per model since Mar 2, 2026 (tracking start).'
    );
  });

  test('total without since falls back to all tracked usage', () => {
    expect(span({ range: 'total' })).toBe('Token share per model across all tracked usage.');
  });

  test('unknown timezone does not throw', () => {
    expect(span({ range: 'today', since: '2026-10-14T22:00:00Z', timezone: 'Nope/Zone' })).toMatch(
      /^Token share per model since \d\d:\d\d/
    );
  });
});

describe('selection persistence', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    };
  };

  test('defaults to the live window', () => {
    expect(readSavedModelUsageRange(memory())).toBe('window');
  });

  test('round-trips every range', () => {
    const storage = memory();
    for (const range of ['window', 'today', '7d', 'total'] as const) {
      saveModelUsageRange(range, storage);
      expect(readSavedModelUsageRange(storage)).toBe(range);
    }
    expect(storage.data.has(MODEL_USAGE_RANGE_STORAGE_KEY)).toBe(true);
  });

  test('stale or invalid values fall back to the live window', () => {
    const storage = memory();
    storage.setItem(MODEL_USAGE_RANGE_STORAGE_KEY, 'month');
    expect(readSavedModelUsageRange(storage)).toBe('window');
  });

  test('throwing storage never breaks the dashboard', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readSavedModelUsageRange(broken)).toBe('window');
    expect(() => saveModelUsageRange('total', broken)).not.toThrow();
  });
});

describe('large token values', () => {
  test('compact format reaches B and T without overflowing the column', () => {
    expect(formatCompactNumber(3_400_000_000)).toBe('3.4B');
    expect(formatCompactNumber(12_300_000_000)).toBe('12.3B');
    expect(formatCompactNumber(999_600_000)).toBe('1B');
    expect(formatCompactNumber(2_100_000_000_000)).toBe('2.1T');
    expect(formatCompactNumber(3_400_000_000).length).toBeLessThanOrEqual(5);
  });
});
