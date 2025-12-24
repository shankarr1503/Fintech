import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { getDashboard, getInsights } from '../../src/services/api';
import { formatCurrency, getCategoryColor, getCategoryIcon } from '../../src/utils/format';

const { width } = Dimensions.get('window');

interface DashboardData {
  spending: {
    this_month: number;
    last_month: number;
    change_percentage: number;
    remaining_balance: number;
  };
  income: number;
  debts: {
    total: number;
    monthly_emi: number;
    count: number;
  };
  savings: {
    total_saved: number;
    total_target: number;
    progress: number;
    goals_count: number;
  };
  category_breakdown: Record<string, number>;
  recent_transactions: any[];
  recommended_action: {
    type: string;
    title: string;
    description: string;
  };
}

export default function HomeScreen() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [insights, setInsights] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    if (!user?.id) return;
    try {
      const [dashData, insightData] = await Promise.all([
        getDashboard(user.id),
        getInsights(user.id),
      ]);
      setDashboard(dashData);
      setInsights(insightData || []);
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
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

  const pieData = dashboard?.category_breakdown
    ? Object.entries(dashboard.category_breakdown)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => ({
          value,
          color: getCategoryColor(key),
          text: key,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    : [];

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00D09C" />
        <Text style={styles.loadingText}>Loading your finances...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
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
          <View>
            <Text style={styles.greeting}>Hello,</Text>
            <Text style={styles.userName}>{user?.name || 'User'}</Text>
          </View>
          <TouchableOpacity style={styles.notificationBtn}>
            <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeader}>
            <Text style={styles.balanceLabel}>Remaining Balance</Text>
            <View style={[
              styles.changeBadge,
              dashboard?.spending?.change_percentage! > 0
                ? styles.changeBadgeNegative
                : styles.changeBadgePositive,
            ]}>
              <Ionicons
                name={dashboard?.spending?.change_percentage! > 0 ? 'arrow-up' : 'arrow-down'}
                size={12}
                color={dashboard?.spending?.change_percentage! > 0 ? '#EF4444' : '#10B981'}
              />
              <Text style={[
                styles.changeText,
                dashboard?.spending?.change_percentage! > 0
                  ? styles.changeTextNegative
                  : styles.changeTextPositive,
              ]}>
                {Math.abs(dashboard?.spending?.change_percentage || 0)}%
              </Text>
            </View>
          </View>
          <Text style={styles.balanceAmount}>
            {formatCurrency(dashboard?.spending?.remaining_balance || 0)}
          </Text>
          <View style={styles.balanceStats}>
            <View style={styles.balanceStat}>
              <Text style={styles.balanceStatLabel}>Income</Text>
              <Text style={styles.balanceStatValue}>
                {formatCurrency(dashboard?.income || 0)}
              </Text>
            </View>
            <View style={styles.balanceStatDivider} />
            <View style={styles.balanceStat}>
              <Text style={styles.balanceStatLabel}>Spent</Text>
              <Text style={[styles.balanceStatValue, styles.spentValue]}>
                {formatCurrency(dashboard?.spending?.this_month || 0)}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.quickStats}>
          <View style={styles.quickStatCard}>
            <View style={[styles.quickStatIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="card" size={20} color="#EF4444" />
            </View>
            <Text style={styles.quickStatLabel}>Total Debt</Text>
            <Text style={styles.quickStatValue}>
              {formatCurrency(dashboard?.debts?.total || 0)}
            </Text>
          </View>
          <View style={styles.quickStatCard}>
            <View style={[styles.quickStatIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="trending-up" size={20} color="#10B981" />
            </View>
            <Text style={styles.quickStatLabel}>Saved</Text>
            <Text style={[styles.quickStatValue, styles.savedValue]}>
              {formatCurrency(dashboard?.savings?.total_saved || 0)}
            </Text>
          </View>
        </View>

        {/* Recommended Action */}
        {dashboard?.recommended_action && (
          <TouchableOpacity style={styles.actionCard}>
            <View style={styles.actionIconContainer}>
              <Ionicons
                name={
                  dashboard.recommended_action.type === 'debt'
                    ? 'card'
                    : dashboard.recommended_action.type === 'savings'
                    ? 'trending-up'
                    : 'restaurant'
                }
                size={24}
                color="#00D09C"
              />
            </View>
            <View style={styles.actionContent}>
              <Text style={styles.actionTitle}>
                {dashboard.recommended_action.title}
              </Text>
              <Text style={styles.actionDescription}>
                {dashboard.recommended_action.description}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6B7280" />
          </TouchableOpacity>
        )}

        {/* Spending Breakdown */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Spending Breakdown</Text>
        </View>
        <View style={styles.chartCard}>
          {pieData.length > 0 ? (
            <View>
              <View style={styles.chartSummary}>
                <Text style={styles.chartSummaryLabel}>This Month Total</Text>
                <Text style={styles.chartSummaryValue}>
                  {formatCurrency(dashboard?.spending?.this_month || 0)}
                </Text>
              </View>
              {pieData.map((item, index) => {
                const percentage = ((item.value / (dashboard?.spending?.this_month || 1)) * 100).toFixed(1);
                return (
                  <View key={index} style={styles.categoryRow}>
                    <View style={styles.categoryInfo}>
                      <View style={[styles.categoryDot, { backgroundColor: item.color }]} />
                      <Text style={styles.categoryName}>{item.text}</Text>
                    </View>
                    <View style={styles.categoryBarContainer}>
                      <View style={styles.categoryBarBg}>
                        <View 
                          style={[
                            styles.categoryBarFill, 
                            { width: `${percentage}%`, backgroundColor: item.color }
                          ]} 
                        />
                      </View>
                    </View>
                    <Text style={styles.categoryAmount}>{formatCurrency(item.value)}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noDataText}>No spending data available</Text>
          )}
        </View>

        {/* AI Insights */}
        {insights.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>AI Insights</Text>
              <View style={styles.aiBadge}>
                <Ionicons name="sparkles" size={14} color="#00D09C" />
                <Text style={styles.aiBadgeText}>AI</Text>
              </View>
            </View>
            {insights.slice(0, 3).map((insight, index) => (
              <View key={index} style={styles.insightCard}>
                <View style={[
                  styles.insightIcon,
                  insight.category === 'warning'
                    ? { backgroundColor: 'rgba(239, 68, 68, 0.15)' }
                    : insight.category === 'saving'
                    ? { backgroundColor: 'rgba(16, 185, 129, 0.15)' }
                    : { backgroundColor: 'rgba(59, 130, 246, 0.15)' },
                ]}>
                  <Ionicons
                    name={
                      insight.category === 'warning'
                        ? 'warning'
                        : insight.category === 'saving'
                        ? 'trending-up'
                        : 'bulb'
                    }
                    size={20}
                    color={
                      insight.category === 'warning'
                        ? '#EF4444'
                        : insight.category === 'saving'
                        ? '#10B981'
                        : '#3B82F6'
                    }
                  />
                </View>
                <View style={styles.insightContent}>
                  <Text style={styles.insightTitle}>{insight.title}</Text>
                  <Text style={styles.insightDescription}>
                    {insight.description}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Recent Transactions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
        </View>
        {dashboard?.recent_transactions?.slice(0, 5).map((txn, index) => (
          <View key={index} style={styles.transactionItem}>
            <View style={[
              styles.transactionIcon,
              { backgroundColor: `${getCategoryColor(txn.category)}20` },
            ]}>
              <Ionicons
                name={getCategoryIcon(txn.category) as any}
                size={20}
                color={getCategoryColor(txn.category)}
              />
            </View>
            <View style={styles.transactionContent}>
              <Text style={styles.transactionMerchant}>{txn.merchant}</Text>
              <Text style={styles.transactionCategory}>{txn.category}</Text>
            </View>
            <Text style={[
              styles.transactionAmount,
              txn.type === 'credit' && styles.creditAmount,
            ]}>
              {txn.type === 'credit' ? '+' : '-'}{formatCurrency(txn.amount)}
            </Text>
          </View>
        ))}

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
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: 14,
    color: '#6B7280',
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  notificationBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A1F2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceLabel: {
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
    fontSize: 12,
    fontWeight: '600',
  },
  changeTextPositive: {
    color: '#10B981',
  },
  changeTextNegative: {
    color: '#EF4444',
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  balanceStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceStat: {
    flex: 1,
  },
  balanceStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#2A3142',
    marginHorizontal: 16,
  },
  balanceStatLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  balanceStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
  },
  spentValue: {
    color: '#EF4444',
  },
  quickStats: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  quickStatCard: {
    flex: 1,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 16,
  },
  quickStatIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  quickStatLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  quickStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  savedValue: {
    color: '#10B981',
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    backgroundColor: 'rgba(0, 208, 156, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 208, 156, 0.3)',
    padding: 16,
    marginBottom: 24,
  },
  actionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 208, 156, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  actionDescription: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
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
  chartCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  chartSummary: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3142',
    paddingBottom: 16,
  },
  chartSummaryLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  chartSummaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 90,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  categoryName: {
    fontSize: 12,
    color: '#9CA3AF',
    textTransform: 'capitalize',
  },
  categoryBarContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  categoryBarBg: {
    height: 8,
    backgroundColor: '#2A3142',
    borderRadius: 4,
    overflow: 'hidden',
  },
  categoryBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  categoryAmount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    width: 70,
    textAlign: 'right',
  },
  noDataText: {
    textAlign: 'center',
    color: '#6B7280',
    padding: 20,
  },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  insightIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  insightContent: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  insightDescription: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 20,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  transactionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  transactionContent: {
    flex: 1,
  },
  transactionMerchant: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  transactionCategory: {
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  transactionAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
  creditAmount: {
    color: '#10B981',
  },
  bottomSpacing: {
    height: 20,
  },
});
