import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { getDebts, analyzeDebts, createDebt, deleteDebt } from '../../src/services/api';
import { formatCurrency } from '../../src/utils/format';

const DEBT_TYPES = [
  { value: 'credit_card', label: 'Credit Card', icon: 'card' },
  { value: 'personal_loan', label: 'Personal Loan', icon: 'cash' },
  { value: 'emi', label: 'EMI', icon: 'phone-portrait' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
];

export default function DebtsScreen() {
  const { user } = useAuth();
  const [debts, setDebts] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [extraPayment, setExtraPayment] = useState(0);
  const [selectedStrategy, setSelectedStrategy] = useState<'snowball' | 'avalanche'>('avalanche');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'credit_card',
    principal: '',
    outstanding: '',
    interest_rate: '',
    emi_amount: '',
    remaining_tenure: '',
  });

  const fetchData = async () => {
    if (!user?.id) return;
    try {
      const [debtsData, analysisData] = await Promise.all([
        getDebts(user.id),
        analyzeDebts(user.id, extraPayment),
      ]);
      setDebts(debtsData);
      setAnalysis(analysisData);
    } catch (error) {
      console.error('Failed to fetch debts:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user?.id, extraPayment]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleAddDebt = async () => {
    if (!formData.name || !formData.outstanding || !formData.emi_amount) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      await createDebt({
        user_id: user?.id,
        name: formData.name,
        type: formData.type,
        principal: parseFloat(formData.principal) || parseFloat(formData.outstanding),
        outstanding: parseFloat(formData.outstanding),
        interest_rate: parseFloat(formData.interest_rate) || 0,
        emi_amount: parseFloat(formData.emi_amount),
        remaining_tenure: parseInt(formData.remaining_tenure) || 12,
      });
      setShowAddModal(false);
      setFormData({
        name: '',
        type: 'credit_card',
        principal: '',
        outstanding: '',
        interest_rate: '',
        emi_amount: '',
        remaining_tenure: '',
      });
      fetchData();
      Alert.alert('Success', 'Debt added successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to add debt');
    }
  };

  const handleDeleteDebt = async (debtId: string) => {
    Alert.alert(
      'Delete Debt',
      'Are you sure you want to delete this debt?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDebt(debtId);
              fetchData();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete debt');
            }
          },
        },
      ]
    );
  };

  const getDebtTypeIcon = (type: string) => {
    return DEBT_TYPES.find(t => t.value === type)?.icon || 'ellipsis-horizontal';
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00D09C" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00D09C"
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Debt Manager</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddModal(true)}
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Debt</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(analysis?.total_debt || 0)}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Monthly EMI</Text>
              <Text style={[styles.summaryValue, styles.emiValue]}>
                {formatCurrency(analysis?.total_emi || 0)}
              </Text>
            </View>
          </View>
          <View style={styles.interestRow}>
            <Ionicons name="information-circle" size={16} color="#6B7280" />
            <Text style={styles.interestText}>
              Avg. Interest Rate: {analysis?.average_interest_rate?.toFixed(1) || 0}%
            </Text>
          </View>
        </View>

        {/* Strategy Selector */}
        {analysis?.total_debt > 0 && (
          <View style={styles.strategySection}>
            <Text style={styles.sectionTitle}>Payoff Strategy</Text>
            <View style={styles.strategyCards}>
              <TouchableOpacity
                style={[
                  styles.strategyCard,
                  selectedStrategy === 'snowball' && styles.strategyCardActive,
                ]}
                onPress={() => setSelectedStrategy('snowball')}
              >
                <View style={styles.strategyHeader}>
                  <Ionicons
                    name="snow"
                    size={24}
                    color={selectedStrategy === 'snowball' ? '#00D09C' : '#6B7280'}
                  />
                  <Text style={[
                    styles.strategyName,
                    selectedStrategy === 'snowball' && styles.strategyNameActive,
                  ]}>
                    Snowball
                  </Text>
                </View>
                <Text style={styles.strategyDescription}>
                  Pay smallest debts first for quick wins
                </Text>
                <Text style={styles.strategyResult}>
                  Debt-free in {analysis?.snowball_analysis?.total_months || 0} months
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.strategyCard,
                  selectedStrategy === 'avalanche' && styles.strategyCardActive,
                ]}
                onPress={() => setSelectedStrategy('avalanche')}
              >
                <View style={styles.strategyHeader}>
                  <Ionicons
                    name="trending-down"
                    size={24}
                    color={selectedStrategy === 'avalanche' ? '#00D09C' : '#6B7280'}
                  />
                  <Text style={[
                    styles.strategyName,
                    selectedStrategy === 'avalanche' && styles.strategyNameActive,
                  ]}>
                    Avalanche
                  </Text>
                </View>
                <Text style={styles.strategyDescription}>
                  Pay highest interest first to save more
                </Text>
                <Text style={styles.strategyResult}>
                  Save {formatCurrency(analysis?.interest_saved_with_avalanche || 0)} in interest
                </Text>
              </TouchableOpacity>
            </View>

            {/* Extra Payment Slider */}
            <View style={styles.extraPaymentSection}>
              <View style={styles.extraPaymentHeader}>
                <Text style={styles.extraPaymentLabel}>Extra Monthly Payment</Text>
                <Text style={styles.extraPaymentValue}>
                  {formatCurrency(extraPayment)}
                </Text>
              </View>
              <View style={styles.extraPaymentButtons}>
                {[0, 2000, 5000, 10000].map((amount) => (
                  <TouchableOpacity
                    key={amount}
                    style={[
                      styles.extraPaymentBtn,
                      extraPayment === amount && styles.extraPaymentBtnActive,
                    ]}
                    onPress={() => setExtraPayment(amount)}
                  >
                    <Text style={[
                      styles.extraPaymentBtnText,
                      extraPayment === amount && styles.extraPaymentBtnTextActive,
                    ]}>
                      {amount === 0 ? 'None' : formatCurrency(amount)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Debt-Free Date */}
            <View style={styles.debtFreeCard}>
              <Ionicons name="flag" size={24} color="#10B981" />
              <View style={styles.debtFreeContent}>
                <Text style={styles.debtFreeLabel}>Debt-Free Date</Text>
                <Text style={styles.debtFreeDate}>
                  {selectedStrategy === 'snowball'
                    ? analysis?.snowball_analysis?.debt_free_date
                    : analysis?.avalanche_analysis?.debt_free_date}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Debts List */}
        <Text style={styles.sectionTitle}>Your Debts</Text>
        {debts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="card-outline" size={64} color="#2A3142" />
            <Text style={styles.emptyText}>No debts added yet</Text>
            <Text style={styles.emptySubtext}>Add your debts to start tracking</Text>
          </View>
        ) : (
          debts.map((debt) => (
            <View key={debt.id} style={styles.debtCard}>
              <View style={styles.debtHeader}>
                <View style={styles.debtIconContainer}>
                  <Ionicons
                    name={getDebtTypeIcon(debt.type) as any}
                    size={20}
                    color="#EF4444"
                  />
                </View>
                <View style={styles.debtInfo}>
                  <Text style={styles.debtName}>{debt.name}</Text>
                  <Text style={styles.debtType}>
                    {DEBT_TYPES.find(t => t.value === debt.type)?.label}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteDebt(debt.id)}
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
              <View style={styles.debtDetails}>
                <View style={styles.debtDetail}>
                  <Text style={styles.debtDetailLabel}>Outstanding</Text>
                  <Text style={styles.debtDetailValue}>
                    {formatCurrency(debt.outstanding)}
                  </Text>
                </View>
                <View style={styles.debtDetail}>
                  <Text style={styles.debtDetailLabel}>Interest</Text>
                  <Text style={styles.debtDetailValue}>{debt.interest_rate}%</Text>
                </View>
                <View style={styles.debtDetail}>
                  <Text style={styles.debtDetailLabel}>EMI</Text>
                  <Text style={styles.debtDetailValue}>
                    {formatCurrency(debt.emi_amount)}
                  </Text>
                </View>
                <View style={styles.debtDetail}>
                  <Text style={styles.debtDetailLabel}>Tenure</Text>
                  <Text style={styles.debtDetailValue}>
                    {debt.remaining_tenure} mo
                  </Text>
                </View>
              </View>
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${((debt.principal - debt.outstanding) / debt.principal) * 100}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>
                  {Math.round(((debt.principal - debt.outstanding) / debt.principal) * 100)}% paid
                </Text>
              </View>
            </View>
          ))
        )}

        <View style={styles.bottomSpacing} />
      </ScrollView>

      {/* Add Debt Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Debt</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Debt Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., HDFC Credit Card"
                placeholderTextColor="#6B7280"
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
              />

              <Text style={styles.inputLabel}>Type</Text>
              <View style={styles.typeSelector}>
                {DEBT_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.value}
                    style={[
                      styles.typeOption,
                      formData.type === type.value && styles.typeOptionActive,
                    ]}
                    onPress={() => setFormData({ ...formData, type: type.value })}
                  >
                    <Ionicons
                      name={type.icon as any}
                      size={20}
                      color={formData.type === type.value ? '#00D09C' : '#6B7280'}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Outstanding Amount *</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                value={formData.outstanding}
                onChangeText={(text) => setFormData({ ...formData, outstanding: text })}
              />

              <Text style={styles.inputLabel}>Interest Rate (%)</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                value={formData.interest_rate}
                onChangeText={(text) => setFormData({ ...formData, interest_rate: text })}
              />

              <Text style={styles.inputLabel}>Monthly EMI *</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                value={formData.emi_amount}
                onChangeText={(text) => setFormData({ ...formData, emi_amount: text })}
              />

              <Text style={styles.inputLabel}>Remaining Tenure (months)</Text>
              <TextInput
                style={styles.input}
                placeholder="12"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                value={formData.remaining_tenure}
                onChangeText={(text) => setFormData({ ...formData, remaining_tenure: text })}
              />

              <TouchableOpacity style={styles.submitButton} onPress={handleAddDebt}>
                <Text style={styles.submitButtonText}>Add Debt</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E14',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0E14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#00D09C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#2A3142',
    marginHorizontal: 16,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#EF4444',
  },
  emiValue: {
    color: '#FBBF24',
  },
  interestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  interestText: {
    fontSize: 13,
    color: '#6B7280',
  },
  strategySection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  strategyCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  strategyCard: {
    flex: 1,
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  strategyCardActive: {
    borderColor: '#00D09C',
    backgroundColor: 'rgba(0, 208, 156, 0.1)',
  },
  strategyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  strategyName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  strategyNameActive: {
    color: '#00D09C',
  },
  strategyDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  strategyResult: {
    fontSize: 13,
    fontWeight: '600',
    color: '#10B981',
  },
  extraPaymentSection: {
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  extraPaymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  extraPaymentLabel: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  extraPaymentValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#00D09C',
  },
  extraPaymentButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  extraPaymentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2A3142',
    alignItems: 'center',
  },
  extraPaymentBtnActive: {
    backgroundColor: '#00D09C',
  },
  extraPaymentBtnText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  extraPaymentBtnTextActive: {
    color: '#FFFFFF',
  },
  debtFreeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  debtFreeContent: {
    flex: 1,
  },
  debtFreeLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  debtFreeDate: {
    fontSize: 18,
    fontWeight: '700',
    color: '#10B981',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    marginHorizontal: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  debtCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  debtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  debtIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  debtInfo: {
    flex: 1,
  },
  debtName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  debtType: {
    fontSize: 12,
    color: '#6B7280',
  },
  deleteBtn: {
    padding: 8,
  },
  debtDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  debtDetail: {
    width: '50%',
    marginBottom: 8,
  },
  debtDetailLabel: {
    fontSize: 11,
    color: '#6B7280',
  },
  debtDetailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#2A3142',
    borderRadius: 3,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00D09C',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#00D09C',
    fontWeight: '500',
  },
  bottomSpacing: {
    height: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0A0E14',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#2A3142',
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  typeOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1A1F2E',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeOptionActive: {
    borderColor: '#00D09C',
    backgroundColor: 'rgba(0, 208, 156, 0.1)',
  },
  submitButton: {
    backgroundColor: '#00D09C',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 20,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
