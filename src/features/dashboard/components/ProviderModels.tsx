import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import type { ModelUsageQuotaWindow } from '@/services/api/modelUsage';
import type { ModelBreakdownRow, ProviderBreakdown } from '../modelBreakdown';
import { formatCost, formatQuotaPct } from '../quotaFigures';
import { providerLabel } from '../utils';
import styles from './ProviderModels.module.scss';

/** Sub-0.1% shares round to "0%", which reads as unused. */
const formatShare = (value: number): string =>
  value > 0 && value < 0.1 ? '<0.1%' : formatPercent(value);

type Translate = TFunction;

function formatReset(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function windowLines(t: Translate, window: ModelUsageQuotaWindow | undefined): string[] {
  if (!window) return [];
  if (window.accounts.length > 0) {
    return window.accounts.map((account, index) =>
      account.exact || account.baselineUsedPct === undefined
        ? t('dashboard.models_hint_account', {
            n: index + 1,
            percent: formatQuotaPct(account.usedPct) ?? '0%',
            time: formatReset(account.resetsAt),
          })
        : t('dashboard.models_hint_account_since', {
            n: index + 1,
            percent: formatQuotaPct(account.usedPct) ?? '0%',
            since: formatReset(account.baselineAt),
            points: Math.max(0, account.usedPct - account.baselineUsedPct).toFixed(1),
          })
    );
  }
  return window.resetsAt
    ? [t('dashboard.models_hint_reset', { time: formatReset(window.resetsAt) })]
    : [];
}

interface Figures {
  cost: string | null;
  fable: string | null;
  weekly: string | null;
}

interface FigureSource {
  costUsd?: number;
  quotaWeeklyPct?: number;
  quotaFablePct?: number;
  unpricedRequests: number;
  costPartial: boolean;
}

/** Fable % is exact only on Fable-scope rows (and the card total once such rows exist). */
function figuresOf(source: FigureSource, fableScope: boolean): Figures {
  return {
    cost: formatCost(source.costUsd),
    fable: fableScope ? formatQuotaPct(source.quotaFablePct) : null,
    weekly: formatQuotaPct(source.quotaWeeklyPct),
  };
}

function hintOf(
  t: Translate,
  source: FigureSource,
  figures: Figures,
  provider: ProviderBreakdown
): string {
  const quota = provider.quota;
  const lines: string[] = [];
  if (figures.cost) {
    lines.push(t('dashboard.models_hint_price'), t('dashboard.models_hint_cache_write'));
  }
  if (source === provider && quota && !quota.weeklyAll) {
    lines.push(t('dashboard.models_hint_quota_pending'));
  }
  if (figures.weekly || figures.fable) {
    lines.push(
      t('dashboard.models_hint_weekly'),
      t('dashboard.models_hint_external'),
      t('dashboard.models_hint_over_100')
    );
    lines.push(...windowLines(t, quota?.weeklyAll));
    if (figures.fable) {
      lines.push(t('dashboard.models_hint_fable_heading'), ...windowLines(t, quota?.fable));
    }
    if (quota?.accounts) lines.push(t('dashboard.models_hint_accounts', { count: quota.accounts }));
    if (
      quota?.accounts &&
      quota.accountsInRate !== undefined &&
      quota.accountsInRate < quota.accounts
    ) {
      lines.push(
        t('dashboard.models_hint_rate_coverage', {
          used: quota.accountsInRate,
          total: quota.accounts,
        })
      );
    }
    if (quota?.stale) lines.push(t('dashboard.models_hint_stale'));
  }
  if (source.costPartial) lines.push(t('dashboard.models_hint_partial'));
  if (source.unpricedRequests > 0) {
    lines.push(t('dashboard.models_hint_unpriced', { count: source.unpricedRequests }));
  }
  return lines.join('\n');
}

interface FigureChipsProps {
  source: FigureSource;
  fableScope: boolean;
  provider: ProviderBreakdown;
}

function FigureChips({ source, fableScope, provider }: FigureChipsProps) {
  const { t } = useTranslation();
  const figures = figuresOf(source, fableScope);
  const unpriced =
    source.unpricedRequests > 0
      ? t('dashboard.models_unpriced_chip', { count: source.unpricedRequests })
      : null;
  if (!figures.cost && !figures.fable && !figures.weekly && !unpriced) return null;
  return (
    <span className={styles.figures} tabIndex={0} title={hintOf(t, source, figures, provider)}>
      {figures.cost && <span className={styles.cost}>{figures.cost}</span>}
      {figures.fable && (
        <span>{t('dashboard.models_quota_fable', { percent: figures.fable })}</span>
      )}
      {figures.weekly && (
        <span>{t('dashboard.models_quota_weekly', { percent: figures.weekly })}</span>
      )}
      {unpriced && !figures.cost && !figures.weekly && !figures.fable && <span>{unpriced}</span>}
    </span>
  );
}

interface ShareBarProps {
  row: ModelBreakdownRow;
  label: string;
}

/** Fill width is the provider share; the hatched tail is the subagent part of it. */
function ShareBar({ row, label }: ShareBarProps) {
  return (
    <div className={styles.track} role="img" aria-label={label}>
      {row.share > 0 && (
        <div className={styles.fill} style={{ width: `${row.share}%` }}>
          {row.mainTokens > 0 && (
            <span className={styles.main} style={{ flexGrow: row.mainTokens }} />
          )}
          {row.subagentTokens > 0 && (
            <span className={styles.subagent} style={{ flexGrow: row.subagentTokens }} />
          )}
        </div>
      )}
    </div>
  );
}

interface ProviderModelsProps {
  provider: ProviderBreakdown;
  unknownProviderLabel: string;
}

export function ProviderModels({ provider, unknownProviderLabel }: ProviderModelsProps) {
  const { t } = useTranslation();
  const name = providerLabel(provider.id, unknownProviderLabel);
  const providerSubagentShare =
    provider.totalTokens > 0 ? (provider.subagentTokens / provider.totalTokens) * 100 : 0;

  return (
    <>
      <header className={styles.head}>
        <div className={styles.identity}>
          <h3 className={styles.name}>{name}</h3>
          <span className={styles.meta}>
            {t('dashboard.models_provider_meta', {
              models: provider.models.length,
              requests: provider.requests.toLocaleString(),
            })}
          </span>
        </div>
        <div className={styles.headNumbers}>
          <FigureChips
            source={provider}
            fableScope={provider.models.some((row) => row.fable)}
            provider={provider}
          />
          {providerSubagentShare > 0 && (
            <span className={styles.chip}>
              <i className={styles.swatch} aria-hidden="true" />
              {t('dashboard.models_subagent_chip', { percent: formatShare(providerSubagentShare) })}
            </span>
          )}
          <span className={styles.headTotal} title={provider.totalTokens.toLocaleString()}>
            {formatCompactNumber(provider.totalTokens)}
          </span>
          <span className={styles.unit}>{t('dashboard.models_tokens')}</span>
        </div>
      </header>

      <ul className={styles.list}>
        {provider.models.map((row) => {
          const subagentLabel =
            row.subagentShare !== null && row.subagentShare > 0
              ? t('dashboard.models_subagent_chip', { percent: formatShare(row.subagentShare) })
              : null;
          return (
            <li key={row.model} className={styles.row}>
              <div className={styles.modelCell}>
                <div className={styles.modelIdentity}>
                  <span className={styles.modelName} title={row.model}>
                    {row.model}
                  </span>
                  {subagentLabel && (
                    <span className={styles.chip}>
                      <i className={styles.swatch} aria-hidden="true" />
                      {subagentLabel}
                    </span>
                  )}
                </div>
                <FigureChips source={row} fableScope={row.fable} provider={provider} />
              </div>
              <ShareBar
                row={row}
                label={t('dashboard.models_share_label', {
                  model: row.model,
                  percent: formatShare(row.share),
                })}
              />
              <span className={styles.tokens} title={row.totalTokens.toLocaleString()}>
                {formatCompactNumber(row.totalTokens)}
              </span>
              <span className={styles.percent}>{formatShare(row.share)}</span>
            </li>
          );
        })}
      </ul>

      <Collapsible className={styles.tableToggle} label={t('dashboard.models_table')}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('dashboard.models_col_model')}</th>
                <th scope="col">{t('dashboard.models_col_requests')}</th>
                <th scope="col">{t('dashboard.models_col_input')}</th>
                <th scope="col">{t('dashboard.models_col_output')}</th>
                <th scope="col">{t('dashboard.models_col_cached')}</th>
                <th scope="col">{t('dashboard.models_col_reasoning')}</th>
                <th scope="col">{t('dashboard.models_col_main')}</th>
                <th scope="col">{t('dashboard.models_col_subagent')}</th>
              </tr>
            </thead>
            <tbody>
              {provider.models.map((row) => (
                <tr key={row.model}>
                  <th scope="row">{row.model}</th>
                  <td>{row.requests.toLocaleString()}</td>
                  <td>{row.inputTokens.toLocaleString()}</td>
                  <td>{row.outputTokens.toLocaleString()}</td>
                  <td>{row.cachedTokens.toLocaleString()}</td>
                  <td>{row.reasoningTokens.toLocaleString()}</td>
                  <td>{row.mainTokens.toLocaleString()}</td>
                  <td>{row.subagentTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>
    </>
  );
}
