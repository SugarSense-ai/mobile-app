import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Alert, ActivityIndicator, TextInput, Switch, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from 'react-native-elements';
import { COLORS } from '@/constants/theme';
import { StyleSheet } from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import config from '@/constants/config';

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

    // Check if credentials are required and provided
    if (selectedCGM && (!username || !password)) {
      Alert.alert('Missing Credentials', 'Please enter your username and password to connect.');
      return;
    }

    const selectedOption = cgmOptions.find(option => option.id === selectedCGM);
    if (!selectedOption) return;

    setIsConnecting(true);

    try {
      // Simulate connection process
      await new Promise(resolve => setTimeout(resolve, 2000));

      // In a real implementation, you would:
      // 1. Make API call to initiate CGM connection
      // 2. Handle OAuth flow if needed
      // 3. Store connection details

      Alert.alert(
        'Connection Initiated',
        `We're setting up your connection to ${selectedOption.name}. You'll receive instructions via email shortly.`,
        [
          {
            text: 'OK',
            onPress: () => router.back()
          }
        ]
      );
    } catch (error) {
      console.error('Error connecting CGM:', error);
      Alert.alert(
        'Connection Failed',
        'Unable to connect to your CGM device. Please try again later.',
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

          {/* Enhanced Login Box - visible only when a CGM is selected */}
          {selectedCGM && (
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
                  (!username || !password || isConnecting) && styles.connectBoxButtonDisabled
                ]}
                onPress={handleConnect}
                disabled={!username || !password || isConnecting}
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
            (!selectedCGM || isConnecting) && styles.connectButtonDisabled
          ]}
          onPress={handleConnect}
          disabled={!selectedCGM || isConnecting}
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
    marginBottom: 24,
    lineHeight: 22,
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