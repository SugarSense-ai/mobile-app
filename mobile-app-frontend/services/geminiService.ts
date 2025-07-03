import * as FileSystem from 'expo-file-system';
import { getBaseUrl } from './api';

export interface ChatMessage {
  type: 'user' | 'system' | 'info' | 'badge';
  text?: string;
  image?: string;
  time: string;
  avatar?: any;
  icon?: string;
  iconName?: string;
  highlighted?: boolean;
}

export const sendMessageToLlama = async (message: string): Promise<string> => {
  // Simulate API call
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(`Llama AI response to: "${message}"`);
    }, 1000);
  });
};

export const sendImageToGemini = async (imageUri: string): Promise<string> => {
  try {
    const baseUrl = await getBaseUrl();
    const base64Image = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });

    const response = await fetch(`${baseUrl}/gemini-analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageData: base64Image }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to analyze image with Gemini API');
    }

    const data = await response.json();
    return data.description;
  } catch (error) {
    console.error('Error sending image to Gemini API:', error);
    throw error;
  }
}; 