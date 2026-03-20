import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>();

  useEffect(() => {
    async function handleCallback() {
      const { access_token, refresh_token, error } = params;

      if (error) {
        router.replace('/(auth)/login');
        return;
      }

      if (access_token && refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (sessionError) {
          router.replace('/(auth)/login');
          return;
        }
        // Success: onAuthStateChange in _layout.tsx fires SIGNED_IN,
        // sets user + isAuthenticated, then (auth)/_layout.tsx redirects to /(app)
      } else {
        router.replace('/(auth)/login');
      }
    }

    handleCallback();
  }, [params]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#1E40AF" />
    </View>
  );
}
