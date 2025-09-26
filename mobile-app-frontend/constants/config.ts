import { Platform } from 'react-native';
import { getHostIp } from './networkUtils'; // Import the new helper

// --- Dynamic Configuration ---

// Dynamically construct the primary backend URL
const DYNAMIC_BACKEND_IP = getHostIp();
const DYNAMIC_BACKEND_URL = `http://${DYNAMIC_BACKEND_IP}:3001`;

// Additional local development URLs to try
// Updated with current network IP address - PRIORITIZE LOCALHOST FOR TESTING
const DEVELOPMENT_URLS = [
  'http://localhost:3001',      // For iOS simulator - PRIORITIZE THIS
  'http://127.0.0.1:3001',      // Localhost alternative
  'http://192.168.1.138:3001',  // Current network IP
  DYNAMIC_BACKEND_URL,          // Dynamically detected IP (fallback)
  'http://192.168.0.103:3001',  // Previous IP as fallback
  'http://10.0.2.2:3001',       // Android emulator host
];

// Configuration for different environments
const Config = {
  // Development configuration
  development: {
    // Use localhost first for testing - backend is confirmed working on localhost:3001
    BACKEND_URL: 'http://localhost:3001',
    FALLBACK_URLS: DEVELOPMENT_URLS,  // All URLs to try
  },
  
  // Production configuration - for now, use your local network IP
  // TODO: Replace with your actual production backend URL when deployed
  production: {
    BACKEND_URL: 'http://192.168.1.138:3001',  // Current local development server
    FALLBACK_URLS: [
      'http://192.168.1.138:3001',      // Primary local server
      'http://192.168.0.103:3001',      // Previous IP as fallback
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
console.log('   __DEV__:', __DEV__);
console.log('   isDevelopment:', isDevelopment);
console.log('   hostIp:', DYNAMIC_BACKEND_IP);
console.log('   dynamicBackendUrl:', DYNAMIC_BACKEND_URL);
console.log('   selectedConfig:', isDevelopment ? 'development' : 'production');
console.log('   baseUrl:', currentConfig.BACKEND_URL);
console.log('   fallbackUrls:', currentConfig.FALLBACK_URLS);
console.log('🔧🔧🔧 END CONFIG DEBUG 🔧🔧🔧');

export const BACKEND_URL = currentConfig.BACKEND_URL;
export const FALLBACK_URLS = currentConfig.FALLBACK_URLS;

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
  REGISTER_USER: `${BACKEND_URL}/api/register-user`,
  SAVE_ONBOARDING_DATA: `${BACKEND_URL}/api/save-onboarding-data`,
  RECENT_MEAL: `${BACKEND_URL}/api/recent-meal`,
};

// Make it easy to switch between local and production clerk keys
const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export { CLERK_PUBLISHABLE_KEY };

export default currentConfig; 