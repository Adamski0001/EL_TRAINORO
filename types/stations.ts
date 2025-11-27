export type StationCoordinate = {
  latitude: number;
  longitude: number;
};

export type StationRegion =
  | 'Stockholm'
  | 'Malardalen'
  | 'Vastra Gotaland'
  | 'Skane'
  | 'Sverige'
  | 'Norra Sverige'
  | 'Ovriga Sodra Sverige';

export type StationTrafficVolume = 'high' | 'medium' | 'low';

export type StationLineCategory = 'Fjärrtåg' | 'Regionaltåg' | 'Pendeltåg' | 'Lokaltåg' | 'Godståg' | 'Övrigt';

export type StationLineInfo = {
  name: string;
  category: StationLineCategory;
  description?: string;
};

export type StationServices = {
  hasParking: boolean;
  hasRestrooms: boolean;
  hasAccessibility: boolean;
  hasTicketOffice: boolean;
  hasShops: boolean;
};

export type Station = {
  id: string;
  signature: string;
  displayName: string;
  shortDisplayName: string | null;
  officialName: string | null;
  displayNames: string[];
  coordinate: StationCoordinate | null;
  region: StationRegion;
  trafficVolume: StationTrafficVolume;
  lines: StationLineInfo[];
  services: StationServices;
};
