import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { updateUser } from '../src/services/api';

export default function EditProfileScreen() {
  const { user, updateUser: updateLocalUser } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    monthly_income: user?.monthly_income?.toString() || '',
    fixed_expenses: user?.fixed_expenses?.toString() || '',
  });

  const handleSave = async () => {
    if (!user?.id) return;
    
    setIsLoading(true);
    try {
      const updates = {
        name: formData.name || undefined,
        monthly_income: formData.monthly_income ? parseFloat(formData.monthly_income) : undefined,
        fixed_expenses: formData.fixed_expenses ? parseFloat(formData.fixed_expenses) : undefined,
      };
      
      await updateUser(user.id, updates);
      
      // Update local user state
      updateLocalUser({
        name: formData.name || user.name,
        monthly_income: parseFloat(formData.monthly_income) || user.monthly_income,
        fixed_expenses: parseFloat(formData.fixed_expenses) || user.fixed_expenses,
      });
      
      Alert.alert('Success', 'Profile updated successfully!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Failed to update profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.title}>Edit Profile</Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Avatar */}
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {formData.name?.charAt(0) || user?.phone?.charAt(0) || 'U'}
              </Text>
            </View>
            <TouchableOpacity style={styles.changePhotoBtn}>
              <Ionicons name="camera" size={16} color="#00D09C" />
              <Text style={styles.changePhotoText}>Change Photo</Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your name"
              placeholderTextColor="#6B7280"
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
            />

            <Text style={styles.inputLabel}>Phone Number</Text>
            <View style={styles.disabledInput}>
              <Text style={styles.disabledInputText}>+91 {user?.phone}</Text>
              <Ionicons name="lock-closed" size={16} color="#6B7280" />
            </View>

            <Text style={styles.inputLabel}>Monthly Income</Text>
            <View style={styles.inputWithPrefix}>
              <Text style={styles.inputPrefix}>₹</Text>
              <TextInput
                style={styles.inputInner}
                placeholder="0"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                value={formData.monthly_income}
                onChangeText={(text) => setFormData({ ...formData, monthly_income: text })}
              />
            </View>

            <Text style={styles.inputLabel}>Fixed Monthly Expenses</Text>
            <View style={styles.inputWithPrefix}>
              <Text style={styles.inputPrefix}>₹</Text>
              <TextInput
                style={styles.inputInner}
                placeholder="0"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                value={formData.fixed_expenses}
                onChangeText={(text) => setFormData({ ...formData, fixed_expenses: text })}
              />
            </View>
            <Text style={styles.inputHint}>
              Include rent, utilities, subscriptions, EMIs, etc.
            </Text>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>

          <View style={styles.bottomSpacing} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#00D09C',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 40,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  changePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  changePhotoText: {
    fontSize: 14,
    color: '#00D09C',
    fontWeight: '500',
  },
  formSection: {
    paddingHorizontal: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 8,
    marginTop: 16,
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
  disabledInput: {
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3142',
  },
  disabledInputText: {
    fontSize: 16,
    color: '#6B7280',
  },
  inputWithPrefix: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A3142',
    paddingHorizontal: 16,
  },
  inputPrefix: {
    fontSize: 16,
    color: '#6B7280',
    marginRight: 8,
  },
  inputInner: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
  },
  inputHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
  },
  saveButton: {
    backgroundColor: '#00D09C',
    marginHorizontal: 20,
    marginTop: 32,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  bottomSpacing: {
    height: 40,
  },
});
