import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/providers/AuthProvider';
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

export default function ProfileScreen() {
  const { session } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    await supabase.auth.signOut();
    // On success, onAuthStateChange clears the session and Stack.Protected
    // in app/_layout.tsx sends the user back to sign-in automatically.
    setIsSigningOut(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.accountCard}>
        <View style={styles.avatarCircle}>
          <SymbolView
            name={{ ios: 'person.fill', android: 'person', web: 'person' }}
            tintColor={COLORS.accent}
            size={28}
          />
        </View>
        <Text style={styles.accountLabel}>当前账号</Text>
        {session?.user.email && <Text style={styles.email}>{session.user.email}</Text>}
      </View>

      <Pressable
        onPress={handleSignOut}
        disabled={isSigningOut}
        accessibilityRole="button"
        accessibilityLabel="退出登录"
        accessibilityState={{ disabled: isSigningOut }}
        style={[styles.signOutButton, isSigningOut && styles.signOutButtonDisabled]}>
        {isSigningOut ? (
          <View style={styles.signOutButtonRow}>
            <ActivityIndicator size="small" color={COLORS.danger} />
            <Text style={styles.signOutButtonText}>正在退出…</Text>
          </View>
        ) : (
          <Text style={styles.signOutButtonText}>退出登录</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    padding: 20,
    gap: 20,
  },
  accountCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  accountLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray,
  },
  email: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.ink,
  },
  signOutButton: {
    minHeight: 44,
    minWidth: 140,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.danger,
    backgroundColor: COLORS.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  signOutButtonDisabled: {
    opacity: 0.5,
  },
  signOutButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signOutButtonText: {
    color: COLORS.danger,
    fontSize: 16,
    fontWeight: '600',
  },
});
