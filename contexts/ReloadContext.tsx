import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { trainPositionsStore } from '../state/trainPositionsStore';
import { trafficEventsStore } from '../state/trafficEventsStore';

type ReloadContextValue = {
  reloadApp: () => Promise<void>;
  lastReloadedAt: Date | null;
};

const ReloadContext = createContext<ReloadContextValue | null>(null);

const ReloadBoundary = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};

export function ReloadProvider({ children }: { children: ReactNode }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [lastReloadedAt, setLastReloadedAt] = useState<Date | null>(null);

  const reloadApp = useCallback(async () => {
    trainPositionsStore.reset();
    trafficEventsStore.reset();
    setReloadKey(key => key + 1);
    setLastReloadedAt(new Date());
  }, []);

  const value = useMemo(
    () => ({
      reloadApp,
      lastReloadedAt,
    }),
    [lastReloadedAt, reloadApp],
  );

  return (
    <ReloadContext.Provider value={value}>
      <ReloadBoundary key={reloadKey}>{children}</ReloadBoundary>
    </ReloadContext.Provider>
  );
}

export function useReloadApp() {
  const context = useContext(ReloadContext);
  if (!context) {
    throw new Error('useReloadApp must be used within a ReloadProvider');
  }
  return context.reloadApp;
}

export function useReloadInfo() {
  const context = useContext(ReloadContext);
  if (!context) {
    throw new Error('useReloadInfo must be used within a ReloadProvider');
  }
  return {
    lastReloadedAt: context.lastReloadedAt,
  };
}
