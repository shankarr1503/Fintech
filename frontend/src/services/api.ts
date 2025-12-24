import axios from 'axios';
import Constants from 'expo-constants';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8001';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auth APIs
export const sendOTP = async (phone: string) => {
  const response = await api.post('/auth/send-otp', { phone });
  return response.data;
};

export const verifyOTP = async (phone: string, otp: string) => {
  const response = await api.post('/auth/verify-otp', { phone, otp });
  return response.data;
};

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

export const updateUser = async (userId: string, data: { name?: string; monthly_income?: number; fixed_expenses?: number }) => {
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

export const updateLanguage = async (userId: string, language: string) => {
  const response = await api.post(`/users/${userId}/language`, { user_id: userId, language });
  return response.data;
};

export const getLinkedAccounts = async (userId: string) => {
  const response = await api.get(`/users/${userId}/linked-accounts`);
  return response.data;
};

// Support API
export const submitSupportRequest = async (userId: string, subject: string, message: string) => {
  const response = await api.post('/support', { user_id: userId, subject, message });
  return response.data;
};

export default api;
