import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { supabase } from '@/src/services/supabase';

const COLORS = {
  background: '#F6F3EE',
  surface: '#FFFFFF',
  ink: '#1E362F',
  inkSoft: '#4B6358',
  accent: '#48715F',
  accentSoft: '#E4EEE8',
  gray: '#66666A',
  grayTrack: '#EDEAE4',
  border: '#E2DED7',
  danger: '#B3483F',
  dangerSoft: '#F7E8E6',
};

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const isDisabled = trimmedEmail.length === 0 || password.length === 0 || isSubmitting;

  const handleSignIn = async () => {
    if (isDisabled) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      setErrorMessage('登录失败，请检查邮箱和密码。');
    }

    setIsSubmitting(false);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>RoleWords</Text>
          <Text style={styles.tagline}>Words for your next role.</Text>

          <View style={styles.form}>
            <Text style={styles.label}>邮箱</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="邮箱"
              placeholderTextColor={COLORS.gray}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel="邮箱"
              style={styles.input}
            />

            <Text style={styles.label}>密码</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="密码"
              placeholderTextColor={COLORS.gray}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              accessibilityLabel="密码"
              style={styles.input}
            />

            {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

            <Pressable
              onPress={handleSignIn}
              disabled={isDisabled}
              accessibilityRole="button"
              accessibilityLabel="登录"
              accessibilityState={{ disabled: isDisabled }}
              style={[styles.button, isDisabled && styles.buttonDisabled]}>
              {isSubmitting ? (
                <ActivityIndicator color={COLORS.surface} />
              ) : (
                <Text style={styles.buttonText}>登录</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.ink,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 32,
  },
  form: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 20,
    gap: 8,
  },
  label: {
    fontSize: 13,
    color: COLORS.inkSoft,
    marginTop: 8,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: COLORS.ink,
  },
  error: {
    fontSize: 13,
    color: COLORS.danger,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: COLORS.surface,
    fontSize: 16,
    fontWeight: '600',
  },
});
