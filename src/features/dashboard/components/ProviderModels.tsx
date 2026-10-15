import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import type { ModelBreakdownRow, ProviderBreakdown } from '../modelBreakdown';
import { providerLabel } from '../utils';
import styles from './ProviderModels.module.scss';

/** Sub-0.1% shares round to "0%", which reads as unused. */
const formatShare = (value: number): string =>
  value > 0 && value < 0.1 ? '<0.1%' : formatPercent(value);

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
