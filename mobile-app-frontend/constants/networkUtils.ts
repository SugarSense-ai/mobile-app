// Network utility functions for better debugging and connectivity
import { NativeModules } from 'react-native';

// Helper to get the host IP address for development
// This is crucial for connecting to a local backend from a physical device
export const getHostIp = (): string => {
  try {
    const { scriptURL } = NativeModules.SourceCode;
    console.log('🔍 NativeModules.SourceCode.scriptURL:', scriptURL);
    
    if (scriptURL) {
      const address = scriptURL.split('://')[1].split('/')[0];
      const hostname = address.split(':')[0];
      console.log('🔍 Extracted hostname from scriptURL:', hostname);
      
      // Validate that we got a reasonable IP address
      if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return hostname;
      }
    }
  } catch (e) {
    console.log('❌ Error extracting host IP from NativeModules:', e);
  }
  
  // Fallback to current working IP for this network
  console.log('🔄 Falling back to current working IP: 192.168.1.138');
  return '192.168.1.138';
};

export interface NetworkInfo {
  workingUrl: string | null;
  testedUrls: string[];
  failedUrls: string[];
  responseTime: number;
}

export const testNetworkConnectivity = async (urls: string[], _retries: number = 2): Promise<NetworkInfo> => {
  const testedUrls: string[] = [];
  const failedUrls: string[] = [];
  const startTime = Date.now();
  
  const tryUrls = async (): Promise<string | null> => {
    for (const url of urls) {
      try {
        console.log(`🔍 Testing connectivity to: ${url}`);
        testedUrls.push(url);

        // React Native's global fetch does **not** currently support AbortController.
        // Using it triggers an immediate "TypeError: Network request failed" on iOS/Android.
        // Instead, implement a universal timeout with Promise.race.

        const fetchPromise = fetch(`${url}/api/health`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        // Timeout after 5 seconds to avoid long hangs on unreachable hosts.
        const timeoutPromise = new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        );

        const response: any = await Promise.race([fetchPromise, timeoutPromise]);

        if (response.ok) {
          return url;
        }

        console.log(`❌ Connectivity test failed for ${url}: HTTP ${response.status}`);
        failedUrls.push(url);
      } catch (error) {
        console.log(`❌ Connectivity test error for ${url}:`, error);
        failedUrls.push(url);
      }
    }
    return null;
  };

  let working: string | null = null;
  for (let attempt = 0; attempt < _retries + 1; attempt++) {
    working = await tryUrls();
    if (working) break;
    // Small delay before retrying
    if (attempt < _retries) {
      await new Promise((r) => setTimeout(r, 1500));
      console.log(`🔄 Retry connectivity attempt #${attempt + 2}`);
    }
  }

  if (working) {
    const endTime = Date.now();
    console.log(`✅ Connectivity test passed for: ${working} (${endTime - startTime}ms)`);
    return {
      workingUrl: working,
      testedUrls,
      failedUrls,
      responseTime: endTime - startTime,
    };
  }
  
  const endTime = Date.now();
  console.log('❌ All connectivity tests failed');
  
  return {
    workingUrl: null,
    testedUrls,
    failedUrls,
    responseTime: endTime - startTime
  };
};

export const getNetworkDiagnostics = async (urls: string[]): Promise<{
  summary: string;
  details: any;
  suggestions: string[];
}> => {
  const networkInfo = await testNetworkConnectivity(urls);
  
  const suggestions = [];
  
  if (!networkInfo.workingUrl) {
    suggestions.push('• Check if the backend server is running');
    suggestions.push('• Verify you\'re connected to the same WiFi network as your computer');
    suggestions.push('• Make sure port 3001 is not blocked by firewall');
    suggestions.push('• Try restarting the backend server');
    suggestions.push('• Check that the backend is running on 192.168.1.138:3001 or 192.168.0.103:3001');
  }
  
  const summary = networkInfo.workingUrl 
    ? `✅ Connected to ${networkInfo.workingUrl} (${networkInfo.responseTime}ms)`
    : `❌ Unable to connect to backend server after testing ${networkInfo.testedUrls.length} URLs`;
  
  return {
    summary,
    details: networkInfo,
    suggestions
  };
};

// Helper to get common network IP ranges for debugging
export const getCommonNetworkRanges = (): string[] => {
  return [
    '192.168.0.x',   // Most common home router range
    '192.168.1.x',   // Second most common
    '10.0.0.x',      // Corporate networks
    '172.16.0.x',    // Another private range
  ];
};

export default {
  getHostIp,
  testNetworkConnectivity,
  getNetworkDiagnostics,
  getCommonNetworkRanges
}; 