import { getBaseUrl } from './api';
import * as FileSystem from 'expo-file-system';

export interface ChatMessage {
  type: 'user' | 'system' | 'info';
  text?: string;
  time: string;
  avatar?: any;
  image?: string;
  icon?: string;
  iconName?: string;
}

export interface HealthSnapshot {
  glucoseSummary: {
    averageToday: number;
    spikes: any[];
    drops: any[];
    recentReadings: any[];
  };
  mealHistory: {
    lastMeal: string;
    typicalDinner: string;
    recentHighCarb: boolean;
  };
  sleepSummary: {
    hours: number;
    quality: string;
  };
  activitySummary: {
    stepsToday: number;
    activeMinutes: number;
    activityLevel?: string;
    sedentary: boolean;
  };
}

const convertImageToBase64 = async (imageUri: string) => {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } catch (e) {
    console.error("Failed to convert image to base64", e);
    throw e;
  }
};

export const sendMessage = async (
  message: string,
  healthSnapshot: HealthSnapshot | null,
  chatHistory: ChatMessage[],
  imageUri?: string | null
): Promise<string> => {
  try {
    const baseUrl = await getBaseUrl();
    let imageBase64: string | null = null;
    if (imageUri) {
      imageBase64 = await convertImageToBase64(imageUri);
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        image: imageBase64,
        health_snapshot: healthSnapshot,
        chat_history: chatHistory, // Send the whole chat message object
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error Response:', errorData);
      throw new Error(errorData.error || 'Failed to get chat response from API');
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Error sending message to API:', error);
    throw error;
  }
};
