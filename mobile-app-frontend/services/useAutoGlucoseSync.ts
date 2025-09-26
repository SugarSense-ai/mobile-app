/**
 * Auto Glucose Sync Hook
 * Automatically syncs glucose data from connected CGM devices
 * Uses the mobile-optimized backend endpoints
 */

import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@clerk/clerk-expo';
import { getCGMStatus, testCGMConnection, GlucoseReading } from './cgmService';

interface AutoGlucoseSyncState {
  isConnected: boolean;
  isLoading: boolean;
  latestGlucose: GlucoseReading | null;
  lastSyncTime: Date | null;
  syncCount: number;
  error: string | null;
  cgmType?: string;
  region?: string;
}

interface AutoGlucoseSyncOptions {
  intervalMinutes?: number;
  enabled?: boolean;
  onGlucoseUpdate?: (glucose: GlucoseReading) => void;
  onError?: (error: string) => void;
  onConnectionStatusChange?: (connected: boolean) => void;
}

/**
 * Hook for automatic glucose data syncing
 */
export const useAutoGlucoseSync = (options: AutoGlucoseSyncOptions = {}) => {
  const { user } = useUser();
  const {
    intervalMinutes = 15,
    enabled = true,
    onGlucoseUpdate,
    onError,
    onConnectionStatusChange
  } = options;

  const [state, setState] = useState<AutoGlucoseSyncState>({
    isConnected: false,
    isLoading: false,
    latestGlucose: null,
    lastSyncTime: null,
    syncCount: 0,
    error: null,
  });

  /**
   * Check CGM connection status
   */
  const checkConnectionStatus = useCallback(async () => {
    if (!user?.id) return;

    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const status = await getCGMStatus(user.id);
      
      setState(prev => ({
        ...prev,
        isConnected: status.connected,
        cgmType: status.cgmType,
        region: status.region,
        isLoading: false,
        error: status.connected ? null : status.error || 'No CGM connected'
      }));

      if (onConnectionStatusChange) {
        onConnectionStatusChange(status.connected);
      }

      return status.connected;
    } catch (error: any) {
      console.error('❌ Auto Glucose Sync: Failed to check connection status:', error);
      setState(prev => ({
        ...prev,
        isConnected: false,
        isLoading: false,
        error: 'Failed to check CGM connection status'
      }));
      
      if (onError) {
        onError('Failed to check CGM connection status');
      }
      
      return false;
    }
  }, [user?.id, onConnectionStatusChange, onError]);

  /**
   * Sync glucose data from CGM
   */
  const syncGlucoseData = useCallback(async () => {
    if (!user?.id || !state.isConnected) return null;

    try {
      console.log('🔄 Auto Glucose Sync: Fetching latest glucose...');
      
      const glucose = await testCGMConnection(user.id);
      
      if (glucose) {
        console.log('✅ Auto Glucose Sync: Got glucose data:', {
          value: glucose.value,
          trend: glucose.trend,
          timestamp: glucose.timestamp
        });
        
        setState(prev => ({
          ...prev,
          latestGlucose: glucose,
          lastSyncTime: new Date(),
          syncCount: prev.syncCount + 1,
          error: null
        }));

        if (onGlucoseUpdate) {
          onGlucoseUpdate(glucose);
        }

        return glucose;
      } else {
        console.warn('⚠️ Auto Glucose Sync: No glucose data available');
        setState(prev => ({
          ...prev,
          lastSyncTime: new Date(),
          error: 'No glucose data available'
        }));
        
        return null;
      }
    } catch (error: any) {
      console.error('❌ Auto Glucose Sync: Failed to sync glucose:', error);
      setState(prev => ({
        ...prev,
        lastSyncTime: new Date(),
        error: 'Failed to sync glucose data'
      }));
      
      if (onError) {
        onError('Failed to sync glucose data');
      }
      
      return null;
    }
  }, [user?.id, state.isConnected, onGlucoseUpdate, onError]);

  /**
   * Manual sync trigger
   */
  const manualSync = useCallback(async () => {
    if (!enabled) return null;
    
    console.log('🔄 Auto Glucose Sync: Manual sync triggered');
    
    // Check connection first
    const isConnected = await checkConnectionStatus();
    if (!isConnected) {
      return null;
    }
    
    // Then sync glucose
    return await syncGlucoseData();
  }, [enabled, checkConnectionStatus, syncGlucoseData]);

  /**
   * Setup automatic syncing
   */
  useEffect(() => {
    if (!enabled || !user?.id) return;

    console.log(`🔄 Auto Glucose Sync: Starting auto-sync every ${intervalMinutes} minutes`);

    // Initial connection check
    checkConnectionStatus();

    // Setup interval for automatic syncing
    const syncInterval = setInterval(async () => {
      console.log('⏰ Auto Glucose Sync: Interval sync triggered');
      
      // Check connection status periodically
      const isConnected = await checkConnectionStatus();
      if (isConnected) {
        await syncGlucoseData();
      }
    }, intervalMinutes * 60 * 1000);

    // Cleanup
    return () => {
      console.log('🛑 Auto Glucose Sync: Stopping auto-sync');
      clearInterval(syncInterval);
    };
  }, [enabled, user?.id, intervalMinutes, checkConnectionStatus, syncGlucoseData]);

  /**
   * Initial sync when hook mounts
   */
  useEffect(() => {
    if (enabled && user?.id) {
      console.log('🚀 Auto Glucose Sync: Initial sync on mount');
      // Delay initial sync slightly to avoid race conditions
      const timer = setTimeout(() => {
        manualSync();
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [enabled, user?.id, manualSync]);

  return {
    // State
    isConnected: state.isConnected,
    isLoading: state.isLoading,
    latestGlucose: state.latestGlucose,
    lastSyncTime: state.lastSyncTime,
    syncCount: state.syncCount,
    error: state.error,
    cgmType: state.cgmType,
    region: state.region,
    
    // Actions
    manualSync,
    checkConnectionStatus,
    
    // Helper functions
    getTimeSinceLastSync: () => {
      if (!state.lastSyncTime) return null;
      return Math.floor((Date.now() - state.lastSyncTime.getTime()) / 1000 / 60); // minutes
    },
    
    isGlucoseDataFresh: (maxAgeMinutes: number = 30) => {
      if (!state.latestGlucose || !state.lastSyncTime) return false;
      const ageMinutes = (Date.now() - state.lastSyncTime.getTime()) / 1000 / 60;
      return ageMinutes <= maxAgeMinutes;
    }
  };
};

export default useAutoGlucoseSync;