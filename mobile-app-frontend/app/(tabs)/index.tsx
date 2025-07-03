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
      if (selectedDevice.connectionType === 'bluetooth' && bluetoothManager) {
        console.log('Attempting Bluetooth connection for:', selectedDevice.name);
        bluetoothManager.startDeviceScan(null, null, (error: any, device: any) => {
          if (error) {
            console.error('Bluetooth Scan Error:', error);
            setConnectionStatus({ success: false, message: `Bluetooth Scan Error: ${error.message}` });
            setIsConnecting(false);
            bluetoothManager.stopDeviceScan();
            return;
          }
          if (device && device.name?.includes(selectedDevice.name.split(' ')[0])) {
            console.log('Found device:', device.name);
            bluetoothManager.stopDeviceScan();
            device.connect()
              .then((connectedDevice: any) => {
                console.log('Connected to:', connectedDevice.name);
                setConnectionStatus({ success: true, message: `${selectedDevice.name} connected successfully!` });
              })
              .catch((connectError: any) => {
                console.error('Bluetooth Connect Error:', connectError);
                setConnectionStatus({ success: false, message: `Failed to connect to ${selectedDevice.name}: ${connectError.message}` });
              })
              .finally(() => setIsConnecting(false));
          }
        });
        setTimeout(() => {
          if (isConnecting) {
            bluetoothManager.stopDeviceScan();
            setConnectionStatus({ success: false, message: 'Bluetooth scan timed out. Please try again.' });
            setIsConnecting(false);
          }
        }, 15000);
      } else if (selectedDevice.connectionType === 'web_link' && selectedDevice.authUrl) {
        Linking.openURL(selectedDevice.authUrl);
        setConnectionStatus({ success: null, message: `Redirecting to ${selectedDevice.name} for authorization... Please follow the instructions on the website and return to the app.` });
        setIsConnecting(false);
      } else if (selectedDevice.connectionType === 'api') {
        console.log('Attempting API connection for:', selectedDevice.name);
        setTimeout(() => {
          const success = Math.random() > 0.5;
          setConnectionStatus({ success: success, message: success ? `${selectedDevice.name} connected via API!` : `Failed to connect to ${selectedDevice.name} via API.` });
          setIsConnecting(false);
        }, 3000);
      } else {
        setConnectionStatus({ success: false, message: 'Unsupported connection type for this device.' });
        setIsConnecting(false);
      }
    } catch (error) {
      console.error('Connection Error:', error);
      setConnectionStatus({ success: false, message: `An unexpected error occurred: ${error}` });
      setIsConnecting(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContentContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>Connect Your CGM</Text>
          <Text style={styles.subtitle}>Seamlessly integrate your glucose data</Text>
        </View>

        <View style={styles.deviceListContainer}>
          <Text style={styles.deviceListTitle}>Select Your Device</Text>
          <FlatList
            data={supportedCGMDevices}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.listItem, selectedDevice?.id === item.id && styles.selectedListItem]}
                onPress={() => handleDeviceSelection(item)}
              >
                {item.logo && <Image source={item.logo} style={styles.logo} />}
                <Text style={styles.listItemText}>{item.name}</Text>
                {selectedDevice?.id === item.id && <Feather name="check-circle" size={20} color="#00aaff" />}
              </TouchableOpacity>
            )}
          />
        </View>

        {selectedDevice && (
          <View style={styles.instructionsContainer}>
            <Text style={styles.instructionsTitle}>Connecting to {selectedDevice.name}</Text>
            {selectedDevice.connectionType === 'bluetooth' && (
              <Text style={styles.instructionsText}>
                <Feather name="bluetooth" size={16} color="#555" style={styles.icon} />
                Ensure Bluetooth is enabled and your {selectedDevice.name} is in pairing mode.
              </Text>
            )}
            {selectedDevice.connectionType === 'web_link' && (
              <Text style={styles.instructionsText}>
                <Feather name="link" size={16} color="#555" style={styles.icon} />
                You will be redirected to the {selectedDevice.name} website for authorization.
              </Text>
            )}
            {selectedDevice.connectionType === 'api' && (
              <Text style={styles.instructionsText}>
                <Feather name="key" size={16} color="#555" style={styles.icon} />
                The application will attempt to connect using your API credentials.
              </Text>
            )}
            <TouchableOpacity
              style={[
                styles.connectButton,
                isConnecting && styles.connectingButton,
                connectionStatus?.success === true && styles.connectedButton,
              ]}
              onPress={handleConnectDevice}
              disabled={isConnecting || connectionStatus?.success === true}
            >
              <Text style={styles.connectButtonText}>
                {isConnecting ? <ActivityIndicator size="small" color="#fff" /> : connectionStatus?.success === true ? 'Connected' : 'Connect'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {connectionStatus && (
          <View style={styles.statusContainer}>
            <Text style={styles.statusTitle}>Connection Status</Text>
            {connectionStatus.success === true && (
              <Text style={styles.successText}>
                <Feather name="check-circle" size={16} color="#28a745" style={styles.icon} />
                {connectionStatus.message}
              </Text>
            )}
            {connectionStatus.success === false && (
              <Text style={styles.errorText}>
                <Feather name="alert-triangle" size={16} color="#dc3545" style={styles.icon} />
                {connectionStatus.message}
              </Text>
            )}
            {connectionStatus.success === null && (
              <Text style={{ fontSize: 15, color: '#777' }}>
                <Feather name="info" size={16} color="#777" style={styles.icon} />
                {connectionStatus.message}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default CGMConnectionScreen;