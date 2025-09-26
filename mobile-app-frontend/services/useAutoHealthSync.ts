import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

interface UseAutoHealthSyncOptions {
  userId: number | null;
  syncFn: (userId: number) => Promise<any>;
  cooldownMs?: number;
}

export const useAutoHealthSync = ({ userId, syncFn, cooldownMs = 60000 }: UseAutoHealthSyncOptions) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;

  // Helper to trigger sync if cooldown passed
  const maybeSync = useCallback(async () => {
    if (!userId) return;
    const now = Date.now();
    if (isSyncing) return;
    if (lastSyncTime && now - lastSyncTime < cooldownMs) return;
    
    setIsSyncing(true);
    setError(null);
    
    try {
      await syncFn(userId);
      setLastSyncTime(Date.now());
      retryCountRef.current = 0; // Reset retry count on success
    } catch (err: any) {
      const errorMessage = err?.message || 'Sync failed';
      console.log(`⚠️ Auto-sync failed: ${errorMessage}`);
      
      // Check for database lock errors
      if (errorMessage.includes('Deadlock') || errorMessage.includes('Lock wait timeout') || errorMessage.includes('Aborted')) {
        retryCountRef.current += 1;
        
        if (retryCountRef.current < MAX_RETRIES) {
          console.log(`🔄 Will retry sync (attempt ${retryCountRef.current}/${MAX_RETRIES}) after delay...`);
          // Exponential backoff: 2s, 4s, 8s
          const retryDelay = Math.pow(2, retryCountRef.current) * 1000;
          setTimeout(() => {
            if (!isSyncing) {
              maybeSync();
            }
          }, retryDelay);
        } else {
          console.log(`❌ Max retries (${MAX_RETRIES}) reached. Stopping auto-sync attempts.`);
          setError('Multiple sync failures. Please refresh manually.');
          retryCountRef.current = 0;
        }
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [userId, syncFn, cooldownMs, lastSyncTime, isSyncing]);

  // Manual trigger
  const triggerManualSync = useCallback(async () => {
    if (!userId) return;
    setIsSyncing(true);
    setError(null);
    try {
      await syncFn(userId);
      setLastSyncTime(Date.now());
    } catch (err: any) {
      setError(err?.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  }, [userId, syncFn]);

  // Focus effect: sync on focus
  useFocusEffect(
    useCallback(() => {
      maybeSync();
      // Start timer
      timerRef.current = setInterval(maybeSync, cooldownMs);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }, [maybeSync, cooldownMs])
  );

  // AppState effect: sync on foreground
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        maybeSync();
      }
      appState.current = nextAppState;
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [maybeSync]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return {
    isSyncing,
    lastSyncTime,
    error,
    triggerManualSync,
  };
}; 