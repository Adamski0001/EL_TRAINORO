import * as Haptics from 'expo-haptics';

type HapticVariant = 'light' | 'medium' | 'success' | 'warning' | 'error';

const trigger = (variant: HapticVariant) => {
  try {
    switch (variant) {
      case 'light':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      default:
        break;
    }
  } catch (error) {
    // Ignore haptic failures (e.g. simulators/web)
  }
};

export const haptics = {
  light: () => trigger('light'),
  medium: () => trigger('medium'),
  success: () => trigger('success'),
  warning: () => trigger('warning'),
  error: () => trigger('error'),
};
