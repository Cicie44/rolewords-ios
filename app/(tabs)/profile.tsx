import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/providers/AuthProvider';
import { supabase } from '@/src/services/supabase';

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
      <Text style={styles.title}>我的 Profile</Text>

      {session?.user.email && <Text style={styles.email}>{session.user.email}</Text>}

      <Pressable
        onPress={handleSignOut}
        disabled={isSigningOut}
        accessibilityRole="button"
        accessibilityLabel="退出登录"
        style={[styles.signOutButton, isSigningOut && styles.signOutButtonDisabled]}>
        <Text style={styles.signOutButtonText}>退出登录</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  email: {
    fontSize: 15,
    color: '#666',
  },
  signOutButton: {
    marginTop: 16,
    minHeight: 44,
    minWidth: 140,
    borderRadius: 10,
    backgroundColor: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  signOutButtonDisabled: {
    opacity: 0.5,
  },
  signOutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
