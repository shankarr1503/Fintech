import type { Reward } from '../game/GameContext';

/** The last completed payment, handed from the amount screen to the success screen. */
export type Receipt = {
  /** `unknown`: the connection dropped and we couldn't yet tell whether the server received the payment. */
  status: 'success' | 'pending' | 'failed' | 'on_hold' | 'unknown';
  reason?: string | null;
  txnId: string;
  /** Idempotency key of the attempt: resolves the transaction when the server hadn't assigned one yet. */
  key?: string;
  amount: number;
  name: string;
  upi: string;
  ref: string;
  note?: string;
  from: string;
  at: string;
  coins: number;
  reward?: Reward;
};

let last: Receipt | null = null;

export const setReceipt = (r: Receipt) => {
  last = r;
};

export const getReceipt = () => last;

/** Parse a UPI QR payload such as upi://pay?pa=shop@okicici&pn=Chai%20Point&am=40&tn=Tea */
export function parseUpiQr(data: string): { to: string; name?: string; amount?: string; note?: string } | null {
  const raw = data.trim();
  if (/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(raw)) return { to: raw };
  if (!/^upi:\/\/pay\?/i.test(raw)) return null;
  const params: Record<string, string> = {};
  for (const part of raw.slice(raw.indexOf('?') + 1).split('&')) {
    const [k, v = ''] = part.split('=');
    try {
      params[k.toLowerCase()] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      params[k.toLowerCase()] = v;
    }
  }
  if (!params.pa) return null;
  const am = params.am && Number(params.am) > 0 ? String(Number(params.am)) : undefined;
  return { to: params.pa, name: params.pn || undefined, amount: am, note: params.tn || undefined };
}
