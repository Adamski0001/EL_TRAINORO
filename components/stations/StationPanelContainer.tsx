import { memo, useEffect } from 'react';

import { useStationById } from '../../hooks/useStationById';
import type { TrafficSheetSnapPoint } from '../traffic/TrafficInfoSheet';
import { StationPanel } from './StationPanel';

type StationPanelContainerProps = {
  stationId: string | null;
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
};

function StationPanelContainerComponent({
  stationId,
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
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
    />
  );
}

export const StationPanelContainer = memo(StationPanelContainerComponent);
