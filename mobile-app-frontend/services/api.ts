import { API_ENDPOINTS } from '@/constants/config';
import { testNetworkConnectivity, NetworkInfo } from '@/constants/networkUtils';

let apiConfig: { baseUrl: string } = {
  baseUrl: API_ENDPOINTS.BASE_URL,
};

let networkInfo: NetworkInfo | null = null;
let isInitializing = false;

export const initializeApi = async (): Promise<string> => {
  if (networkInfo?.workingUrl) {
    return networkInfo.workingUrl;
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
      return result.workingUrl;
    } else {
      console.error('❌ Failed to find a working backend URL.');
      // Fallback to the default URL, though it's likely to fail
      apiConfig.baseUrl = API_ENDPOINTS.BASE_URL;
      throw new Error('Could not connect to the backend.');
    }
  } catch (error) {
    console.error('Error during API initialization:', error);
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