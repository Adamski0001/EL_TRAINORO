import { memo, useCallback, useEffect, useState } from 'react';
import type { TrafficSheetSnapPoint } from '../traffic/sheetSnapPoints';
import type { TrainPosition } from '../../types/trains';
import type { OnboardingStage } from '../onboarding/OnboardingOverlay';
import { ProfilePanel } from './ProfilePanel';

export type ProfilePanelContainerProps = {
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  onOpenTrain: (train: TrainPosition, options?: { allowScheduleFallback?: boolean; focus?: boolean }) => void;
  onRequestAuth?: (startStage?: OnboardingStage) => void;
};

function ProfilePanelContainerComponent({
  visible,
  initialSnap,
  onClose,
  onSnapPointChange,
  onOpenTrain,
  onRequestAuth,
}: ProfilePanelContainerProps) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
  }, [visible]);

  const handlePanelClose = useCallback(() => {
    onClose();
    setMounted(false);
  }, [onClose]);

  if (!mounted) {
    return null;
  }

  return (
    <ProfilePanel
      visible={visible}
      initialSnap={initialSnap}
      onClose={handlePanelClose}
      onSnapPointChange={onSnapPointChange}
      onOpenTrain={onOpenTrain}
      onRequestAuth={onRequestAuth}
    />
  );
}

export const ProfilePanelContainer = memo(ProfilePanelContainerComponent);
