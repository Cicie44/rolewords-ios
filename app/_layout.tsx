import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/src/providers/AuthProvider';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Prevent the splash screen from auto-hiding before the app is ready.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const { session, isLoading } = useAuth();

  useEffect(() => {
    // Wait for the auth session to finish restoring before hiding the splash
    // screen, so we never flash the sign-in screen for an already-logged-in user.
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  if (isLoading) {
    return null;
  }

  return (
    // v0.1 screens are only styled for a light background, so the app stays
    // in light mode regardless of the system appearance setting for now.
    <ThemeProvider value={DefaultTheme}>
      <Stack>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="saved/[id]"
            options={{
              title: '收藏详情',
              headerBackTitle: '生词本',
            }}
          />
          <Stack.Screen
            name="interview/[id]"
            options={{
              title: '面试准备',
              headerBackTitle: '面试',
            }}
          />
          <Stack.Screen
            name="interview/new"
            options={{
              title: '新建面试准备',
              headerBackTitle: '面试',
            }}
          />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
