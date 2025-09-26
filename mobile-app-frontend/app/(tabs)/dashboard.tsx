import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
// import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { API_ENDPOINTS, FALLBACK_URLS } from '@/constants/config';

// Immediate debug logging to see what config is loaded
console.log('🚨 DASHBOARD DEBUG - API_ENDPOINTS loaded:');
console.log('  BASE_URL:', API_ENDPOINTS.BASE_URL);
console.log('  FALLBACK_URLS:', API_ENDPOINTS.FALLBACK_URLS);
console.log('  Full API_ENDPOINTS:', JSON.stringify(API_ENDPOINTS, null, 2));

import {
  fetchDashboardData as fetchDashboardDataFromService,
  syncAndRefreshDashboard,
  DashboardData,
  ActivityLogEntry,
} from '@/services/dashboardService';
// HealthKit sync functions are intentionally not used during pull-to-refresh to keep refresh fast
import { useUserIds } from '@/services/userService';
import { useAutoHealthSync } from '@/services/useAutoHealthSync';
import { quickSyncTodayOnly } from '@/services/healthKit';

const { width } = Dimensions.get('window');

const Dashboard = () => {
  const { getDatabaseUserId } = useUserIds();
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string>('glucose');
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [loadingActivityLogs, setLoadingActivityLogs] = useState(false);
  const [sleepDataQualityIssue, setSleepDataQualityIssue] = useState<any>(null);
  const [sleepWarningVisible, setSleepWarningVisible] = useState(true);
  const [errorInfo, setErrorInfo] = useState<{ message: string; urls: string[] } | null>(null);

  // Initialize user ID
  useEffect(() => {
    const initializeUserId = async () => {
      try {
        const dbUserId = await getDatabaseUserId();
        if (dbUserId) {
          setCurrentUserId(dbUserId);
          console.log('✅ Dashboard: Initialized with database user ID:', dbUserId);
        } else {
          console.error('❌ Dashboard: Failed to get database user ID');
          Alert.alert('Error', 'Unable to identify user. Please try signing in again.');
        }
      } catch (error) {
        console.error('❌ Dashboard: Error getting user ID:', error);
        Alert.alert('Error', 'Unable to identify user. Please try signing in again.');
      }
    };

    initializeUserId();
  }, []);

  const fetchDashboardData = async () => {
    if (!currentUserId) {
      console.log('⏳ Dashboard: Waiting for user ID to be available...');
      return;
    }

    try {
      // setLoading(true) is called in onRefresh or useEffect
      setErrorInfo(null);
      console.log(`🔄 Starting dashboard data fetch for user ${currentUserId}...`);

      // Pass client timezone offset to ensure per-day grouping matches Apple Health UI
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const offsetMinutes = new Date().getTimezoneOffset();
      const sign = offsetMinutes <= 0 ? '+' : '-';
      const absMin = Math.abs(offsetMinutes);
      const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
      const mm = String(absMin % 60).padStart(2, '0');
      const tzOffset = `${sign}${hh}:${mm}`;
      const data = await fetchDashboardDataFromService(7, currentUserId as number, tzOffset);

      console.log('✅ Dashboard data received successfully via service:', {
        glucose_entries: data.glucose?.data?.length || 0,
        sleep_entries: data.sleep?.data?.length || 0,
        activity_entries: data.activity?.data?.length || 0,
      });
      
      // Check if we have fresh data for today
      const today = new Date().toISOString().split('T')[0];
      const hasTodayData = data.activity?.data?.some((entry: any) => entry.date === today) ||
                          data.sleep?.data?.some((entry: any) => entry.date === today);
      
      if (hasTodayData) {
        console.log('📅 Dashboard contains fresh data for today');
      } else {
        console.log('⚠️ Dashboard may not contain today\'s data yet');
      }
      
      setDashboardData(data);
    } catch (error) {
      console.error('❌ Error fetching dashboard data from service:', error);

      setErrorInfo({
        message: (error as Error).message || 'An unknown error occurred.',
        urls: FALLBACK_URLS,
      });

      // Log network details for debugging
      console.log('🔍 Attempted URLs from config:', FALLBACK_URLS);
      console.log('🔍 Error details:', {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchActivityLogs = async () => {
    if (!currentUserId) {
      console.log('⏳ Dashboard: Waiting for user ID to fetch activity logs...');
      return;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        setLoadingActivityLogs(true);
        console.log(`🔄 Fetching comprehensive activity logs for user ${currentUserId} (attempt ${attempt}/${maxRetries})...`);
        
        // Use dynamic URL resolution to find working backend
        const { getBaseUrl } = await import('@/services/api');
        const workingUrl = await getBaseUrl();
        
        const offsetMinutes = new Date().getTimezoneOffset();
        const sign = offsetMinutes <= 0 ? '+' : '-';
        const absMin = Math.abs(offsetMinutes);
        const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
        const mm = String(absMin % 60).padStart(2, '0');
        const tzOffset = `${sign}${hh}:${mm}`;
        console.log(`🔄 Fetching activity logs from: ${workingUrl}/api/activity-logs?days=7&user_id=${currentUserId}&tz_offset=${encodeURIComponent(tzOffset)}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
        
        const response = await fetch(`${workingUrl}/api/activity-logs?days=7&user_id=${currentUserId}&tz_offset=${encodeURIComponent(tzOffset)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ Activity logs received successfully:', {
            total_entries: data.activity_logs?.length || 0,
            manual_entries: data.activity_logs?.filter((log: ActivityLogEntry) => log.type === 'manual').length || 0,
            apple_health_entries: data.activity_logs?.filter((log: ActivityLogEntry) => log.type === 'apple_health').length || 0
          });
          
          // DEBUG: Log first few entries to see what we're getting
          console.log('🔍 First 5 activity log entries:');
          (data.activity_logs || []).slice(0, 5).forEach((log: ActivityLogEntry, index: number) => {
            console.log(`  ${index + 1}. ID: ${log.id}, Type: ${log.type}, Activity: ${log.activity_type}, Source: ${log.source}`);
          });

          setActivityLogs(data.activity_logs || []);
          return; // Success, exit retry loop
        } else {
          throw new Error(`Failed to fetch activity logs: ${response.status} ${response.statusText}`);
        }
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Activity logs fetch attempt ${attempt} failed:`, error.message);
        
        // Check if it's a retryable error
        const isRetryableError = error.name === 'AbortError' || 
                                error.message.includes('Network request failed') ||
                                error.message.includes('fetch') ||
                                (error.message.includes('Failed to fetch') && error.message.includes('50')); // 5xx errors
        
        if (isRetryableError && attempt < maxRetries) {
          const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`⏳ Retrying activity logs fetch in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } else if (!isRetryableError) {
          // Non-retryable error, break out of retry loop
          break;
        }
      } finally {
        setLoadingActivityLogs(false);
      }
    }

    console.error(`❌ All activity logs fetch attempts failed after ${maxRetries} tries`);
    console.error('❌ Final error:', lastError);
    setActivityLogs([]);
  };
  
  const checkSleepDataQuality = async () => {
    if (!currentUserId) {
      console.log('⏳ Dashboard: Waiting for user ID to check sleep data quality...');
      return;
    }

    try {
      console.log(`🔍 Checking sleep data quality for user ${currentUserId}...`);
      
      // Use dynamic URL resolution to find working backend
      const { getBaseUrl } = await import('@/services/api');
      const workingUrl = await getBaseUrl();
      if (!workingUrl) return;
      
      const response = await fetch(`${workingUrl}/api/enhanced-sleep-analysis?days=7&user_id=${currentUserId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        const data = await response.json();
        const analysis = data.analysis;
        
        // Check for significant sleep data quality issues
        if (analysis.sleep_schedule_analysis.truncation_percentage > 25 || 
            analysis.sample_breakdown.asleep_samples === 0) {
          
          setSleepDataQualityIssue({
            truncationPercentage: analysis.sleep_schedule_analysis.truncation_percentage,
            hasAsleepSamples: analysis.sample_breakdown.asleep_samples > 0,
            recommendations: analysis.recommendations
          });
          
          console.log(`⚠️ Sleep data quality issue detected: ${analysis.sleep_schedule_analysis.truncation_percentage}% truncation`);
        } else {
          setSleepDataQualityIssue(null);
          console.log('✅ Sleep data quality looks good');
        }
      }
    } catch (error) {
      console.error('❌ Error checking sleep data quality:', error);
    }
  };

  useEffect(() => {
    if (currentUserId) {
      console.log(`🚀 Dashboard: User ID available (${currentUserId}), starting data fetch...`);
      setLoading(true);
      fetchDashboardData();
      fetchActivityLogs();
      checkSleepDataQuality();
    }
  }, [currentUserId]);

  const onRefresh = async () => {
    // Prevent multiple concurrent refresh operations
    if (refreshing || !currentUserId) {
      console.log('🔄 Refresh skipped - already in progress or no user ID available');
      return;
    }

    setRefreshing(true);

    try {
      // First do a quick sync for today's Apple Health data so archive reflects latest steps
      let timedOut = false;
      try {
        console.log('🚀 Quick sync for today before refreshing dashboard...');
        const result = await quickSyncTodayOnly(currentUserId);
        console.log(`✅ Quick sync result: ${result.success} (${result.message})`);
        timedOut = !result.success && /timed out/i.test(result.message || '');
      } catch (syncErr: any) {
        console.warn('⚠️ Quick sync failed during pull-to-refresh:', syncErr?.message || syncErr);
      }

      // First fetch immediately
      await fetchDashboardData();

      // If the quick sync timed out, the backend may still be committing.
      // Fetch once more shortly after to capture the just-updated archive.
      if (timedOut) {
        await new Promise(res => setTimeout(res, 2000));
        await fetchDashboardData();
      }
    } catch (error) {
      console.error('❌ Error during dashboard refresh:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const getGlucoseColor = (glucose: number) => {
    if (glucose < 70) return '#E53E3E'; // Low - Deeper Red for better contrast
    if (glucose > 180) return '#DD6B20'; // High - Deeper Orange
    return '#319795'; // In range - Deeper Teal
  };

  const getSleepColor = (hours: number) => {
    if (hours < 6) return '#E53E3E'; // Poor sleep - Deeper Red
    if (hours >= 7 && hours <= 9) return '#38A169'; // Good sleep - Deeper Green
    return '#D69E2E'; // Okay sleep - Deeper Yellow
  };

  const getActivityColor = (steps: number) => {
    if (steps < 5000) return '#E53E3E'; // Low activity - Deeper Red
    if (steps >= 10000) return '#38A169'; // High activity - Deeper Green
    return '#D69E2E'; // Moderate activity - Deeper Yellow
  };

  // Enhanced color functions for backgrounds
  const getGlucoseBackground = (glucose: number) => {
    if (glucose < 70) return ['#FED7D7', '#FEB2B2']; // Light to medium red gradient
    if (glucose > 180) return ['#FEEBC8', '#FBD38D']; // Light to medium orange gradient
    return ['#B2F5EA', '#81E6D9']; // Light to medium teal gradient
  };

  const getSleepBackground = (hours: number) => {
    if (hours < 6) return ['#FED7D7', '#FEB2B2']; // Light to medium red gradient
    if (hours >= 7 && hours <= 9) return ['#C6F6D5', '#9AE6B4']; // Light to medium green gradient
    return ['#FAF089', '#F6E05E']; // Light to medium yellow gradient
  };

  const getCaloriesBackground = () => {
    return ['#FEEBC8', '#FBD38D']; // Orange gradient
  };

  const getWalkingBackground = () => {
    return ['#DBEAFE', '#BFDBFE']; // Blue gradient
  };

  const SleepQualityWarning = ({ showInTimeline = false }) => {
    if (!sleepDataQualityIssue) return null;
    
    // Only show in timeline (Sleep Patterns section) if visible
    if (showInTimeline && !sleepWarningVisible) return null;
    
    // Don't show main banner anymore - only in Sleep Patterns
    if (!showInTimeline) return null;
    
    const truncationMsg = sleepDataQualityIssue.truncationPercentage > 25 
      ? `${sleepDataQualityIssue.truncationPercentage}% of your recent sleep sessions end at exactly 7:00 AM. This suggests your Apple Health Sleep Schedule may be cutting off your actual sleep time.`
      : 'Missing detailed sleep tracking data - only basic "time in bed" is available.';
    
    return (
      <View style={styles.timelineSleepWarning}>
        <View style={styles.warningHeader}>
          <Ionicons name="warning" size={20} color="#FF8E53" />
          <Text style={styles.warningTitle}>Sleep Tracking Notice</Text>
        </View>
        
        <Text style={styles.warningDescription}>
          {truncationMsg}
        </Text>
        
        {sleepDataQualityIssue.truncationPercentage > 25 && (
          <View style={styles.warningHighlight}>
            <Text style={styles.warningHighlightText}>
              📊 Impact: {sleepDataQualityIssue.truncationPercentage}% of recent nights may have incomplete data
            </Text>
          </View>
        )}
        
        <View style={styles.warningActions}>
          <Text style={styles.warningActionTitle}>💡 Recommended Actions:</Text>
          {sleepDataQualityIssue.truncationPercentage > 25 && (
            <Text style={styles.warningActionItem}>
              • Extend your Sleep Schedule to 9-10 AM in Apple Health app
            </Text>
          )}
          {!sleepDataQualityIssue.hasAsleepSamples && (
            <Text style={styles.warningActionItem}>
              • Enable Apple Watch sleep tracking for detailed data
            </Text>
          )}
          <Text style={styles.warningActionItem}>
            • This will capture your full sleep duration without artificial cutoffs
          </Text>
        </View>
        
        <TouchableOpacity 
          style={styles.warningDismiss}
          onPress={() => setSleepWarningVisible(false)}
        >
          <Text style={styles.warningDismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const MetricCard = ({ 
    title, 
    value, 
    unit, 
    subtitle, 
    color, 
    icon,
    onPress,
    backgroundGradient 
  }: {
    title: string;
    value: string | number;
    unit: string;
    subtitle?: string;
    color: string;
    icon: string;
    onPress?: () => void;
    backgroundGradient?: string[];
  }) => (
    <TouchableOpacity onPress={onPress} style={styles.metricCard}>
      <View style={[
        styles.cardGradient, 
        backgroundGradient && {
          backgroundColor: backgroundGradient[0],
          borderWidth: 1,
          borderColor: backgroundGradient[1],
        }
      ]}>
        <View style={styles.cardHeader}>
          <Ionicons name={icon as any} size={24} color={color} />
          <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
        </View>
        <Text style={[styles.cardValue, { color }]} numberOfLines={1} ellipsizeMode="tail">
          {value} <Text style={styles.cardUnit}>{unit}</Text>
        </Text>
        {subtitle && <Text style={styles.cardSubtitle} numberOfLines={2} ellipsizeMode="tail">{subtitle}</Text>}
      </View>
    </TouchableOpacity>
  );

  const TimelineItem = ({ 
    date, 
    value, 
    subtitle, 
    color,
    isLast = false 
  }: {
    date: string;
    value: string;
    subtitle?: string;
    color: string;
    isLast?: boolean;
  }) => (
    <View style={styles.timelineItem}>
      <View style={styles.timelineDate}>
        <Text style={styles.timelineDateText}>
          {new Date(date).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
          })}
        </Text>
      </View>
      <View style={[styles.timelineDot, { backgroundColor: color }]} />
      {!isLast && <View style={styles.timelineLine} />}
      <View style={styles.timelineContent}>
        <Text style={[styles.timelineValue, { color }]}>{value}</Text>
        {subtitle && <Text style={styles.timelineSubtitle}>{subtitle}</Text>}
      </View>
    </View>
  );

  const renderGlucoseTimeline = () => {
    if (!dashboardData?.glucose.data.length) return null;
    
    return dashboardData.glucose.data.slice(0, 7).map((item, index) => (
      <TimelineItem
        key={item.date}
        date={item.date}
        value={`${item.avg_glucose} mg/dL`}
        subtitle={`${item.reading_count} readings • ${item.time_in_range_percent}% in range`}
        color={getGlucoseColor(item.avg_glucose)}
        isLast={index === dashboardData.glucose.data.slice(0, 7).length - 1}
      />
    ));
  };

  const renderSleepTimeline = () => {
    if (!dashboardData?.sleep.data.length) return null;
    
    // Log sleep data dates for debugging
    console.log("📅 Sleep data dates:", dashboardData.sleep.data.map(d => d.date));
    
    return (
      <>
        {/* Show sleep quality warning in timeline if issue exists and warning is visible */}
        {sleepDataQualityIssue && sleepWarningVisible && (
          <SleepQualityWarning showInTimeline={true} />
        )}
        
        {dashboardData.sleep.data.slice(0, 7).map((item, index) => (
          <TimelineItem
            key={item.date}
            date={item.date}
            value={item.formatted_sleep}
            subtitle={`${item.bedtime} - ${item.wake_time}`}
            color={getSleepColor(item.sleep_hours)}
            isLast={index === dashboardData.sleep.data.slice(0, 7).length - 1}
          />
        ))}
      </>
    );
  };

  const renderActivityLogs = () => {
    if (loadingActivityLogs) {
      return (
        <View style={styles.noDataContainer}>
          <Text style={styles.noDataText}>Loading activity logs...</Text>
        </View>
      );
    }

    if (!activityLogs.length) {
      return (
        <View style={styles.noDataContainer}>
          <Ionicons name="walk-outline" size={32} color="#CCCCCC" />
          <Text style={styles.noDataText}>No activity logs available</Text>
          <Text style={styles.noDataSubtext}>Start logging activities or sync Apple Health data</Text>
        </View>
      );
    }

    // DEBUG: Log what we're about to render
    console.log(`🎨 Rendering ${activityLogs.length} activity logs. Types breakdown:`);
    const manualCount = activityLogs.filter(log => log.type === 'manual').length;
    const appleHealthCount = activityLogs.filter(log => log.type === 'apple_health').length;
    console.log(`  Manual: ${manualCount}, Apple Health: ${appleHealthCount}`);
    
    return (
      <View>
        {activityLogs.slice(0, 10).map((log, index) => (
          <View key={log.id} style={styles.activityLogItem}>
            <View style={styles.activityLogHeader}>
              <View style={styles.activityLogInfo}>
                <Text style={styles.activityLogDate}>{log.date}</Text>
                <Text style={styles.activityLogTime}>{log.time}</Text>
              </View>
              <View style={[
                styles.activityLogBadge,
                { backgroundColor: log.type === 'manual' ? '#4ECDC4' : '#FFB84D' }
              ]}>
                <Text style={styles.activityLogBadgeText}>
                  {log.type === 'manual' ? 'Manual' : 'Apple Health'}
                </Text>
              </View>
            </View>
            
            <View style={styles.activityLogContent}>
              <View style={styles.activityLogMainInfo}>
                <Ionicons 
                  name={getActivityIcon(log.activity_type)} 
                  size={20} 
                  color="#4ECDC4" 
                  style={styles.activityLogIcon}
                />
                <View style={styles.activityLogDetails}>
                  <Text style={styles.activityLogType}>{log.activity_type}</Text>
                  <Text style={styles.activityLogDescription}>{log.description}</Text>
                </View>
              </View>
              
              {(log.duration_minutes || log.steps || log.calories_burned || log.distance_km) && (
                <View style={styles.activityLogMetrics}>
                  {log.duration_minutes && (
                    <View style={styles.activityLogMetric}>
                      <Ionicons name="time-outline" size={14} color="#666666" />
                      <Text style={styles.activityLogMetricText}>{log.duration_minutes} min</Text>
                    </View>
                  )}
                  {log.steps && (
                    <View style={styles.activityLogMetric}>
                      <Ionicons name="footsteps-outline" size={14} color="#666666" />
                      <Text style={styles.activityLogMetricText}>{typeof log.steps === 'string' ? log.steps : log.steps.toLocaleString()}</Text>
                    </View>
                  )}
                  {log.calories_burned && (
                    <View style={styles.activityLogMetric}>
                      <Ionicons name="flame-outline" size={14} color="#666666" />
                      <Text style={styles.activityLogMetricText}>{log.calories_burned} cal</Text>
                    </View>
                  )}
                  {log.distance_km && (
                    <View style={styles.activityLogMetric}>
                      <Ionicons name="location-outline" size={14} color="#666666" />
                      <Text style={styles.activityLogMetricText}>{log.distance_km} km</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
            
            {index < activityLogs.slice(0, 10).length - 1 && <View style={styles.activityLogSeparator} />}
          </View>
        ))}
        
        {activityLogs.length > 10 && (
          <TouchableOpacity style={styles.viewMoreButton}>
            <Text style={styles.viewMoreText}>View More ({activityLogs.length - 10} more entries)</Text>
            <Ionicons name="chevron-down" size={16} color="#4ECDC4" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const getActivityIcon = (activityType: string): any => {
    const type = activityType.toLowerCase();
    if (type.includes('walk')) return 'walk-outline';
    if (type.includes('run') || type.includes('jog')) return 'walk-outline';
    if (type.includes('gym') || type.includes('strength')) return 'fitness-outline';
    if (type.includes('cycle') || type.includes('bike')) return 'bicycle-outline';
    if (type.includes('swim')) return 'water-outline';
    if (type.includes('step')) return 'footsteps-outline';
    return 'body-outline';
  };

  const renderWalkingRunningTimeline = () => {
    if (!dashboardData?.walking_running.data.length) {
      return (
        <View style={styles.noDataContainer}>
          <Ionicons name="footsteps-outline" size={32} color="#CCCCCC" />
          <Text style={styles.noDataText}>No walking/running data available</Text>
          <Text style={styles.noDataSubtext}>Sync Apple Health data or log manual activities</Text>
        </View>
      );
    }
    
    return dashboardData.walking_running.data.slice(0, 7).map((item, index) => (
      <TimelineItem
        key={item.date}
        date={item.date}
        value={`${item.distance_miles.toFixed(2)} mi`}
        subtitle={`${item.distance_km.toFixed(2)} km • Apple Health data`}
        color="#2C5282"
        isLast={index === dashboardData.walking_running.data.slice(0, 7).length - 1}
      />
    ));
  };

  const renderActivityTimeline = () => {
    if (selectedMetric === 'activity') {
      // Show only last 7 days for Activity History as well
      return (
        <View>
          {renderActivityLogs()}
        </View>
      );
    }

    // Original activity timeline for summary view
    if (!dashboardData?.activity.data.length) {
      return (
        <View style={styles.noDataContainer}>
          <Ionicons name="walk-outline" size={32} color="#CCCCCC" />
          <Text style={styles.noDataText}>No activity data available</Text>
          <Text style={styles.noDataSubtext}>Sync Apple Health data to see activity metrics</Text>
        </View>
      );
    }
    
    // Ensure only last 7 days shown in summary timeline
    return dashboardData.activity.data.slice(0, 7).map((item, index) => (
      <TimelineItem
        key={item.date}
        date={item.date}
        value={`${item.steps.toLocaleString()} steps`}
        subtitle={`Apple Health data${item.calories_burned > 0 ? ` • ${item.calories_burned} cal` : ''}${item.distance_km > 0 ? ` • ${item.distance_km} km` : ''}`}
        color={getActivityColor(item.steps)}
        isLast={index === dashboardData.activity.data.slice(0, 7).length - 1}
      />
    ));
  };

  // Auto Health Sync Hook - DISABLED to prevent database lock conflicts
  // const {
  //   isSyncing: autoSyncing,
  //   lastSyncTime: autoSyncTime,
  //   error: autoSyncError,
  //   triggerManualSync: triggerAutoManualSync,
  // } = useAutoHealthSync({
  //   userId: currentUserId,
  //   syncFn: async (userId: number) => {
  //     // Skip if manual refresh is in progress
  //     if (refreshing) {
  //       console.log('⏭️ Auto-sync skipped - manual refresh in progress');
  //       return;
  //     }
  //     
  //     // Check if Apple Health sync is enabled before syncing
  //     const isSyncEnabled = isAppleHealthSyncEnabledState();
  //     if (isSyncEnabled) {
  //       try {
  //         // For auto-refresh, sync 7 days to maintain historical data
  //         // The backend currently clears all display data for synced types,
  //         // so we need to sync enough days to maintain the dashboard view
  //         await syncLatestHealthDataForDashboard(userId, 7);
  //       } catch (syncError) {
  //         console.error('❌ Auto-sync Apple Health failed:', syncError);
  //         // Continue with dashboard refresh even if sync fails
  //       }
  //     }
  //     
  //     // After syncing (or if sync fails), fetch dashboard data to update UI
  //     await fetchDashboardData();
  //     await fetchActivityLogs();
  //     await checkSleepDataQuality();
  //   },
  //   cooldownMs: 120000, // 2 minutes to reduce database conflicts
  // });

  // Auto-sync indicators disabled; refresh path is fetch-only
  const autoSyncing = false;
  const autoSyncTime = null;
  const autoSyncError = null;
  const triggerAutoManualSync = null;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading your health dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!dashboardData || errorInfo) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="wifi-outline" size={48} color="#FF6B6B" style={styles.errorIcon} />
          <Text style={styles.errorTitle}>Unable to load dashboard data</Text>
          <Text style={styles.errorDescription}>
            Network connection failed. Please check:
          </Text>
          <View style={styles.troubleshootingList}>
            <Text style={styles.troubleshootingItem}>• WiFi connection is active</Text>
            <Text style={styles.troubleshootingItem}>• Device is on same network as computer</Text>
            <Text style={styles.troubleshootingItem}>• Backend server is running</Text>
          </View>
          <Text style={styles.networkInfo}>
            Attempted URLs:
          </Text>
          <View style={styles.urlList}>
            {(errorInfo?.urls || FALLBACK_URLS).map((url, index) => (
              <Text key={index} style={styles.urlItem}>• {url}</Text>
            ))}
          </View>
          <TouchableOpacity onPress={onRefresh} style={styles.retryButton}>
            <Ionicons name="refresh" size={20} color="#FFFFFF" style={styles.retryIcon} />
            <Text style={styles.retryButtonText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Subtle syncing indicator */}
      {autoSyncing && (
        <View style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, backgroundColor: '#FFF8E1', padding: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="sync" size={16} color="#007AFF" style={{ marginRight: 6 }} />
          <Text style={{ color: '#007AFF', fontWeight: '600' }}>Syncing...</Text>
        </View>
      )}
      
      {/* Auto-sync error indicator */}
      {autoSyncError && !autoSyncing && (
        <View style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, backgroundColor: '#FFE5E5', padding: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="alert-circle" size={16} color="#E53E3E" style={{ marginRight: 6 }} />
          <Text style={{ color: '#E53E3E', fontSize: 12, fontWeight: '600' }}>Sync issue</Text>
        </View>
      )}
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Diabetes Dashboard</Text>
          <Text style={styles.subtitle}>
            Last 7 days overview
          </Text>
        </View>

        {/* Key Metrics Cards */}
        <View style={styles.metricsGrid}>
          <MetricCard
            title="Avg Glucose"
            value={dashboardData.glucose.summary.avg_glucose_7_days || 0}
            unit="mg/dL"
            subtitle={`${dashboardData.glucose.summary.avg_time_in_range}% in range`}
            color={getGlucoseColor(dashboardData.glucose.summary.avg_glucose_7_days)}
            backgroundGradient={getGlucoseBackground(dashboardData.glucose.summary.avg_glucose_7_days)}
            icon="water"
            onPress={() => setSelectedMetric('glucose')}
          />
          <MetricCard
            title="Avg Sleep"
            value={dashboardData.sleep.summary.avg_sleep_hours || 0}
            unit="hours"
            subtitle={dashboardData.sleep.summary.sleep_quality_trend}
            color={getSleepColor(dashboardData.sleep.summary.avg_sleep_hours)}
            backgroundGradient={getSleepBackground(dashboardData.sleep.summary.avg_sleep_hours)}
            icon="moon"
            onPress={() => setSelectedMetric('sleep')}
          />
          <MetricCard
            title="Daily Steps"
            value={dashboardData.activity.summary.avg_daily_steps.toLocaleString() || 0}
            unit="avg"
            subtitle={`From Apple Health • ${dashboardData.activity.summary.total_distance_km} km`}
            color="#2B6CB0"
            backgroundGradient={['#EBF8FF', '#BEE3F8']}
            icon="walk"
            onPress={() => setSelectedMetric('activity')}
          />
          <MetricCard
            title="Walking + Running"
            value={dashboardData.walking_running?.summary.avg_daily_distance_miles || 0}
            unit="mi/day"
            subtitle={`Apple Health data • ${dashboardData.walking_running?.summary.total_distance_miles.toFixed(1) || 0} mi total`}
            color="#2C5282"
            backgroundGradient={getWalkingBackground()}
            icon="walk"
            onPress={() => setSelectedMetric('walking_running')}
          />
          <MetricCard
            title="Calories Burned"
            value={dashboardData.activity.summary.avg_daily_calories || 0}
            unit="kcal/day"
            subtitle="Apple Health + Manual entries"
            color="#C05621"
            backgroundGradient={getCaloriesBackground()}
            icon="flame"
            onPress={() => setSelectedMetric('activity')}
          />
        </View>

        {/* Metric Selector */}
        <View style={styles.metricSelector}>
          {[
            { key: 'glucose', label: 'Glucose', icon: 'water' },
            { key: 'sleep', label: 'Sleep', icon: 'moon' },
            { key: 'activity', label: 'Activity', icon: 'walk' },
            { key: 'walking_running', label: 'Walking +\nRunning', icon: 'footsteps' },
          ].map((metric) => (
            <TouchableOpacity
              key={metric.key}
              style={[
                styles.metricTab,
                selectedMetric === metric.key && styles.activeMetricTab,
              ]}
              onPress={() => setSelectedMetric(metric.key)}
            >
              <Ionicons
                name={metric.icon as any}
                size={18}
                color={selectedMetric === metric.key ? '#FFFFFF' : '#666666'}
              />
              <Text
                style={[
                  styles.metricTabText,
                  selectedMetric === metric.key && styles.activeMetricTabText,
                ]}
                numberOfLines={2}
              >
                {metric.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Timeline */}
        <View style={styles.timelineContainer}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineTitle}>
              {selectedMetric === 'glucose' && 'Glucose Levels'}
              {selectedMetric === 'sleep' && 'Sleep Patterns'}
              {selectedMetric === 'activity' && 'Activity History'}
              {selectedMetric === 'walking_running' && 'Walking + Running Distance'}
            </Text>
            
            {/* Sleep data quality indicator in timeline header - only show when issue exists and warning is dismissed */}
            {selectedMetric === 'sleep' && sleepDataQualityIssue && !sleepWarningVisible && (
              <TouchableOpacity 
                style={styles.sleepInfoButton}
                onPress={() => setSleepWarningVisible(true)}
              >
                <Ionicons name="information-circle" size={20} color="#FF8E53" />
              </TouchableOpacity>
            )}
          </View>
          
          <View style={styles.timeline}>
            {selectedMetric === 'glucose' && renderGlucoseTimeline()}
            {selectedMetric === 'sleep' && renderSleepTimeline()}
            {selectedMetric === 'activity' && renderActivityTimeline()}
            {selectedMetric === 'walking_running' && renderWalkingRunningTimeline()}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorIcon: {
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 10,
  },
  errorDescription: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 20,
    textAlign: 'center',
  },
  troubleshootingList: {
    marginBottom: 20,
  },
  troubleshootingItem: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 4,
  },
  networkInfo: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  retryIcon: {
    marginRight: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    padding: 20,
    paddingBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2D3748',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#718096',
    fontWeight: '500',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    marginTop: 10,
    alignItems: 'flex-start',
  },
  metricCard: {
    width: (width - 60) / 2,
    marginBottom: 15,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 6,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  cardGradient: {
    padding: 18,
    backgroundColor: '#FFFFFF',
    height: 140,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5568',
    marginLeft: 8,
    letterSpacing: 0.3,
    flex: 1,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
    lineHeight: 28,
  },
  cardUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: '#718096',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#718096',
    lineHeight: 13,
    fontWeight: '500',
    marginTop: 2,
    height: 26,
  },
  metricSelector: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 15,
    marginBottom: 25,
    gap: 12,
  },
  metricTab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    minHeight: 70,
  },
  activeMetricTab: {
    backgroundColor: '#007AFF',
    elevation: 4,
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  metricTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666666',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 14,
  },
  activeMetricTabText: {
    color: '#FFFFFF',
  },
  timelineContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  timelineTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333333',
  },
  timeline: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    position: 'relative',
  },
  timelineDate: {
    width: 60,
    marginRight: 16,
  },
  timelineDateText: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '600',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 16,
    marginTop: 4,
  },
  timelineLine: {
    position: 'absolute',
    left: 76,
    top: 16,
    width: 2,
    height: 40,
    backgroundColor: '#E0E0E0',
  },
  timelineContent: {
    flex: 1,
  },
  timelineValue: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  timelineSubtitle: {
    fontSize: 12,
    color: '#888888',
  },
  noDataContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noDataText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999999',
    marginTop: 12,
  },
  noDataSubtext: {
    fontSize: 14,
    color: '#CCCCCC',
    marginTop: 4,
    textAlign: 'center',
  },
  urlList: {
    marginBottom: 15,
  },
  urlItem: {
    fontSize: 12,
    color: '#888888',
    marginBottom: 2,
  },
  activityLogItem: {
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  activityLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  activityLogInfo: {
    flex: 1,
  },
  activityLogDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
  },
  activityLogTime: {
    fontSize: 12,
    color: '#666666',
    marginTop: 2,
  },
  activityLogBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  activityLogBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  activityLogContent: {
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  activityLogMainInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  activityLogIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  activityLogDetails: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  activityLogType: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 2,
  },
  activityLogDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 18,
  },
  activityLogMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    backgroundColor: 'transparent',
  },
  activityLogMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    marginBottom: 4,
    backgroundColor: 'transparent',
  },
  activityLogMetricText: {
    fontSize: 12,
    color: '#666666',
    marginLeft: 4,
  },
  activityLogSeparator: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginTop: 12,
  },
  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  viewMoreText: {
    fontSize: 14,
    color: '#4ECDC4',
    fontWeight: '500',
    marginRight: 4,
  },
  timelineSleepWarning: {
    backgroundColor: '#FFF8E1',
    borderLeftWidth: 4,
    borderLeftColor: '#FF8E53',
    padding: 16,
    marginBottom: 20,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E65100',
    marginLeft: 8,
  },
  warningDescription: {
    fontSize: 14,
    color: '#5D4037',
    lineHeight: 20,
    marginBottom: 12,
  },
  warningActions: {
    marginBottom: 12,
  },
  warningActionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5D4037',
    marginBottom: 6,
  },
  warningActionItem: {
    fontSize: 13,
    color: '#6D4C41',
    marginBottom: 3,
  },
  warningDismiss: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FF8E53',
    borderRadius: 6,
  },
  warningDismissText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  warningHighlight: {
    backgroundColor: 'rgba(255, 142, 83, 0.1)',
    padding: 10,
    borderRadius: 6,
    marginVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FF8E53',
  },
  warningHighlightText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E65100',
  },
  sleepInfoButton: {
    padding: 8,
    borderRadius: 16,
    backgroundColor: '#FFF8E1',
    marginLeft: 12,
  },
});

export default Dashboard; 