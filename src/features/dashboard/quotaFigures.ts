const costFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const wholeCostFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Null when there is no cost to show: absent, or zero (history recorded before pricing). */
export function formatCost(usd: number | undefined): string | null {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd < 0.005) return '<$0.01';
  return (usd >= 1000 ? wholeCostFormat : costFormat).format(usd);
}

/** One decimal, may exceed 100. Null when absent or zero. */
export function formatQuotaPct(pct: number | undefined): string | null {
  if (pct === undefined || !Number.isFinite(pct) || pct <= 0) return null;
  if (pct < 0.05) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}
