import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';

export const onboardingService = {
  /**
   * Check if the user has completed onboarding
   * @returns Promise<boolean> - true if onboarding is completed, false otherwise
   */
  async isOnboardingCompleted(): Promise<boolean> {
    try {
      const storedValue = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
      return storedValue === 'true';
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      return false;
    }
  },

  /**
   * Mark onboarding as completed
   * @returns Promise<void>
   */
  async setOnboardingCompleted(): Promise<void> {
    try {
      await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    } catch (error) {
      console.error('Error setting onboarding completed:', error);
    }
  },

  /**
   * Reset onboarding status (for testing purposes)
   * @returns Promise<void>
   */
  async resetOnboardingStatus(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    } catch (error) {
      console.error('Error resetting onboarding status:', error);
    }
  },
}; 