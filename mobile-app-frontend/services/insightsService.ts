import { API_ENDPOINTS } from '@/constants/config';
import { getBaseUrl } from './api';

// TypeScript interfaces for insights
export interface UserMetrics {
  glucose: {
    averageToday: number | null;
    averageYesterday: number | null;
    morningRise?: {
      detected: boolean;
      riseAmount: number;
      timeRange: string;
      daysInRow: number;
    };
    timeInRange: {
      today: number | null; // percentage
      yesterday: number | null;
    };
    highestReading: number | null;
    lowestReading: number | null;
    totalReadings: number;
    lastReading?: {
      value: number;
      timestamp: string;
    };
  };
  meals: {
    totalCarbs: number;
    totalCalories: number;
    mealCount: number;
    lastMeal?: {
      description: string;
      type: string;
      carbs: number;
      timestamp: string;
    };
    postMealResponse?: {
      averageSpike: number;
      maxSpike: number;
      timeToReturn: number; // minutes
    };
  };
  activity: {
    totalSteps: number;
    totalMinutes: number;
    activitiesLogged: number;
    caloriesBurned: number;
    lastActivity?: {
      type: string;
      duration: number;
      timestamp: string;
    };
  };
  sleep: {
    lastNightHours: number | null;
    averageThisWeek: number | null;
    quality: 'good' | 'average' | 'poor' | null;
  };
  predictions: {
    nextHourTrend: 'rising' | 'stable' | 'falling' | null;
    confidence: number; // 0-1
    riskLevel: 'low' | 'moderate' | 'high';
  };
}

export interface GeneratedInsight {
  id: string;
  type: 'positive' | 'neutral' | 'warning' | 'tip';
  icon: string;
  title: string;
  description: string;
  priority: number; // 1-5, higher is more important
  isAIGenerated: boolean;
  fallbackUsed?: boolean;
}

export interface InsightsResponse {
  success: boolean;
  insights: GeneratedInsight[];
  metrics: UserMetrics;
  generatedAt: string;
  llmUsed: boolean;
  fallbackReason?: string;
  error?: string;
}

// Cache for insights to avoid excessive API calls
interface InsightsCache {
  data: InsightsResponse | null;
  timestamp: number;
  isValid: boolean;
}

let insightsCache: InsightsCache = {
  data: null,
  timestamp: 0,
  isValid: false
};

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Check if cached insights are still valid
 */
function isCacheValid(): boolean {
  const now = Date.now();
  const cacheAge = now - insightsCache.timestamp;
  return insightsCache.isValid && cacheAge < CACHE_DURATION && insightsCache.data !== null;
}

/**
 * Generate fallback insights using rule-based logic
 */
function generateFallbackInsights(metrics: UserMetrics): GeneratedInsight[] {
  const insights: GeneratedInsight[] = [];

  // Morning rise detection
  if (metrics.glucose.morningRise?.detected) {
    insights.push({
      id: 'morning-rise',
      type: 'warning',
      icon: '🌅',
      title: 'Dawn Phenomenon Detected',
      description: `Your glucose has risen ${metrics.glucose.morningRise.riseAmount} mg/dL in the morning for ${metrics.glucose.morningRise.daysInRow} days. Consider discussing timing of long-acting insulin with your doctor.`,
      priority: 4,
      isAIGenerated: false,
      fallbackUsed: true
    });
  }

  // Time in range comparison
  if (metrics.glucose.timeInRange.today !== null && metrics.glucose.timeInRange.yesterday !== null) {
    const improvement = metrics.glucose.timeInRange.today - metrics.glucose.timeInRange.yesterday;
    if (improvement > 5) {
      insights.push({
        id: 'time-in-range-improvement',
        type: 'positive',
        icon: '✅',
        title: 'Great Time in Range Progress',
        description: `You've improved your time in range by ${improvement.toFixed(1)}% compared to yesterday. Keep up the excellent work!`,
        priority: 3,
        isAIGenerated: false,
        fallbackUsed: true
      });
    } else if (improvement < -10) {
      insights.push({
        id: 'time-in-range-decline',
        type: 'warning',
        icon: '⚠️',
        title: 'Time in Range Needs Attention',
        description: `Your time in range decreased by ${Math.abs(improvement).toFixed(1)}% today. Review your meal timing and activity levels.`,
        priority: 4,
        isAIGenerated: false,
        fallbackUsed: true
      });
    }
  }

  // Activity insights
  if (metrics.activity.totalSteps > 8000) {
    insights.push({
      id: 'activity-goal',
      type: 'positive',
      icon: '🚶‍♂️',
      title: 'Step Goal Achievement',
      description: `Excellent! You've taken ${metrics.activity.totalSteps.toLocaleString()} steps today. Regular activity helps improve glucose control.`,
      priority: 2,
      isAIGenerated: false,
      fallbackUsed: true
    });
  } else if (metrics.activity.totalSteps < 3000) {
    insights.push({
      id: 'activity-encouragement',
      type: 'tip',
      icon: '💪',
      title: 'Activity Opportunity',
      description: `Consider a short walk after your next meal. Even 10-15 minutes can help with glucose management.`,
      priority: 3,
      isAIGenerated: false,
      fallbackUsed: true
    });
  }

  // Meal response insights
  if (metrics.meals.postMealResponse && metrics.meals.postMealResponse.averageSpike > 50) {
    insights.push({
      id: 'meal-response',
      type: 'warning',
      icon: '🍽️',
      title: 'Post-Meal Glucose Spikes',
      description: `Your average post-meal spike today was ${metrics.meals.postMealResponse.averageSpike} mg/dL. Consider smaller portions or pre-meal activity.`,
      priority: 4,
      isAIGenerated: false,
      fallbackUsed: true
    });
  }

  // Sleep quality insights
  if (metrics.sleep.lastNightHours && metrics.sleep.lastNightHours < 6) {
    insights.push({
      id: 'sleep-quality',
      type: 'tip',
      icon: '😴',
      title: 'Sleep Impact on Glucose',
      description: `You had ${metrics.sleep.lastNightHours} hours of sleep. Poor sleep can affect glucose control. Aim for 7-9 hours nightly.`,
      priority: 3,
      isAIGenerated: false,
      fallbackUsed: true
    });
  }

  // Default insight if none generated
  if (insights.length === 0) {
    insights.push({
      id: 'default-encouragement',
      type: 'positive',
      icon: '🎯',
      title: 'Keep Going Strong',
      description: 'You\'re actively monitoring your health. Consistency in logging meals, activity, and glucose is key to better management.',
      priority: 2,
      isAIGenerated: false,
      fallbackUsed: true
    });
  }

  // Sort by priority (highest first) and limit to 3
  return insights.sort((a, b) => b.priority - a.priority).slice(0, 3);
}

/**
 * Fetch insights from backend with caching and fallback logic
 */
export async function fetchTodaysInsights(forceRefresh: boolean = false): Promise<InsightsResponse> {
  // Return cached data if valid and not forcing refresh
  if (!forceRefresh && isCacheValid() && insightsCache.data) {
    console.log('📊 Returning cached insights');
    return insightsCache.data;
  }

  try {
    console.log('🔍 Fetching fresh insights from backend...');
    const baseUrl = await getBaseUrl();
    const response = await fetch(`${baseUrl}/api/insights`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: InsightsResponse = await response.json();
    
    if (data.success) {
      // Cache successful response
      insightsCache = {
        data,
        timestamp: Date.now(),
        isValid: true
      };
      console.log('✅ Insights fetched successfully, cached for 30 minutes');
      return data;
    } else {
      throw new Error(data.error || 'Backend returned unsuccessful response');
    }

  } catch (error) {
    console.error('❌ Error fetching insights from backend:', error);
    
    // Attempt to fetch basic metrics for fallback
    try {
      const fallbackMetrics = await fetchBasicMetricsForFallback();
      const fallbackInsights = generateFallbackInsights(fallbackMetrics);
      
      const fallbackResponse: InsightsResponse = {
        success: true,
        insights: fallbackInsights,
        metrics: fallbackMetrics,
        generatedAt: new Date().toISOString(),
        llmUsed: false,
        fallbackReason: `API Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };

      console.log('🔄 Generated fallback insights using rule-based logic');
      return fallbackResponse;

    } catch (fallbackError) {
      console.error('❌ Fallback insights generation failed:', fallbackError);
      
      // Return minimal response with basic insights
      const minimalResponse: InsightsResponse = {
        success: false,
        insights: [{
          id: 'system-error',
          type: 'neutral',
          icon: '📱',
          title: 'Keep Up the Good Work',
          description: 'Continue logging your meals, glucose, and activity. We\'ll analyze your patterns as more data becomes available.',
          priority: 1,
          isAIGenerated: false,
          fallbackUsed: true
        }],
        metrics: getEmptyMetrics(),
        generatedAt: new Date().toISOString(),
        llmUsed: false,
        fallbackReason: `Complete failure: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: 'Unable to generate insights at this time'
      };

      return minimalResponse;
    }
  }
}

/**
 * Fetch basic metrics for fallback insights
 */
async function fetchBasicMetricsForFallback(): Promise<UserMetrics> {
  const baseUrl = await getBaseUrl();
  
  // Fetch basic glucose history
  const glucoseResponse = await fetch(`${baseUrl}/api/glucose-history`);
  const glucoseData = glucoseResponse.ok ? await glucoseResponse.json() : { glucose_logs: [] };
  
  // Process glucose data for basic metrics
  const glucoseLogs = glucoseData.glucose_logs || [];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const todayLogs = glucoseLogs.filter((log: any) => {
    const logDate = new Date(log.timestamp);
    return logDate.toDateString() === today.toDateString();
  });

  const yesterdayLogs = glucoseLogs.filter((log: any) => {
    const logDate = new Date(log.timestamp);
    return logDate.toDateString() === yesterday.toDateString();
  });

  const calculateAverage = (logs: any[]) => {
    if (logs.length === 0) return null;
    const sum = logs.reduce((acc: number, log: any) => acc + parseFloat(log.glucose_level), 0);
    return parseFloat((sum / logs.length).toFixed(1));
  };

  const calculateTimeInRange = (logs: any[]) => {
    if (logs.length === 0) return null;
    const inRange = logs.filter((log: any) => {
      const level = parseFloat(log.glucose_level);
      return level >= 70 && level <= 180;
    });
    return parseFloat(((inRange.length / logs.length) * 100).toFixed(1));
  };

  return {
    glucose: {
      averageToday: calculateAverage(todayLogs),
      averageYesterday: calculateAverage(yesterdayLogs),
      timeInRange: {
        today: calculateTimeInRange(todayLogs),
        yesterday: calculateTimeInRange(yesterdayLogs)
      },
      highestReading: todayLogs.length > 0 ? Math.max(...todayLogs.map((log: any) => parseFloat(log.glucose_level))) : null,
      lowestReading: todayLogs.length > 0 ? Math.min(...todayLogs.map((log: any) => parseFloat(log.glucose_level))) : null,
      totalReadings: todayLogs.length
    },
    meals: {
      totalCarbs: 0,
      totalCalories: 0,
      mealCount: 0
    },
    activity: {
      totalSteps: 0,
      totalMinutes: 0,
      activitiesLogged: 0,
      caloriesBurned: 0
    },
    sleep: {
      lastNightHours: null,
      averageThisWeek: null,
      quality: null
    },
    predictions: {
      nextHourTrend: null,
      confidence: 0,
      riskLevel: 'low'
    }
  };
}

/**
 * Get empty metrics structure
 */
function getEmptyMetrics(): UserMetrics {
  return {
    glucose: {
      averageToday: null,
      averageYesterday: null,
      timeInRange: { today: null, yesterday: null },
      highestReading: null,
      lowestReading: null,
      totalReadings: 0
    },
    meals: {
      totalCarbs: 0,
      totalCalories: 0,
      mealCount: 0
    },
    activity: {
      totalSteps: 0,
      totalMinutes: 0,
      activitiesLogged: 0,
      caloriesBurned: 0
    },
    sleep: {
      lastNightHours: null,
      averageThisWeek: null,
      quality: null
    },
    predictions: {
      nextHourTrend: null,
      confidence: 0,
      riskLevel: 'low'
    }
  };
}

/**
 * Clear insights cache (useful after logging new data)
 */
export function clearInsightsCache(): void {
  insightsCache.isValid = false;
  console.log('🗑️ Insights cache cleared');
}

/**
 * Get cache status for debugging
 */
export function getCacheStatus(): { isValid: boolean; age: number; hasData: boolean } {
  const age = Date.now() - insightsCache.timestamp;
  return {
    isValid: insightsCache.isValid,
    age,
    hasData: insightsCache.data !== null
  };
} 