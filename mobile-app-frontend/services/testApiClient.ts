// Test utility for API client
import apiClient from './apiClient';

export const testApiConnection = async (): Promise<{
  success: boolean;
  workingUrl?: string;
  error?: string;
  responseTime?: number;
}> => {
  const startTime = Date.now();
  
  try {
    console.log('🧪 Testing API client connection...');
    
    // Test health endpoint
    const result = await apiClient.get('/api/health');
    const responseTime = Date.now() - startTime;
    
    if (result.success) {
      console.log(`✅ API client test passed (${responseTime}ms)`);
      console.log(`🌐 Working URL: ${result.workingUrl}`);
      console.log(`📊 Response:`, result.data);
      
      return {
        success: true,
        workingUrl: result.workingUrl,
        responseTime
      };
    } else {
      console.log(`❌ API client test failed: ${result.error}`);
      return {
        success: false,
        error: result.error,
        responseTime
      };
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    console.log(`❌ API client test error: ${error.message}`);
    return {
      success: false,
      error: error.message,
      responseTime
    };
  }
};

export const runApiTests = async (): Promise<void> => {
  console.log('🚀 Running API client tests...');
  
  // Test 1: Health check
  const healthTest = await testApiConnection();
  
  if (!healthTest.success) {
    console.log('❌ Health check failed, skipping other tests');
    return;
  }
  
  // Test 2: Invalid user profile (should return user not found)
  try {
    const invalidUserResult = await apiClient.get('/api/user-profile?clerk_user_id=test_invalid_user');
    if (!invalidUserResult.success && invalidUserResult.error?.includes('User not found')) {
      console.log('✅ Invalid user test passed - correctly returned user not found');
    } else {
      console.log('⚠️ Invalid user test unexpected result:', invalidUserResult);
    }
  } catch (error) {
    console.log('❌ Invalid user test error:', error);
  }
  
  console.log('🏁 API client tests completed');
};

export default { testApiConnection, runApiTests };