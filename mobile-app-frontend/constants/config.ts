import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Function to get the host IP address from Expo's config
const getHostIp = () => {
  // hostUri is typically in the format '192.168.x.x:8081'
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    return hostUri.split(':')[0];
  }
  // Fallback for simulators or when hostUri is not available
  return 'localhost'; 
};

// Dynamically construct the primary backend URL
const DYNAMIC_BACKEND_IP = getHostIp();
const DYNAMIC_BACKEND_URL = `http://${DYNAMIC_BACKEND_IP}:3001`;

// Additional local development URLs to try
const DEVELOPMENT_URLS = [
  DYNAMIC_BACKEND_URL,
  'http://192.168.0.101:3001',  // Your actual local IP from backend logs
  'http://127.0.0.1:3001',      // Localhost from backend logs
  'http://localhost:3001',      // For simulator
  'http://10.0.2.2:3001',       // Android emulator host
];

// Configuration for different environments
const Config = {
  // Development configuration
  development: {
    BACKEND_URL: DEVELOPMENT_URLS[0], // Start with dynamically detected IP
    FALLBACK_URLS: DEVELOPMENT_URLS,  // All URLs to try
  },
  
  // Production configuration - for now, use your local network IP
  // TODO: Replace with your actual production backend URL when deployed
  production: {
    BACKEND_URL: 'http://192.168.0.101:3001',  // Your local development server
    FALLBACK_URLS: [
      'http://192.168.0.101:3001',      // Primary local server
      'http://127.0.0.1:3001',          // Localhost fallback
      'http://localhost:3001',          // Localhost alternative
    ],
  }
};

// Auto-detect environment based on __DEV__ flag
const isDevelopment = __DEV__;

// Use the appropriate config based on development/production mode
const currentConfig = isDevelopment ? Config.development : Config.production;

// Debug logging to help troubleshoot
console.log('🔧🔧🔧 CONFIG DEBUG INFO 🔧🔧🔧');
console.log('  __DEV__:', __DEV__);
console.log('  isDevelopment:', isDevelopment);
console.log('  hostUri:', Constants.expoConfig?.hostUri);
console.log('  dynamicBackendIP:', DYNAMIC_BACKEND_IP);
console.log('  DYNAMIC_BACKEND_URL:', DYNAMIC_BACKEND_URL);
console.log('  DEVELOPMENT_URLS:', DEVELOPMENT_URLS);
console.log('  selectedConfig:', isDevelopment ? 'development' : 'production');
console.log('  baseUrl:', currentConfig.BACKEND_URL);
console.log('  fallbackUrls:', currentConfig.FALLBACK_URLS);
console.log('🔧🔧🔧 END CONFIG DEBUG 🔧🔧🔧');

export const BACKEND_URL = currentConfig.BACKEND_URL;
export const FALLBACK_URLS = currentConfig.FALLBACK_URLS || [currentConfig.BACKEND_URL];

export const API_ENDPOINTS = {
  BASE_URL: BACKEND_URL,
  FALLBACK_URLS: FALLBACK_URLS,
  SYNC_HEALTH_DATA: `${BACKEND_URL}/api/sync-health-data`,
  LOG_GLUCOSE: `${BACKEND_URL}/api/log-glucose`,
  LOG_MEAL: `${BACKEND_URL}/api/log-meal`,
  LOG_ACTIVITY: `${BACKEND_URL}/api/log-activity`,
  LOG_MEDICATION: `${BACKEND_URL}/api/log-medication`,
  PREDICT_GLUCOSE: `${BACKEND_URL}/api/predict-glucose`,
  CHAT: `${BACKEND_URL}/api/chat`,
  DIABETES_DASHBOARD: `${BACKEND_URL}/api/diabetes-dashboard`,
  ACTIVITY_LOGS: `${BACKEND_URL}/api/activity-logs`,
  HEALTH_CHECK: `${BACKEND_URL}/api/health`,
  INSIGHTS: `${BACKEND_URL}/api/insights`,
};

export default currentConfig; 