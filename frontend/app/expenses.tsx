import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { getExpenseReductionTips, getAnalyticsSummary } from '../src/services/api';
import { formatCurrency, getCategoryColor, getCategoryIcon } from '../src/utils/format';

export default function ExpensesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [tips, setTips] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    if (!user?.id) return;
    try {
      const [tipsData, analyticsData] = await Promise.all([
        getExpenseReductionTips(user.id),
        getAnalyticsSummary(user.id),
      ]);
      setTips(tipsData || []);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error('Failed to fetch expense data:', error);
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

  const categoryBreakdown = analytics?.category_breakdown
    ? Object.entries(analytics.category_breakdown)
        .filter(([_, value]) => (value as number) > 0)
        .map(([key, value]) => ({
          category: key,
          amount: value as number,
          percentage: ((value as number) / (analytics?.this_month_spending || 1) * 100).toFixed(1),
        }))
        .sort((a, b) => b.amount - a.amount)
    : [];

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00D09C" />
        <Text style={styles.loadingText}>Analyzing your expenses...</Text>
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
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.title}>Expense Review</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryLabel}>This Month's Spending</Text>
            <View style={[
              styles.changeBadge,
              analytics?.change_percentage > 0
                ? styles.changeBadgeNegative
                : styles.changeBadgePositive,
            ]}>
              <Ionicons
                name={analytics?.change_percentage > 0 ? 'arrow-up' : 'arrow-down'}
                size={12}
                color={analytics?.change_percentage > 0 ? '#EF4444' : '#10B981'}
              />
              <Text style={[
                styles.changeText,
                analytics?.change_percentage > 0
                  ? styles.changeTextNegative
                  : styles.changeTextPositive,
              ]}>
                {Math.abs(analytics?.change_percentage || 0)}% vs last month
              </Text>
            </View>
          </View>
          <Text style={styles.summaryAmount}>
            {formatCurrency(analytics?.this_month_spending || 0)}
          </Text>
          <Text style={styles.summarySubtext}>
            {analytics?.transaction_count || 0} transactions this month
          </Text>
        </View>

        {/* Savings Tips */}
        {tips.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Savings Opportunities</Text>
              <View style={styles.aiBadge}>
                <Ionicons name="sparkles" size={14} color="#00D09C" />
                <Text style={styles.aiBadgeText}>AI</Text>
              </View>
            </View>
            {tips.map((tip, index) => (
              <View key={index} style={styles.tipCard}>
                <View style={[
                  styles.tipIcon,
                  { backgroundColor: `${getCategoryColor(tip.category)}20` },
                ]}>
                  <Ionicons
                    name={getCategoryIcon(tip.category) as any}
                    size={24}
                    color={getCategoryColor(tip.category)}
                  />
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>{tip.title}</Text>
                  <Text style={styles.tipDescription}>{tip.description}</Text>
                  {tip.monthly_savings && (
                    <View style={styles.savingsRow}>
                      <Text style={styles.savingsLabel}>Potential Savings:</Text>
                      <Text style={styles.savingsAmount}>
                        {formatCurrency(tip.monthly_savings)}/mo
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </>
        )}

        {/* Category Breakdown */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Spending by Category</Text>
        </View>
        <View style={styles.categoryCard}>
          {categoryBreakdown.map((item, index) => (
            <View key={index} style={styles.categoryRow}>
              <View style={styles.categoryInfo}>
                <View style={[
                  styles.categoryDot,
                  { backgroundColor: getCategoryColor(item.category) },
                ]} />
                <View style={[
                  styles.categoryIconContainer,
                  { backgroundColor: `${getCategoryColor(item.category)}20` },
                ]}>
                  <Ionicons
                    name={getCategoryIcon(item.category) as any}
                    size={16}
                    color={getCategoryColor(item.category)}
                  />
                </View>
                <Text style={styles.categoryName}>{item.category}</Text>
              </View>
              <View style={styles.categoryValues}>
                <Text style={styles.categoryAmount}>
                  {formatCurrency(item.amount)}
                </Text>
                <Text style={styles.categoryPercentage}>{item.percentage}%</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Quick Actions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/transactions')}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
              <Ionicons name="list" size={20} color="#3B82F6" />
            </View>
            <Text style={styles.actionText}>View All Transactions</Text>
            <Ionicons name="chevron-forward" size={16} color="#6B7280" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/savings')}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="trending-up" size={20} color="#10B981" />
            </View>
            <Text style={styles.actionText}>Set Savings Goal</Text>
            <Ionicons name="chevron-forward" size={16} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
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
  loadingText: {
    color: '#6B7280',
    marginTop: 16,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A1F2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  summaryCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  changeBadgePositive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  changeBadgeNegative: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  changeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  changeTextPositive: {
    color: '#10B981',
  },
  changeTextNegative: {
    color: '#EF4444',
  },
  summaryAmount: {
    fontSize: 36,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 4,
  },
  summarySubtext: {
    fontSize: 13,
    color: '#6B7280',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 208, 156, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  aiBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#00D09C',
  },
  tipCard: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  tipIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  tipContent: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  tipDescription: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 20,
    marginBottom: 8,
  },
  savingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savingsLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  savingsAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10B981',
  },
  categoryCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3142',
  },
  categoryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryDot: {
    width: 4,
    height: 24,
    borderRadius: 2,
    marginRight: 10,
  },
  categoryIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  categoryName: {
    fontSize: 14,
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  categoryValues: {
    alignItems: 'flex-end',
  },
  categoryAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  categoryPercentage: {
    fontSize: 12,
    color: '#6B7280',
  },
  actionsContainer: {
    marginHorizontal: 20,
    gap: 10,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  bottomSpacing: {
    height: 40,
  },
});
