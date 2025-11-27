import { memo, useCallback, useEffect, useState } from 'react';
import type { TrafficSheetSnapPoint } from '../traffic/sheetSnapPoints';
import type { TrainPosition } from '../../types/trains';
import { ProfilePanel } from './ProfilePanel';

export type ProfilePanelContainerProps = {
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  onOpenTrain: (train: TrainPosition) => void;
};

function ProfilePanelContainerComponent({
  visible,
  initialSnap,
  onClose,
  onSnapPointChange,
  onOpenTrain,
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
    />
  );
}

export const ProfilePanelContainer = memo(ProfilePanelContainerComponent);
