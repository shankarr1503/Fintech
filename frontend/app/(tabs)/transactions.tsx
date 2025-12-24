import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { getTransactions, mockBankSync } from '../../src/services/api';
import { formatCurrency, formatDate, getCategoryColor, getCategoryIcon } from '../../src/utils/format';

const CATEGORIES = [
  'all', 'food', 'transport', 'shopping', 'utilities',
  'entertainment', 'health', 'subscription', 'emi', 'salary',
];

export default function TransactionsScreen() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchTransactions = async () => {
    if (!user?.id) return;
    try {
      const category = selectedCategory === 'all' ? undefined : selectedCategory;
      const data = await getTransactions(user.id, 100, category);
      setTransactions(data);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    fetchTransactions();
  }, [user?.id, selectedCategory]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTransactions();
  };

  const handleBankSync = async () => {
    if (!user?.id) return;
    
    Alert.alert(
      'Sync Bank Account',
      'This will fetch your latest transactions from connected banks (Demo Mode)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync Now',
          onPress: async () => {
            setSyncing(true);
            try {
              await mockBankSync(user.id);
              Alert.alert('Success', 'Bank transactions synced successfully!');
              fetchTransactions();
            } catch (error) {
              Alert.alert('Error', 'Failed to sync transactions');
            } finally {
              setSyncing(false);
            }
          },
        },
      ]
    );
  };

  const groupedTransactions = transactions.reduce((groups: any, txn) => {
    const date = formatDate(txn.date);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(txn);
    return groups;
  }, {});

  const sections = Object.entries(groupedTransactions).map(([date, items]) => ({
    date,
    data: items as any[],
  }));

  const renderTransaction = ({ item }: { item: any }) => (
    <View style={styles.transactionItem}>
      <View style={[
        styles.transactionIcon,
        { backgroundColor: `${getCategoryColor(item.category)}20` },
      ]}>
        <Ionicons
          name={getCategoryIcon(item.category) as any}
          size={20}
          color={getCategoryColor(item.category)}
        />
      </View>
      <View style={styles.transactionContent}>
        <Text style={styles.transactionMerchant}>{item.merchant}</Text>
        <View style={styles.transactionMeta}>
          <Text style={styles.transactionCategory}>{item.category}</Text>
          {item.is_recurring && (
            <View style={styles.recurringBadge}>
              <Ionicons name="repeat" size={10} color="#00D09C" />
            </View>
          )}
        </View>
      </View>
      <Text style={[
        styles.transactionAmount,
        item.type === 'credit' && styles.creditAmount,
      ]}>
        {item.type === 'credit' ? '+' : '-'}{formatCurrency(item.amount)}
      </Text>
    </View>
  );

  const renderSection = ({ item }: { item: { date: string; data: any[] } }) => (
    <View style={styles.section}>
      <Text style={styles.sectionDate}>{item.date}</Text>
      {item.data.map((txn, index) => (
        <View key={txn.id || index}>
          {renderTransaction({ item: txn })}
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <TouchableOpacity
          style={styles.syncButton}
          onPress={handleBankSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#00D09C" />
          ) : (
            <Ionicons name="sync" size={20} color="#00D09C" />
          )}
        </TouchableOpacity>
      </View>

      {/* Category Filter */}
      <View style={styles.filterContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORIES}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterChip,
                selectedCategory === item && styles.filterChipActive,
              ]}
              onPress={() => setSelectedCategory(item)}
            >
              <Text style={[
                styles.filterText,
                selectedCategory === item && styles.filterTextActive,
              ]}>
                {item === 'all' ? 'All' : item}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Transactions List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D09C" />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="receipt-outline" size={64} color="#2A3142" />
          <Text style={styles.emptyText}>No transactions found</Text>
          <TouchableOpacity style={styles.syncBankButton} onPress={handleBankSync}>
            <Text style={styles.syncBankText}>Sync Bank Account</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.date}
          renderItem={renderSection}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#00D09C"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E14',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  syncButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 208, 156, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterContainer: {
    marginBottom: 16,
  },
  filterList: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1A1F2E',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#00D09C',
  },
  filterText: {
    fontSize: 14,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  filterTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  transactionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transactionCategory: {
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  recurringBadge: {
    backgroundColor: 'rgba(0, 208, 156, 0.15)',
    padding: 4,
    borderRadius: 4,
  },
  transactionAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
  creditAmount: {
    color: '#10B981',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 16,
    marginBottom: 24,
  },
  syncBankButton: {
    backgroundColor: '#00D09C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  syncBankText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
