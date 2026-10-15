import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import ko from '../src/i18n/locales/ko.json';
import ru from '../src/i18n/locales/ru.json';
import vi from '../src/i18n/locales/vi.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import { ProviderModels } from '../src/features/dashboard/components/ProviderModels';
import { apiClient } from '../src/services/api/client';
import { modelUsageApi, normalizeModelUsage } from '../src/services/api/modelUsage';
import { buildModelBreakdown } from '../src/features/dashboard/modelBreakdown';

const row = (over: Record<string, unknown>) => ({
  provider: 'claude',
  model: 'claude-opus-5-5',
  subagent: false,
  requests: 1,
  failed: 0,
  input_tokens: 0,
  output_tokens: 0,
  cached_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  ...over,
});

const payload = (models: unknown[], windowMinutes = 200) => ({
  bucket_seconds: 600,
  window_minutes: windowMinutes,
  generated_at: '2026-10-15T10:00:00Z',
  models,
});

const build = (models: unknown[]) => buildModelBreakdown(normalizeModelUsage(payload(models)));

describe('normalizeModelUsage', () => {
  test('maps snake_case rows and window metadata', () => {
    const usage = normalizeModelUsage(
      payload([row({ input_tokens: 10, output_tokens: 5, cached_tokens: 3, total_tokens: 15 })])
    );
    expect(usage?.windowMinutes).toBe(200);
    expect(usage?.models[0]).toMatchObject({
      provider: 'claude',
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 3,
      totalTokens: 15,
      subagent: false,
    });
  });

  test('rejects non-envelope payloads and drops malformed rows', () => {
    expect(normalizeModelUsage(null)).toBeNull();
    expect(normalizeModelUsage('<html>')).toBeNull();
    expect(normalizeModelUsage({ models: 'x' })).toBeNull();
    const usage = normalizeModelUsage(
      payload([null, row({ model: '' }), row({ total_tokens: 4 })])
    );
    expect(usage?.models).toHaveLength(1);
  });

  test('derives total from input+output when the backend omits it', () => {
    const usage = normalizeModelUsage(payload([row({ input_tokens: 7, output_tokens: 3 })]));
    expect(usage?.models[0].totalTokens).toBe(10);
  });
});

describe('buildModelBreakdown', () => {
  test('merges main and subagent rows of one model', () => {
    const result = build([
      row({ total_tokens: 700, input_tokens: 500, output_tokens: 200, requests: 7 }),
      row({ subagent: true, total_tokens: 300, input_tokens: 250, output_tokens: 50, requests: 3 }),
    ]);
    const models = result?.providers[0].models ?? [];
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      requests: 10,
      totalTokens: 1000,
      mainTokens: 700,
      subagentTokens: 300,
      inputTokens: 750,
      outputTokens: 250,
    });
    expect(models[0].subagentShare).toBeCloseTo(30, 6);
  });

  test('shares within a provider sum to 100 and sort by tokens', () => {
    const result = build([
      row({ model: 'haiku', total_tokens: 100 }),
      row({ model: 'opus', total_tokens: 5000 }),
      row({ model: 'sonnet', total_tokens: 2900 }),
      row({ model: 'sonnet', subagent: true, total_tokens: 1 }),
    ]);
    const models = result?.providers[0].models ?? [];
    expect(models.map((m) => m.model)).toEqual(['opus', 'sonnet', 'haiku']);
    const sum = models.reduce((acc, m) => acc + m.share, 0);
    expect(sum).toBeCloseTo(100, 6);
    expect(models[0].share).toBeCloseTo((5000 / 8001) * 100, 6);
  });

  test('drops providers without requests and orders providers by tokens', () => {
    const result = build([
      row({ provider: 'gemini', model: 'g', requests: 0, total_tokens: 0 }),
      row({ provider: 'codex', model: 'c', requests: 2, total_tokens: 50 }),
      row({ provider: 'claude', model: 'o', requests: 5, total_tokens: 900 }),
    ]);
    expect(result?.providers.map((p) => p.id)).toEqual(['claude', 'codex']);
  });

  test('keeps a zero-token provider that served requests without dividing by zero', () => {
    const result = build([row({ requests: 4, total_tokens: 0 })]);
    const model = result?.providers[0].models[0];
    expect(model?.share).toBe(0);
    expect(model?.subagentShare).toBeNull();
  });

  test('empty response yields no providers; null stays null', () => {
    expect(build([])?.providers).toEqual([]);
    expect(buildModelBreakdown(null)).toBeNull();
  });
});

describe('modelUsageApi.getModelUsage', () => {
  afterEach(() => {
    spyOn(apiClient, 'get').mockRestore();
  });

  test('requests the v8 observability path', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue(payload([row({ total_tokens: 1 })]));
    const usage = await modelUsageApi.getModelUsage();
    expect(get.mock.calls[0][0]).toBe('/observability/usage/models');
    expect(usage?.models).toHaveLength(1);
  });

  test('resolves null on 404 or any error so the section can hide', async () => {
    spyOn(apiClient, 'get').mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    expect(await modelUsageApi.getModelUsage()).toBeNull();
  });

  test('resolves null on a non-envelope body', async () => {
    spyOn(apiClient, 'get').mockResolvedValue('not found page');
    expect(await modelUsageApi.getModelUsage()).toBeNull();
  });
});

const testI18n = createInstance();
await testI18n.init({ lng: 'en', resources: { en: { translation: en } } });

describe('ProviderModels markup', () => {
  const provider = build([
    row({
      model: 'claude-opus-5-5',
      requests: 7,
      total_tokens: 1_500_000,
      input_tokens: 1_000_000,
    }),
    row({ model: 'claude-opus-5-5', subagent: true, requests: 3, total_tokens: 500_000 }),
    row({ model: 'claude-haiku-5', requests: 1, total_tokens: 2_000_000 }),
  ])!.providers[0];

  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: testI18n },
      createElement(ProviderModels, { provider, unknownProviderLabel: 'Unknown' })
    )
  );

  test('shows compact tokens with the exact value as title', () => {
    expect(markup).toContain('title="2,000,000"');
    expect(markup).toContain('>2M<');
    expect(markup).toContain('>4M<');
  });

  test('marks subagent usage only on models that have it', () => {
    // provider-level chip plus the one model that has subagent rows
    expect(markup.match(/subagent 12\.5%/g)).toHaveLength(1);
    expect(markup.match(/subagent 25%/g)).toHaveLength(1);
    expect(markup).not.toContain('subagent 0%');
  });

  test('renders one accessible share bar per model and a token detail disclosure', () => {
    expect(markup.match(/role="img"/g)).toHaveLength(2);
    expect(markup).toContain('claude-haiku-5: 50% of provider tokens');
    expect(markup).toContain('<details');
    expect(markup).toContain('Token details');
  });
});

describe('model breakdown locales', () => {
  const dashboardKeys = (locale: unknown) =>
    (locale as { dashboard: Record<string, string> }).dashboard;
  const keys = Object.keys(dashboardKeys(en)).filter((key) => key.startsWith('models_'));
  const locales = { 'zh-CN': zhCN, 'zh-TW': zhTW, ru, vi, ko };

  test('every locale defines every key with the same placeholders', () => {
    expect(keys.length).toBeGreaterThan(10);
    const placeholders = (text: string) => (text.match(/{{\w+}}/g) ?? []).sort().join();
    for (const [name, locale] of Object.entries(locales)) {
      for (const key of keys) {
        const value = dashboardKeys(locale)[key];
        expect(typeof value, `${name}:${key}`).toBe('string');
        expect(placeholders(value), `${name}:${key}`).toBe(placeholders(dashboardKeys(en)[key]));
      }
    }
  });
});
