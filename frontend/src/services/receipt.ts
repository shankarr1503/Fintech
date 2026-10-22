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

/** Smallest and largest single UPI payment the app allows (the server caps amounts at 1,00,000). */
export const MIN_PAYMENT = 1;
export const MAX_PAYMENT = 100000;

export type UpiQr = { to: string; name?: string; amount?: string; note?: string };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

/** Parse a UPI QR payload such as upi://pay?pa=shop@okicici&pn=Chai%20Point&am=40&tn=Tea.
 * Null if it isn't a UPI code; `{ error }` if it is one we can't pay. */
export function parseUpiQr(data: string): UpiQr | { error: string } | null {
  const raw = data.trim();
  if (/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(raw)) return { to: raw };
  if (!/^upi:\/\/pay\?/i.test(raw)) return null;
  const params: Record<string, string> = {};
  for (const part of raw.slice(raw.indexOf('?') + 1).split('&')) {
    if (!part) continue;
    // Split on the first '=' only: values may contain '='.
    const eq = part.indexOf('=');
    const k = decode(eq < 0 ? part : part.slice(0, eq)).toLowerCase();
    params[k] = eq < 0 ? '' : decode(part.slice(eq + 1));
  }
  if (!params.pa) return null;
  if (params.cu && params.cu.trim().toUpperCase() !== 'INR') return { error: `This code asks for payment in ${params.cu}. UPI payments can only be in rupees.` };
  let am: string | undefined;
  if (params.am) {
    if (!/^\d+(\.\d+)?$/.test(params.am.trim())) return { error: "This code's amount isn't valid." };
    const paise = Math.round(Number(params.am) * 100);
    // 0 means the payer chooses the amount; anything else is locked, so it must be payable.
    if (paise > 0) {
      if (paise < MIN_PAYMENT * 100 || paise > MAX_PAYMENT * 100)
        return { error: `This code asks for ₹${(paise / 100).toLocaleString('en-IN')}. A single UPI payment must be ₹${MIN_PAYMENT} to ₹${MAX_PAYMENT.toLocaleString('en-IN')}.` };
      am = String(paise / 100);
    }
  }
  return { to: params.pa, name: params.pn || undefined, amount: am, note: params.tn || undefined };
}
