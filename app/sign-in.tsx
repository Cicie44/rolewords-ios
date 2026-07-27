import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { supabase } from '@/src/services/supabase';

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
        <Text style={styles.title}>RoleWords</Text>
        <Text style={styles.tagline}>Words for your next role.</Text>

        <View style={styles.form}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="邮箱"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel="邮箱"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="密码"
            placeholderTextColor="#999"
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
            style={[styles.button, isDisabled && styles.buttonDisabled]}>
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>登录</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 32,
  },
  form: {
    gap: 12,
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#000',
  },
  error: {
    fontSize: 13,
    color: '#d9534f',
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
