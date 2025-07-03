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

// List of URLs to try. The dynamically detected one is first.
const DEVELOPMENT_URLS = [
  DYNAMIC_BACKEND_URL,
  'http://localhost:3001',      // For simulator
  'http://127.0.0.1:3001',      // Alternative localhost
];

// Configuration for different environments
const Config = {
  // Development configuration
  development: {
    BACKEND_URL: DEVELOPMENT_URLS[0], // Start with IP address for physical device
    FALLBACK_URLS: DEVELOPMENT_URLS,  // All URLs to try
  },
  
  // Production configuration (when you deploy)
  production: {
    BACKEND_URL: 'https://your-production-backend.com',
    FALLBACK_URLS: ['https://your-production-backend.com'],
  }
};

// Auto-detect environment
const isDevelopment = __DEV__;
const currentConfig = isDevelopment ? Config.development : Config.production;

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
};

export default currentConfig; 