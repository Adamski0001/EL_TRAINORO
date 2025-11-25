export type TrainPosition = {
  id: string;
  label: string;
  advertisedTrainIdent: string | null;
  operationalTrainNumber: string | null;
  operationalTrainDepartureDate: string | null;
  journeyPlanNumber: string | null;
  journeyPlanDepartureDate: string | null;
  trainOwner: string | null;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  speed: number | null;
  bearing: number | null;
  updatedAt: string;
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
  advertisedTrainIdent: string | null;
  operationalTrainNumber: string | null;
  operator: string | null;
  productName: string | null;
  fromName: string | null;
  toName: string | null;
  stops: TrainStop[];
};
