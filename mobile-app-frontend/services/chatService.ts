import axios from 'axios';
import { API_ENDPOINTS } from '@/constants/config';
import { getApiEndpoint } from './api';

// Use centralized API configuration

export interface ChatMessage {
  type: 'user' | 'system' | 'info' | 'badge';
  text?: string; // Made text optional
  time: string;
  avatar?: any;
  image?: string; // Made image optional
  icon?: 'message-circle' | 'thumbs-up'; // Made icon type specific
  iconName?: 'message-circle'; // Made iconName type specific
  highlighted?: boolean;
}

export const sendMessageToLlama = async (message: string, chatHistory: ChatMessage[]): Promise<string> => {
  try {
    const chatEndpoint = await getApiEndpoint('CHAT');
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_message: message, chat_history: chatHistory }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.response || 'Failed to get AI response');
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Error sending message to AI API:', error);
    throw error;
  }
};

// Test the endpoint with curl or Postman
// curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"message":"Hello"}'