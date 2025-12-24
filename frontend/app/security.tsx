import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { getSecuritySettings, updateSecuritySettings, deleteUserAccount, exportUserData } from '../src/services/api';

export default function SecurityScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState({
    biometric_enabled: false,
    transaction_alerts: true,
    login_notifications: true,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    if (!user?.id) return;
    try {
      const data = await getSecuritySettings(user.id);
      setSettings(data);
    } catch (error) {
      console.error('Failed to fetch security settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = async (key: string, value: boolean) => {
    if (!user?.id) return;
    
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    
    try {
      await updateSecuritySettings(user.id, newSettings);
    } catch (error) {
      // Revert on error
      setSettings(settings);
      Alert.alert('Error', 'Failed to update settings');
    }
  };

  const handleExportData = async () => {
    if (!user?.id) return;
    
    try {
      const data = await exportUserData(user.id);
      Alert.alert(
        'Data Export Ready',
        `Your data includes:\n• ${data.total_transactions} transactions\n• ${data.total_debts} debts\n• ${data.total_savings_goals} savings goals\n\nIn a production app, this would be downloaded as a file.`
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to export data');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => confirmDeleteAccount(),
        },
      ]
    );
  };

  const confirmDeleteAccount = async () => {
    if (!user?.id) return;
    
    try {
      await deleteUserAccount(user.id, 'User requested deletion');
      await logout();
      router.replace('/(auth)/login');
    } catch (error) {
      Alert.alert('Error', 'Failed to delete account');
    }
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
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.title}>Privacy & Security</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Security Badge */}
        <View style={styles.securityBadge}>
          <View style={styles.securityIcon}>
            <Ionicons name="shield-checkmark" size={32} color="#10B981" />
          </View>
          <View style={styles.securityContent}>
            <Text style={styles.securityTitle}>Your data is protected</Text>
            <Text style={styles.securityText}>
              Bank-grade 256-bit encryption • Read-only access • DPDP Act compliant
            </Text>
          </View>
        </View>

        {/* Authentication */}
        <Text style={styles.sectionTitle}>Authentication</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Ionicons name="finger-print" size={20} color="#3B82F6" />
              </View>
              <View>
                <Text style={styles.settingTitle}>Biometric Login</Text>
                <Text style={styles.settingDesc}>Use fingerprint or Face ID</Text>
              </View>
            </View>
            <Switch
              value={settings.biometric_enabled}
              onValueChange={(value) => handleToggle('biometric_enabled', value)}
              trackColor={{ false: '#2A3142', true: 'rgba(0, 208, 156, 0.4)' }}
              thumbColor={settings.biometric_enabled ? '#00D09C' : '#6B7280'}
            />
          </View>
        </View>

        {/* Notifications */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Ionicons name="card" size={20} color="#10B981" />
              </View>
              <View>
                <Text style={styles.settingTitle}>Transaction Alerts</Text>
                <Text style={styles.settingDesc}>Get notified for spending</Text>
              </View>
            </View>
            <Switch
              value={settings.transaction_alerts}
              onValueChange={(value) => handleToggle('transaction_alerts', value)}
              trackColor={{ false: '#2A3142', true: 'rgba(0, 208, 156, 0.4)' }}
              thumbColor={settings.transaction_alerts ? '#00D09C' : '#6B7280'}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(251, 191, 36, 0.15)' }]}>
                <Ionicons name="log-in" size={20} color="#FBBF24" />
              </View>
              <View>
                <Text style={styles.settingTitle}>Login Notifications</Text>
                <Text style={styles.settingDesc}>Alert on new device login</Text>
              </View>
            </View>
            <Switch
              value={settings.login_notifications}
              onValueChange={(value) => handleToggle('login_notifications', value)}
              trackColor={{ false: '#2A3142', true: 'rgba(0, 208, 156, 0.4)' }}
              thumbColor={settings.login_notifications ? '#00D09C' : '#6B7280'}
            />
          </View>
        </View>

        {/* Data Management */}
        <Text style={styles.sectionTitle}>Data Management</Text>
        <View style={styles.settingsCard}>
          <TouchableOpacity style={styles.settingRow} onPress={handleExportData}>
            <View style={styles.settingInfo}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                <Ionicons name="download" size={20} color="#8B5CF6" />
              </View>
              <View>
                <Text style={styles.settingTitle}>Export My Data</Text>
                <Text style={styles.settingDesc}>Download all your data</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <Text style={styles.sectionTitle}>Danger Zone</Text>
        <TouchableOpacity style={styles.dangerCard} onPress={handleDeleteAccount}>
          <View style={styles.settingInfo}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="trash" size={20} color="#EF4444" />
            </View>
            <View>
              <Text style={[styles.settingTitle, { color: '#EF4444' }]}>Delete Account</Text>
              <Text style={styles.settingDesc}>Permanently delete all data</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#EF4444" />
        </TouchableOpacity>

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
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 24,
  },
  securityIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  securityContent: {
    flex: 1,
  },
  securityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
    marginBottom: 4,
  },
  securityText: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginHorizontal: 20,
    marginBottom: 12,
    marginTop: 8,
  },
  settingsCard: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 4,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  settingDesc: {
    fontSize: 12,
    color: '#6B7280',
  },
  divider: {
    height: 1,
    backgroundColor: '#2A3142',
    marginHorizontal: 12,
  },
  dangerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  bottomSpacing: {
    height: 40,
  },
});
