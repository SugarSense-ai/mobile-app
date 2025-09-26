import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBaseUrl } from './api';

const ONBOARDING_COMPLETED_KEY_PREFIX = 'onboarding_completed_';

export const onboardingService = {
  /**
   * Get the storage key for the current user's onboarding status
   */
  getUserOnboardingKey(userId: string): string {
    return `${ONBOARDING_COMPLETED_KEY_PREFIX}${userId}`;
  },

  /**
   * Check if the current user has completed onboarding
   * @param userId - The user's unique ID from Clerk
   * @returns Promise<boolean> - true if onboarding is completed, false otherwise
   */
  async isOnboardingCompleted(userId?: string): Promise<boolean> {
    try {
      if (!userId) {
        console.log('❌ No userId provided, onboarding not completed');
        return false;
      }

      console.log(`🔍 Checking onboarding status for user: ${userId}`);
      
      // First check the backend for the authoritative status
      try {
        const baseUrl = getBaseUrl();
        const response = await fetch(`${baseUrl}/api/user-profile?clerk_user_id=${userId}`);
        
        if (response.ok) {
          const userData = await response.json();
          const backendStatus = userData.user?.onboarding_completed || false;
          console.log(`📡 Backend onboarding status for user ${userId}: ${backendStatus}`);
          
          // Sync the backend status with local storage
          const userKey = this.getUserOnboardingKey(userId);
          await AsyncStorage.setItem(userKey, backendStatus.toString());
          console.log(`🔄 Synced onboarding status to local storage: ${backendStatus}`);
          
          console.log(`✅ Onboarding completed for user ${userId}: ${backendStatus}`);
          return backendStatus;
        } else {
          console.log(`⚠️ Backend check failed (${response.status}), falling back to local storage`);
        }
      } catch (backendError) {
        console.log(`⚠️ Backend check error, falling back to local storage:`, backendError);
      }
      
      // Fallback to local storage if backend check fails
      const userKey = this.getUserOnboardingKey(userId);
      const storedValue = await AsyncStorage.getItem(userKey);
      
      // For new users or when backend is unreachable, default to false to ensure onboarding
      if (storedValue === null || storedValue === undefined) {
        console.log(`📱 No local storage data for user ${userId}, defaulting to onboarding not completed`);
        console.log(`✅ Onboarding completed for user ${userId}: false`);
        return false;
      }
      
      const isCompleted = storedValue === 'true';
      console.log(`📱 Local storage onboarding status for user ${userId}: ${isCompleted}`);
      console.log(`✅ Onboarding completed for user ${userId}: ${isCompleted}`);
      return isCompleted;
    } catch (error) {
      console.error('❌ Error checking onboarding status:', error);
      return false;
    }
  },

  /**
   * Mark onboarding as completed for the current user
   * @param userId - The user's unique ID from Clerk
   * @returns Promise<void>
   */
  async setOnboardingCompleted(userId: string): Promise<void> {
    try {
      if (!userId) {
        console.error('❌ Cannot set onboarding completed: No userId provided');
        return;
      }

      console.log(`🎯 Setting onboarding as completed for user: ${userId}`);
      
      // Update backend first
      try {
        const baseUrl = getBaseUrl();
        const response = await fetch(`${baseUrl}/api/save-onboarding-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clerk_user_id: userId,
            onboarding_completed: true
          }),
        });
        
        if (response.ok) {
          console.log(`📡 Backend onboarding status updated for user ${userId}`);
        } else {
          console.log(`⚠️ Backend update failed (${response.status}), but continuing with local update`);
        }
      } catch (backendError) {
        console.log(`⚠️ Backend update error, but continuing with local update:`, backendError);
      }
      
      // Update local storage
      const userKey = this.getUserOnboardingKey(userId);
      await AsyncStorage.setItem(userKey, 'true');
      console.log(`✅ Onboarding marked as completed for user ${userId}`);
    } catch (error) {
      console.error('❌ Error setting onboarding completed:', error);
    }
  },

  /**
   * Clean up old onboarding data (for migration)
   */
  async cleanupOldOnboardingData(): Promise<void> {
    try {
      console.log('🧹 Cleaning up old onboarding data...');
      await AsyncStorage.removeItem('onboarding_completed');
      await AsyncStorage.removeItem('hasSeenOnboarding');
      
      // Also clean up any user-specific onboarding keys that might be stale
      const allKeys = await AsyncStorage.getAllKeys();
      const onboardingKeys = allKeys.filter(key => key.startsWith(ONBOARDING_COMPLETED_KEY_PREFIX));
      
      if (onboardingKeys.length > 0) {
        console.log(`🧹 Found ${onboardingKeys.length} user-specific onboarding keys to clean`);
        await AsyncStorage.multiRemove(onboardingKeys);
      }
      
      console.log('✅ Old onboarding data cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up old onboarding data:', error);
    }
  },

  /**
   * Clear onboarding status for a specific user (useful for logout)
   * @param userId - The user's unique ID from Clerk
   */
  async clearOnboardingStatus(userId: string): Promise<void> {
    try {
      if (!userId) {
        console.error('❌ Cannot clear onboarding status: No userId provided');
        return;
      }

      console.log(`🧹 Clearing onboarding status for user: ${userId}`);
      const userKey = this.getUserOnboardingKey(userId);
      await AsyncStorage.removeItem(userKey);
      console.log(`✅ Onboarding status cleared for user ${userId}`);
    } catch (error) {
      console.error('❌ Error clearing onboarding status:', error);
    }
  },
}; 