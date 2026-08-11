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

const COLORS = {
  background: '#F6F3EE',
  ink: '#1E362F',
  border: '#E2DED7',
  accent: '#48715F',
  danger: '#B3483F',
};

// Keeps every other DefaultTheme field (fonts, dark, etc.) intact and only
// overrides the color roles that need the warm-gray/ink-green palette.
const AppTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: COLORS.accent,
    background: COLORS.background,
    card: COLORS.background,
    text: COLORS.ink,
    border: COLORS.border,
    notification: COLORS.danger,
  },
};

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
    <ThemeProvider value={AppTheme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.ink,
          headerTitleStyle: { fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: COLORS.background },
        }}>
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
