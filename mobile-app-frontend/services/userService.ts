import { useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBaseUrl } from './api';

export const userService = {
  /**
   * Get the Clerk user ID for API calls
   */
  getClerkUserId(): string | null {
    // This should be called within a component that has access to useUser
    // For now, we'll return null and let the calling component provide it
    return null;
  },

  /**
   * Get the database user ID from AsyncStorage
   */
  async getDatabaseUserId(clerkUserId: string): Promise<number | null> {
    try {
      const storedUserId = await AsyncStorage.getItem(`db_user_id_${clerkUserId}`);
      return storedUserId ? parseInt(storedUserId, 10) : null;
    } catch (error) {
      console.error('Error getting database user ID:', error);
      return null;
    }
  },

  /**
   * Get the database user ID from backend if not cached
   */
  async fetchDatabaseUserId(clerkUserId: string): Promise<number | null> {
    try {
      const baseUrl = await getBaseUrl();
      const response = await fetch(`${baseUrl}/api/user-profile?clerk_user_id=${clerkUserId}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user.user_id) {
          // Cache it for future use
          await AsyncStorage.setItem(`db_user_id_${clerkUserId}`, data.user.user_id.toString());
          return data.user.user_id;
        }
      }
      return null;
    } catch (error) {
      console.error('Error fetching database user ID:', error);
      return null;
    }
  },

  /**
   * Get or fetch database user ID with fallback
   */
  async getOrFetchDatabaseUserId(clerkUserId: string): Promise<number | null> {
    // Try to get from cache first
    let dbUserId = await this.getDatabaseUserId(clerkUserId);
    
    // If not cached, fetch from backend
    if (!dbUserId) {
      dbUserId = await this.fetchDatabaseUserId(clerkUserId);
    }
    
    return dbUserId;
  },

  /**
   * Helper to create request body with user ID
   */
  async createRequestBody(clerkUserId: string, data: any): Promise<any> {
    return {
      clerk_user_id: clerkUserId,
      ...data
    };
  },

  /**
   * Update user profile data
   */
  async updateUserProfile(clerkUserId: string, profileData: any): Promise<any> {
    try {
      const baseUrl = await getBaseUrl();
      const requestBody = await this.createRequestBody(clerkUserId, profileData);
      
      const response = await fetch(`${baseUrl}/api/update-user-profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }

      return data;
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  }
};

/**
 * Hook to get user IDs in React components
 */
export const useUserIds = () => {
  const { user } = useUser();
  
  const getClerkUserId = () => user?.id || null;
  
  const getDatabaseUserId = async () => {
    if (!user?.id) return null;
    return await userService.getOrFetchDatabaseUserId(user.id);
  };

  const createRequestBody = async (data: any) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }
    return userService.createRequestBody(user.id, data);
  };

  const updateUserProfile = async (profileData: any) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }
    return userService.updateUserProfile(user.id, profileData);
  };

  return {
    clerkUserId: user?.id || null,
    getDatabaseUserId,
    createRequestBody,
    updateUserProfile,
    isAuthenticated: !!user?.id
  };
}; 