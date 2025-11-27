import { useCallback, useSyncExternalStore } from 'react';

import {
  profileStore,
  recordRecentTrain,
  removeRecentTrain,
  toggleFavoriteTrain,
  addSavedStation,
  removeSavedStation,
  setPreferences as changePreferences,
  setUserInfo as updateUserInfo,
  reloadProfileState,
} from '../state/profileStore';

export function useUserProfile() {
  const snapshot = useSyncExternalStore(
    profileStore.subscribe,
    profileStore.getSnapshot,
    profileStore.getSnapshot,
  );

  const toggleFavorite = useCallback((trainId: string) => {
    toggleFavoriteTrain(trainId);
  }, []);

  const recordRecent = useCallback((trainId: string) => {
    recordRecentTrain(trainId);
  }, []);

  const removeRecent = useCallback((trainId: string) => {
    removeRecentTrain(trainId);
  }, []);

  const addStation = useCallback((station: Parameters<typeof addSavedStation>[0]) => {
    addSavedStation(station);
  }, []);

  const removeStation = useCallback((stationId: string) => {
    removeSavedStation(stationId);
  }, []);

  const updatePreferences = useCallback((preferences: Parameters<typeof changePreferences>[0]) => {
    changePreferences(preferences);
  }, []);

  const updateUser = useCallback((user: Parameters<typeof updateUserInfo>[0]) => {
    updateUserInfo(user);
  }, []);

  const reload = useCallback(() => {
    reloadProfileState();
  }, []);

  return {
    ...snapshot,
    toggleFavoriteTrain: toggleFavorite,
    recordRecentTrain: recordRecent,
    removeRecentTrain: removeRecent,
    addSavedStation: addStation,
    removeSavedStation: removeStation,
    setPreferences: updatePreferences,
    setUserInfo: updateUser,
    reloadProfile: reload,
  };
}
