import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MODEL_USAGE_RANGES, type ModelUsageRange } from '@/services/api/modelUsage';
import styles from './RangeToggle.module.scss';

interface RangeToggleProps {
  value: ModelUsageRange;
  onChange: (range: ModelUsageRange) => void;
}

/** Radio group with roving tabindex: arrows move and select, Tab leaves the group. */
export function RangeToggle({ value, onChange }: RangeToggleProps) {
  const { t } = useTranslation();
  const buttonRefs = useRef<Partial<Record<ModelUsageRange, HTMLButtonElement | null>>>({});

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const count = MODEL_USAGE_RANGES.length;
    const currentIndex = MODEL_USAGE_RANGES.indexOf(value);
    let nextIndex = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % count;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + count) % count;
    } else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = count - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = MODEL_USAGE_RANGES[nextIndex];
    onChange(next);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div className={styles.group} role="radiogroup" aria-label={t('dashboard.models_range_group')}>
      {MODEL_USAGE_RANGES.map((range) => {
        const selected = range === value;
        return (
          <button
            key={range}
            ref={(node) => {
              buttonRefs.current[range] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(`dashboard.models_range_${range}_aria`)}
            tabIndex={selected ? 0 : -1}
            className={`${styles.option} ${selected ? styles.optionActive : ''}`}
            onClick={() => onChange(range)}
            onKeyDown={handleKeyDown}
          >
            {t(`dashboard.models_range_${range}`)}
          </button>
        );
      })}
    </div>
  );
}
