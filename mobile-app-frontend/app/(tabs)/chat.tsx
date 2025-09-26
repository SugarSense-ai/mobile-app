import React, { useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Animated,
  Keyboard,
} from 'react-native';
import { FontAwesome5, Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { styles } from '@/styles/chat.styles';
import { sendMessage, ChatMessage, HealthSnapshot } from '@/services/chatService';
import { fetchDashboardData, DashboardData } from '@/services/dashboardService';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '@/constants/theme';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useUserIds } from '@/services/userService';

export default function ChatScreen() {
  const { clerkUserId, getDatabaseUserId } = useUserIds();
  const tabBarHeight = useBottomTabBarHeight();
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const animValue1 = useRef(new Animated.Value(0.4)).current;
  const animValue2 = useRef(new Animated.Value(0.4)).current;
  const animValue3 = useRef(new Animated.Value(0.4)).current;
  const keyboardHeight = useRef(new Animated.Value(0)).current;
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const isMounted = useRef(true);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      type: 'info',
      text: 'Welcome to your personalized health assistant! Share your meal by typing, uploading a picture, or taking one.',
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [cameraPermission, setCameraPermission] = useState(false);
  const [galleryPermission, setGalleryPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const keyboardWillShowListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        Animated.timing(keyboardHeight, {
          toValue: event.endCoordinates.height,
          duration: Platform.OS === 'ios' ? event.duration : 250,
          useNativeDriver: false,
        }).start();
      }
    );

    const keyboardWillHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (event) => {
        Animated.timing(keyboardHeight, {
          toValue: 0,
          duration: Platform.OS === 'ios' ? event.duration : 250,
          useNativeDriver: false,
        }).start();
      }
    );

    return () => {
      keyboardWillShowListener?.remove();
      keyboardWillHideListener?.remove();
    };
  }, []);

  useEffect(() => {
    // Initialize user ID
    const initializeUserId = async () => {
      try {
        const dbUserId = await getDatabaseUserId();
        if (dbUserId) {
          setCurrentUserId(dbUserId);
          console.log('✅ Chat: Initialized with database user ID:', dbUserId);
        } else {
          console.error('❌ Chat: Failed to get database user ID');
        }
      } catch (error) {
        console.error('❌ Chat: Error getting user ID:', error);
      }
    };

    // Fetch dashboard data on component mount
    const fetchDashboardDataAsync = async () => {
      try {
        if (!currentUserId) {
          console.log('⏳ Chat: Waiting for user ID to fetch dashboard data...');
          return;
        }
        const data = await fetchDashboardData(7, currentUserId);
        if (isMounted.current) {
          setDashboardData(data);
        }
      } catch (error) {
        console.error("Failed to fetch dashboard data for chat snapshot:", error);
      }
    };

    (async () => {
      const cameraStatus = await ImagePicker.requestCameraPermissionsAsync();
      setCameraPermission(cameraStatus.status === 'granted');

      const galleryStatus = await ImagePicker.requestMediaLibraryPermissionsAsync();
      setGalleryPermission(galleryStatus.status === 'granted');
    })();

    initializeUserId();
    
    if (currentUserId) {
    fetchDashboardDataAsync();
    }
  }, [currentUserId]);

  useEffect(() => {
    if (isLoading) {
      const createPulseAnimation = (animValue: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.timing(animValue, {
              toValue: 1,
              duration: 600,
              delay,
              useNativeDriver: true,
            }),
            Animated.timing(animValue, {
              toValue: 0.4,
              duration: 600,
              useNativeDriver: true,
            }),
          ])
        );
      };

      const animation1 = createPulseAnimation(animValue1, 0);
      const animation2 = createPulseAnimation(animValue2, 200);
      const animation3 = createPulseAnimation(animValue3, 400);

      animation1.start();
      animation2.start();
      animation3.start();

      return () => {
        animation1.stop();
        animation2.stop();
        animation3.stop();
      };
    }
  }, [isLoading]);

  // Helper to build the health snapshot from dashboard data
  const buildHealthSnapshot = (): HealthSnapshot | null => {
    if (!dashboardData) return null;

    const today = new Date().toISOString().split('T')[0];
    const todaysGlucose = dashboardData.glucose.data.find((d: { date: string }) => d.date === today);
    const todaysActivity = dashboardData.activity.data.find((d: any) => d.date === today);

    // Get the last 7 days of glucose readings for context
    const recentGlucoseReadings = dashboardData.glucose.data.slice(0, 7).map(d => ({
      date: d.date,
      value: d.avg_glucose,
    }));

    const snapshot: HealthSnapshot = {
      glucoseSummary: {
        averageToday: todaysGlucose ? todaysGlucose.avg_glucose : (dashboardData.glucose.summary.avg_glucose_7_days || 0),
        spikes: [], // Placeholder
        drops: [], // Placeholder
        recentReadings: recentGlucoseReadings, // Populate with recent daily averages
      },
      mealHistory: {
        lastMeal: "Not tracked", // Placeholder
        typicalDinner: "Not tracked", // Placeholder
        recentHighCarb: false, // Placeholder
      },
      sleepSummary: {
        hours: dashboardData.sleep.summary.avg_sleep_hours || 0,
        quality: dashboardData.sleep.summary.avg_sleep_hours > 7 ? 'good' : dashboardData.sleep.summary.avg_sleep_hours > 5 ? 'average' : 'poor',
        dailySleep: dashboardData.sleep.data.map((d: any) => ({ date: d.date, hours: d.total_hours })),
      },
      activitySummary: {
        stepsToday: todaysActivity ? (todaysActivity as any).steps : 0,
        activeMinutes: todaysActivity ? ((todaysActivity as any).active_minutes || 0) : 0,
        activityLevel: todaysActivity ? ((todaysActivity as any).activity_level || 'Unknown') : 'Unknown',
        sedentary: todaysActivity ? (((todaysActivity as any).activity_level === 'Sedentary')) : true,
      },
    };
    return snapshot;
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        setKeyboardOffset(event.endCoordinates.height);
      }
    );

    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardOffset(0);
      }
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const bottomPadding = keyboardOffset > 0 ? keyboardOffset + 20 : 90;

  const pickImageFromGallery = async () => {
    if (!galleryPermission) {
      Alert.alert(
        'Permission Denied',
        'Please grant gallery access to upload images.',
        [{ text: 'OK' }]
      );
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    });

    handleImageSelection(result);
  };

  const takePictureFromCamera = async () => {
    if (!cameraPermission) {
      Alert.alert(
        'Permission Denied',
        'Please grant camera access to take pictures.',
        [{ text: 'OK' }]
      );
      return;
    }

    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });

    handleImageSelection(result);
  };

  const handleImageSelection = async (result: any) => {
    if (!result.canceled) {
      // Attach image to input instead of sending immediately
      setAttachedImage(result.assets[0].uri);
      
      // Focus the input to encourage user to add a caption
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  };

  const removeAttachedImage = () => {
    setAttachedImage(null);
  };

  const handleSendMessage = async () => {
    // Ensure there's either text or an image to send
    if (!inputText.trim() && !attachedImage) {
      return;
    }

    const currentTime = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    
    // Create the user's message object for the UI
    const userMessage: ChatMessage = {
      type: 'user',
      avatar: require('../../assets/images/avatar.png'),
      text: inputText.trim() || undefined,
      image: attachedImage || undefined,
      time: currentTime,
    };

    // Optimistically update the UI with the user's message
    // and store the state *before* the send action
    const currentChatMessages = [...chatMessages, userMessage];
    setChatMessages(currentChatMessages);
    
    // Clear inputs and set loading state
    const textToSend = inputText.trim();
    const imageToSend = attachedImage;
    setInputText('');
    setAttachedImage(null);
    setIsLoading(true);

    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);

    try {
      // Build the health snapshot
      const healthSnapshot = buildHealthSnapshot();
      
      // Call the unified sendMessage service function
      const aiResponse = await sendMessage(textToSend, healthSnapshot, currentChatMessages, imageToSend, clerkUserId);
      
      // Create the AI's response message
      const newAiMessage: ChatMessage = {
        type: 'system',
        icon: 'message-circle',
        iconName: 'message-circle',
        text: aiResponse,
        time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }),
      };

      // Update the UI with the AI's response
      setChatMessages(prev => [...prev, newAiMessage]);

    } catch (error) {
      // If the API call fails, show an alert
      Alert.alert(
        'Error',
        'Failed to get response from AI. Please try again.',
        [{ text: 'OK' }]
      );
      // Optional: Revert optimistic UI updates or add a failure indicator
    } finally {
      // Stop the loading indicator
      setIsLoading(false);
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left','right']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.blue} />
      {/* Header - now just topNav */}
      <View style={styles.topNav}>
        <TouchableOpacity style={styles.backButton}>
          <FontAwesome5 name="arrow-left" size={18} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>SugarSense.ai Assistant</Text>
          <View style={styles.userStatus}>
            <View style={styles.onlineIndicator} />
            <Text style={styles.userStatusText}>Online</Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>
      {/* Messages */}
      <View style={styles.messagesContainer}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[styles.messagesList, { paddingBottom: bottomPadding }]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {chatMessages.map((message: ChatMessage, index) => (
            <View key={index} style={styles.messageGroup}>
              {message.type === 'info' && (
                <View style={styles.infoMessage}>
                  <Text style={styles.infoText}>{message.text}</Text>
                </View>
              )}
              {message.type === 'user' && message.text && !message.image && (
                <View style={styles.userMessageContainer}>
                  <View style={styles.userMessageWrapper}>
                    <View style={styles.userMessageBubble}>
                      <Text style={styles.userText}>{message.text}</Text>
                    </View>
                    <Text style={styles.userMessageTime}>{message.time}</Text>
                  </View>
                  <Image source={message.avatar} style={styles.userAvatar} />
                </View>
              )}
              {message.type === 'user' && message.image && (
                <View style={styles.userMessageContainer}>
                  <View style={styles.userMessageWrapper}>
                    <View style={styles.userImageBubble}>
                      <Image source={{ uri: message.image }} style={styles.userImage} />
                      {message.text && (
                        <View style={styles.imageCaptionContainer}>
                          <Text style={styles.imageCaptionText}>{message.text}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.userMessageTime}>{message.time}</Text>
                  </View>
                  <Image source={message.avatar} style={styles.userAvatar} />
                </View>
              )}
              {message.type === 'system' && (
                <View style={styles.systemMessageContainer}>
                  <View style={styles.systemAvatar}>
                    <Feather name="zap" size={14} color="#fff" />
                  </View>
                  <View style={styles.systemMessageWrapper}>
                    <View style={styles.systemMessage}>
                      <Text style={styles.systemText}>{message.text}</Text>
                    </View>
                    <Text style={styles.systemMessageTime}>{message.time}</Text>
                  </View>
                </View>
              )}
            </View>
          ))}
          {isLoading && (
            <View style={styles.messageGroup}>
              <View style={styles.systemMessageContainer}>
                <View style={styles.systemAvatar}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
                <View style={styles.systemMessageWrapper}>
                  <View style={styles.typingIndicator}>
                    <View style={styles.typingDots}>
                      <Animated.View style={[styles.typingDot, { opacity: animValue1 }]} />
                      <Animated.View style={[styles.typingDot, { opacity: animValue2 }]} />
                      <Animated.View style={[styles.typingDot, { opacity: animValue3 }]} />
                    </View>
                  </View>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
      {/* Input Area - Floating */}
      <KeyboardAvoidingView
        style={[styles.inputArea, { bottom: 0, paddingBottom: tabBarHeight }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={tabBarHeight}
      >
        {/* Image Preview */}
        {attachedImage && (
          <View style={styles.imagePreviewContainer}>
            <View style={styles.imagePreview}>
              <Image source={{ uri: attachedImage }} style={styles.previewImage} />
              <TouchableOpacity style={styles.removeImageButton} onPress={removeAttachedImage}>
                <FontAwesome5 name="times" size={16} color={COLORS.white} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.mediaButton} onPress={pickImageFromGallery}>
            <FontAwesome5 name="image" size={18} color={COLORS.blue} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.mediaButton} onPress={takePictureFromCamera}>
            <FontAwesome5 name="camera" size={18} color={COLORS.blue} />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={attachedImage ? "Add a caption..." : "Message SugarSense.ai..."}
            placeholderTextColor={COLORS.lightGray}
            value={inputText}
            onChangeText={setInputText}
            editable={!isLoading}
            multiline
            onFocus={() => {
              setTimeout(() => {
                scrollViewRef.current?.scrollToEnd({ animated: true });
              }, 100);
            }}
          />
          <TouchableOpacity 
            style={[styles.sendButton, (!inputText.trim() && !attachedImage || isLoading) && styles.sendButtonDisabled]} 
            onPress={handleSendMessage}
            disabled={(!inputText.trim() && !attachedImage) || isLoading}
          >
            <FontAwesome5 
              name="paper-plane" 
              size={14} 
              solid
              color={COLORS.white} 
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}