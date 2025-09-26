/**
 * CGM Service for handling Continuous Glucose Monitor connections and data syncing
 * Uses the mobile-optimized backend endpoints for better reliability on mobile networks
 */

import { BACKEND_URL, FALLBACK_URLS } from '@/constants/config';
import { testNetworkConnectivity } from '@/constants/networkUtils';

export interface CGMConnectionResult {
  success: boolean;
  cgmType?: string;
  region?: string;
  currentGlucose?: {
    value: number;
    trend: string;
    trendArrow: string;
    timestamp: string;
  };
  error?: string;
  message?: string;
  timestamp?: string;
}

export interface CGMStatus {
  connected: boolean;
  cgmType?: string;
  region?: string;
  username?: string;
  lastSync?: string;
  error?: string;
}

export interface GlucoseReading {
  value: number;
  trend?: string;
  trendArrow?: string;
  timestamp: string;
}

/**
 * Get a working backend URL by testing connectivity
 */
const getWorkingBackendUrl = async (): Promise<string> => {
  console.log('🔍 CGM Service: Testing backend connectivity...');
  
  // Always try the primary URL first
  const urlsToTest = [BACKEND_URL, ...FALLBACK_URLS.filter(url => url !== BACKEND_URL)];
  
  const networkInfo = await testNetworkConnectivity(urlsToTest, 1);
  
  if (networkInfo.workingUrl) {
    console.log(`✅ CGM Service: Using working backend URL: ${networkInfo.workingUrl}`);
    return networkInfo.workingUrl;
  }
  
  console.warn('⚠️ CGM Service: No backend URLs are reachable, using primary URL as fallback');
  return BACKEND_URL;
};

/**
 * Connect to a CGM device using mobile-optimized endpoint
 */
export const connectCGM = async (
  clerkUserId: string,
  username: string,
  password: string,
  cgmType: string,
  region: string = 'us',
  timeoutMs: number = 45000
): Promise<CGMConnectionResult> => {
  console.log('🔗 CGM Service: Starting connection:', {
    cgmType,
    username: username.substring(0, 3) + '***',
    region,
    timestamp: new Date().toISOString()
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    // Get a working backend URL first
    const workingBackendUrl = await getWorkingBackendUrl();
    
    const response = await fetch(`${workingBackendUrl}/api/connect-cgm-mobile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clerk_user_id: clerkUserId,
        username,
        password,
        cgm_type: cgmType,
        region,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const data = await response.json();
    
    console.log('📊 CGM Service: Connection response:', {
      status: response.status,
      success: data.success,
      cgmType: data.cgmType,
      hasGlucose: !!data.currentGlucose,
      timestamp: data.timestamp
    });

    return data;
    
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    console.error('❌ CGM Service: Connection failed:', {
      error: error.message,
      name: error.name,
      timestamp: new Date().toISOString()
    });
    
    // Transform fetch errors into user-friendly messages
    let errorMessage = 'Unable to connect to CGM device.';
    let errorTitle = 'Connection Failed';
    
    if (error.name === 'AbortError') {
      errorTitle = 'Connection Timeout';
      errorMessage = 'Connection timed out. Try connecting to WiFi for better connectivity or restart the app.';
    } else if (error.message?.includes('Network request failed')) {
      errorTitle = 'Network Error';
      errorMessage = 'Network connection failed. Please ensure you\'re connected to the same WiFi network as your computer, or try restarting the backend server.';
    } else if (error.message?.includes('fetch') || error.message?.includes('TypeError')) {
      errorTitle = 'Server Connection Error';
      errorMessage = 'Unable to reach the backend server. Please check:\n• Backend server is running on http://192.168.1.138:3001\n• You\'re on the same WiFi network\n• Try restarting the app';
    }
    
    return {
      success: false,
      error: `${errorTitle}: ${errorMessage}`,
      message: errorMessage,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Check current CGM connection status
 */
export const getCGMStatus = async (clerkUserId: string): Promise<CGMStatus> => {
  try {
    const workingBackendUrl = await getWorkingBackendUrl();
    const response = await fetch(`${workingBackendUrl}/api/cgm-status?clerk_user_id=${clerkUserId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (response.ok && data.connected) {
      return {
        connected: true,
        cgmType: data.cgm_type,
        region: data.region,
        username: data.username,
        lastSync: data.last_sync_at,
      };
    } else {
      return {
        connected: false,
        error: data.error || 'No CGM connection found'
      };
    }
  } catch (error: any) {
    console.error('❌ CGM Service: Status check failed:', error);
    return {
      connected: false,
      error: 'Unable to check CGM status'
    };
  }
};

/**
 * Test existing CGM connection and get current glucose
 */
export const testCGMConnection = async (clerkUserId: string): Promise<GlucoseReading | null> => {
  try {
    const workingBackendUrl = await getWorkingBackendUrl();
    const response = await fetch(`${workingBackendUrl}/api/test-cgm-connection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clerk_user_id: clerkUserId,
      }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      return {
        value: data.glucose,
        trend: data.trend,
        timestamp: data.datetime,
      };
    } else {
      console.warn('⚠️ CGM Service: Test connection failed:', data.error);
      return null;
    }
  } catch (error: any) {
    console.error('❌ CGM Service: Test connection failed:', error);
    return null;
  }
};

/**
 * Disconnect CGM device
 */
export const disconnectCGM = async (clerkUserId: string): Promise<boolean> => {
  try {
    const workingBackendUrl = await getWorkingBackendUrl();
    const response = await fetch(`${workingBackendUrl}/api/disconnect-cgm`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clerk_user_id: clerkUserId,
      }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log('✅ CGM Service: Disconnected successfully');
      return true;
    } else {
      console.error('❌ CGM Service: Disconnect failed:', data.error);
      return false;
    }
  } catch (error: any) {
    console.error('❌ CGM Service: Disconnect failed:', error);
    return false;
  }
};

/**
 * Sync glucose data from CGM (manual sync)
 */
export const syncGlucoseData = async (clerkUserId: string): Promise<GlucoseReading[]> => {
  try {
    // Test connection first to get current glucose
    const currentGlucose = await testCGMConnection(clerkUserId);
    
    if (currentGlucose) {
      console.log('✅ CGM Service: Manual sync successful:', currentGlucose);
      return [currentGlucose];
    } else {
      console.warn('⚠️ CGM Service: Manual sync - no glucose data available');
      return [];
    }
  } catch (error: any) {
    console.error('❌ CGM Service: Manual sync failed:', error);
    return [];
  }
};

/**
 * Auto-sync glucose data at regular intervals
 * This is handled by the backend, but we can trigger manual syncs
 */
export const setupAutoSync = (
  clerkUserId: string,
  intervalMinutes: number = 15,
  onGlucoseUpdate?: (glucose: GlucoseReading) => void,
  onError?: (error: string) => void
): (() => void) => {
  console.log(`🔄 CGM Service: Setting up auto-sync every ${intervalMinutes} minutes`);
  
  const syncInterval = setInterval(async () => {
    try {
      const glucose = await testCGMConnection(clerkUserId);
      if (glucose && onGlucoseUpdate) {
        onGlucoseUpdate(glucose);
      }
    } catch (error: any) {
      console.error('❌ CGM Service: Auto-sync error:', error);
      if (onError) {
        onError('Failed to sync glucose data');
      }
    }
  }, intervalMinutes * 60 * 1000);
  
  // Return cleanup function
  return () => {
    console.log('🛑 CGM Service: Stopping auto-sync');
    clearInterval(syncInterval);
  };
};

/**
 * Backfill historical glucose data for the specified number of days
 */
export const backfillHistoricalData = async (
  clerkUserId: string,
  days: number = 7
): Promise<{ success: boolean; readings_added: number; message?: string; error?: string }> => {
  console.log(`📊 CGM Service: Starting ${days}-day historical backfill`);
  
  try {
    const workingBackendUrl = await getWorkingBackendUrl();
    const response = await fetch(`${workingBackendUrl}/api/backfill-cgm-historical`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clerk_user_id: clerkUserId,
        days,
      }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log(`✅ CGM Service: Historical backfill completed - ${data.readings_added} readings added`);
      return {
        success: true,
        readings_added: data.readings_added,
        message: data.message,
      };
    } else {
      console.error('❌ CGM Service: Historical backfill failed:', data.error);
      return {
        success: false,
        readings_added: 0,
        error: data.error || 'Historical backfill failed',
      };
    }
  } catch (error: any) {
    console.error('❌ CGM Service: Historical backfill error:', error);
    
    let errorMessage = 'Unable to backfill historical data.';
    if (error.message?.includes('Network request failed')) {
      errorMessage = 'Network connection failed. Please check your internet connection.';
    } else if (error.message?.includes('fetch')) {
      errorMessage = 'Unable to reach the server. Please check your internet connection.';
    }
    
    return {
      success: false,
      readings_added: 0,
      error: errorMessage,
    };
  }
};

export default {
  connectCGM,
  getCGMStatus,
  testCGMConnection,
  disconnectCGM,
  syncGlucoseData,
  setupAutoSync,
  backfillHistoricalData,
};