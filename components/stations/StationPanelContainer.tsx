import { memo, useEffect } from 'react';

import { useStationById } from '../../hooks/useStationById';
import type { TrafficSheetSnapPoint } from '../traffic/TrafficInfoSheet';
import { StationPanel } from './StationPanel';
import type { TrainPosition } from '../../types/trains';

type StationPanelContainerProps = {
  stationId: string | null;
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  onOpenTrain: (train: TrainPosition) => void;
};

function StationPanelContainerComponent({
  stationId,
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
  onOpenTrain,
}: StationPanelContainerProps) {
  const station = useStationById(stationId);

  useEffect(() => {
    if (!station && visible && stationId) {
      onClose();
    }
  }, [onClose, station, stationId, visible]);

  if (!station) {
    return null;
  }

  return (
    <StationPanel
      visible={visible}
      initialSnap={initialSnap}
      station={station}
      onClose={onClose}
      onSnapPointChange={onSnapPointChange}
      onOpenTrain={onOpenTrain}
    />
  );
}

export const StationPanelContainer = memo(StationPanelContainerComponent);
