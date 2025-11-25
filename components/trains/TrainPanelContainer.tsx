import { memo, useEffect } from 'react';

import { useTrainPositionById } from '../../hooks/useTrainPositionById';
import type { TrafficSheetSnapPoint } from '../traffic/TrafficInfoSheet';
import { TrainPanel } from './TrainPanel';

type TrainPanelContainerProps = {
  trainId: string | null;
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
};

function TrainPanelContainerComponent({
  trainId,
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
}: TrainPanelContainerProps) {
  const train = useTrainPositionById(trainId);

  useEffect(() => {
    if (!train && visible && trainId) {
      onClose();
    }
  }, [onClose, train, trainId, visible]);

  if (!train) {
    return null;
  }

  return (
    <TrainPanel
      visible={visible}
      initialSnap={initialSnap}
      train={train}
      onClose={onClose}
      onSnapPointChange={onSnapPointChange}
    />
  );
}

export const TrainPanelContainer = memo(TrainPanelContainerComponent);
