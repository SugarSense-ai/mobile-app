import React, { useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Modal,
  TextInput,
  Button,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Alert,
  TouchableWithoutFeedback,
  Image,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { styles } from '@/styles/prediction.styles';
import { API_ENDPOINTS } from '@/constants/config';
import { getBaseUrl } from '@/services/api';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { fetchTodaysInsights, clearInsightsCache, InsightsResponse, GeneratedInsight } from '@/services/insightsService';

const { width } = Dimensions.get('window');

/**
 * Formats a Date object into a MySQL-compatible DATETIME string in the user's local timezone.
 * @param date The Date object to format.
 * @returns A string in 'YYYY-MM-DD HH:MM:SS' format.
 */
function formatToMySQLDateTime(date: Date): string {
  const YYYY = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

const dummyGlucoseData: any = {
  labels: ['00', '03', '06', '09', '12', '15', '18', 'Now', '+1h', '+2h', '+3h'],
  datasets: [
    {
      data: [120, 105, 130, 160, 145, 135, 150, 170, 185, 195, 180],
      color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, // Modern blue
      strokeWidth: 3,
      withDots: true,
      withShadow: true,
    },
    {
      data: [null, null, null, null, null, null, null, 170, 180, 196, 175],
      color: (opacity = 1) => `rgba(251, 113, 133, ${opacity})`, // Modern coral
      strokeWidth: 3,
      withDots: true,
      withShadow: false,
    },
  ],
  legend: ['Measured', 'SugarSense.ai Prediction'],
};

// Modern chart configuration with gradients and better styling
const chartConfig = {
  backgroundColor: '#ffffff',
  backgroundGradientFrom: '#ffffff',
  backgroundGradientTo: '#fafbfc',
  color: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
  strokeWidth: 3,
  barPercentage: 0.5,
  useShadowColorFromDataset: true,
  decimalPlaces: 0,
  fillShadowGradient: 'rgba(59, 130, 246, 0.1)',
  fillShadowGradientOpacity: 0.3,
  propsForBackgroundLines: {
    strokeDasharray: "3,3",
    stroke: 'rgba(156, 163, 175, 0.3)',
    strokeWidth: 1,
  },
  propsForDots: {
    r: '5',
    strokeWidth: '3',
    stroke: '#ffffff',
    fill: '#3b82f6',
    fillOpacity: 1,
    strokeOpacity: 1,
  },
  propsForLabels: {
    fontSize: '13',
    fontWeight: '500',
  },
  xAxisLabelTextStyle: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
  },
  yAxisLabelTextStyle: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
  },
  yAxisSuffix: '',
  yAxisInterval: 50,
  segments: 4,
  paddingTop: 20,
  paddingRight: 50,
};

const sendLogData = async (endpoint: string, data: any) => {
  try {
    // Use dynamic URL resolution instead of static BASE_URL
    const baseUrl = await getBaseUrl();
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Failed to log data to ${endpoint}`);
    }
    // Success handled by toast inside component
    return true;
  } catch (error: any) {
    console.error(`Error logging data to ${endpoint}:`, error);
    Alert.alert("Error", error.message || `Failed to log data to ${endpoint}. Please try again.`);
    return false;
  }
};

// Modern data for different granularities with enhanced styling
const chartDataByGranularity = {
  hourly: {
    labels: ['00', '03', '06', '09', '12', '15', '18', 'Now', '+1h', '+2h', '+3h'],
    datasets: [
      {
        data: [120, 105, 130, 160, 145, 135, 150, 170, 185, 195, 180],
        color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, // Modern blue gradient
        strokeWidth: 3,
        withDots: true,
        withShadow: true,
        withInnerLines: false,
      },
      {
        data: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, 170, 180, 196, 175],
        color: (opacity = 1) => `rgba(251, 113, 133, ${opacity})`, // Modern coral
        strokeWidth: 3,
        withDots: true,
        withShadow: false,
        strokeDashArray: [8, 4], // Dashed line for predictions
      },
    ],
    legend: ['Measured Glucose', 'AI Prediction'],
  },
  '15min': {
    labels: ['00', '03', '06', '09', '12', '15', '18', 'Now', '+15m', '+30m', '+45m', '+1h', '+1h15m', '+1h30m', '+1h45m', '+2h'],
    datasets: [
      {
        data: [120, 105, 130, 160, 145, 135, 150, 170, 172, 175, 178, 180, 182, 185, 190, 195],
        color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
        strokeWidth: 3,
        withDots: true,
        withShadow: true,
        withInnerLines: false,
      },
      {
        data: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, 170, 172, 174, 176, 180, 185, 190, 193, 196],
        color: (opacity = 1) => `rgba(251, 113, 133, ${opacity})`,
        strokeWidth: 3,
        withDots: true,
        withShadow: false,
        strokeDashArray: [8, 4],
      },
    ],
    legend: ['Measured Glucose', 'AI Prediction'],
  },
  '5min': {
    labels: ['00', '03', '06', '09', '12', '15', '18', 'Now', '+5m', '+10m', '+15m', '+20m', '+25m', '+30m', '+35m', '+40m', '+45m', '+50m', '+55m', '+1h'],
    datasets: [
      {
        data: [120, 105, 130, 160, 145, 135, 150, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 182, 185],
        color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
        strokeWidth: 3,
        withDots: true,
        withShadow: true,
        withInnerLines: false,
      },
      {
        data: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182],
        color: (opacity = 1) => `rgba(251, 113, 133, ${opacity})`,
        strokeWidth: 3,
        withDots: true,
        withShadow: false,
        strokeDashArray: [8, 4],
      },
    ],
    legend: ['Measured Glucose', 'AI Prediction'],
  },
};

type ChartKitDataset = {
  data: number[];
  color: (opacity?: number) => string;
  strokeWidth: number;
};

type ChartKitData = {
  labels: string[];
  datasets: ChartKitDataset[];
  legend: string[];
};

function cleanChartData(rawData: ChartKitData): ChartKitData {
  return {
    ...rawData,
    datasets: rawData.datasets.map((ds: ChartKitDataset) => ({
      ...ds,
      data: ds.data.map((v: number) => {
        // Convert NaN, null, undefined to 0 for safe chart rendering
        if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) {
          return 0;
        }
        if (typeof v === 'number' && isFinite(v)) {
          return v;
        }
        return 0;
      }),
    })),
  };
}

export default function PredictionDashboard(){
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [loggingType, setLoggingType] = useState<'meal' | 'activity' | 'glucose' | 'medication' | null>(null);
  const [logDetails, setLogDetails] = useState<any>({});

  // State for AI Meal Logging
  const [mealImage, setMealImage] = useState<string | null>(null);
  const [mealAnalysis, setMealAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // New state for AI analysis error message
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // New state for meal logging method selection
  const [mealLoggingMethod, setMealLoggingMethod] = useState<'photo' | 'manual' | null>(null);

  // New state variables for prediction and glucose history
  const [currentGlucose, setCurrentGlucose] = useState<number | null>(null);
  const [predictedLevels, setPredictedLevels] = useState<number[]>([]);
  const [glucoseHistory, setGlucoseHistory] = useState<Array<{ timestamp: Date; value: number }>>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [recentCarbs, setRecentCarbs] = useState<number>(0);
  const [recentActivityMinutes, setRecentActivityMinutes] = useState<number>(0);
  const [recentSleepQuality, setRecentSleepQuality] = useState<'good' | 'average' | 'poor'>('average');
  const [showOtherActivityInput, setShowOtherActivityInput] = useState(false); // New state for 'Other' activity
  const [isActivityDropdownOpen, setIsActivityDropdownOpen] = useState(false); // New state for dropdown visibility
  const [isMealTypeDropdownOpen, setIsMealTypeDropdownOpen] = useState(false); // New state for meal type dropdown

  // New state for glucose logging date/time
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // New state for medication logging
  const [medicationDetails, setMedicationDetails] = useState<any>({});
  const [isMedicationTypeDropdownOpen, setIsMedicationTypeDropdownOpen] = useState(false);
  const [isInsulinTypeDropdownOpen, setIsInsulinTypeDropdownOpen] = useState(false);
  const [showInsulinDosageInput, setShowInsulinDosageInput] = useState(false);
  const [isInjectionSiteDropdownOpen, setIsInjectionSiteDropdownOpen] = useState(false);
  
  // New state for injection site recommendation
  const [injectionRecommendation, setInjectionRecommendation] = useState<{
    site: string;
    reason: string;
    fallback?: boolean;
  } | null>(null);
  const [isLoadingRecommendation, setIsLoadingRecommendation] = useState<boolean>(false);
  const [showRecommendation, setShowRecommendation] = useState<boolean>(true);

  // New state for chart granularity
  const [granularity, setGranularity] = useState<'hourly' | '15min' | '5min'>('hourly');

  // New state for tooltip and selected point
  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number; label: string; datasetIndex: number; pointIndex: number } | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<{ datasetIndex: number; pointIndex: number } | null>(null);
  
  // New state for today's stats
  const [todaysStats, setTodaysStats] = useState<{
    averageGlucose: number | null;
    timeInRange: number | null;
    highestReading: number | null;
    lowestReading: number | null;
  }>({
    averageGlucose: null,
    timeInRange: null,
    highestReading: null,
    lowestReading: null,
  });

  // New state for dynamic insights
  const [insights, setInsights] = useState<GeneratedInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState<boolean>(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [lastInsightsRefresh, setLastInsightsRefresh] = useState<Date | null>(null);
  const chartWidth = width - 40;
  const chartHeight = 200;

  // --- Toast State ---
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  useEffect(() => {
    if (toastMessage) {
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setTimeout(() => {
          Animated.timing(toastOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => {
            setToastMessage(null);
          });
        }, 2500);
      });
    }
  }, [toastMessage]);

  // Function to generate dynamic chart data based on glucose history and predictions
  const generateDynamicChartData = (granularityType: 'hourly' | '15min' | '5min') => {
    console.log('🎯 Generating chart data for granularity:', granularityType);
    console.log('📊 Current glucose history length:', glucoseHistory.length);
    console.log('📊 Current glucose value:', currentGlucose);
    console.log('📊 Predicted levels length:', predictedLevels.length);
    
    const now = new Date();
    const baseData = chartDataByGranularity[granularityType];
    
    // If we have no glucose history and no current glucose, use fallback
    if (glucoseHistory.length === 0 && currentGlucose === null) {
      console.log('⚠️ No glucose data available, using base chart data');
      return baseData;
    }
    
    // Create a simplified approach: show recent glucose readings + predictions
    const labels: string[] = [];
    const measuredData: number[] = [];
    const predictionData: number[] = [];
    
    // Use glucose history as the source of truth for measured data.
    // This prevents adding a duplicate "current" glucose reading.
    const recentReadings = [...glucoseHistory];
    
    // Sort by timestamp to ensure proper chronological order
    recentReadings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    console.log('📈 Deduplicated readings to display:', recentReadings);
    
    // For simplicity, let's show the last few actual readings + predictions
    const maxHistoricalPoints = 8;
    const recentPoints = recentReadings.slice(-maxHistoricalPoints);
    
    // Create labels for historical data
    recentPoints.forEach((reading, index) => {
      const isLast = index === recentPoints.length - 1;
      
      // Intelligently skip labels to prevent overlap, based on granularity.
      // We'll show fewer labels for broader time ranges.
      const labelInterval = granularityType === 'hourly' ? 3 : granularityType === '15min' ? 2 : 1;
      let label = '';

      // Always show the first label, the last ("Now"), and interval-based labels.
      if (isLast) {
        label = 'Now';
      } else if (index === 0 || index % labelInterval === 0) {
        label = reading.timestamp.getHours().toString().padStart(2, '0') + ':' + 
                reading.timestamp.getMinutes().toString().padStart(2, '0');
      }
      
      labels.push(label);
      measuredData.push(reading.value);
      predictionData.push(0); // No predictions for historical data
    });
    
    // Add prediction labels and data
    const predictionLabels = granularityType === 'hourly' ? ['+1h', '+2h', '+3h'] :
                            granularityType === '15min' ? ['+15m', '+30m', '+45m', '+1h'] :
                            ['+5m', '+10m', '+15m', '+20m'];
    
    predictionLabels.forEach((label, index) => {
      labels.push(label);
      measuredData.push(0); // No measured data for future
      if (predictedLevels.length > index) {
        predictionData.push(predictedLevels[index]);
      } else {
        // Fallback prediction based on current glucose
        const baseValue = currentGlucose || 120;
        predictionData.push(baseValue + (Math.random() - 0.5) * 20);
      }
    });
    
    console.log('📊 Generated labels:', labels);
    console.log('📊 Generated measured data:', measuredData);
    console.log('📊 Generated prediction data:', predictionData);
    
    return {
      labels,
      datasets: [
        {
          ...baseData.datasets[0],
          data: measuredData,
        },
        {
          ...baseData.datasets[1],
          data: predictionData,
        },
      ],
      legend: baseData.legend,
    };
  };

  // Function to compute today's stats from glucose history
  const computeTodaysStats = () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    // Filter glucose history for today's readings only
    const todaysReadings = glucoseHistory.filter(reading => {
      const readingTime = new Date(reading.timestamp);
      return readingTime >= startOfToday && readingTime <= endOfToday;
    });
    
    console.log('📊 Computing today\'s stats from', todaysReadings.length, 'readings');
    
    if (todaysReadings.length === 0) {
      console.log('⚠️ No readings available for today');
      setTodaysStats({
        averageGlucose: null,
        timeInRange: null,
        highestReading: null,
        lowestReading: null,
      });
      return;
    }
    
    // Extract glucose values
    const glucoseValues = todaysReadings.map(reading => reading.value);
    
    // Calculate average glucose
    const averageGlucose = parseFloat((
      glucoseValues.reduce((sum, value) => sum + value, 0) / glucoseValues.length
    ).toFixed(1));
    
    // Calculate time in range (70-180 mg/dL)
    const readingsInRange = glucoseValues.filter(value => value >= 70 && value <= 180);
    const timeInRange = parseFloat(((readingsInRange.length / glucoseValues.length) * 100).toFixed(1));
    
    // Calculate highest and lowest readings
    const highestReading = Math.max(...glucoseValues);
    const lowestReading = Math.min(...glucoseValues);
    
    console.log('📈 Computed stats:', {
      averageGlucose,
      timeInRange: `${timeInRange}%`,
      highestReading,
      lowestReading,
      totalReadings: glucoseValues.length
    });
    
    setTodaysStats({
      averageGlucose,
      timeInRange,
      highestReading,
      lowestReading,
    });
  };

  // Cleaned chart data for current granularity with dynamic updates
  const cleanedChartData = cleanChartData(generateDynamicChartData(granularity));

  // --- AI Meal Analysis Functions ---

  const handleImagePicker = async () => {
    // Request permissions
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Sorry, we need camera roll permissions to make this work!');
      return;
    }

    // Launch image picker
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8, // Compress image for faster upload
      base64: true, // We need base64 for the API
    });

    if (!result.canceled && result.assets && result.assets[0].uri) {
      setMealImage(result.assets[0].uri);
      // Automatically trigger analysis
      if (result.assets[0].base64) {
        analyzeMealImage(result.assets[0].base64);
      }
    }
  };

  const analyzeMealImage = async (base64Image: string) => {
    setIsAnalyzing(true);
    setMealAnalysis(null);
    setAnalysisError(null); // Reset previous errors
    try {
      console.log('🖼️ Sending image to Gemini for analysis...');
      const response = await fetch(`${API_ENDPOINTS.BASE_URL}/gemini-analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: base64Image,
          prompt_type: 'food_analysis' // Specify the type of analysis
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        console.log('✅ AI analysis successful:', result.analysis);
        
        const nutritional_values = result.analysis.nutritional_values || {};

        // Pre-fill logDetails with the analysis
        setMealAnalysis(result.analysis);
        setLogDetails({
          meal_type: result.analysis.meal_type || 'Lunch', // Default to Lunch
          food_description: result.analysis.description || '',
          calories: String(nutritional_values.calories || '0'),
          carbs: String(nutritional_values.carbs_g || '0'),
          sugar: String(nutritional_values.sugar_g || '0'),
          fiber: String(nutritional_values.fiber_g || '0'),
          protein: String(nutritional_values.protein_g || '0'),
          fat: String(nutritional_values.fat_g || '0'),
          ingredients: result.analysis.ingredients || [],
        });
      } else {
        // Handle both network errors and explicit API errors (e.g., not food)
        const errorMessage = result.error || 'Failed to analyze meal.';
        console.error('❌ Analysis failed:', errorMessage);
        setAnalysisError(errorMessage);
        // Clear out details to prevent saving invalid data
        setLogDetails({});
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.error('💥 Error analyzing meal image:', error);
      // The error is already set, just need to alert the user if we want
      // Alert.alert('Analysis Failed', error.message || 'Could not analyze the image. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Function to fetch glucose history from backend
  const fetchGlucoseHistory = async () => {
    try {
      console.log('🔍 Starting glucose history fetch...');
      setIsLoadingHistory(true);
      
      // Use dynamic URL resolution instead of static BASE_URL
      const baseUrl = await getBaseUrl();
      const url = `${baseUrl}/api/glucose-history`;
      console.log('🌐 Fetching from URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('📡 Response status:', response.status);
      console.log('📡 Response ok:', response.ok);
      
      if (response.ok) {
        const data = await response.json();
        console.log('📊 Raw response data:', JSON.stringify(data, null, 2));
        
        if (data.success && data.glucose_logs && Array.isArray(data.glucose_logs)) {
          console.log(`📈 Processing ${data.glucose_logs.length} glucose records...`);
          
          // Convert timestamps and sort by time
          const historyData = data.glucose_logs.map((log: any) => {
            console.log('🔄 Processing log:', log);
            return {
              timestamp: new Date(log.timestamp),
              value: parseFloat(log.glucose_level)
            };
          }).sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());
          
          console.log('✅ Processed glucose history:', historyData);
          setGlucoseHistory(historyData);
          
          // Set current glucose to the most recent reading
          if (historyData.length > 0) {
            const mostRecent = historyData[historyData.length - 1];
            setCurrentGlucose(mostRecent.value);
            console.log('📈 Current glucose set to:', mostRecent.value, 'at', mostRecent.timestamp);
          } else {
            console.log('⚠️ No glucose data available - setting current glucose to null');
            setCurrentGlucose(null);
          }
        } else {
          console.log('⚠️ Invalid response format or no glucose logs:', data);
          setGlucoseHistory([]);
          setCurrentGlucose(null);
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to fetch glucose history:', response.status, errorText);
        setGlucoseHistory([]);
        setCurrentGlucose(null);
      }
    } catch (error) {
      console.error('💥 Error fetching glucose history:', error);
      setGlucoseHistory([]);
      setCurrentGlucose(null);
    } finally {
      setIsLoadingHistory(false);
      console.log('🏁 Glucose history fetch completed');
    }
  };

  // Function to fetch glucose prediction
  const fetchGlucosePrediction = async (glucose: number | null, carbs: number, activity: number, sleep: string) => {
    if (glucose === null) return; // Cannot predict without current glucose
    try {
      // Use dynamic URL resolution instead of static BASE_URL
      const baseUrl = await getBaseUrl();
      const response = await fetch(`${baseUrl}/api/predict-glucose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_glucose: glucose,
          recent_carbs: carbs,
          recent_activity_minutes: activity,
          recent_sleep_quality: sleep,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setPredictedLevels(data.predictions);
      } else {
        Alert.alert("Prediction Error", data.error || "Failed to fetch predictions.");
      }
    } catch (error) {
      console.error("Error fetching glucose prediction:", error);
      Alert.alert("Network Error", "Could not connect to prediction service.");
    }
  };

  // Fetch glucose history when component mounts
  useEffect(() => {
    console.log('🔄 Prediction component mounted, fetching glucose history...');
    console.log('🔧 API_ENDPOINTS.BASE_URL:', API_ENDPOINTS.BASE_URL);
    fetchGlucoseHistory();
  }, []);

  // Fetch predictions when current glucose or related data changes
  useEffect(() => {
    if (currentGlucose !== null && !isLoadingHistory) {
      console.log('🔮 Fetching predictions for glucose:', currentGlucose);
      fetchGlucosePrediction(currentGlucose, recentCarbs, recentActivityMinutes, recentSleepQuality);
    }
  }, [currentGlucose, recentCarbs, recentActivityMinutes, recentSleepQuality, isLoadingHistory]);

  // Clear selections when data changes to avoid confusion
  useEffect(() => {
    setTooltip(null);
    setSelectedPoint(null);
  }, [currentGlucose, predictedLevels, granularity, glucoseHistory]);

  // Compute today's stats whenever glucose history changes
  useEffect(() => {
    console.log('🔄 Glucose history updated, recomputing today\'s stats...');
    computeTodaysStats();
  }, [glucoseHistory]);

  // Function to fetch insights
  const fetchInsights = async (forceRefresh: boolean = false) => {
    try {
      setInsightsLoading(true);
      setInsightsError(null);
      
      console.log('🔍 Fetching today\'s insights...');
      const response = await fetchTodaysInsights(forceRefresh);
      
      if (response.success) {
        setInsights(response.insights);
        setLastInsightsRefresh(new Date());
        console.log('✅ Insights loaded successfully:', response.insights.length, 'insights');
        
        // Log LLM usage for debugging
        if (response.llmUsed) {
          console.log('🤖 Insights generated using LLM');
        } else {
          console.log('📊 Insights generated using rule-based logic');
          if (response.fallbackReason) {
            console.log('🔄 Fallback reason:', response.fallbackReason);
          }
        }
      } else {
        setInsightsError(response.error || 'Failed to generate insights');
        // Set fallback insights if none exist
        if (insights.length === 0) {
          setInsights([{
            id: 'fallback-default',
            type: 'positive',
            icon: '🎯',
            title: 'Keep Going Strong',
            description: 'Continue monitoring your health consistently. Your dedication to tracking will help us provide better insights.',
            priority: 1,
            isAIGenerated: false,
            fallbackUsed: true
          }]);
        }
      }
    } catch (error) {
      console.error('❌ Error fetching insights:', error);
      setInsightsError('Unable to load insights. Please try again.');
      
      // Set error fallback insights
      if (insights.length === 0) {
        setInsights([{
          id: 'error-fallback',
          type: 'neutral',
          icon: '📱',
          title: 'Insights Temporarily Unavailable',
          description: 'We\'re working to restore insight generation. Keep logging your data for better analysis.',
          priority: 1,
          isAIGenerated: false,
          fallbackUsed: true
        }]);
      }
    } finally {
      setInsightsLoading(false);
    }
  };

  // Fetch insights when component mounts
  useEffect(() => {
    console.log('🔄 Component mounted, fetching insights...');
    fetchInsights();
  }, []);

  // Refresh insights when important data changes
  useEffect(() => {
    if (!isLoadingHistory && glucoseHistory.length > 0) {
      console.log('🔄 Glucose data updated, refreshing insights...');
      // Delay to allow other operations to complete
      setTimeout(() => {
        fetchInsights(true); // Force refresh with new data
      }, 2000);
    }
  }, [glucoseHistory.length, isLoadingHistory]);

  // Handle refresh for insights
  const handleRefreshInsights = async () => {
    console.log('🔄 Manual insights refresh triggered');
    await fetchInsights(true);
  };

  // Clear insights cache when logging new data
  const clearInsightsCacheAndRefresh = async () => {
    clearInsightsCache();
    await fetchInsights(true);
  };

  // Function to fetch injection site recommendation
  const fetchInjectionSiteRecommendation = async () => {
    try {
      setIsLoadingRecommendation(true);
      setInjectionRecommendation(null);
      
      const baseUrl = await getBaseUrl();
      const response = await fetch(`${baseUrl}/api/injection-site-recommendation?user_id=1`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('✅ Injection site recommendation received:', data.recommendation);
        setInjectionRecommendation(data.recommendation);
      } else {
        console.log('⚠️ No recommendation available:', data.message);
        // Don't show error for no history - this is expected for new users
      }
    } catch (error) {
      console.error('❌ Error fetching injection site recommendation:', error);
      // Don't show error alert - recommendation is optional
    } finally {
      setIsLoadingRecommendation(false);
    }
  };

  // Function to use recommended injection site
  const useRecommendedSite = () => {
    if (injectionRecommendation) {
      setMedicationDetails({
        ...medicationDetails,
        injection_site: injectionRecommendation.site
      });
      setIsInjectionSiteDropdownOpen(false);
    }
  };

  const handleLogMeal = () => {
    console.log('Log Meal button pressed');
    setLoggingType('meal');
    setMealImage(null); // Reset image state
    setMealAnalysis(null); // Reset analysis state
    setAnalysisError(null); // Reset error state
    setIsAnalyzing(false);
    setMealLoggingMethod(null); // Reset method selection
    setLogDetails({}); // Reset details
    setIsModalVisible(true);
  };

  const handleLogActivity = () => {
    console.log('Log Activity button pressed');
    setLoggingType('activity');
    setIsModalVisible(true);
    setLogDetails({ activity_type: '', duration_minutes: '', steps: '', calories_burned: '' });
  };

  const handleLogGlucose = () => {
    console.log('Log Glucose button pressed');
    const now = new Date();
    console.log('Timestamp captured by app:', now); // Added for debugging
    setDate(now); // Set the date state to current time
    setLogDetails({
      glucoseLevel: '',
      time: formatToMySQLDateTime(now),
    });
    setLoggingType('glucose');
    setIsModalVisible(true);
    setShowDatePicker(false); // Ensure date picker is hidden initially
  };

  const handleLogMedication = () => {
    console.log('Log Medication button pressed');
    const now = new Date();
    setDate(now);
    setMedicationDetails({
      medication_type: '',
      medication_name: '',
      dosage: '',
      time: formatToMySQLDateTime(now),
      meal_context: '',
      injection_site: '',
    });
    setLoggingType('medication');
    setIsModalVisible(true);
    setIsMedicationTypeDropdownOpen(false);
    setIsInsulinTypeDropdownOpen(false);
    setShowInsulinDosageInput(false);
    setIsInjectionSiteDropdownOpen(false);
    setShowDatePicker(false);
    // Reset recommendation when opening medication modal
    setInjectionRecommendation(null);
    setIsLoadingRecommendation(false);
    setShowRecommendation(true);
  };

  const closeModal = () => {
    setIsModalVisible(false);
    setLoggingType(null);
    setLogDetails({});
    setMedicationDetails({});
    setMealImage(null);
    setMealAnalysis(null);
    setAnalysisError(null);
    setIsAnalyzing(false);
    setMealLoggingMethod(null);
  };

  const handleSaveLog = async () => {
    console.log(`Saving log for type: ${loggingType}`);
    console.log(`Details:`, loggingType === 'medication' ? medicationDetails : logDetails);

    if (loggingType === 'glucose') {
        if (logDetails.glucoseLevel && logDetails.time) {
            const glucoseValue = parseFloat(logDetails.glucoseLevel);
            if (!isNaN(glucoseValue)) {
                // Send glucose data to backend
                const success = await sendLogData('/api/log-glucose', {
                    glucoseLevel: glucoseValue,
                    time: logDetails.time,
                });
                if (success) {
                    showToast(`✅ Glucose logged! You're staying on track 💪`);
                    // Close modal immediately for a smoother UX
                    closeModal();

                    console.log('✅ Glucose logged successfully, refreshing history...');
                    // Fire-and-forget background refreshes
                    fetchGlucoseHistory();
                    clearInsightsCacheAndRefresh();
                }
            } else {
                Alert.alert("Invalid Input", "Please enter a valid glucose level.");
            }
        } else {
            Alert.alert("Missing Information", "Please enter both glucose level and time.");
        }
    } else if (loggingType === 'meal') {
        // Only require meal type and food description - nutritional info is optional
        const isValidMeal = logDetails.meal_type?.trim() && 
                           logDetails.food_description?.trim();

        if (isValidMeal) {
            const carbsValue = parseFloat(logDetails.carbs || '0');
            const caloriesValue = parseFloat(logDetails.calories || '0');
            const proteinValue = parseFloat(logDetails.protein || '0');
            const fatValue = parseFloat(logDetails.fat || '0');
            const sugarValue = parseFloat(logDetails.sugar || '0');
            const fiberValue = parseFloat(logDetails.fiber || '0');

            // Send meal data to backend
            const success = await sendLogData('/api/log-meal', {
                meal_type: logDetails.meal_type,
                food_description: logDetails.food_description,
                calories: caloriesValue,
                carbs: carbsValue,
                protein_g: proteinValue,
                fat_g: fatValue,
                sugar_g: sugarValue,
                fiber_g: fiberValue,
            });
            if (success) {
                setRecentCarbs(carbsValue);
                showToast(`🎉 Great job! Your health journey just got stronger.`);
                // Close modal first
                closeModal();

                // Background updates
                fetchGlucosePrediction(currentGlucose, carbsValue, recentActivityMinutes, recentSleepQuality);
                clearInsightsCacheAndRefresh();
            }
        } else {
            Alert.alert("Missing Information", "Please fill in meal type and food description.");
        }
    }
    else if (loggingType === 'activity') {
          if (logDetails.activity_type?.trim() && logDetails.duration_minutes?.trim()) {
              const durationValue = parseFloat(logDetails.duration_minutes);
              const stepsValue = logDetails.steps ? parseFloat(logDetails.steps) : 0;
              const caloriesBurnedValue = logDetails.calories_burned ? parseFloat(logDetails.calories_burned) : 0;
              const finalActivityType = logDetails.activity_type === 'Other' ? logDetails.other_activity_type : logDetails.activity_type;

              if (!isNaN(durationValue) && !isNaN(stepsValue) && !isNaN(caloriesBurnedValue)) {
                  // Send activity data to backend
                  const success = await sendLogData('/api/log-activity', {
                      activity_type: finalActivityType,
                      duration_minutes: durationValue,
                      steps: stepsValue,
                      calories_burned: caloriesBurnedValue,
                  });
                  if (success) {
                      setRecentActivityMinutes(durationValue);
                      showToast(`👏 Entry saved. You're taking control!`);
                      // Close modal for immediate feedback
                      closeModal();

                      // Background updates
                      fetchGlucosePrediction(currentGlucose, recentCarbs, durationValue, recentSleepQuality);
                      clearInsightsCacheAndRefresh();
                  }
              } else {
                  Alert.alert("Invalid Input", "Please enter valid numbers for duration, steps, and calories burned.");
              }
          } else {
              Alert.alert("Missing Information", "Please fill in activity details.");
          }
     }
     else if (loggingType === 'medication') {
         // Check if injection site is required for insulin
         const requiresInjectionSite = medicationDetails.medication_type === 'Insulin' && !medicationDetails.injection_site?.trim();
         
         if (medicationDetails.medication_type?.trim() && medicationDetails.medication_name?.trim() && medicationDetails.dosage?.trim() && medicationDetails.time && !requiresInjectionSite) {
             const dosageValue = parseFloat(medicationDetails.dosage);
             if (!isNaN(dosageValue)) {
                 const success = await sendLogData('/api/log-medication', {
                     medication_type: medicationDetails.medication_type,
                     medication_name: medicationDetails.medication_name,
                     dosage: dosageValue,
                     time: medicationDetails.time,
                     meal_context: medicationDetails.meal_context || null, // Optional
                     injection_site: medicationDetails.injection_site || null, // Optional, but required for insulin
                 });
                 if (success) {
                     showToast(`💊 Medication logged! Consistency is key!`);
                     closeModal();
                 }
             } else {
                 Alert.alert("Invalid Input", "Please enter a valid number for dosage.");
             }
         } else {
             if (requiresInjectionSite) {
                 Alert.alert("Missing Information", "Please select an injection site for insulin.");
             } else {
                 Alert.alert("Missing Information", "Please fill in all medication details.");
             }
         }
     }
  };

  const renderModalContent = () => {
    const activityTypes = ['Walking', 'Running', 'Jogging', 'Gym', 'Other', 'Swimming']; // Predefined activity types

    switch (loggingType) {
      case 'meal':
        const mealTypes = ['Breakfast', 'Brunch', 'Lunch', 'Evening Snack', 'Dinner', 'Other'];

        return (
          <View style={modalStyles.contentContainer}>
            <Text style={modalStyles.modalTitle}>Log Your Meal</Text>

            {/* Method Selection - Show if no method is selected */}
            {!mealLoggingMethod && (
              <View style={modalStyles.methodSelectionContainer}>
                <TouchableOpacity 
                  style={modalStyles.methodButton} 
                  onPress={() => setMealLoggingMethod('photo')}
                >
                  <FontAwesome5 name="camera" size={20} color="#fff" style={{ marginRight: 12 }} />
                  <Text style={modalStyles.methodButtonText}>Analyze Meal from Photo</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={modalStyles.methodButtonSecondary} 
                  onPress={() => {
                    setMealLoggingMethod('manual');
                    // Initialize manual entry with default values
                    setLogDetails({
                      meal_type: '',
                      food_description: '',
                      carbs: '',
                      sugar: '',
                      fiber: '',
                      protein: '',
                      fat: '',
                      calories: '',
                    });
                  }}
                >
                  <FontAwesome5 name="edit" size={20} color="#4A90E2" style={{ marginRight: 12 }} />
                  <Text style={modalStyles.methodButtonSecondaryText}>Enter Meal Manually</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Photo Analysis Method */}
            {mealLoggingMethod === 'photo' && (
              <View style={{ width: '100%', alignItems: 'center' }}>
                {/* Switch Method Button */}
                <TouchableOpacity 
                  style={modalStyles.switchMethodButton} 
                  onPress={() => {
                    setMealLoggingMethod('manual');
                    setMealImage(null);
                    setMealAnalysis(null);
                    setAnalysisError(null);
                    setIsAnalyzing(false);
                    setLogDetails({
                      meal_type: '',
                      food_description: '',
                      carbs: '',
                      sugar: '',
                      fiber: '',
                      protein: '',
                      fat: '',
                      calories: '',
                    });
                  }}
                >
                  <Text style={modalStyles.switchMethodButtonText}>Switch to Manual Entry</Text>
                </TouchableOpacity>

                {!mealImage ? (
                  <TouchableOpacity style={modalStyles.aiButton} onPress={handleImagePicker}>
                    <FontAwesome5 name="camera" size={20} color="#fff" style={{ marginRight: 12 }} />
                    <Text style={modalStyles.aiButtonText}>Take or Choose Photo</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: '100%', alignItems: 'center' }}>
                    <Image source={{ uri: mealImage }} style={modalStyles.mealImage} resizeMode="contain" />
                    
                    {isAnalyzing ? (
                      <View style={modalStyles.loadingContainer}>
                        <ActivityIndicator size="large" color="#4A90E2" />
                        <Text style={modalStyles.loadingText}>Analyzing your meal...</Text>
                      </View>
                    ) : mealAnalysis ? (
                      <ScrollView style={{ width: '100%', maxHeight: 350 }}>
                        <Text style={modalStyles.analysisTitle}>AI Analysis Results</Text>
                        {/* Editable Meal Type */}
                        <Text style={modalStyles.label}>Meal Type</Text>
                        <TouchableOpacity
                          style={modalStyles.modernDropdownButton}
                          onPress={() => setIsMealTypeDropdownOpen(!isMealTypeDropdownOpen)}
                        >
                          <Text style={modalStyles.modernDropdownButtonText}>
                            {logDetails.meal_type || "Select Meal Type"}
                          </Text>
                          <MaterialCommunityIcons
                            name={isMealTypeDropdownOpen ? "chevron-up" : "chevron-down"}
                            size={20}
                            color="#666"
                          />
                        </TouchableOpacity>

                        {isMealTypeDropdownOpen && (
                          <View style={modalStyles.modernDropdownOptionsContainer}>
                            <ScrollView
                              style={{ maxHeight: 220 }}
                              showsVerticalScrollIndicator={true}
                              nestedScrollEnabled={true}
                            >
                              {mealTypes.map((type) => (
                                <TouchableOpacity
                                  key={type}
                                  style={modalStyles.modernDropdownOption}
                                  onPress={() => {
                                    setLogDetails({ ...logDetails, meal_type: type });
                                    setIsMealTypeDropdownOpen(false);
                                  }}
                                >
                                  <Text style={modalStyles.modernDropdownOptionText}>{type}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          </View>
                        )}

                        {/* Editable Food Description */}
                        <Text style={modalStyles.label}>Food Description</Text>
                        <TextInput
                          style={[modalStyles.modernInput, { height: 80 }]}
                          value={logDetails.food_description}
                          onChangeText={(text) => setLogDetails({ ...logDetails, food_description: text })}
                          multiline
                        />
                        
                        {/* Editable Nutritional Info in a 3x2 grid */}
                        <View style={modalStyles.nutritionGrid}>
                          <View style={modalStyles.nutritionInputContainer}>
                            <Text style={modalStyles.label}>Carbs (g)</Text>
                            <TextInput
                              style={modalStyles.modernInput}
                              value={logDetails.carbs}
                              onChangeText={(text) => setLogDetails({ ...logDetails, carbs: text })}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={modalStyles.nutritionInputContainer}>
                            <Text style={modalStyles.label}>Sugar (g)</Text>
                            <TextInput
                              style={modalStyles.modernInput}
                              value={logDetails.sugar}
                              onChangeText={(text) => setLogDetails({ ...logDetails, sugar: text })}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={modalStyles.nutritionInputContainer}>
                            <Text style={modalStyles.label}>Fiber (g)</Text>
                            <TextInput
                              style={modalStyles.modernInput}
                              value={logDetails.fiber}
                              onChangeText={(text) => setLogDetails({ ...logDetails, fiber: text })}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={modalStyles.nutritionInputContainer}>
                            <Text style={modalStyles.label}>Protein (g)</Text>
                            <TextInput
                              style={modalStyles.modernInput}
                              value={logDetails.protein}
                              onChangeText={(text) => setLogDetails({ ...logDetails, protein: text })}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={modalStyles.nutritionInputContainer}>
                            <Text style={modalStyles.label}>Fat (g)</Text>
                            <TextInput
                              style={modalStyles.modernInput}
                              value={logDetails.fat}
                              onChangeText={(text) => setLogDetails({ ...logDetails, fat: text })}
                              keyboardType="numeric"
                            />
                          </View>
                          <View style={modalStyles.nutritionInputContainer}>
                            <Text style={modalStyles.label}>Calories</Text>
                            <TextInput
                              style={modalStyles.modernInput}
                              value={logDetails.calories}
                              onChangeText={(text) => setLogDetails({ ...logDetails, calories: text })}
                              keyboardType="numeric"
                            />
                          </View>
                        </View>
                        
                        {/* Display other nutritional info if available */}
                        <Text style={modalStyles.label}>Ingredients</Text>
                        <Text style={modalStyles.ingredientsText}>
                          {logDetails.ingredients?.join(', ') || 'Not available'}
                        </Text>

                      </ScrollView>
                    ) : (
                      <View style={modalStyles.loadingContainer}>
                         <Text style={modalStyles.errorText}>
                           {analysisError || "Analysis failed. Please try another image."}
                         </Text>
                         <TouchableOpacity style={modalStyles.aiButton} onPress={handleImagePicker}>
                           <Text style={modalStyles.aiButtonText}>Try Again</Text>
                         </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Manual Entry Method */}
            {mealLoggingMethod === 'manual' && (
              <View style={{ width: '100%' }}>
                {/* Switch Method Button */}
                <TouchableOpacity 
                  style={modalStyles.switchMethodButton} 
                  onPress={() => {
                    setMealLoggingMethod('photo');
                    setLogDetails({});
                  }}
                >
                  <Text style={modalStyles.switchMethodButtonText}>Switch to Photo Analysis</Text>
                </TouchableOpacity>

                <ScrollView style={{ width: '100%', maxHeight: 400 }} showsVerticalScrollIndicator={true}>
                  {/* Meal Type Dropdown */}
                  <Text style={modalStyles.label}>Meal Type *</Text>
                  <TouchableOpacity
                    style={modalStyles.modernDropdownButton}
                    onPress={() => setIsMealTypeDropdownOpen(!isMealTypeDropdownOpen)}
                  >
                    <Text style={modalStyles.modernDropdownButtonText}>
                      {logDetails.meal_type || "Select Meal Type"}
                    </Text>
                    <MaterialCommunityIcons
                      name={isMealTypeDropdownOpen ? "chevron-up" : "chevron-down"}
                      size={20}
                      color="#666"
                    />
                  </TouchableOpacity>

                  {isMealTypeDropdownOpen && (
                    <View style={modalStyles.modernDropdownOptionsContainer}>
                      <ScrollView
                        style={{ maxHeight: 220 }}
                        showsVerticalScrollIndicator={true}
                        nestedScrollEnabled={true}
                      >
                        {mealTypes.map((type) => (
                          <TouchableOpacity
                            key={type}
                            style={modalStyles.modernDropdownOption}
                            onPress={() => {
                              setLogDetails({ ...logDetails, meal_type: type });
                              setIsMealTypeDropdownOpen(false);
                            }}
                          >
                            <Text style={modalStyles.modernDropdownOptionText}>{type}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Food Description */}
                  <Text style={modalStyles.label}>Food Description *</Text>
                  <TextInput
                    style={[modalStyles.modernInput, { height: 80 }]}
                    placeholder="Describe your meal..."
                    placeholderTextColor="#888"
                    value={logDetails.food_description}
                    onChangeText={(text) => setLogDetails({ ...logDetails, food_description: text })}
                    multiline
                  />
                  
                  {/* Nutritional Information - All Optional */}
                  <Text style={modalStyles.sectionTitle}>Nutritional Information (Optional)</Text>
                  <Text style={modalStyles.sectionSubtitle}>Enter nutritional values if known - all fields are optional</Text>
                  <View style={modalStyles.nutritionGrid}>
                    <View style={modalStyles.nutritionInputContainer}>
                      <Text style={modalStyles.label}>Carbs (g)</Text>
                      <TextInput
                        style={modalStyles.modernInput}
                        placeholder="0"
                        placeholderTextColor="#888"
                        value={logDetails.carbs}
                        onChangeText={(text) => setLogDetails({ ...logDetails, carbs: text.replace(/[^0-9.]/g, '') })}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={modalStyles.nutritionInputContainer}>
                      <Text style={modalStyles.label}>Calories</Text>
                      <TextInput
                        style={modalStyles.modernInput}
                        placeholder="0"
                        placeholderTextColor="#888"
                        value={logDetails.calories}
                        onChangeText={(text) => setLogDetails({ ...logDetails, calories: text.replace(/[^0-9.]/g, '') })}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  {/* Additional Nutritional Fields */}
                  <Text style={modalStyles.sectionTitle}>Additional Information (Optional)</Text>
                  <View style={modalStyles.nutritionGrid}>
                    <View style={modalStyles.nutritionInputContainer}>
                      <Text style={modalStyles.label}>Sugar (g)</Text>
                      <TextInput
                        style={modalStyles.modernInput}
                        placeholder="0"
                        placeholderTextColor="#888"
                        value={logDetails.sugar}
                        onChangeText={(text) => setLogDetails({ ...logDetails, sugar: text.replace(/[^0-9.]/g, '') })}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={modalStyles.nutritionInputContainer}>
                      <Text style={modalStyles.label}>Fiber (g)</Text>
                      <TextInput
                        style={modalStyles.modernInput}
                        placeholder="0"
                        placeholderTextColor="#888"
                        value={logDetails.fiber}
                        onChangeText={(text) => setLogDetails({ ...logDetails, fiber: text.replace(/[^0-9.]/g, '') })}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={modalStyles.nutritionInputContainer}>
                      <Text style={modalStyles.label}>Protein (g)</Text>
                      <TextInput
                        style={modalStyles.modernInput}
                        placeholder="0"
                        placeholderTextColor="#888"
                        value={logDetails.protein}
                        onChangeText={(text) => setLogDetails({ ...logDetails, protein: text.replace(/[^0-9.]/g, '') })}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={modalStyles.nutritionInputContainer}>
                      <Text style={modalStyles.label}>Fat (g)</Text>
                      <TextInput
                        style={modalStyles.modernInput}
                        placeholder="0"
                        placeholderTextColor="#888"
                        value={logDetails.fat}
                        onChangeText={(text) => setLogDetails({ ...logDetails, fat: text.replace(/[^0-9.]/g, '') })}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                </ScrollView>
              </View>
            )}
          </View>
        );
      case 'activity':
        return (
          <View style={modalStyles.contentContainer}>
            <Text style={modalStyles.modalTitle}>Log Your Activity</Text>
            <TouchableOpacity
                style={modalStyles.modernDropdownButton}
                onPress={() => setIsActivityDropdownOpen(!isActivityDropdownOpen)}
            >
                <Text style={modalStyles.modernDropdownButtonText}>
                    {logDetails.activity_type || "Select Activity Type"}
                </Text>
                <MaterialCommunityIcons
                    name={isActivityDropdownOpen ? "chevron-up" : "chevron-down"}
                    size={20}
                    color="#666"
                />
            </TouchableOpacity>

            {isActivityDropdownOpen && ( // Conditionally render dropdown options
                <View style={modalStyles.modernDropdownOptionsContainer}>
                    <ScrollView 
                      style={{ maxHeight: 180 }}
                      showsVerticalScrollIndicator={true}
                      nestedScrollEnabled={true}
                    >
                      {activityTypes.map((type) => (
                          <TouchableOpacity
                              key={type}
                              style={modalStyles.modernDropdownOption}
                              onPress={() => {
                                  setLogDetails({ ...logDetails, activity_type: type });
                                  setShowOtherActivityInput(type === 'Other');
                                  setIsActivityDropdownOpen(false);
                              }}
                          >
                              <Text style={modalStyles.modernDropdownOptionText}>{type}</Text>
                          </TouchableOpacity>
                      ))}
                    </ScrollView>
                </View>
            )}

            {showOtherActivityInput && ( // Conditionally render 'Other' input
                <TextInput
                    style={modalStyles.modernInput}
                    placeholder="Enter Other Activity Type"
                    placeholderTextColor="#888"
                    value={logDetails.other_activity_type || ''}
                    onChangeText={(text) => setLogDetails({ ...logDetails, other_activity_type: text })}
                />
            )}
             <TextInput
                style={modalStyles.modernInput}
                placeholder="Duration (minutes)"
                placeholderTextColor="#888"
                keyboardType="numeric"
                value={logDetails.duration_minutes || ''}
                onChangeText={(text) => setLogDetails({...logDetails, duration_minutes: text.replace(/[^0-9.]/g, '')})}
              />
            <TextInput
              style={modalStyles.modernInput}
              placeholder="Steps (optional)"
              placeholderTextColor="#888"
              keyboardType="numeric"
              value={logDetails.steps || ''}
              onChangeText={(text) => setLogDetails({...logDetails, steps: text.replace(/[^0-9.]/g, '')})}
            />
            <TextInput
              style={modalStyles.modernInput}
              placeholder="Calories Burned (optional)"
              placeholderTextColor="#888"
              keyboardType="numeric"
              value={logDetails.calories_burned || ''}
              onChangeText={(text) => setLogDetails({...logDetails, calories_burned: text.replace(/[^0-9.]/g, '')})}
            />
          </View>
        );
      case 'glucose':
        const onDateChange = (event: any, selectedDate: Date | undefined) => {
            const currentDate = selectedDate || date;
            setShowDatePicker(Platform.OS === 'ios'); // On iOS, picker remains visible by default
            setDate(currentDate);
            setLogDetails({
                ...logDetails,
                time: formatToMySQLDateTime(currentDate),
            });
        };

        return (
          <View style={modalStyles.contentContainer}>
             <Text style={modalStyles.modalTitle}>Log Your Glucose</Text>
             <TextInput
                style={modalStyles.modernInput}
                placeholder="Glucose level (mg/dL)"
                placeholderTextColor="#888"
                keyboardType="numeric"
                value={logDetails.glucoseLevel || ''}
                onChangeText={(text) => setLogDetails({...logDetails, glucoseLevel: text.replace(/[^0-9.]/g, '')})}
              />
              <TouchableOpacity
                 style={modalStyles.modernInput} // Re-using input style for button appearance
                 onPress={() => setShowDatePicker(true)}
               >
                 <Text style={{ color: logDetails.time ? '#2c3e50' : '#888', fontSize: 16 }}>
                     {logDetails.time ? new Date(logDetails.time).toLocaleString() : 'Select Time'}
                 </Text>
               </TouchableOpacity>

              {showDatePicker && (
                  <DateTimePicker
                      testID="dateTimePicker"
                      value={date}
                      mode="datetime" // Allows both date and time selection
                      display="default"
                      onChange={onDateChange}
                  />
              )}
          </View>
        );
      case 'medication':
        const medicationTypes = ['Insulin', 'Oral Medication', 'Other'];
        const insulinTypes = ['Bolus', 'Basal'];
        const injectionSites = ['Left Arm', 'Right Arm', 'Left Thigh', 'Right Thigh', 'Abdomen', 'Buttock'];
        const mealContexts = ['Before Meal', 'With Meal', 'After Meal', 'No Meal Relation'];

        const onMedicationDateChange = (event: any, selectedDate: Date | undefined) => {
            const currentDate = selectedDate || date;
            setShowDatePicker(Platform.OS === 'ios');
            setDate(currentDate);
            setMedicationDetails({
                ...medicationDetails,
                time: formatToMySQLDateTime(currentDate),
            });
        };

        return (
            <ScrollView style={{width:'100%'}} contentContainerStyle={modalStyles.contentContainer}>
                <Text style={modalStyles.modalTitle}>Log Your Medication</Text>
                
                {medicationDetails.medication_type === 'Insulin' && showRecommendation && (
                    <View style={modalStyles.recommendationWrapper}>
                        {/* Close Button - positioned outside and top-right of the blue box */}
                        <TouchableOpacity 
                            style={modalStyles.closeButton} 
                            onPress={() => setShowRecommendation(false)}
                            activeOpacity={0.7}
                        >
                            <MaterialCommunityIcons name="close" size={16} color="#6b7280" />
                        </TouchableOpacity>
                        
                        <View style={modalStyles.recommendationContainer}>
                            {isLoadingRecommendation ? (
                                <View style={modalStyles.recommendationLoading}>
                                    <ActivityIndicator size="small" color="#4A90E2" />
                                    <Text style={modalStyles.recommendationLoadingText}>Getting personalized recommendation...</Text>
                                </View>
                            ) : injectionRecommendation ? (
                                <View style={modalStyles.recommendationCard}>
                                    <View style={modalStyles.recommendationHeader}>
                                        <Text style={modalStyles.recommendationIcon}>💡</Text>
                                        <Text style={modalStyles.recommendationTitle}>Recommended Site: {injectionRecommendation.site}</Text>
                                    </View>
                                    <Text style={modalStyles.recommendationReason}>{injectionRecommendation.reason}</Text>
                                    {injectionRecommendation.fallback && (
                                        <Text style={modalStyles.fallbackNote}>* Using rule-based recommendation</Text>
                                    )}
                                    <TouchableOpacity 
                                        style={modalStyles.useRecommendationButton}
                                        onPress={useRecommendedSite}
                                    >
                                        <Text style={modalStyles.useRecommendationButtonText}>Use This Site</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <TouchableOpacity 
                                    style={modalStyles.getRecommendationButton}
                                    onPress={fetchInjectionSiteRecommendation}
                                >
                                    <Text style={modalStyles.getRecommendationButtonText}>Get Site Recommendation</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )}
                
                {/* Show Recommendation button when hidden */}
                {medicationDetails.medication_type === 'Insulin' && !showRecommendation && (
                    <TouchableOpacity 
                        style={modalStyles.showRecommendationButton}
                        onPress={() => setShowRecommendation(true)}
                        activeOpacity={0.7}
                    >
                        <MaterialCommunityIcons name="lightbulb-outline" size={16} color="#0ea5e9" style={{ marginRight: 8 }} />
                        <Text style={modalStyles.showRecommendationButtonText}>Show Site Recommendation</Text>
                    </TouchableOpacity>
                )}
                
                {/* Medication Type Dropdown */}
                <TouchableOpacity
                    style={modalStyles.modernDropdownButton}
                    onPress={() => setIsMedicationTypeDropdownOpen(!isMedicationTypeDropdownOpen)}
                >
                    <Text style={modalStyles.modernDropdownButtonText}>
                        {medicationDetails.medication_type || "Select Medication Type"}
                    </Text>
                    <MaterialCommunityIcons
                        name={isMedicationTypeDropdownOpen ? "chevron-up" : "chevron-down"}
                        size={20}
                        color="#666"
                    />
                </TouchableOpacity>
                {isMedicationTypeDropdownOpen && (
                    <View style={modalStyles.modernDropdownOptionsContainer}>
                        <ScrollView 
                          style={{ maxHeight: 120 }}
                          showsVerticalScrollIndicator={true}
                          nestedScrollEnabled={true}
                        >
                          {medicationTypes.map((type) => (
                              <TouchableOpacity
                                  key={type}
                                  style={modalStyles.modernDropdownOption}
                                  onPress={() => {
                                      setMedicationDetails({ ...medicationDetails, medication_type: type, insulin_type: '' });
                                      setShowInsulinDosageInput(type === 'Insulin');
                                      setIsMedicationTypeDropdownOpen(false);
                                      
                                      // Auto-fetch injection site recommendation when insulin is selected
                                      if (type === 'Insulin') {
                                          setTimeout(() => {
                                              fetchInjectionSiteRecommendation();
                                          }, 500); // Small delay to ensure state is updated
                                      }
                                  }}
                              >
                                  <Text style={modalStyles.modernDropdownOptionText}>{type}</Text>
                              </TouchableOpacity>
                          ))}
                        </ScrollView>
                    </View>
                )}

                {/* Insulin Type Dropdown (Conditional) */}
                {medicationDetails.medication_type === 'Insulin' && (
                    <TouchableOpacity
                        style={modalStyles.modernDropdownButton}
                        onPress={() => setIsInsulinTypeDropdownOpen(!isInsulinTypeDropdownOpen)}
                    >
                        <Text style={modalStyles.modernDropdownButtonText}>
                            {medicationDetails.insulin_type || "Select Insulin Type"}
                        </Text>
                        <MaterialCommunityIcons
                            name={isInsulinTypeDropdownOpen ? "chevron-up" : "chevron-down"}
                            size={20}
                            color="#666"
                        />
                    </TouchableOpacity>
                )}
                {medicationDetails.medication_type === 'Insulin' && isInsulinTypeDropdownOpen && (
                    <View style={modalStyles.modernDropdownOptionsContainer}>
                        <ScrollView 
                          style={{ maxHeight: 100 }}
                          showsVerticalScrollIndicator={true}
                          nestedScrollEnabled={true}
                        >
                          {insulinTypes.map((type) => (
                              <TouchableOpacity
                                  key={type}
                                  style={modalStyles.modernDropdownOption}
                                  onPress={() => {
                                      setMedicationDetails({ ...medicationDetails, insulin_type: type });
                                      setIsInsulinTypeDropdownOpen(false);
                                  }}
                              >
                                  <Text style={modalStyles.modernDropdownOptionText}>{type}</Text>
                              </TouchableOpacity>
                          ))}
                        </ScrollView>
                    </View>
                )}

                {/* Injection Site Dropdown (Conditional for Insulin) */}
                {medicationDetails.medication_type === 'Insulin' && (
                    <TouchableOpacity
                        style={modalStyles.modernDropdownButton}
                        onPress={() => setIsInjectionSiteDropdownOpen(!isInjectionSiteDropdownOpen)}
                    >
                        <Text style={modalStyles.modernDropdownButtonText}>
                            {medicationDetails.injection_site || "Select Injection Site"}
                        </Text>
                        <MaterialCommunityIcons
                            name={isInjectionSiteDropdownOpen ? "chevron-up" : "chevron-down"}
                            size={20}
                            color="#666"
                        />
                    </TouchableOpacity>
                )}
                {medicationDetails.medication_type === 'Insulin' && isInjectionSiteDropdownOpen && (
                    <View style={modalStyles.modernDropdownOptionsContainer}>
                        <ScrollView 
                          style={{ maxHeight: 180 }}
                          showsVerticalScrollIndicator={true}
                          nestedScrollEnabled={true}
                        >
                          {injectionSites.map((site) => (
                              <TouchableOpacity
                                  key={site}
                                  style={modalStyles.modernDropdownOption}
                                  onPress={() => {
                                      setMedicationDetails({ ...medicationDetails, injection_site: site });
                                      setIsInjectionSiteDropdownOpen(false);
                                  }}
                              >
                                  <Text style={modalStyles.modernDropdownOptionText}>{site}</Text>
                              </TouchableOpacity>
                          ))}
                        </ScrollView>
                    </View>
                )}

                <TextInput
                    style={modalStyles.modernInput}
                    placeholder="Medication Name (e.g., Metformin, Humalog)"
                    placeholderTextColor="#888"
                    value={medicationDetails.medication_name || ''}
                    onChangeText={(text) => setMedicationDetails({ ...medicationDetails, medication_name: text })}
                />
                <TextInput
                    style={modalStyles.modernInput}
                    placeholder={`Dosage (${medicationDetails.medication_type === 'Insulin' ? 'units' : 'mg'})`}
                    placeholderTextColor="#888"
                    keyboardType="numeric"
                    value={medicationDetails.dosage || ''}
                    onChangeText={(text) => setMedicationDetails({ ...medicationDetails, dosage: text.replace(/[^0-9.]/g, '') })}
                />

                {/* Time Picker */}
                <TouchableOpacity
                    style={modalStyles.modernInput}
                    onPress={() => setShowDatePicker(true)}
                >
                    <Text style={{ color: medicationDetails.time ? '#2c3e50' : '#888', fontSize: 16 }}>
                        {medicationDetails.time ? new Date(medicationDetails.time).toLocaleString() : 'Select Time'}
                    </Text>
                </TouchableOpacity>
                {showDatePicker && (
                    <DateTimePicker
                        testID="medicationDateTimePicker"
                        value={date}
                        mode="datetime"
                        display="default"
                        onChange={onMedicationDateChange}
                    />
                )}

                {/* Meal Context Dropdown */}
                <TouchableOpacity
                    style={modalStyles.modernDropdownButton}
                    onPress={() => setMedicationDetails({ ...medicationDetails, isMealContextDropdownOpen: !medicationDetails.isMealContextDropdownOpen })}
                >
                    <Text style={modalStyles.modernDropdownButtonText}>
                        {medicationDetails.meal_context || "Select Meal Context"}
                    </Text>
                    <MaterialCommunityIcons
                        name={medicationDetails.isMealContextDropdownOpen ? "chevron-up" : "chevron-down"}
                        size={20}
                        color="#666"
                    />
                </TouchableOpacity>
                {medicationDetails.isMealContextDropdownOpen && (
                    <View style={modalStyles.modernDropdownOptionsContainer}>
                        <ScrollView 
                          style={{ maxHeight: 140 }}
                          showsVerticalScrollIndicator={true}
                          nestedScrollEnabled={true}
                        >
                          {mealContexts.map((context) => (
                              <TouchableOpacity
                                  key={context}
                                  style={modalStyles.modernDropdownOption}
                                  onPress={() => {
                                      setMedicationDetails({ ...medicationDetails, meal_context: context, isMealContextDropdownOpen: false });
                                  }}
                              >
                                  <Text style={modalStyles.modernDropdownOptionText}>{context}</Text>
                              </TouchableOpacity>
                          ))}
                        </ScrollView>
                    </View>
                )}
            </ScrollView>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {toastMessage && (
        <Animated.View style={[toastStyles.container, { opacity: toastOpacity }]}> 
          <Text style={toastStyles.text}>{toastMessage}</Text>
        </Animated.View>
      )}
      <ScrollView style={styles.container}>
        <View style={styles.topInfoContainer}>
          <View style={styles.currentGlucoseSection}>
            <Text style={styles.currentGlucoseLabel}>Current Glucose</Text>
            <Text style={styles.currentGlucoseValue}>{currentGlucose !== null ? currentGlucose : '--'} <Text style={styles.unit}>mg/dL</Text></Text>
            <Text style={styles.lastUpdated}>Last updated: Just now</Text>
          </View>
          <View style={styles.predictedGlucoseSection}>
            <Text style={styles.predictedGlucoseLabel}>Predicted ({predictedLevels.length > 0 ? predictedLevels.length : '0'}h)</Text>
            <Text style={styles.predictedGlucoseValue}>{predictedLevels.length > 0 ? predictedLevels[0] : '--'} <Text style={styles.unit}>mg/dL</Text></Text>
            <Text style={styles.lastMeal}>Last meal: sandwich</Text>
          </View>
        </View>

        <View style={styles.chartCard}>
          {/* Modern granularity controls */}
          <View style={styles.granularityContainer}>
            <TouchableOpacity
              style={[
                styles.granularityButton,
                granularity === 'hourly' && styles.granularityButtonActive
              ]}
              onPress={() => setGranularity('hourly')}
            >
              <Text style={[
                styles.granularityButtonText,
                granularity === 'hourly' && styles.granularityButtonTextActive
              ]}>Hourly</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.granularityButton,
                granularity === '15min' && styles.granularityButtonActive
              ]}
              onPress={() => setGranularity('15min')}
            >
              <Text style={[
                styles.granularityButtonText,
                granularity === '15min' && styles.granularityButtonTextActive
              ]}>15 min</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.granularityButton,
                granularity === '5min' && styles.granularityButtonActive
              ]}
              onPress={() => setGranularity('5min')}
            >
              <Text style={[
                styles.granularityButtonText,
                granularity === '5min' && styles.granularityButtonTextActive
              ]}>5 min</Text>
            </TouchableOpacity>
          </View>
          
          <TouchableWithoutFeedback onPress={() => {
            setTooltip(null);
            setSelectedPoint(null);
          }}>
            <View style={styles.chartContainer}>
              {isLoadingHistory ? (
                <View style={[styles.chartContainer, { justifyContent: 'center', alignItems: 'center', height: chartHeight }]}>
                  <Text style={{ color: '#6b7280', fontSize: 16 }}>Loading glucose history...</Text>
                </View>
              ) : (
            <LineChart
              data={cleanedChartData}
              width={chartWidth}
              height={chartHeight}
              chartConfig={chartConfig}
              bezier
                  style={styles.modernChart}
              onDataPointClick={({ value, dataset, getColor, x, y, index }) => {
                const datasetIndex = cleanedChartData.datasets.findIndex(ds => ds === dataset);
                  
                  // Set selected point for highlighting
                  setSelectedPoint({ datasetIndex, pointIndex: index });
                  
                setTooltip({
                  x,
                  y,
                  value,
                  label: cleanedChartData.legend[datasetIndex],
                  datasetIndex,
                  pointIndex: index,
                });
                  
                  // Auto-hide tooltip and selection after 4 seconds
                  setTimeout(() => {
                    setTooltip(null);
                    setSelectedPoint(null);
                  }, 4000);
                }}
                withHorizontalLabels={true}
                withVerticalLabels={true}
                withInnerLines={false}
                withOuterLines={false}
                withHorizontalLines={true}
                withVerticalLines={false}
                decorator={(props: any) => {
                  // Custom decorator for highlighting selected points
                  if (!selectedPoint) return null;
                  
                  const { data, paddingTop, paddingLeft, width: chartInnerWidth, height: chartInnerHeight } = props;
                  const { datasetIndex, pointIndex } = selectedPoint;
                  
                  if (!data || !data.datasets || !data.datasets[datasetIndex]) return null;
                  
                  const dataset = data.datasets[datasetIndex];
                  const dataValue = dataset.data[pointIndex];
                  
                  if (typeof dataValue !== 'number' || isNaN(dataValue)) return null;
                  
                  // Calculate position
                  const maxValue = Math.max(...data.datasets.flatMap((d: any) => d.data.filter((v: any) => typeof v === 'number' && !isNaN(v))));
                  const minValue = Math.min(...data.datasets.flatMap((d: any) => d.data.filter((v: any) => typeof v === 'number' && !isNaN(v))));
                  
                  const xStep = chartInnerWidth / (data.labels.length - 1);
                  const yRatio = (dataValue - minValue) / (maxValue - minValue);
                  
                  const x = paddingLeft + (pointIndex * xStep);
                  const y = paddingTop + chartInnerHeight - (yRatio * chartInnerHeight);
                  
                  return (
                    <View key={`highlight-${datasetIndex}-${pointIndex}`}>
                      {/* Pulsing halo effect */}
                      <View
                        style={[
                          styles.selectedPointHalo,
                          {
                            position: 'absolute',
                            left: x - 12,
                            top: y - 12,
                            backgroundColor: datasetIndex === 0 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(251, 113, 133, 0.2)',
                          }
                        ]}
                      />
                      {/* Enhanced dot */}
              <View
                        style={[
                          styles.selectedPointDot,
                          {
                  position: 'absolute',
                            left: x - 8,
                            top: y - 8,
                            backgroundColor: datasetIndex === 0 ? '#3b82f6' : '#fb7185',
                            borderColor: '#ffffff',
                          }
                        ]}
                      />
                    </View>
                  );
                }}
              />
              )}
              
              {/* Enhanced tooltip */}
              {tooltip && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.tooltipContainer,
                    {
                      left: Math.max(10, Math.min(chartWidth - 140, tooltip.x - 70)),
                      top: Math.max(10, tooltip.y - 70),
                    }
                  ]}
                >
                  <View style={[
                    styles.modernTooltip,
                    { borderLeftColor: tooltip.datasetIndex === 0 ? '#3b82f6' : '#fb7185' }
                  ]}>
                    <Text style={styles.tooltipValue}>{tooltip.value} mg/dL</Text>
                    <Text style={styles.tooltipLabel}>{tooltip.label}</Text>
                    <Text style={styles.tooltipTime}>
                      {cleanedChartData.labels[tooltip.pointIndex]}
                    </Text>
                </View>
                  {/* Tooltip arrow */}
                  <View style={[
                    styles.tooltipArrow,
                    { borderTopColor: tooltip.datasetIndex === 0 ? 'rgba(59, 130, 246, 0.05)' : 'rgba(251, 113, 133, 0.05)' }
                  ]} />
              </View>
            )}
          </View>
          </TouchableWithoutFeedback>
          
          {/* Modern legend with icons */}
          <View style={styles.modernLegendContainer}>
            {cleanedChartData.legend.map((legend: any, index: any) => (
              <View key={index} style={styles.modernLegendItem}>
                <View style={styles.legendIndicator}>
                  <View style={[
                    styles.legendLine,
                    { 
                      backgroundColor: cleanedChartData.datasets[index].color(),
                      ...(index === 1 && { borderStyle: 'dashed', borderWidth: 1, borderColor: cleanedChartData.datasets[index].color(), backgroundColor: 'transparent' })
                    }
                  ]} />
                  <View style={[
                    styles.legendDot,
                    { backgroundColor: cleanedChartData.datasets[index].color() }
                  ]} />
                </View>
                <Text style={styles.modernLegendText}>{legend}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.logActionsContainer}>
          <TouchableOpacity style={[styles.modernLogButton, styles.logMealButton]} onPress={handleLogMeal}>
            <View style={styles.buttonIconContainer}>
              <FontAwesome5 name="utensils" size={20} color="#fff" />
            </View>
            <Text style={styles.modernLogButtonText}>Log Meal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modernLogButton, styles.logActivityButton]} onPress={handleLogActivity}>
            <View style={styles.buttonIconContainer}>
              <FontAwesome5 name="running" size={20} color="#fff" />
            </View>
            <Text style={styles.modernLogButtonText}>Log Activity</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modernLogButton, styles.logGlucoseButton]} onPress={handleLogGlucose}>
            <View style={styles.buttonIconContainer}>
              <FontAwesome5 name="tint" size={20} color="#fff" />
            </View>
            <Text style={styles.modernLogButtonText}>Log Glucose</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modernLogButton, styles.logMedicationButton]} onPress={handleLogMedication}>
            <View style={styles.buttonIconContainer}>
              <FontAwesome5 name="pills" size={20} color="#fff" />
            </View>
            <Text style={styles.modernLogButtonText}>Log Medication</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today's Stats</Text>
          <View style={styles.statsRow}>
            <View style={styles.statsItem}>
              <Text style={styles.statsLabel}>Average Glucose</Text>
              <Text style={styles.statsValue}>
                {todaysStats.averageGlucose !== null ? todaysStats.averageGlucose : '--'} <Text style={styles.unit}>mg/dL</Text>
              </Text>
            </View>
            <View style={styles.statsItem}>
              <Text style={styles.statsLabel}>Time In Range</Text>
              <Text style={styles.statsValue}>
                {todaysStats.timeInRange !== null ? `${todaysStats.timeInRange}%` : '--'}
              </Text>
            </View>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statsItem}>
              <Text style={styles.statsLabel}>Highest Reading</Text>
              <Text style={styles.statsValue}>
                {todaysStats.highestReading !== null ? todaysStats.highestReading : '--'} <Text style={styles.unit}>mg/dL</Text>
              </Text>
            </View>
            <View style={styles.statsItem}>
              <Text style={styles.statsLabel}>Lowest Reading</Text>
              <Text style={styles.statsValue}>
                {todaysStats.lowestReading !== null ? todaysStats.lowestReading : '--'} <Text style={styles.unit}>mg/dL</Text>
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Today's Insights</Text>
            <TouchableOpacity onPress={handleRefreshInsights} disabled={insightsLoading}>
              <Text style={[styles.viewAllLink, insightsLoading && { color: '#ccc' }]}>
                {insightsLoading ? 'Refreshing...' : 'Refresh'}
              </Text>
            </TouchableOpacity>
          </View>
          
          {insightsLoading && insights.length === 0 ? (
            <View style={styles.insightLoadingContainer}>
              <ActivityIndicator size="small" color="#4A90E2" />
              <Text style={styles.insightLoadingText}>Generating personalized insights...</Text>
            </View>
          ) : insightsError && insights.length === 0 ? (
            <View style={styles.insightErrorContainer}>
              <Text style={styles.insightErrorText}>Unable to generate insights</Text>
              <TouchableOpacity onPress={handleRefreshInsights} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {insights.map((insight, index) => {
                // Map insight types to colors
                const getInsightColor = (type: string) => {
                  switch (type) {
                    case 'positive': return '#28a745';
                    case 'warning': return '#ffc107';
                    case 'tip': return '#007bff';
                    default: return '#6c757d';
                  }
                };
                
                // Map insight types to FontAwesome icons
                const getInsightIconName = (type: string) => {
                  switch (type) {
                    case 'positive': return 'check-circle';
                    case 'warning': return 'exclamation-triangle';
                    case 'tip': return 'lightbulb';
                    default: return 'info-circle';
                  }
                };

                return (
                  <View key={insight.id} style={styles.insightItem}>
                    <View style={styles.insightIconContainer}>
                      {insight.icon && insight.icon.length === 2 ? (
                        // Show emoji icon if provided
                        <Text style={styles.insightEmoji}>{insight.icon}</Text>
                      ) : (
                        // Fallback to FontAwesome icon
                        <FontAwesome5 
                          name={getInsightIconName(insight.type)} 
                          size={16} 
                          color={getInsightColor(insight.type)} 
                          style={styles.insightIcon} 
                        />
                      )}
                    </View>
                    <View style={styles.insightTextContainer}>
                      <Text style={styles.insightTitle}>{insight.title}</Text>
                      <Text style={styles.insightDetails}>{insight.description}</Text>
                    </View>
                  </View>
                );
              })}
              
              {lastInsightsRefresh && (
                <Text style={styles.insightsTimestamp}>
                  Last updated: {lastInsightsRefresh.toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </Text>
              )}
            </>
          )}
        </View>

        <Modal
          animationType="slide"
          transparent={true}
          visible={isModalVisible}
          onRequestClose={closeModal}
        >
          <KeyboardAvoidingView
             behavior={Platform.OS === "ios" ? "padding" : "height"}
             style={modalStyles.centeredView}
          >
            <View style={modalStyles.modalView}>
              {renderModalContent()}
              <View style={modalStyles.buttonContainer}>
                   <TouchableOpacity style={modalStyles.cancelButton} onPress={closeModal}>
                     <Text style={modalStyles.cancelButtonText}>Cancel</Text>
                   </TouchableOpacity>
                   <TouchableOpacity 
                       style={[
                         modalStyles.saveButton, 
                         (loggingType === 'glucose' ? !(logDetails.glucoseLevel?.trim() && logDetails.time?.trim()) :
                          loggingType === 'meal' ? !(logDetails.meal_type?.trim() && logDetails.food_description?.trim()) :
                          loggingType === 'activity' ? !(logDetails.activity_type?.trim() && logDetails.duration_minutes?.trim() && (logDetails.activity_type === 'Other' ? logDetails.other_activity_type?.trim() : true)) :
                          loggingType === 'medication' ? !(medicationDetails.medication_type?.trim() && medicationDetails.medication_name?.trim() && medicationDetails.dosage?.trim() && medicationDetails.time && (medicationDetails.medication_type !== 'Insulin' || medicationDetails.injection_site?.trim())) :
                          true) && modalStyles.disabledButton
                       ]}
                       onPress={handleSaveLog}
                       disabled={
                           loggingType === 'glucose' ? !(logDetails.glucoseLevel?.trim() && logDetails.time?.trim()) :
                           loggingType === 'meal' ? !(logDetails.meal_type?.trim() && logDetails.food_description?.trim()) :
                           loggingType === 'activity' ? !(logDetails.activity_type?.trim() && logDetails.duration_minutes?.trim() && (logDetails.activity_type === 'Other' ? logDetails.other_activity_type?.trim() : true)) :
                           loggingType === 'medication' ? !(medicationDetails.medication_type?.trim() && medicationDetails.medication_name?.trim() && medicationDetails.dosage?.trim() && medicationDetails.time && (medicationDetails.medication_type !== 'Insulin' || medicationDetails.injection_site?.trim())) :
                           true
                       }
                   >
                     <Text style={modalStyles.saveButtonText}>Save Log</Text>
                   </TouchableOpacity>
               </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </ScrollView>
    </>
  );
};

export const modalStyles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
    width: '90%',
    maxWidth: 400,
  },
  modalTitle: {
    marginBottom: 24,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#2c3e50',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    marginBottom: 15,
    width: '100%',
    color: '#000',
    fontSize: 16,
  },
  modernInput: {
    borderWidth: 1,
    borderColor: '#E1E8ED',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    width: '100%',
    color: '#2c3e50',
    fontSize: 16,
    backgroundColor: '#FAFBFC',
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    marginBottom: 15,
    width: '100%',
    backgroundColor: '#fff',
  },
  modernDropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E1E8ED',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    width: '100%',
    backgroundColor: '#FAFBFC',
  },
  dropdownButtonText: {
    fontSize: 16,
    color: '#000',
  },
  modernDropdownButtonText: {
    fontSize: 16,
    color: '#2c3e50',
    fontWeight: '500',
  },
  dropdownOptionsContainer: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    width: '100%',
    maxHeight: 200, // Limit height and make scrollable if many options
    overflow: 'hidden', // Ensures content is clipped if it overflows
    marginBottom: 15,
    backgroundColor: '#fff',
  },
  modernDropdownOptionsContainer: {
    borderWidth: 1,
    borderColor: '#E1E8ED',
    borderRadius: 12,
    width: '100%',
    maxHeight: 240,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dropdownOption: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modernDropdownOption: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F7F9FA',
  },
  dropdownOptionText: {
    fontSize: 16,
    color: '#000',
  },
  modernDropdownOptionText: {
    fontSize: 16,
    color: '#2c3e50',
    fontWeight: '500',
  },
  buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      marginTop: 20,
      gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E1E8ED',
  },
  cancelButtonText: {
    color: '#6C757D',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#BDC3C7',
    opacity: 0.6,
  },
  contentContainer: {
      width: '100%',
      alignItems: 'center',
  },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 20,
    width: '100%',
  },
  aiButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  mealImage: {
    width: '100%',
    height: 250, // Increased height for better visibility
    borderRadius: 12,
    marginBottom: 20,
    backgroundColor: '#f8f9fa', // Light background for better contrast
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  errorText: {
    color: '#e74c3c',
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 16,
  },
  analysisTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 16,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  nutritionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 16,
  },
  nutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  nutritionInputContainer: {
    width: '48%', // Two columns
    marginBottom: 12,
  },
  ingredientsText: {
    fontSize: 15,
    color: '#374151',
    fontStyle: 'italic',
    lineHeight: 22,
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    width: '100%',
  },
  // Injection site recommendation styles
  recommendationWrapper: {
    width: '100%',
    marginBottom: 16,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e1e8ed',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  recommendationContainer: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E1E8ED',
    backgroundColor: '#FAFBFC',
    padding: 16,
  },
  recommendationLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e1e8ed',
  },
  recommendationLoadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  recommendationCard: {
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#0ea5e9',
  },
  recommendationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  recommendationIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  recommendationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0c4a6e',
    flex: 1,
  },
  recommendationReason: {
    fontSize: 14,
    color: '#0369a1',
    lineHeight: 20,
    marginBottom: 8,
  },
  fallbackNote: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  useRecommendationButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  useRecommendationButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  getRecommendationButton: {
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
  },
  getRecommendationButtonText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
  },

  showRecommendationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f9ff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#0ea5e9',
    marginBottom: 16,
    shadowColor: '#0ea5e9',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  showRecommendationButtonText: {
    color: '#0ea5e9',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Method selection styles
  methodSelectionContainer: {
    width: '100%',
    gap: 12,
    marginBottom: 20,
  },
  methodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
    shadowColor: '#4A90E2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  methodButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  methodButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
    borderWidth: 2,
    borderColor: '#4A90E2',
  },
  methodButtonSecondaryText: {
    color: '#4A90E2',
    fontSize: 16,
    fontWeight: '600',
  },
  switchMethodButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  switchMethodButtonText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 12,
    marginTop: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
    marginTop: -8,
    fontStyle: 'italic',
  },
});

// Toast styles
const toastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    alignSelf: 'center',
    backgroundColor: '#323232',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});