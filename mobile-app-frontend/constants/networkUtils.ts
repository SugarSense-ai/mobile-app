// Network utility functions for better debugging and connectivity

export interface NetworkInfo {
  workingUrl: string | null;
  testedUrls: string[];
  failedUrls: string[];
  responseTime: number;
}

export const testNetworkConnectivity = async (urls: string[]): Promise<NetworkInfo> => {
  const testedUrls: string[] = [];
  const failedUrls: string[] = [];
  const startTime = Date.now();
  
  for (const url of urls) {
    try {
      console.log(`🔍 Testing connectivity to: ${url}`);
      testedUrls.push(url);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      const response = await fetch(`${url}/api/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const endTime = Date.now();
        console.log(`✅ Connectivity test passed for: ${url} (${endTime - startTime}ms)`);
        return {
          workingUrl: url,
          testedUrls,
          failedUrls,
          responseTime: endTime - startTime
        };
      } else {
        console.log(`❌ Connectivity test failed for ${url}: HTTP ${response.status}`);
        failedUrls.push(url);
      }
    } catch (error) {
      console.log(`❌ Connectivity test error for ${url}:`, error);
      failedUrls.push(url);
    }
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
  testNetworkConnectivity,
  getNetworkDiagnostics,
  getCommonNetworkRanges
}; 