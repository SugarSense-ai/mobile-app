import AsyncStorage from '@react-native-async-storage/async-storage';

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
      const userKey = this.getUserOnboardingKey(userId);
      const storedValue = await AsyncStorage.getItem(userKey);
      const isCompleted = storedValue === 'true';
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
      console.log('✅ Old onboarding data cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up old onboarding data:', error);
    }
  },
}; 