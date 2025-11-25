import { BlurView } from 'expo-blur';
import { RotateCcw } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, DevSettings, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReloadApp } from '../contexts/ReloadContext';

export function ReloadButton() {
  const insets = useSafeAreaInsets();
  const [reloading, setReloading] = useState(false);
  const reloadApp = useReloadApp();

  const handleReload = useCallback(async () => {
    if (reloading) {
      return;
    }
    setReloading(true);
    try {
      if (__DEV__ && Platform.OS !== 'web' && typeof DevSettings.reload === 'function') {
        DevSettings.reload();
        return;
      }
      await reloadApp();
    } catch (error) {
      console.warn('[ReloadButton] Reload failed', error);
      setReloading(false);
      return;
    }
  }, [reloadApp, reloading]);

  return (
    <View pointerEvents="box-none" style={[styles.container, { paddingTop: insets.top + 12 }]}> 
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Uppdatera appen"
        disabled={reloading}
        onPress={handleReload}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressablePressed, reloading && styles.pressableDisabled]}
      >
        <BlurView intensity={80} tint="dark" style={styles.blur}>
          {reloading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <RotateCcw size={18} color="#fff" strokeWidth={2.4} />
          )}
        </BlurView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    paddingHorizontal: 18,
    zIndex: 20,
  },
  pressable: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#010513',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  pressablePressed: {
    transform: [{ scale: 0.98 }],
  },
  pressableDisabled: {
    opacity: 0.75,
  },
  blur: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(6, 16, 34, 0.55)',
  },
});
