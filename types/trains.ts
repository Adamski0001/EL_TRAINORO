export type TrainPosition = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speedKmh: number;
  trainOwner: string;
};

export type TrainStop = {
  id: string;
  stationName: string;
  track: string | null;
  arrivalAdvertised: Date | null;
  arrivalEstimated: Date | null;
  arrivalActual: Date | null;
  departureAdvertised: Date | null;
  departureEstimated: Date | null;
  departureActual: Date | null;
  canceled: boolean;
};

export type TrainDetails = {
  id: string;
  operator: string;
  productName: string | null;
  fromName: string;
  toName: string;
  stops: TrainStop[];
};
