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

export default api;
