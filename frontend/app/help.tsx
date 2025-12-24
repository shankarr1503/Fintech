import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { submitSupportRequest } from '../src/services/api';

const FAQS = [
  {
    question: 'How does FinanceWise track my transactions?',
    answer: 'FinanceWise can track transactions through Account Aggregator integration, SMS parsing, or manual entry. Your data is always encrypted and we only have read-only access.',
  },
  {
    question: 'Is my financial data secure?',
    answer: 'Yes! We use bank-grade 256-bit encryption. We never store your banking credentials and only access read-only transaction data. We are fully DPDP Act compliant.',
  },
  {
    question: 'How do Snowball and Avalanche strategies work?',
    answer: 'Snowball prioritizes paying off the smallest debts first for psychological wins. Avalanche prioritizes highest interest rate debts first to save the most money overall.',
  },
  {
    question: 'Can I delete my account and data?',
    answer: 'Yes, you can delete your account anytime from Settings > Privacy & Security > Delete Account. All your data will be permanently removed.',
  },
  {
    question: 'How are the AI insights generated?',
    answer: 'Our AI analyzes your spending patterns, compares them with optimal financial habits, and provides personalized recommendations to help you save more.',
  },
];

export default function HelpScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [showContactForm, setShowContactForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    subject: '',
    message: '',
  });

  const handleSubmitSupport = async () => {
    if (!user?.id || !formData.subject || !formData.message) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitSupportRequest(user.id, formData.subject, formData.message);
      Alert.alert(
        'Request Submitted',
        'Our support team will get back to you within 24 hours.',
        [{ text: 'OK', onPress: () => {
          setShowContactForm(false);
          setFormData({ subject: '', message: '' });
        }}]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
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
            <Text style={styles.title}>Help & Support</Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={styles.quickActionCard}
              onPress={() => setShowContactForm(true)}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(0, 208, 156, 0.15)' }]}>
                <Ionicons name="chatbubble" size={24} color="#00D09C" />
              </View>
              <Text style={styles.quickActionTitle}>Contact Support</Text>
              <Text style={styles.quickActionDesc}>Get help from our team</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickActionCard}
              onPress={() => Linking.openURL('mailto:support@financewise.app')}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Ionicons name="mail" size={24} color="#3B82F6" />
              </View>
              <Text style={styles.quickActionTitle}>Email Us</Text>
              <Text style={styles.quickActionDesc}>support@financewise.app</Text>
            </TouchableOpacity>
          </View>

          {/* Contact Form */}
          {showContactForm && (
            <View style={styles.contactForm}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>Contact Support</Text>
                <TouchableOpacity onPress={() => setShowContactForm(false)}>
                  <Ionicons name="close" size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>
              <Text style={styles.inputLabel}>Subject</Text>
              <TextInput
                style={styles.input}
                placeholder="What do you need help with?"
                placeholderTextColor="#6B7280"
                value={formData.subject}
                onChangeText={(text) => setFormData({ ...formData, subject: text })}
              />
              <Text style={styles.inputLabel}>Message</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Describe your issue in detail..."
                placeholderTextColor="#6B7280"
                multiline
                numberOfLines={4}
                value={formData.message}
                onChangeText={(text) => setFormData({ ...formData, message: text })}
              />
              <TouchableOpacity
                style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
                onPress={handleSubmitSupport}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* FAQs */}
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          <View style={styles.faqContainer}>
            {FAQS.map((faq, index) => (
              <TouchableOpacity
                key={index}
                style={styles.faqItem}
                onPress={() => setExpandedFaq(expandedFaq === index ? null : index)}
              >
                <View style={styles.faqHeader}>
                  <Text style={styles.faqQuestion}>{faq.question}</Text>
                  <Ionicons
                    name={expandedFaq === index ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color="#6B7280"
                  />
                </View>
                {expandedFaq === index && (
                  <Text style={styles.faqAnswer}>{faq.answer}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Legal Links */}
          <Text style={styles.sectionTitle}>Legal</Text>
          <View style={styles.legalLinks}>
            <TouchableOpacity style={styles.legalLink}>
              <Ionicons name="document-text" size={20} color="#6B7280" />
              <Text style={styles.legalLinkText}>Terms of Service</Text>
              <Ionicons name="chevron-forward" size={16} color="#6B7280" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.legalLink}>
              <Ionicons name="shield" size={20} color="#6B7280" />
              <Text style={styles.legalLinkText}>Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>

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
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 24,
  },
  quickActionCard: {
    flex: 1,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  quickActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  quickActionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  quickActionDesc: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  contactForm: {
    marginHorizontal: 20,
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '600',
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
    backgroundColor: '#0A0E14',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#2A3142',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#00D09C',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginHorizontal: 20,
    marginBottom: 12,
  },
  faqContainer: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  faqItem: {
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 12,
  },
  faqAnswer: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 12,
    lineHeight: 20,
  },
  legalLinks: {
    marginHorizontal: 20,
  },
  legalLink: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1F2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    gap: 12,
  },
  legalLinkText: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
  },
  bottomSpacing: {
    height: 40,
  },
});
