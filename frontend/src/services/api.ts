import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

// Point EXPO_PUBLIC_BACKEND_URL at your API (see frontend/.env.example).
export const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8001';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Session token from OTP sign-in; attached to every request.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};
export const getAuthToken = () => authToken;

/** Called when the server rejects the session (expired/invalid token). */
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

// A random id per install, so the server can tell a new device from a known one (new sign-in alerts).
let deviceId: string | null = null;
const DEVICE_NAME = (Device.modelName || (Platform.OS === 'web' ? 'Web browser' : Platform.OS)).slice(0, 60);

async function getDeviceId() {
  if (deviceId) return deviceId;
  try {
    deviceId = await AsyncStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem('device_id', deviceId);
    }
  } catch {
    deviceId = `${Platform.OS}-ephemeral`;
  }
  return deviceId;
}

api.interceptors.request.use(async (config) => {
  // A request may name its own token (logout of a session already cleared on this device).
  if (authToken && !config.headers.Authorization) config.headers.Authorization = `Bearer ${authToken}`;
  config.headers['X-Device-Id'] = await getDeviceId();
  config.headers['X-Device-Name'] = DEVICE_NAME;
  return config;
});

// The server's 401s that are about the session itself (auth.py session_from_token).
const SESSION_GONE = ['Session ended', 'Signed out after'];

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const headers = error?.config?.headers;
    const header = (name: string) => headers?.get?.(name) ?? headers?.[name];
    // Only a rejection of the current session signs out, not one for an older token.
    if (error?.response?.status === 401 && authToken && header('Authorization') === `Bearer ${authToken}`) {
      const detail = String(error.response.data?.detail ?? '');
      // A 401 on a request carrying a step-up token usually means only that 5-minute token expired
      // (the server words it like an expired session). Keep the session and ask for the PIN again;
      // if the session really expired, the PIN check itself gets a 401 and signs out.
      const sentStepUp = !!header('X-Step-Up-Token');
      if (sentStepUp && !SESSION_GONE.some((s) => detail.startsWith(s))) error.stepUpExpired = true;
      else onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** The payment's PIN confirmation expired: ask for the PIN again rather than signing out. */
export const isStepUpExpired = (error: any) => !!error?.stepUpExpired;

// Auth APIs
export const sendOTP = async (phone: string) => {
  const response = await api.post('/auth/send-otp', { phone });
  return response.data;
};

/** Revoke a session token on the server (by default the current one). */
export const logoutSession = async (token: string | null = authToken) => {
  await api.post('/auth/logout', null, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
};

/** Version of the Terms & Privacy Policy shown on the sign-in screen. */
export const TERMS_VERSION = '2026-10';

/** `consent` is the user's explicit tick: 18 or older, and accepts the Terms and Privacy Policy. */
export const verifyOTP = async (phone: string, otp: string, consent = false) => {
  const response = await api.post('/auth/verify-otp', consent ? { phone, otp, accept_terms: TERMS_VERSION, confirm_age: true } : { phone, otp });
  return response.data;
};

/** Public, OTP-verified account deletion for people who can't sign in. */
export const requestDeletion = async (phone: string, otp: string) =>
  (await api.post('/privacy/deletion-request', { phone, otp, confirm: true })).data as { deleted: boolean; message: string; retain_until?: string };

export const getAppConfig = async () => (await api.get('/app-config')).data as { demo_mode: boolean; terms_version: string };

// ============== PIN, SESSIONS ==============

export const pinLogin = async (mfaToken: string, pin: string) => (await api.post('/auth/pin/login', { mfa_token: mfaToken, pin })).data;
export const resetPin = async (mfaToken: string, newPin: string, pan?: string) =>
  (await api.post('/auth/pin/reset', { mfa_token: mfaToken, new_pin: newPin, pan })).data;
export const setPin = async (pin: string, currentPin?: string) => (await api.post('/auth/pin', { pin, current_pin: currentPin })).data;
/** Fresh PIN check; returns a 5-minute step-up token for large payments. */
export const verifyPin = async (pin: string) => (await api.post('/auth/pin/verify', { pin })).data as { step_up_token: string };
export const listSessions = async () => (await api.get('/auth/sessions')).data;
export const endSession = async (id: string) => (await api.delete(`/auth/sessions/${id}`)).data;
export const endOtherSessions = async () => (await api.post('/auth/sessions/revoke-others')).data;

// ============== KYC ==============

export const getKycStatus = async (userId: string) => (await api.get(`/kyc/status/${userId}`)).data;
export const submitKyc = async (userId: string, body: { pan: string; full_name: string; dob: string; consent: boolean }) =>
  (await api.post('/kyc/submit', { user_id: userId, ...body })).data;

// ============== NOTIFICATIONS ==============

export const getNotifications = async (userId: string) => (await api.get(`/notifications/${userId}`)).data;
export const markNotificationsRead = async (userId: string, ids?: string[]) => (await api.post('/notifications/read', { user_id: userId, ids })).data;
export const getNotificationPrefs = async (userId: string) => (await api.get(`/notifications/prefs/${userId}`)).data;
export const updateNotificationPrefs = async (userId: string, prefs: Record<string, boolean>) =>
  (await api.put('/notifications/prefs', { user_id: userId, prefs })).data;
export const registerPushToken = async (userId: string, token: string) => (await api.post('/notifications/push-token', { user_id: userId, token })).data;

// ============== LOANS ==============

export type KeyFacts = {
  name: string; amount: number; tenure_months: number; interest_rate: number; emi: number; processing_fee: number; gst_on_fee: number;
  net_disbursal: number; total_interest: number; total_repayable: number; apr: number; late_payment: string; cooling_off_days: number; lender: string | null;
};
export const getLoanQuote = async (loanType: string, amount: number, tenure: number) =>
  (await api.post('/loans/quote', { loan_type: loanType, amount, tenure })).data as KeyFacts;

// ============== CATEGORIES ==============

export const getCategories = async (userId: string) => (await api.get(`/categories/${userId}`)).data;
export const addCategory = async (userId: string, name: string) => (await api.post('/categories', { user_id: userId, name })).data;
export const recategorize = async (txnId: string, category: string, applyToMerchant = false) =>
  (await api.patch(`/transactions/${txnId}`, { category, apply_to_merchant: applyToMerchant })).data;

// Dashboard API
export const getDashboard = async (userId: string) => {
  const response = await api.get(`/dashboard/${userId}`);
  return response.data;
};

// Transaction APIs
export const getTransactions = async (userId: string, limit = 100, category?: string) => {
  const params: any = { limit };
  if (category) params.category = category;
  const response = await api.get(`/transactions/${userId}`, { params });
  return response.data;
};

export const createTransaction = async (transaction: any) => {
  const response = await api.post('/transactions', transaction);
  return response.data;
};

export const mockBankSync = async (userId: string) => {
  const response = await api.post(`/transactions/mock-sync/${userId}`);
  return response.data;
};

// Analytics APIs
export const getAnalyticsSummary = async (userId: string) => {
  const response = await api.get(`/analytics/summary/${userId}`);
  return response.data;
};

export const getInsights = async (userId: string) => {
  const response = await api.get(`/analytics/insights/${userId}`);
  return response.data;
};

export const getExpenseReductionTips = async (userId: string) => {
  const response = await api.get(`/analytics/expense-reduction/${userId}`);
  return response.data;
};

// Debt APIs
export const getDebts = async (userId: string) => {
  const response = await api.get(`/debts/${userId}`);
  return response.data;
};

export const createDebt = async (debt: any) => {
  const response = await api.post('/debts', debt);
  return response.data;
};

export const deleteDebt = async (debtId: string) => {
  const response = await api.delete(`/debts/${debtId}`);
  return response.data;
};

export const payDebt = async (debtId: string, amount: number) => {
  const response = await api.post(`/debts/${debtId}/pay`, { amount });
  return response.data;
};

export const analyzeDebts = async (userId: string, extraPayment = 0) => {
  const response = await api.get(`/debts/analysis/${userId}`, { params: { extra_payment: extraPayment } });
  return response.data;
};

// Savings APIs
export const getSavingsGoals = async (userId: string) => {
  const response = await api.get(`/savings/${userId}`);
  return response.data;
};

export const createSavingsGoal = async (goal: any) => {
  const response = await api.post('/savings', goal);
  return response.data;
};

export const contributeSavings = async (goalId: string, amount: number) => {
  const response = await api.post('/savings/contribute', { goal_id: goalId, amount });
  return response.data;
};

export const deleteSavingsGoal = async (goalId: string) => {
  const response = await api.delete(`/savings/${goalId}`);
  return response.data;
};

export const getSavingsSuggestions = async (userId: string) => {
  const response = await api.get(`/savings/suggestions/${userId}`);
  return response.data;
};

// User Profile APIs
export const getUser = async (userId: string) => {
  const response = await api.get(`/users/${userId}`);
  return response.data;
};

export const updateUser = async (
  userId: string,
  data: { name?: string; avatar?: string },
) => {
  const response = await api.put(`/users/${userId}`, data);
  return response.data;
};

export const deleteUserAccount = async (userId: string, reason?: string) => {
  const response = await api.delete(`/users/${userId}`, { data: { user_id: userId, reason } });
  return response.data;
};

export const exportUserData = async (userId: string) => {
  const response = await api.get(`/users/${userId}/export`);
  return response.data;
};

// Security & Settings APIs
export const getSecuritySettings = async (userId: string) => {
  const response = await api.get(`/users/${userId}/security`);
  return response.data;
};

export const updateSecuritySettings = async (userId: string, settings: {
  biometric_enabled?: boolean;
  transaction_alerts?: boolean;
  login_notifications?: boolean;
}) => {
  const response = await api.post(`/users/${userId}/security`, { user_id: userId, ...settings });
  return response.data;
};



// Support API
export const submitSupportRequest = async (userId: string, subject: string, message: string) => {
  const response = await api.post('/support', { user_id: userId, subject, message });
  return response.data;
};

// ============== CRED-LIKE FEATURES ==============

// Credit Score APIs
export const getCreditScore = async (userId: string) => {
  const response = await api.get(`/credit-score/${userId}`);
  return response.data;
};

export const payCreditCardBill = async (userId: string, cardBank: string, amount: number) => {
  const response = await api.post('/credit-cards/pay-bill', { user_id: userId, card_bank: cardBank, amount });
  return response.data;
};

// Rewards APIs
export const getRewards = async (userId: string) => {
  const response = await api.get(`/rewards/${userId}`);
  return response.data;
};

export const redeemReward = async (userId: string, dealId: string) => {
  const response = await api.post('/rewards/redeem', { user_id: userId, deal_id: dealId });
  return response.data;
};

// Bills APIs
export const getBills = async (userId: string) => {
  const response = await api.get(`/bills/${userId}`);
  return response.data;
};

export const payBill = async (userId: string, billId: string) => {
  const response = await api.post('/bills/pay', { user_id: userId, bill_id: billId });
  return response.data;
};

// ============== 1% CLUB FEATURES ==============

// Learning APIs
export const getCourses = async () => {
  const response = await api.get('/learn/courses');
  return response.data;
};


export const getLearningProgress = async (userId: string) => {
  const response = await api.get(`/learn/progress/${userId}`);
  return response.data;
};

export const completeModule = async (userId: string, courseId: string, moduleId: string) => {
  const response = await api.post('/learn/complete-module', { user_id: userId, course_id: courseId, module_id: moduleId });
  return response.data;
};


// ============== ACCOUNT AGGREGATOR (AA) FRAMEWORK ==============

export const getAAConsentStatus = async (userId: string) => {
  const response = await api.get(`/aa/consent-status/${userId}`);
  return response.data;
};

export const initiateAAConsent = async (userId: string, fipIds: string[]) => {
  const response = await api.post('/aa/initiate-consent', { user_id: userId, fip_ids: fipIds });
  return response.data;
};

export const confirmAAConsent = async (consentId: string, userId: string) => {
  const response = await api.post('/aa/confirm-consent', { consent_id: consentId, user_id: userId });
  return response.data;
};

export const getAggregatedData = async (userId: string) => {
  const response = await api.get(`/aa/aggregated-data/${userId}`);
  return response.data;
};

export const revokeAAConsent = async (userId: string, consentId: string) => {
  const response = await api.post('/aa/revoke-consent', { user_id: userId, consent_id: consentId });
  return response.data;
};

// ============== SECURITY & COMPLIANCE ==============

export const getAuditLog = async (userId: string) => {
  const response = await api.get(`/security/audit-log/${userId}`);
  return response.data;
};




// ============== UPI PAYMENTS ==============

export const getUPILinkedAccounts = async (userId: string) => {
  const response = await api.get(`/upi/linked-accounts/${userId}`);
  return response.data;
};

export const getRecentPayees = async (userId: string) => {
  const response = await api.get(`/upi/recent-payees/${userId}`);
  return response.data;
};

export type PaymentOptions = { idempotencyKey: string; stepUpToken?: string; confirmDuplicate?: boolean };

/** Send money. The same idempotencyKey is reused for retries so a payment can never go through twice. */
export const sendMoneyUPI = async (userId: string, recipientUpi: string, amount: number, note: string, sourceAccount: string, opts: PaymentOptions) => {
  const headers: Record<string, string> = { 'Idempotency-Key': opts.idempotencyKey };
  if (opts.stepUpToken) headers['X-Step-Up-Token'] = opts.stepUpToken;
  const response = await api.post(
    '/upi/send-money',
    { user_id: userId, recipient_upi: recipientUpi, amount, note, source_account: sourceAccount, confirm_duplicate: !!opts.confirmDuplicate },
    { headers },
  );
  return response.data;
};

/** After a timeout: did the server receive this payment? */
export const paymentByKey = async (key: string) => (await api.get(`/upi/idempotency/${key}`)).data;
export const getPaymentStatus = async (txnId: string) => (await api.get(`/upi/transactions/${txnId}`)).data;

export const requestMoneyUPI = async (userId: string, fromUpi: string, amount: number, note: string) => {
  const response = await api.post('/upi/request-money', { user_id: userId, from_upi: fromUpi, amount, note });
  return response.data;
};

export const getUPIHistory = async (userId: string) => {
  const response = await api.get(`/upi/transaction-history/${userId}`);
  return response.data;
};

// ============== DIGITAL LOANS ==============

export const checkLoanEligibility = async (userId: string) => {
  const response = await api.get(`/loans/eligibility/${userId}`);
  return response.data;
};

/** Only after the user has seen the key facts (getLoanQuote) and ticked to accept them. */
export const applyForLoan = async (userId: string, loanType: string, amount: number, tenure: number) => {
  const response = await api.post('/loans/apply', { user_id: userId, loan_type: loanType, amount, tenure, accept_key_facts: true });
  return response.data;
};

export const getActiveLoans = async (userId: string) => {
  const response = await api.get(`/loans/active/${userId}`);
  return response.data;
};

// ============== COMPREHENSIVE ACCOUNTS ==============

export const getAllAccounts = async (userId: string) => {
  const response = await api.get(`/accounts/all/${userId}`);
  return response.data;
};



// ============== GAME ==============

export const getGameProfile = async (userId: string) => {
  const response = await api.get(`/game/profile/${userId}`);
  return response.data;
};

export const dailyCheckIn = async (userId: string) => {
  const response = await api.post('/game/checkin', { user_id: userId });
  return response.data;
};


/** Pull a human-readable message out of an axios error. */
export const errorMessage = (error: any, fallback = 'Something went wrong') => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  if (error?.message === 'Network Error') return "Can't reach CoinQuest right now. Check your connection.";
  if (error?.code === 'ECONNABORTED') return 'The request timed out.';
  return fallback;
};

export default api;
