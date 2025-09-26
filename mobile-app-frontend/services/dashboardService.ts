import { API_ENDPOINTS } from '@/constants/config';
import { performFullHealthSync, quickSyncTodayOnly } from './healthKit';
import { getBaseUrl } from './api';

export interface ActivityLogEntry {
  id: string;
  date: string;
  time: string;
  type: 'manual' | 'apple_health';
  activity_type: string;
  description: string;
  duration_minutes?: number;
  steps?: number;
  calories_burned?: number;
  distance_km?: number;
  source: string;
}

export interface DashboardData {
  date_range: {
    start_date: string;
    end_date: string;
    days: number;
  };
  glucose: {
    data: Array<{
      date: string;
      avg_glucose: number;
      min_glucose: number;
      max_glucose: number;
      reading_count: number;
      time_in_range_percent: number;
    }>;
    summary: {
      avg_glucose_15_days: number;
      avg_glucose_7_days: number;
      avg_time_in_range: number;
      total_readings: number;
    };
  };
  sleep: {
    data: Array<{
      date: string;
      sleep_hours: number;
      formatted_sleep: string;
      bedtime: string;
      wake_time: string;
    }>;
    summary: {
      avg_sleep_hours: number;
      sleep_quality_trend: string;
    };
  };
  activity: {
    data: Array<{
      date: string;
      steps: number;
      calories_burned: number;
      distance_km: number;
    }>;
    summary: {
      avg_daily_steps: number;
      avg_daily_calories: number;
      total_distance_km: number;
    };
  };
  walking_running: {
    data: Array<{
      date: string;
      distance_km: number;
      distance_miles: number;
    }>;
    summary: {
      avg_daily_distance_km: number;
      avg_daily_distance_miles: number;
      total_distance_km: number;
      total_distance_miles: number;
    };
  };
  health_metrics: {
    weight: Array<{ date: string; value: number; unit: string }>;
    heart_rate: Array<{ date: string; avg_value: number; unit: string }>;
    resting_heart_rate: Array<{ date: string; value: number; unit: string }>;
  };
  lifestyle: {
    meals: Array<{
      date: string;
      meal_count: number;
      avg_carbs: number;
      total_carbs: number;
    }>;
    medications: Array<{
      date: string;
      medication_count: number;
    }>;
  };
  activity_logs?: ActivityLogEntry[];
}

/**
 * Fetch comprehensive dashboard data for diabetes management
 */
export const fetchDashboardData = async (days: number = 15, userId?: number, tzOffset?: string): Promise<DashboardData> => {
  if (!userId) {
    throw new Error('User ID is required to fetch dashboard data');
  }
  
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Fetching dashboard data (attempt ${attempt}/${maxRetries})`);
      
      // Use dynamic URL resolution instead of static BASE_URL
      const baseUrl = await getBaseUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const tzParam = tzOffset ? `&tz_offset=${encodeURIComponent(tzOffset)}` : '';
      const response = await fetch(
        `${baseUrl}/api/diabetes-dashboard?days=${days}&user_id=${userId}${tzParam}`,
        {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`✅ Dashboard data fetched successfully (${days} days, user ${userId})`);
      return data;
      
    } catch (error: any) {
      lastError = error;
      console.error(`❌ Dashboard fetch attempt ${attempt} failed:`, error.message);
      
      // Check if it's a retryable error
      const isRetryableError = error.name === 'AbortError' || 
                              error.message.includes('Network request failed') ||
                              error.message.includes('fetch') ||
                              (error.message.includes('HTTP error') && error.message.includes('50')); // 5xx errors
      
      if (isRetryableError && attempt < maxRetries) {
        const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`⏳ Retrying dashboard fetch in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      } else if (!isRetryableError) {
        // Non-retryable error, break out of retry loop
        break;
      }
    }
  }
  
  console.error(`❌ All dashboard fetch attempts failed after ${maxRetries} tries`);
  throw lastError || new Error('Failed to fetch dashboard data after multiple attempts');
};

/**
 * Sync latest health data from Apple Health and refresh dashboard
 */
export const syncAndRefreshDashboard = async (days: number = 15, userId?: number): Promise<DashboardData> => {
  if (!userId) {
    throw new Error('User ID is required to sync dashboard data');
  }
  
  let syncSuccess = false;
  let dashboardData: DashboardData;
  
  try {
    console.log('🔄 Starting health data sync and dashboard refresh...');
    
    // Step 1: Quick sync today's data first for immediate feedback
    try {
      console.log('🚀 Starting quick sync for today\'s data...');
      const quickSyncResult = await quickSyncTodayOnly(userId);
      if (quickSyncResult.success) {
        console.log('✅ Quick sync completed - today\'s data available');
        syncSuccess = true;
      } else {
        console.warn('⚠️ Quick sync failed:', quickSyncResult.message);
      }
    } catch (quickSyncError) {
      console.warn('⚠️ Quick sync failed:', quickSyncError);
    }

    // Step 2: Attempt full sync in background (non-blocking)
    // Don't await this - let it run in background while we show today's data
    performFullHealthSync(15, userId).then(() => {
      console.log('✅ Background full sync completed');
      syncSuccess = true;
    }).catch((syncError) => {
      console.warn('⚠️ Background full sync failed:', syncError);
      // This doesn't affect the immediate user experience
    });
    
         // Step 3: Sleep summary is now refreshed automatically on the backend within the sync endpoint.
     // This call is no longer needed and the endpoint is disabled.
     // const refreshResponse = await fetch(`${API_ENDPOINTS.BASE_URL}/refresh-sleep-summary`, {
     //   method: 'POST',
     //   headers: { 'Content-Type': 'application/json' },
     //   body: JSON.stringify({ user_id: userId })
     // });
     
     // if (!refreshResponse.ok) {
     //   console.warn('Warning: Failed to refresh sleep summary');
     // }
     
     // Step 4: Fetch updated dashboard data (this should work even if sync failed)
    try {
      dashboardData = await fetchDashboardData(days, userId);
      
      if (syncSuccess) {
        console.log('✅ Health data sync and dashboard refresh completed successfully');
      } else {
        console.log('⚠️ Dashboard loaded with existing data (sync failed but data is available)');
      }
      
      return dashboardData;
      
    } catch (dashboardError) {
      console.error('❌ Failed to fetch dashboard data:', dashboardError);
      
      // If dashboard fetch fails, try with fewer days as fallback
      if (days > 7) {
        console.log('🔄 Retrying dashboard fetch with fewer days...');
        try {
          dashboardData = await fetchDashboardData(7, userId);
          console.log('✅ Dashboard loaded with reduced date range');
          return dashboardData;
        } catch (fallbackError) {
          console.error('❌ Fallback dashboard fetch also failed:', fallbackError);
        }
      }
      
      throw dashboardError;
    }
    
  } catch (error) {
    console.error('❌ Critical error during sync and refresh:', error);
    throw error;
  }
};

/**
 * Get glucose level color based on value
 */
export const getGlucoseColor = (glucose: number): string => {
  if (glucose < 70) return '#FF6B6B'; // Low - Red
  if (glucose > 180) return '#FF8E53'; // High - Orange
  return '#4ECDC4'; // In range - Teal
};

/**
 * Get sleep quality color based on hours
 */
export const getSleepColor = (hours: number): string => {
  if (hours < 6) return '#FF6B6B'; // Poor sleep - Red
  if (hours >= 7 && hours <= 9) return '#4ECDC4'; // Good sleep - Teal
  return '#FFE66D'; // Okay sleep - Yellow
};

/**
 * Get activity level color based on steps
 */
export const getActivityColor = (steps: number): string => {
  if (steps < 5000) return '#FF6B6B'; // Low activity - Red
  if (steps >= 10000) return '#4ECDC4'; // High activity - Teal
  return '#FFE66D'; // Moderate activity - Yellow
};

/**
 * Format date for timeline display
 */
export const formatTimelineDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  });
};

/**
 * Calculate diabetes management score based on recent metrics
 */
export const calculateManagementScore = (dashboardData: DashboardData): {
  score: number;
  grade: string;
  recommendations: string[];
} => {
  let score = 0;
  const recommendations: string[] = [];
  
  // Glucose management (40% weight)
  const timeInRange = dashboardData.glucose.summary.avg_time_in_range;
  if (timeInRange >= 70) {
    score += 40;
  } else if (timeInRange >= 50) {
    score += 25;
    recommendations.push('Improve glucose control - aim for 70%+ time in range');
  } else {
    score += 10;
    recommendations.push('Focus on glucose management - consider medication adjustments');
  }
  
  // Sleep quality (25% weight)
  const avgSleep = dashboardData.sleep.summary.avg_sleep_hours;
  if (avgSleep >= 7 && avgSleep <= 9) {
    score += 25;
  } else if (avgSleep >= 6) {
    score += 15;
    recommendations.push('Aim for 7-9 hours of sleep per night');
  } else {
    score += 5;
    recommendations.push('Prioritize better sleep - poor sleep affects glucose control');
  }
  
  // Activity level (25% weight)
  const avgSteps = dashboardData.activity.summary.avg_daily_steps;
  if (avgSteps >= 10000) {
    score += 25;
  } else if (avgSteps >= 7500) {
    score += 18;
    recommendations.push('Try to reach 10,000 steps daily');
  } else if (avgSteps >= 5000) {
    score += 12;
    recommendations.push('Increase daily activity - exercise helps glucose control');
  } else {
    score += 5;
    recommendations.push('Focus on increasing daily movement and exercise');
  }
  
  // Consistency (10% weight) - based on data completeness
  const dataPoints = dashboardData.glucose.data.length + dashboardData.sleep.data.length + dashboardData.activity.data.length;
  if (dataPoints >= 35) { // ~80% of possible data points for 15 days
    score += 10;
  } else if (dataPoints >= 25) {
    score += 7;
    recommendations.push('Try to maintain consistent health data tracking');
  } else {
    score += 3;
    recommendations.push('Improve health data tracking consistency');
  }
  
  // Determine grade
  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';
  
  return { score, grade, recommendations };
};

export default {
  fetchDashboardData,
  syncAndRefreshDashboard,
  getGlucoseColor,
  getSleepColor,
  getActivityColor,
  formatTimelineDate,
  calculateManagementScore,
}; 