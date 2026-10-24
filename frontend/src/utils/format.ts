export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-IN').format(num);
};

/** Read a typed amount such as "1,00,000" or "₹ 2,500.50". NaN if it isn't a plain number (parseFloat would read "1,00,000" as 1). */
export const parseAmount = (raw: string): number => {
  const s = raw.replace(/[₹,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
};

export const formatDate =(dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Compact Indian notation: ₹950, ₹12.4K, ₹3.2L, ₹1.1Cr */
export const formatCompact = (amount: number): string => {
  const sign = amount < 0 ? '-' : '';
  const n = Math.abs(amount);
  const one = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  if (n >= 1e7) return `${sign}₹${one(n / 1e7)}Cr`;
  if (n >= 1e5) return `${sign}₹${one(n / 1e5)}L`;
  if (n >= 1e3) return `${sign}₹${one(n / 1e3)}K`;
  return `${sign}₹${Math.round(n)}`;
};

export const daysUntil = (dateString: string): number => {
  const ms = new Date(dateString).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
};
