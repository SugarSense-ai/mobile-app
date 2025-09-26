// API Client with automatic fallback and retry logic
import config, { FALLBACK_URLS } from '@/constants/config';
import { testNetworkConnectivity } from '@/constants/networkUtils';

interface ApiClientOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  retries?: number;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
  workingUrl?: string;
}

class ApiClient {
  private workingUrl: string | null = null;
  private lastConnectivityTest: number = 0;
  private connectivityTestInterval = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.workingUrl = config.BACKEND_URL;
  }

  private async findWorkingUrl(): Promise<string | null> {
    const now = Date.now();
    
    // If we recently tested connectivity and have a working URL, use it
    if (this.workingUrl && (now - this.lastConnectivityTest) < this.connectivityTestInterval) {
      console.log(`🔄 Using cached working URL: ${this.workingUrl}`);
      return this.workingUrl;
    }

    console.log('🔍 Testing connectivity to find working backend URL...');
    
    // Test all possible URLs
    const urlsToTest = [config.BACKEND_URL, ...FALLBACK_URLS];
    const networkInfo = await testNetworkConnectivity(urlsToTest, 1);
    
    if (networkInfo.workingUrl) {
      this.workingUrl = networkInfo.workingUrl;
      this.lastConnectivityTest = now;
      console.log(`✅ Found working URL: ${this.workingUrl}`);
      return this.workingUrl;
    }

    console.log('❌ No working URL found');
    return null;
  }

  private async makeRequest<T>(
    endpoint: string, 
    options: ApiClientOptions = {}
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = 10000, // 10 second default timeout
      retries = 2
    } = options;

    // Find working URL first
    const baseUrl = await this.findWorkingUrl();
    if (!baseUrl) {
      return {
        success: false,
        error: 'Unable to connect to backend server. Please check your network connection.',
        status: 0
      };
    }

    const url = `${baseUrl}${endpoint}`;
    const requestOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (body) {
      requestOptions.body = body;
    }

    // Attempt request with retries
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        console.log(`🌐 API Request (attempt ${attempt}): ${method} ${url}`);

        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        );

        // Make the request
        const response = await Promise.race([
          fetch(url, requestOptions),
          timeoutPromise
        ]) as Response;

        console.log(`📡 Response received: ${response.status} ${response.statusText}`);

        if (response.ok) {
          let data: T | undefined;
          const contentType = response.headers.get('Content-Type') || '';
          
          if (contentType.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text() as unknown as T;
          }

          return {
            success: true,
            data,
            status: response.status,
            workingUrl: baseUrl
          };
        } else {
          // Handle HTTP errors
          let errorMessage: string;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
          } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }

          console.log(`❌ HTTP Error: ${errorMessage}`);
          
          return {
            success: false,
            error: errorMessage,
            status: response.status,
            workingUrl: baseUrl
          };
        }
      } catch (error: any) {
        console.log(`❌ Request failed (attempt ${attempt}): ${error.message}`);
        
        // If this was a network error and we have more attempts, try to find a new working URL
        if (attempt <= retries && (error.message.includes('timeout') || error.message.includes('Network'))) {
          this.workingUrl = null; // Invalidate cached URL
          this.lastConnectivityTest = 0; // Force new connectivity test
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        
        // Last attempt failed
        if (attempt === retries + 1) {
          return {
            success: false,
            error: error.message.includes('timeout') 
              ? 'Request timed out. Please check your network connection.'
              : `Network error: ${error.message}`,
            status: 0
          };
        }
      }
    }

    return {
      success: false,
      error: 'Unexpected error occurred',
      status: 0
    };
  }

  // Convenience methods
  async get<T>(endpoint: string, options: Omit<ApiClientOptions, 'method'> = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, data: any, options: Omit<ApiClientOptions, 'method' | 'body'> = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async put<T>(endpoint: string, data: any, options: Omit<ApiClientOptions, 'method' | 'body'> = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async delete<T>(endpoint: string, options: Omit<ApiClientOptions, 'method'> = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, { ...options, method: 'DELETE' });
  }

  // Reset connectivity cache (useful for debugging)
  resetConnectivityCache(): void {
    this.workingUrl = null;
    this.lastConnectivityTest = 0;
    console.log('🔄 Connectivity cache reset');
  }

  // Get current working URL
  getCurrentWorkingUrl(): string | null {
    return this.workingUrl;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient;