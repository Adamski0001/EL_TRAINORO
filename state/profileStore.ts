import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TrafficEventSeverity } from '../types/traffic';

const STORAGE_KEY = '@trainar/profile-state';
const MAX_RECENTS = 8;

export type SavedStation = {
  id: string;
  label: string;
  direction: string;
  addedAt: number;
};

export type RecentTrainEntry = {
  trainId: string;
  lastViewedAt: number;
};

export type ProfilePreferences = {
  commuteWindow: string;
  impactThreshold: TrafficEventSeverity;
  defaultRegion: string;
  interestTopics: string[];
};

export type ProfileUserInfo = {
  id: string;
  name: string | null;
  tier: string;
  authenticated: boolean;
  accentColor: string | null;
};

export type ProfileStoreState = {
  favorites: string[];
  recentTrains: RecentTrainEntry[];
  savedStations: SavedStation[];
  preferences: ProfilePreferences;
  user: ProfileUserInfo;
  loading: boolean;
  error: string | null;
  lastSynced: Date | null;
};

const DEFAULT_PREFERENCES: ProfilePreferences = {
  commuteWindow: '06:30-09:00',
  impactThreshold: 'medium',
  defaultRegion: 'Sverige',
  interestTopics: [],
};

const DEFAULT_USER: ProfileUserInfo = {
  id: 'guest',
  name: null,
  tier: 'Fri medlem',
  authenticated: false,
  accentColor: null,
};

const DEFAULT_STATE: ProfileStoreState = {
  favorites: [],
  recentTrains: [],
  savedStations: [],
  preferences: DEFAULT_PREFERENCES,
  user: DEFAULT_USER,
  loading: true,
  error: null,
  lastSynced: null,
};

let state: ProfileStoreState = DEFAULT_STATE;
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach(listener => listener());
};

const assignState = (patch: Partial<ProfileStoreState>) => {
  const nextState: ProfileStoreState = { ...state };
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(patch, 'favorites')) {
    const nextFavorites = patch.favorites ?? [];
    if (nextFavorites !== state.favorites) {
      nextState.favorites = nextFavorites;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'recentTrains')) {
    const nextRecents = patch.recentTrains ?? [];
    if (nextRecents !== state.recentTrains) {
      nextState.recentTrains = nextRecents;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'savedStations')) {
    const nextStations = patch.savedStations ?? [];
    if (nextStations !== state.savedStations) {
      nextState.savedStations = nextStations;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'preferences')) {
    const nextPreferences = patch.preferences ?? state.preferences;
    if (nextPreferences !== state.preferences) {
      nextState.preferences = nextPreferences;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'user')) {
    const nextUser = patch.user ?? state.user;
    if (nextUser !== state.user) {
      nextState.user = nextUser;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'loading') && typeof patch.loading === 'boolean') {
    if (patch.loading !== state.loading) {
      nextState.loading = patch.loading;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
    const nextError = patch.error ?? null;
    if (nextError !== state.error) {
      nextState.error = nextError;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'lastSynced')) {
    const nextDate = patch.lastSynced ?? null;
    if ((nextDate && !state.lastSynced) || (!nextDate && state.lastSynced) || (state.lastSynced && nextDate && nextDate.getTime() !== state.lastSynced.getTime())) {
      nextState.lastSynced = nextDate;
      changed = true;
    }
  }

  if (changed) {
    state = nextState;
    emit();
  }
  return changed;
};

const setupPersistQueue = () => {
  let queue: Promise<void> = Promise.resolve();
  return (payload: string) => {
    queue = queue
      .then(() => AsyncStorage.setItem(STORAGE_KEY, payload))
      .then(() => {
        assignState({ lastSynced: new Date(), error: null });
      })
      .catch(error => {
        console.warn('[ProfileStore] persist failed', error);
        assignState({ error: 'Kunde inte spara dina inställningar.' });
      });
  };
};

const persistProfileState = setupPersistQueue();

const hydrateProfileState = async () => {
  assignState({ loading: true });
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProfileStoreState>;
      assignState({
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : state.favorites,
        recentTrains: Array.isArray(parsed.recentTrains) ? parsed.recentTrains : state.recentTrains,
        savedStations: Array.isArray(parsed.savedStations) ? parsed.savedStations : state.savedStations,
        preferences: {
          ...DEFAULT_PREFERENCES,
          ...(parsed.preferences ?? {}),
        },
        user: parsed.user ?? state.user,
      });
    }
  } catch (error) {
    console.warn('[ProfileStore] hydration failed', error);
    assignState({ error: 'Kunde inte läsa dina inställningar.' });
  } finally {
    assignState({ loading: false });
  }
};

const reloadProfileState = () => {
  void hydrateProfileState();
};

const changePreferences = (preferences: Partial<ProfilePreferences>) => {
  const nextPreferences: ProfilePreferences = {
    ...state.preferences,
    ...preferences,
  };
  if (assignState({ preferences: nextPreferences })) {
    persistProfileState(
      JSON.stringify({
        favorites: state.favorites,
        recentTrains: state.recentTrains,
        savedStations: state.savedStations,
        preferences: nextPreferences,
        user: state.user,
      }),
    );
  }
};

const updateUserInfo = (user: Partial<ProfileUserInfo>) => {
  const nextUser: ProfileUserInfo = {
    ...state.user,
    ...user,
  };
  if (assignState({ user: nextUser })) {
    persistProfileState(
      JSON.stringify({
        favorites: state.favorites,
        recentTrains: state.recentTrains,
        savedStations: state.savedStations,
        preferences: state.preferences,
        user: nextUser,
      }),
    );
  }
};

const toggleFavoriteTrain = (trainId: string) => {
  const exists = state.favorites.includes(trainId);
  const nextFavorites = exists
    ? state.favorites.filter(id => id !== trainId)
    : [...state.favorites, trainId];
  if (assignState({ favorites: nextFavorites })) {
    persistProfileState(
      JSON.stringify({
        favorites: nextFavorites,
        recentTrains: state.recentTrains,
        savedStations: state.savedStations,
        preferences: state.preferences,
        user: state.user,
      }),
    );
  }
};

const recordRecentTrain = (trainId: string) => {
  const now = Date.now();
  const filtered = state.recentTrains.filter(entry => entry.trainId !== trainId);
  const nextRecents = [{ trainId, lastViewedAt: now }, ...filtered].slice(0, MAX_RECENTS);
  if (assignState({ recentTrains: nextRecents })) {
    persistProfileState(
      JSON.stringify({
        favorites: state.favorites,
        recentTrains: nextRecents,
        savedStations: state.savedStations,
        preferences: state.preferences,
        user: state.user,
      }),
    );
  }
};

const removeRecentTrain = (trainId: string) => {
  const nextRecents = state.recentTrains.filter(entry => entry.trainId !== trainId);
  if (nextRecents.length === state.recentTrains.length) {
    return;
  }
  if (assignState({ recentTrains: nextRecents })) {
    persistProfileState(
      JSON.stringify({
        favorites: state.favorites,
        recentTrains: nextRecents,
        savedStations: state.savedStations,
        preferences: state.preferences,
        user: state.user,
      }),
    );
  }
};

const addSavedStation = (station: SavedStation) => {
  if (state.savedStations.some(entry => entry.id === station.id)) {
    return;
  }
  const nextStations = [station, ...state.savedStations];
  if (assignState({ savedStations: nextStations })) {
    persistProfileState(
      JSON.stringify({
        favorites: state.favorites,
        recentTrains: state.recentTrains,
        savedStations: nextStations,
        preferences: state.preferences,
        user: state.user,
      }),
    );
  }
};

const removeSavedStation = (stationId: string) => {
  const nextStations = state.savedStations.filter(entry => entry.id !== stationId);
  if (nextStations.length === state.savedStations.length) {
    return;
  }
  if (assignState({ savedStations: nextStations })) {
    persistProfileState(
      JSON.stringify({
        favorites: state.favorites,
        recentTrains: state.recentTrains,
        savedStations: nextStations,
        preferences: state.preferences,
        user: state.user,
      }),
    );
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => state;

void hydrateProfileState();

export const profileStore = {
  subscribe,
  getSnapshot,
};

export {
  toggleFavoriteTrain,
  recordRecentTrain,
  removeRecentTrain,
  addSavedStation,
  removeSavedStation,
  changePreferences as setPreferences,
  updateUserInfo as setUserInfo,
  reloadProfileState,
};
