import * as FileSystem from 'expo-file-system';
import { getBaseUrl } from './api';

export const sendImageToGemini = async (imageUri: string, caption: string): Promise<string> => {
  try {
    const baseUrl = await getBaseUrl();
    const base64Image = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        user_message: caption,
        image_data: base64Image,
        chat_history: [] // Pass empty history for now
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to analyze image with API');
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Error sending image to API:', error);
    throw error;
  }
}; 