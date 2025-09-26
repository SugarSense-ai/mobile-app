// This file has been commented out as the CGM connection screen is now only accessible from the Profile tab
// The app now launches directly into the Dashboard screen as the default

/*
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Linking,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as Bluetooth from 'react-native-ble-plx';
import { Feather } from '@expo/vector-icons';
import { styles } from '@/styles/index.styles';


const supportedCGMDevices = [
  { id: 'freestyle_libre', name: 'Abbott FreeStyle Libre', connectionType: 'bluetooth', logo: require('../../assets/images/device.png') },
  { id: 'dexcom_g6', name: 'Dexcom G6', connectionType: 'web_link', authUrl: 'https://example-dexcom-auth.com', logo: require('../../assets/images/device.png') },
  { id: 'medtronic_guardian', name: 'Medtronic Guardian', connectionType: 'api', logo: require('../../assets/images/device.png') },
];

const CGMConnectionScreen = () => {
  const navigation = useNavigation();
  const [selectedDevice, setSelectedDevice]: any = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus]: any = useState(null);
  const [bluetoothManager, setBluetoothManager]: any = useState(null);

  useEffect(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      // setBluetoothManager(new Bluetooth.BleManager());
    }
    return () => {
      if (bluetoothManager) {
        bluetoothManager.destroy();
      }
    };
  }, []);

  const handleDeviceSelection = (device: any) => {
    setSelectedDevice(device);
    setConnectionStatus(null);
  };

  const handleConnectDevice = async () => {
    if (!selectedDevice) {
      alert('Please select a CGM device first.');
      return;
    }

    setIsConnecting(true);
    setConnectionStatus(null);

    try {
      if (selectedDevice.connectionType === 'bluetooth') {
        // Simulate connection
        await new Promise(resolve => setTimeout(resolve, 2000));
        setConnectionStatus({ success: true, message: 'Connected successfully!' });
      } else if (selectedDevice.connectionType === 'web_link') {
        // Open web link for OAuth-based connections (like Dexcom)
        Linking.openURL(selectedDevice.authUrl);
        setConnectionStatus({ success: true, message: 'Please complete authentication in the browser.' });
      } else if (selectedDevice.connectionType === 'api') {
        // API-based connection (would require user credentials)
        setConnectionStatus({ success: false, message: 'API connection not implemented yet.' });
      }
    } catch (error) {
      setConnectionStatus({ success: false, message: 'Connection failed. Please try again.' });
    } finally {
      setIsConnecting(false);
    }
  };

  const renderDevice = ({ item }: any) => (
    <TouchableOpacity
      style={[styles.deviceCard, selectedDevice?.id === item.id && styles.selectedDevice]}
      onPress={() => handleDeviceSelection(item)}
    >
      <Image source={item.logo} style={styles.deviceLogo} />
      <Text style={styles.deviceName}>{item.name}</Text>
      {selectedDevice?.id === item.id && (
        <Feather name="check-circle" size={24} color="#4ECDC4" style={styles.checkIcon} />
      )}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <Text style={styles.title}>Connect Your CGM</Text>
        <Text style={styles.subtitle}>Seamlessly integrate your glucose data</Text>
      </View>

      <View style={styles.devicesSection}>
        <Text style={styles.sectionTitle}>Select Your Device</Text>
        <FlatList
          data={supportedCGMDevices}
          renderItem={renderDevice}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
        />
      </View>

      <TouchableOpacity
        style={[styles.connectButton, !selectedDevice && styles.disabledButton]}
        onPress={handleConnectDevice}
        disabled={!selectedDevice || isConnecting}
      >
        {isConnecting ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.connectButtonText}>Connect Device</Text>
        )}
      </TouchableOpacity>

      {connectionStatus && (
        <View style={[styles.statusMessage, connectionStatus.success ? styles.successMessage : styles.errorMessage]}>
          <Feather name={connectionStatus.success ? "check-circle" : "alert-circle"} size={20} color={connectionStatus.success ? "#4ECDC4" : "#FF6B6B"} />
          <Text style={[styles.statusText, connectionStatus.success ? styles.successText : styles.errorText]}>
            {connectionStatus.message}
          </Text>
        </View>
      )}

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>Why Connect Your CGM?</Text>
        <View style={styles.infoItem}>
          <Feather name="trending-up" size={20} color="#4ECDC4" />
          <Text style={styles.infoText}>Real-time glucose monitoring and trends</Text>
        </View>
        <View style={styles.infoItem}>
          <Feather name="bar-chart-2" size={20} color="#4ECDC4" />
          <Text style={styles.infoText}>Comprehensive data analysis and insights</Text>
        </View>
        <View style={styles.infoItem}>
          <Feather name="bell" size={20} color="#4ECDC4" />
          <Text style={styles.infoText}>Smart alerts and predictions</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.skipButton}>
        <Text style={styles.skipButtonText}>I'll connect later</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default CGMConnectionScreen;
*/

// Export a placeholder component to prevent any import errors
export default function Index() {
  // This screen is no longer used - CGM connection is available in Profile tab
  return null;
}