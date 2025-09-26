import { API_ENDPOINTS } from '@/constants/config';
import { testNetworkConnectivity, NetworkInfo } from '@/constants/networkUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';

let apiConfig: { baseUrl: string } = {
  baseUrl: API_ENDPOINTS.BASE_URL,
};

let networkInfo: NetworkInfo | null = null;
let isInitializing = false;

export const initializeApi = async (): Promise<string> => {
  if (networkInfo?.workingUrl) {
    return networkInfo.workingUrl;
  }

  // 1️⃣ Try cached URL quickly ---------------------------------------
  try {
    const cached = await AsyncStorage.getItem('LAST_WORKING_BACKEND_URL');
    if (cached) {
      console.log(`🗄️  Trying cached backend URL first: ${cached}`);
      const quick = await testNetworkConnectivity([cached], 0);
      if (quick.workingUrl) {
        networkInfo = quick;
        apiConfig.baseUrl = quick.workingUrl;
        await AsyncStorage.setItem('LAST_WORKING_BACKEND_URL', quick.workingUrl);
        return quick.workingUrl;
      }
    }
  } catch (e) {
    console.log('⚠️ Failed to use cached URL', e);
  }

  if (isInitializing) {
    // Wait for the ongoing initialization to complete
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!isInitializing && networkInfo?.workingUrl) {
          clearInterval(interval);
          resolve(networkInfo.workingUrl);
        }
      }, 100);
    });
  }

  isInitializing = true;
  console.log('🧪 Initializing API and testing network connectivity...');

  try {
    const result = await testNetworkConnectivity(API_ENDPOINTS.FALLBACK_URLS);
    networkInfo = result;

    if (result.workingUrl) {
      console.log(`✅ API initialized with base URL: ${result.workingUrl}`);
      apiConfig.baseUrl = result.workingUrl;
      // Cache for next launch
      try {
        await AsyncStorage.setItem('LAST_WORKING_BACKEND_URL', result.workingUrl);
      } catch {}
      return result.workingUrl;
    } else {
      console.error('❌ Failed to find a working backend URL.');
      // Fallback to the default URL, though it's likely to fail
      apiConfig.baseUrl = API_ENDPOINTS.BASE_URL;
      throw new Error('Could not connect to the backend.');
    }
  } catch (error) {
    console.error('Error during API initialization:', error);
    // Retry once more after a short delay, in case of a startup race condition
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('🔄 Retrying API initialization one last time...');
    const finalResult = await testNetworkConnectivity(API_ENDPOINTS.FALLBACK_URLS, 1);
    if (finalResult.workingUrl) {
      console.log(`✅ API initialized on second attempt: ${finalResult.workingUrl}`);
      networkInfo = finalResult;
      apiConfig.baseUrl = finalResult.workingUrl;
      await AsyncStorage.setItem('LAST_WORKING_BACKEND_URL', finalResult.workingUrl);
      isInitializing = false;
      return finalResult.workingUrl;
    }
    
    console.error('❌ Final API initialization attempt failed.');
    isInitializing = false;
    throw error;
  } finally {
    isInitializing = false;
  }
};

export const getBaseUrl = async (): Promise<string> => {
  if (networkInfo?.workingUrl) {
    return networkInfo.workingUrl;
  }
  return initializeApi();
};

export const getApiEndpoint = async (endpoint: Exclude<keyof typeof API_ENDPOINTS, 'FALLBACK_URLS'>) => {
  const baseUrl = await getBaseUrl();
  const endpointValue = API_ENDPOINTS[endpoint];

  if (typeof endpointValue !== 'string') {
    throw new Error(`Endpoint ${endpoint} is not a valid string endpoint.`);
  }
  // The API_ENDPOINTS object is built with the initial, possibly incorrect,
  // BASE_URL. We need to reconstruct the URL with the correct, validated base URL.
  const path = endpointValue.substring(API_ENDPOINTS.BASE_URL.length);
  return `${baseUrl}${path}`;
}; 