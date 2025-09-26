import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Alert, ActivityIndicator, TextInput, Switch, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from 'react-native-elements';
import { COLORS } from '@/constants/theme';
import { StyleSheet } from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { connectCGM } from '@/services/cgmService';
import { testNetworkConnectivity } from '@/constants/networkUtils';
import { BACKEND_URL, FALLBACK_URLS } from '@/constants/config';

interface CGMOption {
  id: string;
  name: string;
  description: string;
  iconName: string;
}

const cgmOptions: CGMOption[] = [
  {
    id: 'dexcom-g6-g5-one-plus',
    name: 'Dexcom G6 | G5 | One+',
    description: 'Connect your Dexcom G6, G5, or One+ device',
    iconName: 'radio-button-off-outline'
  },
  {
    id: 'dexcom-g7',
    name: 'Dexcom G7',
    description: 'Connect your latest Dexcom G7 device',
    iconName: 'radio-button-off-outline'
  },
  {
    id: 'freestyle-libre-2',
    name: 'Abbott Freestyle Libre 2 via Link-Up',
    description: 'Connect via Abbott LibreLink-Up app',
    iconName: 'radio-button-off-outline'
  }
];

const CGMConnectionScreen = () => {
  const router = useRouter();
  const { user } = useUser();
  const [selectedCGM, setSelectedCGM] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Credential states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Network status states
  const [networkStatus, setNetworkStatus] = useState<{
    isConnected: boolean;
    workingUrl: string | null;
    isChecking: boolean;
    lastChecked: Date | null;
  }>({
    isConnected: false,
    workingUrl: null,
    isChecking: true,
    lastChecked: null,
  });

  // Check network connectivity on component mount
  useEffect(() => {
    const checkNetworkConnectivity = async () => {
      console.log('🔍 CGM Connection: Checking network connectivity...');
      setNetworkStatus(prev => ({ ...prev, isChecking: true }));
      
      try {
        const urlsToTest = [BACKEND_URL, ...FALLBACK_URLS.filter(url => url !== BACKEND_URL)];
        const networkInfo = await testNetworkConnectivity(urlsToTest, 1);
        
        setNetworkStatus({
          isConnected: networkInfo.workingUrl !== null,
          workingUrl: networkInfo.workingUrl,
          isChecking: false,
          lastChecked: new Date(),
        });
        
        if (networkInfo.workingUrl) {
          console.log(`✅ CGM Connection: Network connectivity OK - using ${networkInfo.workingUrl}`);
        } else {
          console.log('❌ CGM Connection: No working backend URLs found');
        }
      } catch (error) {
        console.error('❌ CGM Connection: Network check failed:', error);
        setNetworkStatus({
          isConnected: false,
          workingUrl: null,
          isChecking: false,
          lastChecked: new Date(),
        });
      }
    };
    
    checkNetworkConnectivity();
  }, []);

  // Reset credentials when CGM selection changes
  useEffect(() => {
    setUsername('');
    setPassword('');
    setShowPassword(false);
  }, [selectedCGM]);

  const handleBack = () => {
    router.back();
  };

  const handleSelectCGM = (cgmId: string) => {
    setSelectedCGM(cgmId);
  };

  const handleConnect = async () => {
    if (!selectedCGM) {
      Alert.alert('No Selection', 'Please select a CGM device to connect.');
      return;
    }

    // Check network connectivity first
    if (!networkStatus.isConnected) {
      Alert.alert(
        'Network Error', 
        'Cannot connect to backend server. Please check your WiFi connection and ensure the backend server is running.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Require credentials for both Dexcom and LibreLinkUp
    if (!username || !password) {
      Alert.alert('Missing Credentials', 'Please enter your username and password to connect.');
      return;
    }

    const selectedOption = cgmOptions.find(option => option.id === selectedCGM);
    if (!selectedOption || !user?.id) return;

    setIsConnecting(true);

    try {
      // Use the new CGM service for mobile-optimized connection
      const result = await connectCGM(
        user.id,
        username,
        password,
        selectedCGM,
        'us', // Default to US region
        45000 // 45 second timeout for mobile
      );

      if (!result.success) {
        // Handle specific error types with appropriate alerts
        let alertTitle = 'Connection Failed';
        let errorMessage = result.error || 'Failed to connect to CGM device.';
        
        if (result.error?.includes('timeout')) {
          alertTitle = 'Connection Timeout';
          errorMessage = result.message || 'Connection timed out. Try connecting to WiFi for better connectivity.';
        } else if (result.error?.includes('Invalid credentials')) {
          alertTitle = 'Invalid Credentials';
          errorMessage = result.message || 'Please check your username and password and try again.';
        } else if (result.error?.includes('Network')) {
          alertTitle = 'Network Error';
          errorMessage = result.message || 'Unable to reach CGM servers. Please check your internet connection.';
        } else if (result.message) {
          errorMessage = result.message;
        }
        
        Alert.alert(alertTitle, errorMessage, [{ text: 'OK' }]);
        return;
      }

      // Success! Show connection confirmation with glucose data if available
      let successMessage = `Your ${selectedOption.name} is now connected!`;
      
      if (result.currentGlucose) {
        const glucose = result.currentGlucose;
        successMessage += `\n\nCurrent glucose: ${glucose.value} mg/dL ${glucose.trendArrow || ''}`;
        
        console.log('📊 Current glucose data received:', {
          value: glucose.value,
          trend: glucose.trend,
          timestamp: glucose.timestamp
        });
      }
      
      if (result.region) {
        successMessage += `\n(Region: ${result.region.toUpperCase()})`;
      }

      Alert.alert(
        'Connection Successful',
        successMessage,
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );

    } catch (error: any) {
      console.error('Unexpected error connecting CGM:', error);
      Alert.alert(
        'Connection Error',
        'An unexpected error occurred. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Icon name="chevron-back" type="ionicon" color={COLORS.primary} size={24} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Connect Your CGM</Text>
        
        <View style={styles.headerSpacer} />
      </View>

      {/* Content with proper keyboard handling */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContentContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <Text style={styles.subtitle}>
            Select your CGM device to connect and sync your glucose data automatically.
          </Text>

          {/* Network Status Indicator */}
          <View style={styles.networkStatusContainer}>
            {networkStatus.isChecking ? (
              <View style={styles.networkStatusRow}>
                <ActivityIndicator size="small" color={COLORS.mediumGray} />
                <Text style={styles.networkStatusText}>Checking backend connection...</Text>
              </View>
            ) : networkStatus.isConnected ? (
              <View style={styles.networkStatusRow}>
                <Icon name="checkmark-circle" type="ionicon" color="#28a745" size={16} />
                <Text style={[styles.networkStatusText, { color: '#28a745' }]}>
                  Backend connected ({networkStatus.workingUrl?.replace('http://', '').replace(':3001', '')})
                </Text>
              </View>
            ) : (
              <View style={styles.networkStatusRow}>
                <Icon name="warning" type="ionicon" color="#dc3545" size={16} />
                <Text style={[styles.networkStatusText, { color: '#dc3545' }]}>
                  Backend not reachable. Check WiFi and server status.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.optionsContainer}>
            {cgmOptions.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.optionCard,
                  selectedCGM === option.id && styles.selectedOptionCard
                ]}
                onPress={() => handleSelectCGM(option.id)}
              >
                <View style={styles.optionContent}>
                  <View style={styles.optionInfo}>
                    <Text style={[
                      styles.optionName,
                      selectedCGM === option.id && styles.selectedOptionName
                    ]}>
                      {option.name}
                    </Text>
                    <Text style={styles.optionDescription}>
                      {option.description}
                    </Text>
                  </View>
                  
                  <Icon
                    name={selectedCGM === option.id ? 'radio-button-on' : 'radio-button-off-outline'}
                    type="ionicon"
                    color={selectedCGM === option.id ? COLORS.primary : COLORS.mediumGray}
                    size={24}
                  />
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Enhanced Login Box - visible for Dexcom and LibreLinkUp */}
          {selectedCGM && (selectedCGM.startsWith('dexcom') || selectedCGM === 'freestyle-libre-2') && (
            <View style={styles.loginBox}>
              <Text style={styles.loginBoxTitle}>
                {selectedCGM === 'freestyle-libre-2' ? 'LibreLinkUp Account' : 'Dexcom Share Account'}
              </Text>
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Username</Text>
                <TextInput
                  style={styles.input}
                  placeholder={selectedCGM === 'freestyle-libre-2' ? 'Enter LibreLinkUp username' : 'Enter Dexcom Share username'}
                  placeholderTextColor={COLORS.mediumGray}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder={selectedCGM === 'freestyle-libre-2' ? 'Enter LibreLinkUp password' : 'Enter Dexcom Share password'}
                  placeholderTextColor={COLORS.mediumGray}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
              </View>

              <View style={styles.toggleContainer}>
                <Switch
                  value={showPassword}
                  onValueChange={setShowPassword}
                  trackColor={{ 
                    false: COLORS.lightGray, 
                    true: COLORS.primary + '40' 
                  }}
                  thumbColor={showPassword ? COLORS.primary : '#f4f3f4'}
                  ios_backgroundColor={COLORS.lightGray}
                  style={styles.toggle}
                />
                <Text style={styles.toggleLabel}>Show my password</Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.connectBoxButton, 
                  (((selectedCGM?.startsWith('dexcom') || selectedCGM === 'freestyle-libre-2') && (!username || !password)) || isConnecting || !networkStatus.isConnected) && styles.connectBoxButtonDisabled
                ]}
                onPress={handleConnect}
                disabled={((selectedCGM?.startsWith('dexcom') || selectedCGM === 'freestyle-libre-2') && (!username || !password)) || isConnecting || !networkStatus.isConnected}
              >
                {isConnecting ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.connectBoxButtonText}>Connect</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Info Text */}
          <Text style={styles.infoText}>
            Your CGM data will be securely encrypted and only used for glucose insights and predictions.
          </Text>

          {/* Extra padding to ensure content is not hidden behind bottom button and keyboard */}
          <View style={styles.keyboardPadding} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom Connect Button */}
      <View style={styles.bottomContainer}>
        <TouchableOpacity
          style={[
            styles.connectButton,
            (!selectedCGM || isConnecting || ((selectedCGM?.startsWith('dexcom') || selectedCGM === 'freestyle-libre-2') && (!username || !password)) || !networkStatus.isConnected) && styles.connectButtonDisabled
          ]}
          onPress={handleConnect}
          disabled={!selectedCGM || isConnecting || ((selectedCGM?.startsWith('dexcom') || selectedCGM === 'freestyle-libre-2') && (!username || !password)) || !networkStatus.isConnected}
        >
          {isConnecting ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.connectButtonText}>Connect Selected CGM</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e1e1',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButtonText: {
    color: COLORS.primary,
    fontSize: 16,
    marginLeft: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    flex: 2,
    textAlign: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 20,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 16,
    lineHeight: 22,
  },
  networkStatusContainer: {
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  networkStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  networkStatusText: {
    fontSize: 14,
    marginLeft: 8,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  optionsContainer: {
    marginBottom: 24,
  },
  optionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#e1e1e1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  selectedOptionCard: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '08',
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionInfo: {
    flex: 1,
    marginRight: 16,
  },
  optionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  selectedOptionName: {
    color: COLORS.primary,
  },
  optionDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  /* Enhanced Login Box Styles */
  loginBox: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  loginBoxTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 24,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e1e1e1',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: COLORS.textDark,
    backgroundColor: '#fafafa',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    minHeight: 52,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    paddingVertical: 4,
  },
  toggle: {
    transform: [{ scaleX: 1.1 }, { scaleY: 1.1 }],
  },
  toggleLabel: {
    marginLeft: 12,
    fontSize: 16,
    color: COLORS.textDark,
    fontWeight: '500',
  },
  connectBoxButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    minHeight: 54,
  },
  connectBoxButtonDisabled: {
    backgroundColor: COLORS.lightGray,
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  connectBoxButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  keyboardPadding: {
    height: 150, // Increased padding to ensure content is not hidden behind bottom button and keyboard
  },
  bottomContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 16,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: '#e1e1e1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  connectButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  connectButtonDisabled: {
    backgroundColor: COLORS.lightGray,
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  connectButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default CGMConnectionScreen; 