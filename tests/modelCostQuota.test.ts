import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import { ProviderModels } from '../src/features/dashboard/components/ProviderModels';
import { buildModelBreakdown } from '../src/features/dashboard/modelBreakdown';
import { formatCost, formatQuotaPct } from '../src/features/dashboard/quotaFigures';
import { normalizeModelUsage } from '../src/services/api/modelUsage';

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
  total_tokens: 100,
  ...over,
});

const account = (index: string, over: Record<string, unknown> = {}) => ({
  auth_index: index,
  used_pct: 27,
  window_start: '2026-10-20T07:00:00Z',
  resets_at: '2026-10-27T07:00:00Z',
  cost_usd_micros: 400_000_000,
  ...over,
});

const quota = {
  provider: 'claude',
  accounts: 2,
  pooling: 'mean',
  weekly_all: {
    used_pct: 41.5,
    cost_usd_micros: 812_345_678,
    pct_per_usd: 0.0511,
    accounts: [account('10'), account('9', { used_pct: 56 })],
  },
  fable: {
    used_pct: 12,
    cost_usd_micros: 100_000_000,
    pct_per_usd: 0.12,
    window_rule: 'common',
    window_start: '2026-10-16T07:00:00Z',
    resets_at: '2026-10-23T07:00:00Z',
    models: ['claude-fable-5-1'],
  },
  observed_at: '2026-10-21T08:12:00Z',
  stale: false,
};

const payload = (models: unknown[], extra: Record<string, unknown> = {}) => ({
  bucket_seconds: 600,
  window_minutes: 200,
  generated_at: '2026-10-21T10:00:00Z',
  models,
  ...extra,
});

const priced = [
  row({
    cache_write_tokens: 40,
    cost_usd_micros: 2_500_000,
    unpriced_requests: 1,
    cost_partial: true,
    quota_weekly_pct: 0.5,
  }),
  row({
    subagent: true,
    cache_write_tokens: 10,
    cost_usd_micros: 1_500_000,
    unpriced_requests: 2,
    quota_weekly_pct: 0.25,
  }),
  row({
    model: 'claude-fable-5-1',
    cost_usd_micros: 4_000_000,
    quota_weekly_pct: 1,
    quota_fable_pct: 3,
  }),
];

describe('normalizeModelUsage cost and quota', () => {
  test('maps a full contract payload', () => {
    const usage = normalizeModelUsage(payload(priced, { quota }));
    expect(usage?.models[0]).toMatchObject({
      cacheWriteTokens: 40,
      costUsdMicros: 2_500_000,
      unpricedRequests: 1,
      costPartial: true,
      quotaWeeklyPct: 0.5,
    });
    expect(usage?.models[0].quotaFablePct).toBeUndefined();
    expect(usage?.models[2].quotaFablePct).toBe(3);
    expect(usage?.quota).toMatchObject({
      provider: 'claude',
      accounts: 2,
      pooling: 'mean',
      observedAt: '2026-10-21T08:12:00Z',
      stale: false,
      weeklyAll: { usedPct: 41.5, pctPerUsd: 0.0511, windowRule: '' },
      fable: {
        usedPct: 12,
        windowRule: 'common',
        resetsAt: '2026-10-23T07:00:00Z',
        models: ['claude-fable-5-1'],
      },
    });
  });

  test('sorts per-account windows by auth_index, numerically', () => {
    const accounts = normalizeModelUsage(payload([row({})], { quota }))!.quota!.weeklyAll!.accounts;
    expect(accounts.map((a) => a.authIndex)).toEqual(['9', '10']);
    expect(accounts[0]).toMatchObject({ usedPct: 56, resetsAt: '2026-10-27T07:00:00Z' });
  });

  test('old payload leaves every new field undefined', () => {
    const usage = normalizeModelUsage(payload([row({})]));
    const first = usage!.models[0];
    expect(first.costUsdMicros).toBeUndefined();
    expect(first.cacheWriteTokens).toBeUndefined();
    expect(first.unpricedRequests).toBeUndefined();
    expect(first.costPartial).toBeUndefined();
    expect(first.quotaWeeklyPct).toBeUndefined();
    expect(first.quotaFablePct).toBeUndefined();
    expect(usage!.quota).toBeUndefined();
  });

  test('quota without a fable sub-block', () => {
    const usage = normalizeModelUsage(
      payload([row({})], { quota: { ...quota, fable: undefined } })
    );
    expect(usage?.quota?.weeklyAll?.usedPct).toBe(41.5);
    expect(usage?.quota?.fable).toBeUndefined();
  });
});

describe('buildModelBreakdown cost and quota', () => {
  const build = (extra: Record<string, unknown> = { quota }) =>
    buildModelBreakdown(normalizeModelUsage(payload(priced, extra)));

  test('merge sums cost, cache writes, unpriced and pcts; cost_partial ORs', () => {
    const opus = build()!.providers[0].models.find((m) => m.model === 'claude-opus-5-5')!;
    expect(opus.costUsd).toBeCloseTo(4, 9);
    expect(opus.cacheWriteTokens).toBe(50);
    expect(opus.unpricedRequests).toBe(3);
    expect(opus.quotaWeeklyPct).toBeCloseTo(0.75, 9);
    expect(opus.costPartial).toBe(true);
    expect(opus.fable).toBe(false);
  });

  test('provider totals sum rows; fable rows flagged from quota.fable.models', () => {
    const claude = build()!.providers[0];
    expect(claude.costUsd).toBeCloseTo(8, 9);
    expect(claude.quotaWeeklyPct).toBeCloseTo(1.75, 9);
    expect(claude.quotaFablePct).toBe(3);
    expect(claude.costPartial).toBe(true);
    expect(claude.quota?.accounts).toBe(2);
    expect(claude.models.find((m) => m.fable)?.model).toBe('claude-fable-5-1');
  });

  test('old backend: no figures, nothing zero', () => {
    const claude = buildModelBreakdown(
      normalizeModelUsage(payload([row({}), row({ subagent: true })]))
    )!.providers[0];
    expect(claude.costUsd).toBeUndefined();
    expect(claude.quotaWeeklyPct).toBeUndefined();
    expect(claude.quota).toBeUndefined();
    expect(claude.models[0].costUsd).toBeUndefined();
    expect(claude.models[0].costPartial).toBe(false);
    expect(claude.models[0].unpricedRequests).toBe(0);
  });

  test('quota belongs to its provider only', () => {
    const result = buildModelBreakdown(
      normalizeModelUsage(
        payload([row({ cost_usd_micros: 1_000_000 }), row({ provider: 'codex', model: 'gpt' })], {
          quota,
        })
      )
    )!;
    const codex = result.providers.find((p) => p.id === 'codex')!;
    expect(codex.quota).toBeUndefined();
  });
});

describe('figure formatting', () => {
  test('cost precision', () => {
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCost(999.99)).toBe('$999.99');
    expect(formatCost(1234)).toBe('$1,234');
    expect(formatCost(1234.6)).toBe('$1,235');
    expect(formatCost(0)).toBeNull();
    expect(formatCost(undefined)).toBeNull();
  });

  test('percent: one decimal, over 100 allowed, tiny and zero', () => {
    expect(formatQuotaPct(12.34)).toBe('12.3%');
    expect(formatQuotaPct(5)).toBe('5.0%');
    expect(formatQuotaPct(240.04)).toBe('240.0%');
    expect(formatQuotaPct(0.03)).toBe('<0.1%');
    expect(formatQuotaPct(0)).toBeNull();
    expect(formatQuotaPct(undefined)).toBeNull();
  });
});

const testI18n = createInstance();
await testI18n.init({ lng: 'en', resources: { en: { translation: en } } });

const render = (models: unknown[], extra: Record<string, unknown>) => {
  const provider = buildModelBreakdown(normalizeModelUsage(payload(models, extra)))!.providers[0];
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: testI18n },
      createElement(ProviderModels, { provider, unknownProviderLabel: 'Unknown' })
    )
  );
};

describe('ProviderModels cost and quota markup', () => {
  const markup = render(priced, { quota });

  test('estimate rows say ≈ weekly, Fable rows say exact Fable weekly', () => {
    expect(markup).toContain('≈ 0.8% weekly');
    expect(markup).toContain('3.0% Fable weekly');
    expect(markup).not.toContain('≈ 3.0%');
    expect(markup).toContain('$4.00');
  });

  test('card total shows summed cost and weekly share', () => {
    expect(markup).toContain('$8.00');
    expect(markup).toContain('≈ 1.8% weekly');
  });

  test('tooltip carries the rules, reset, accounts, partial and unpriced notes', () => {
    expect(markup).toContain('Anthropic&#x27;s API list price');
    expect(markup).toContain('estimate');
    expect(markup).toContain('claude.ai');
    expect(markup).toContain('more than one week');
    expect(markup).toContain('Accounts pooled: 2');
    expect(markup).toContain('Cost partial');
    expect(markup).toContain('Unpriced requests: 3');
  });

  test('old backend renders no cost, no percent', () => {
    const plain = render([row({})], {});
    expect(plain).not.toContain('$');
    expect(plain).not.toContain('weekly');
  });
});

describe('ProviderModels reset lines and missing Fable scope', () => {
  test('one line per account, numbered by auth_index order, no identifier leaked', () => {
    const markup = render(priced, { quota });
    expect(markup).toMatch(/account 1: 56\.0% used, resets [^\n]*Oct/);
    expect(markup).toMatch(/account 2: 27\.0% used, resets/);
    expect(markup).not.toContain('auth_index');
  });

  test('common window rule renders one shared reset line', () => {
    const common = {
      ...quota,
      weekly_all: {
        used_pct: 41.5,
        cost_usd_micros: 1,
        pct_per_usd: 0.5,
        window_rule: 'common',
        window_start: '2026-10-16T07:00:00Z',
        resets_at: '2026-10-23T07:00:00Z',
      },
    };
    const markup = render(priced, { quota: common });
    expect(markup).toContain('Weekly window resets');
    expect(markup).not.toContain('account 1:');
  });

  test('without quota.fable, Fable-named rows show only the weekly estimate', () => {
    const markup = render(priced, { quota: { ...quota, fable: undefined } });
    expect(markup).not.toContain('% Fable weekly');
    expect(markup).toContain('≈ 1.0% weekly');
  });
});

describe('backend golden response', () => {
  const golden = JSON.parse(
    readFileSync(new URL('./fixtures/models-quota.golden.json', import.meta.url), 'utf8')
  ) as { models: Record<string, unknown>[]; quota: Record<string, unknown> };
  const usage = normalizeModelUsage(golden)!;

  test('every wire field on every row is read', () => {
    const wire = (key: string) => key.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
    const rowFields: Record<string, string> = { cost_usd_micros: 'costUsdMicros' };
    golden.models.forEach((raw, index) => {
      for (const [key, value] of Object.entries(raw)) {
        const mapped = (usage.models[index] as unknown as Record<string, unknown>)[
          rowFields[key] ?? wire(key)
        ];
        expect(mapped, `${index}:${key}`).toEqual(value);
      }
    });
  });

  test('quota blocks keep accounts, models, stale and rates', () => {
    const q = usage.quota!;
    expect(q).toMatchObject({ provider: 'claude', accounts: 2, pooling: 'mean', stale: true });
    expect(q.observedAt).toBe('2025-02-25T21:19:00Z');
    expect(q.weeklyAll).toMatchObject({ usedPct: 63.5, costUsdMicros: 20100 });
    expect(q.weeklyAll!.pctPerUsd).toBeCloseTo(3159.2039800995026, 9);
    expect(q.weeklyAll!.accounts.map((a) => [a.authIndex, a.usedPct, a.resetsAt])).toEqual([
      ['ia', 27, '2025-03-03T21:20:00Z'],
      ['ib', 100, '2025-02-26T21:20:00Z'],
    ]);
    expect(q.fable!.models).toEqual(['claude-fable-5-1']);
    expect(q.fable!.accounts).toHaveLength(1);
  });

  test('breakdown flags Fable, sums totals, quota only on claude', () => {
    const [claude, codex] = buildModelBreakdown(usage)!.providers;
    expect(claude.id).toBe('claude');
    expect(claude.models.filter((m) => m.fable).map((m) => m.model)).toEqual(['claude-fable-5-1']);
    expect(claude.costUsd).toBeCloseTo(0.0241, 9);
    expect(claude.quotaFablePct).toBe(10);
    expect(codex.quota).toBeUndefined();
    expect(codex.unpricedRequests).toBe(1);
  });

  test('markup: per-account lines, Fable exact, stale note, unpriced visible without cost', () => {
    const providers = buildModelBreakdown(usage)!.providers;
    const html = (provider: (typeof providers)[number]) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n: testI18n },
          createElement(ProviderModels, { provider, unknownProviderLabel: 'Unknown' })
        )
      );
    const claude = html(providers[0]);
    expect(claude).toContain('account 1: 27.0% used, resets');
    expect(claude).toContain('account 2: 100.0% used, resets');
    expect(claude).toContain('10.0% Fable weekly');
    expect(claude).toContain('≈ 37.9% weekly');
    expect(claude).toContain('&lt;$0.01');
    expect(claude).toContain('Quota data is stale.');
    expect(html(providers[1])).toContain('1 unpriced');
  });
});
