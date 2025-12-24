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
import {
  getSavingsGoals,
  createSavingsGoal,
  contributeSavings,
  deleteSavingsGoal,
  getSavingsSuggestions,
} from '../../src/services/api';
import { formatCurrency } from '../../src/utils/format';

export default function SavingsScreen() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<any>(null);
  const [contributionAmount, setContributionAmount] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    target_amount: '',
    monthly_contribution: '',
  });

  const fetchData = async () => {
    if (!user?.id) return;
    try {
      const [goalsData, suggestionsData] = await Promise.all([
        getSavingsGoals(user.id),
        getSavingsSuggestions(user.id),
      ]);
      setGoals(goalsData);
      setSuggestions(suggestionsData);
    } catch (error) {
      console.error('Failed to fetch savings:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user?.id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleAddGoal = async () => {
    if (!formData.name || !formData.target_amount) {
      Alert.alert('Error', 'Please fill in goal name and target amount');
      return;
    }

    try {
      await createSavingsGoal({
        user_id: user?.id,
        name: formData.name,
        target_amount: parseFloat(formData.target_amount),
        monthly_contribution: parseFloat(formData.monthly_contribution) || 0,
      });
      setShowAddModal(false);
      setFormData({ name: '', target_amount: '', monthly_contribution: '' });
      fetchData();
      Alert.alert('Success', 'Savings goal created!');
    } catch (error) {
      Alert.alert('Error', 'Failed to create goal');
    }
  };

  const handleContribute = async () => {
    if (!contributionAmount || !selectedGoal) return;

    try {
      await contributeSavings(selectedGoal.id, parseFloat(contributionAmount));
      setShowContributeModal(false);
      setContributionAmount('');
      setSelectedGoal(null);
      fetchData();
      Alert.alert('Success', 'Contribution added!');
    } catch (error) {
      Alert.alert('Error', 'Failed to add contribution');
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    Alert.alert(
      'Delete Goal',
      'Are you sure you want to delete this savings goal?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSavingsGoal(goalId);
              fetchData();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete goal');
            }
          },
        },
      ]
    );
  };

  const totalSaved = goals.reduce((sum, g) => sum + g.current_amount, 0);
  const totalTarget = goals.reduce((sum, g) => sum + g.target_amount, 0);

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
          <Text style={styles.title}>Savings Goals</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddModal(true)}
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <Ionicons name="wallet" size={28} color="#10B981" />
            <View style={styles.summaryText}>
              <Text style={styles.summaryLabel}>Total Saved</Text>
              <Text style={styles.summaryValue}>{formatCurrency(totalSaved)}</Text>
            </View>
          </View>
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}% of{' '}
              {formatCurrency(totalTarget)}
            </Text>
          </View>
        </View>

        {/* Savings Suggestions */}
        {suggestions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Smart Suggestions</Text>
            <View style={styles.suggestionsContainer}>
              {suggestions.map((suggestion, index) => (
                <View key={index} style={styles.suggestionCard}>
                  <View style={[
                    styles.suggestionIcon,
                    suggestion.type === 'safe'
                      ? { backgroundColor: 'rgba(16, 185, 129, 0.15)' }
                      : suggestion.type === 'moderate'
                      ? { backgroundColor: 'rgba(251, 191, 36, 0.15)' }
                      : { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
                  ]}>
                    <Ionicons
                      name={
                        suggestion.type === 'safe'
                          ? 'shield-checkmark'
                          : suggestion.type === 'moderate'
                          ? 'trending-up'
                          : 'rocket'
                      }
                      size={20}
                      color={
                        suggestion.type === 'safe'
                          ? '#10B981'
                          : suggestion.type === 'moderate'
                          ? '#FBBF24'
                          : '#EF4444'
                      }
                    />
                  </View>
                  <View style={styles.suggestionContent}>
                    <Text style={styles.suggestionType}>
                      {suggestion.type.charAt(0).toUpperCase() + suggestion.type.slice(1)}
                    </Text>
                    <Text style={styles.suggestionAmount}>
                      {formatCurrency(suggestion.amount)}/month
                    </Text>
                    <Text style={styles.suggestionDesc}>{suggestion.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Goals List */}
        <Text style={styles.sectionTitle}>Your Goals</Text>
        {goals.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="flag-outline" size={64} color="#2A3142" />
            <Text style={styles.emptyText}>No savings goals yet</Text>
            <Text style={styles.emptySubtext}>Start saving for what matters</Text>
          </View>
        ) : (
          goals.map((goal) => {
            const progress = (goal.current_amount / goal.target_amount) * 100;
            const remaining = goal.target_amount - goal.current_amount;
            const monthsToGoal = goal.monthly_contribution > 0
              ? Math.ceil(remaining / goal.monthly_contribution)
              : null;

            return (
              <View key={goal.id} style={styles.goalCard}>
                <View style={styles.goalHeader}>
                  <View style={styles.goalIconContainer}>
                    <Ionicons name="flag" size={20} color="#10B981" />
                  </View>
                  <View style={styles.goalInfo}>
                    <Text style={styles.goalName}>{goal.name}</Text>
                    {monthsToGoal && (
                      <Text style={styles.goalEta}>
                        {monthsToGoal} months to go
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDeleteGoal(goal.id)}
                    style={styles.deleteBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>

                <View style={styles.goalProgress}>
                  <View style={styles.goalAmounts}>
                    <Text style={styles.goalSaved}>
                      {formatCurrency(goal.current_amount)}
                    </Text>
                    <Text style={styles.goalTarget}>
                      of {formatCurrency(goal.target_amount)}
                    </Text>
                  </View>
                  <View style={styles.goalProgressBar}>
                    <View
                      style={[
                        styles.goalProgressFill,
                        { width: `${Math.min(progress, 100)}%` },
                        progress >= 100 && { backgroundColor: '#10B981' },
                      ]}
                    />
                  </View>
                  <Text style={styles.goalProgressText}>
                    {Math.round(progress)}% complete
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.contributeButton}
                  onPress={() => {
                    setSelectedGoal(goal);
                    setShowContributeModal(true);
                  }}
                >
                  <Ionicons name="add-circle" size={20} color="#00D09C" />
                  <Text style={styles.contributeText}>Add Money</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}

        <View style={styles.bottomSpacing} />
      </ScrollView>

      {/* Add Goal Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Savings Goal</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Goal Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Emergency Fund"
              placeholderTextColor="#6B7280"
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
            />

            <Text style={styles.inputLabel}>Target Amount *</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#6B7280"
              keyboardType="numeric"
              value={formData.target_amount}
              onChangeText={(text) => setFormData({ ...formData, target_amount: text })}
            />

            <Text style={styles.inputLabel}>Monthly Contribution</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#6B7280"
              keyboardType="numeric"
              value={formData.monthly_contribution}
              onChangeText={(text) => setFormData({ ...formData, monthly_contribution: text })}
            />

            <TouchableOpacity style={styles.submitButton} onPress={handleAddGoal}>
              <Text style={styles.submitButtonText}>Create Goal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Contribute Modal */}
      <Modal
        visible={showContributeModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowContributeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add to {selectedGoal?.name}</Text>
              <TouchableOpacity onPress={() => setShowContributeModal(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Amount</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#6B7280"
              keyboardType="numeric"
              value={contributionAmount}
              onChangeText={setContributionAmount}
              autoFocus
            />

            <View style={styles.quickAmounts}>
              {[1000, 2500, 5000, 10000].map((amount) => (
                <TouchableOpacity
                  key={amount}
                  style={styles.quickAmountBtn}
                  onPress={() => setContributionAmount(amount.toString())}
                >
                  <Text style={styles.quickAmountText}>
                    {formatCurrency(amount)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleContribute}>
              <Text style={styles.submitButtonText}>Add Money</Text>
            </TouchableOpacity>
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
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 24,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryText: {
    marginLeft: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#10B981',
  },
  progressContainer: {
    gap: 8,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#2A3142',
    borderRadius: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: '#6B7280',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  suggestionsContainer: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  suggestionCard: {
    flexDirection: 'row',
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  suggestionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionType: {
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  suggestionAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginVertical: 2,
  },
  suggestionDesc: {
    fontSize: 12,
    color: '#6B7280',
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
  goalCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  goalIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  goalInfo: {
    flex: 1,
  },
  goalName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  goalEta: {
    fontSize: 12,
    color: '#6B7280',
  },
  deleteBtn: {
    padding: 8,
  },
  goalProgress: {
    marginBottom: 16,
  },
  goalAmounts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  goalSaved: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  goalTarget: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 8,
  },
  goalProgressBar: {
    height: 8,
    backgroundColor: '#2A3142',
    borderRadius: 4,
    marginBottom: 8,
  },
  goalProgressFill: {
    height: '100%',
    backgroundColor: '#00D09C',
    borderRadius: 4,
  },
  goalProgressText: {
    fontSize: 12,
    color: '#00D09C',
    fontWeight: '500',
  },
  contributeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 208, 156, 0.15)',
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
  },
  contributeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#00D09C',
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
  quickAmounts: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  quickAmountBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1A1F2E',
    alignItems: 'center',
  },
  quickAmountText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
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
