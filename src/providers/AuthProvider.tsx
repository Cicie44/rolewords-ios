import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/src/services/supabase';

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ session: null, isLoading: true });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) {
          setSession(data.session);
        }
      })
      .catch((error) => {
        // Never log `data.session` here — only a short error description,
        // never the token payload itself.
        console.warn('[AuthProvider] failed to restore session:', error?.message);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        setSession(nextSession);
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Per Supabase's React Native guidance: auto-refresh should only run
    // while the app is in the foreground.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>;
}
