import { View, Text, StyleSheet } from 'react-native';
import { useAppStore } from '@/stores/appStore';

export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline);
  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    alignItems: 'center',
    width: '100%',
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
