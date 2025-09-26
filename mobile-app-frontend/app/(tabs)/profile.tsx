import React, { useState, useEffect } from 'react';
import { View, ScrollView, Text, TouchableOpacity, Switch, Alert, Modal, TextInput, StyleSheet, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Avatar, ListItem, Icon } from 'react-native-elements';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { styles } from '@/styles/profile.styles';
import { COLORS } from '@/constants/theme';
import { 
  isAppleHealthSyncEnabledState,
  setAppleHealthSyncEnabled,
  triggerManualSync,
  performFreshResync,
  hasHealthKitPermissions
} from '@/services/healthKit';
import { useUserIds } from '@/services/userService';
import config from '@/constants/config';
import apiClient from '@/services/apiClient';
import { testApiConnection } from '@/services/testApiClient';

const AVATAR_SIZE = 80;
const dummyUser = {
    name: 'Alex Austin',
    username: 'alexaustin',
    profilePicture: 'https://randomuser.me/api/portraits/men/4.jpg',
    diabetesType: 'Type 2',
    targetGlucose: '80-130 mg/dL',
    a1cGoal: '7.0%',
    medications: ['Metformin 500mg twice daily'],
    tokenBalance: 150,
    leaderboardRank: 15,
    activityScore: 85,
};

const ProfileScreen = () => {
    const { user: clerkUser } = useUser();
    const navigation = useNavigation();
    const { signOut } = useAuth();
    const router = useRouter();
    const { getDatabaseUserId } = useUserIds();
    
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [user, setUser] = useState(dummyUser); // retains placeholder values for other profile fields
    // Store the display name in state so it can be refreshed when the profile updates.
    const [displayName, setDisplayName] = useState<string>(() => clerkUser?.fullName || clerkUser?.firstName || 'Welcome');
    const [appleHealthSyncEnabledLocal, setAppleHealthSyncEnabledLocal] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
    const [hasCompletedInitialSync, setHasCompletedInitialSync] = useState(false);
    
    // Insulin Calculator state
    const [calculatorVisible, setCalculatorVisible] = useState(false);
    const [carbs, setCarbs] = useState('');
    const [icRatio, setIcRatio] = useState('');
    const [currentGlucose, setCurrentGlucose] = useState('');
    const [targetGlucose, setTargetGlucose] = useState('');
    const [correctionFactor, setCorrectionFactor] = useState('');
    const [mealInsulin, setMealInsulin] = useState<number | null>(null);
    const [correctionInsulin, setCorrectionInsulin] = useState<number | null>(null);
    const [totalInsulin, setTotalInsulin] = useState<number | null>(null);
    const [lowGlucoseWarning, setLowGlucoseWarning] = useState(false);

    // New state for personalization and logging
    const [showBolusForType2, setShowBolusForType2] = useState(false);
    const [diabetesTypeModalVisible, setDiabetesTypeModalVisible] = useState(false);
    const [basalModalVisible, setBasalModalVisible] = useState(false);
    const [basalInsulinName, setBasalInsulinName] = useState('');
    const [basalDose, setBasalDose] = useState('');
    const [logBolusEntry, setLogBolusEntry] = useState(false);
    // Basal history state & feedback
    const [basalHistory, setBasalHistory] = useState<any[]>([]);
    const [timingWarning, setTimingWarning] = useState<string | null>(null);
    const [consistencyMessage, setConsistencyMessage] = useState<string | null>(null);
    
    // Target Glucose Range state
    const [targetGlucoseMin, setTargetGlucoseMin] = useState(70);
    const [targetGlucoseMax, setTargetGlucoseMax] = useState(140);
    const [targetGlucoseModalVisible, setTargetGlucoseModalVisible] = useState(false);
    const [tempTargetMin, setTempTargetMin] = useState('70');
    const [tempTargetMax, setTempTargetMax] = useState('140');
    
    // Connection status
    const [isConnected, setIsConnected] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('Checking connection...');

    // Initialize user ID and test API connection
    useEffect(() => {
        const initializeUserId = async () => {
            try {
                const dbUserId = await getDatabaseUserId();
                if (dbUserId) {
                    setCurrentUserId(dbUserId);
                    console.log('✅ Profile: Initialized with database user ID:', dbUserId);
                } else {
                    console.error('❌ Profile: Failed to get database user ID');
                }
            } catch (error) {
                console.error('❌ Profile: Error getting user ID:', error);
            }
        };

        const testConnection = async () => {
            console.log('🔬 Profile: Testing API connection...');
            setConnectionStatus('Testing connection...');
            const testResult = await testApiConnection();
            if (testResult.success) {
                console.log(`✅ Profile: API connection verified (${testResult.responseTime}ms)`);
                setIsConnected(true);
                setConnectionStatus(`Connected (${testResult.responseTime}ms)`);
            } else {
                console.error(`❌ Profile: API connection failed: ${testResult.error}`);
                setIsConnected(false);
                setConnectionStatus(`Connection failed: ${testResult.error}`);
            }
        };

        initializeUserId();
        testConnection();
    }, []);

    // Refresh the display name whenever the screen gains focus or the Clerk user changes.
    useFocusEffect(
        React.useCallback(() => {
            const fetchDisplayName = async () => {
                if (!clerkUser?.id) return;
                try {
                    const result = await apiClient.get(`/api/user-profile?clerk_user_id=${clerkUser.id}`);
                    
                    if (result.success && result.data?.user) {
                        const userData = result.data.user;
                        // Update display name
                        if (userData.full_name) {
                            setDisplayName(userData.full_name);
                        } else {
                            // Fallback to Clerk's stored name if backend doesn't have it
                            setDisplayName(clerkUser.fullName || clerkUser.firstName || 'Welcome');
                        }
                        
                        // Update target glucose range
                        if (userData.target_glucose_min !== undefined && userData.target_glucose_max !== undefined) {
                            setTargetGlucoseMin(userData.target_glucose_min);
                            setTargetGlucoseMax(userData.target_glucose_max);
                            setTempTargetMin(userData.target_glucose_min.toString());
                            setTempTargetMax(userData.target_glucose_max.toString());
                        }
                    } else {
                        console.error('Failed to fetch user profile:', result.error);
                        // Fallback to Clerk's stored name if backend doesn't have it
                        setDisplayName(clerkUser.fullName || clerkUser.firstName || 'Welcome');
                    }
                } catch (error) {
                    console.error('Failed to fetch display name:', error);
                    setDisplayName(clerkUser?.fullName || clerkUser?.firstName || 'Welcome');
                }
            };

            fetchDisplayName();
        }, [clerkUser?.id])
    );

    // Load basal history from persistence on mount
    useEffect(() => {
        const loadHistory = async () => {
            try {
                if (clerkUser?.id) {
                    const result = await apiClient.get(`/api/basal-dose-history?clerk_user_id=${clerkUser.id}`);
                    
                    if (result.success && result.data?.basal_logs) {
                        // Convert backend format to frontend format
                        const convertedHistory = result.data.basal_logs.map((log: any) => ({
                            insulinType: 'basal',
                            insulinName: log.insulin_name,
                            doseUnits: log.dose_units,
                            timestamp: log.timestamp,
                        }));
                        setBasalHistory(convertedHistory);
                        console.log(`✅ Loaded ${convertedHistory.length} basal history records`);
                    } else {
                        console.error('Failed to load basal history:', result.error);
                        // Fallback to AsyncStorage for backward compatibility
                        const stored = await AsyncStorage.getItem('BASAL_HISTORY');
                        if (stored) {
                            setBasalHistory(JSON.parse(stored));
                        }
                    }
                } else {
                    // Fallback to AsyncStorage for backward compatibility
                    const stored = await AsyncStorage.getItem('BASAL_HISTORY');
                    if (stored) {
                        setBasalHistory(JSON.parse(stored));
                    }
                }
            } catch (error) {
                console.error('Failed to load basal history', error);
                // Try fallback to AsyncStorage
                try {
                    const stored = await AsyncStorage.getItem('BASAL_HISTORY');
                    if (stored) {
                        setBasalHistory(JSON.parse(stored));
                    }
                } catch (fallbackError) {
                    console.error('Fallback load also failed', fallbackError);
                }
            }
        };
        loadHistory();
    }, []);

    // Helper to persist history
    const persistBasalHistory = async (history: any[]) => {
        try {
            await AsyncStorage.setItem('BASAL_HISTORY', JSON.stringify(history));
        } catch (error) {
            console.error('Failed to save basal history', error);
        }
    };

    // Load settings and initial sync status
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const syncEnabled = isAppleHealthSyncEnabledState();
                setAppleHealthSyncEnabledLocal(syncEnabled);
                
                // Set initial sync status based on sync being enabled
                setHasCompletedInitialSync(syncEnabled);
                
                if (syncEnabled) {
                    setLastSyncTime('Previously synced');
                }
            } catch (error) {
                console.error('Error loading settings:', error);
            }
        };

        loadSettings();
    }, []);

    const resetCalculatorState = () => {
        setCarbs('');
        setIcRatio('');
        setCurrentGlucose('');
        setTargetGlucose('');
        setCorrectionFactor('');
        setMealInsulin(null);
        setCorrectionInsulin(null);
        setTotalInsulin(null);
        setLowGlucoseWarning(false);
        setLogBolusEntry(false);
    };

    const handleCloseModal = () => {
        setCalculatorVisible(false);
        // Using a timeout to prevent seeing fields clear during closing animation
        setTimeout(resetCalculatorState, 300);
    };

    useEffect(() => {
        // Initialize Apple Health sync state from persisted storage
        const initializeSyncState = async () => {
            const currentState = isAppleHealthSyncEnabledState();
            setAppleHealthSyncEnabledLocal(currentState);
        };
        
        initializeSyncState();
        checkHealthKitPermissions();
    }, []);

    const checkHealthKitPermissions = async () => {
        try {
            const hasPermissions = await hasHealthKitPermissions();
            console.log(`HealthKit permissions available: ${hasPermissions}`);
        } catch (error) {
            console.error('Error checking HealthKit permissions:', error);
        }
    };

    const handleAppleHealthToggle = async (value: boolean) => {
        if (value) {
            // Enabling Apple Health sync
            Alert.alert(
                'Enable Apple Health Sync',
                'This will automatically sync your health data including steps, sleep, and calories burned with the dashboard.',
                [
                    {
                        text: 'Cancel',
                        style: 'cancel'
                    },
                    {
                        text: 'Enable',
                        onPress: async () => {
                            await setAppleHealthSyncEnabled(true);
                            setAppleHealthSyncEnabledLocal(true);
                            
                            // Trigger initial sync
                            await performInitialSync();
                        }
                    }
                ]
            );
        } else {
            // Disabling Apple Health sync
            Alert.alert(
                'Disable Apple Health Sync',
                'Your existing health data will remain, but new data will not be automatically synced.',
                [
                    {
                        text: 'Cancel',
                        style: 'cancel'
                    },
                    {
                        text: 'Disable',
                        style: 'destructive',
                        onPress: async () => {
                            await setAppleHealthSyncEnabled(false);
                            setAppleHealthSyncEnabledLocal(false);
                        }
                    }
                ]
            );
        }
    };

    const performInitialSync = async () => {
        if (!currentUserId) {
            Alert.alert('Error', 'User ID not available. Please try again.');
            return;
        }

        setIsSyncing(true);
        try {
            console.log(`🔄 Starting initial Apple Health sync for user ${currentUserId}...`);
            const result = await triggerManualSync(currentUserId, 7); // Current user ID, last 7 days
            
            if (result.success) {
                setLastSyncTime(new Date().toLocaleString());
                Alert.alert(
                    'Sync Successful',
                    `Apple Health data synced successfully! ${result.recordsSynced || 0} records processed.`,
                    [{ text: 'OK' }]
                );
            } else {
                Alert.alert(
                    'Sync Failed',
                    result.message,
                    [{ text: 'OK' }]
                );
            }
        } catch (error) {
            console.error('❌ Initial sync failed:', error);
            Alert.alert(
                'Sync Error',
                'Failed to sync Apple Health data. Please check your connection and try again.',
                [{ text: 'OK' }]
            );
        } finally {
            setIsSyncing(false);
        }
    };



    const handleSelectDiabetesType = (type: string) => {
        setUser({ ...user, diabetesType: type });
        setDiabetesTypeModalVisible(false);
    };

    const handleLogBasalDose = async () => {
        if (!basalInsulinName.trim() || !basalDose) {
            Alert.alert('Missing Fields', 'Please fill in all fields.');
            return;
        }
        const doseUnits = parseFloat(basalDose);
        if (isNaN(doseUnits) || doseUnits <= 0) {
            Alert.alert('Invalid Input', 'Dose must be a positive number.');
            return;
        }

        if (!clerkUser?.id) {
            Alert.alert('Error', 'User not authenticated. Please sign in again.');
            return;
        }
    
        try {
            // Log to backend
            const result = await apiClient.post('/api/log-basal-dose', {
                clerk_user_id: clerkUser.id,
                insulin_name: basalInsulinName.trim(),
                dose_units: doseUnits,
                timestamp: new Date().toISOString(),
            });

            if (!result.success) {
                console.error('Backend error response:', result.error);
                throw new Error(result.error || 'Failed to log basal dose');
            }

            console.log('✅ Basal dose logged successfully:', result.data);

            // Create new entry for local state
            const newEntry = {
                insulinType: 'basal',
                insulinName: basalInsulinName.trim(),
                doseUnits: doseUnits,
                timestamp: new Date().toISOString(),
            };
            const updatedHistory = [...basalHistory, newEntry];
            setBasalHistory(updatedHistory);
            
            // Also persist locally as backup
            persistBasalHistory(updatedHistory);

            // --- Smart Feedback ---
            const previousEntries = updatedHistory.slice(0, -1); // exclude new
            if (previousEntries.length > 0) {
                const minutesFromMidnight = (dateStr: string) => {
                    const d = new Date(dateStr);
                    return d.getHours() * 60 + d.getMinutes();
                };
                const avgMinutes = previousEntries.reduce((acc, e) => acc + minutesFromMidnight(e.timestamp), 0) / previousEntries.length;
                const newMinutes = minutesFromMidnight(newEntry.timestamp);
                if (Math.abs(newMinutes - avgMinutes) > 120) {
                    setTimingWarning('⏱️ You took your basal dose significantly later than usual. This may affect fasting glucose.');
                } else {
                    setTimingWarning(null);
                }
            }

            // Consistency last 7 days
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // include today = 7 days
            const uniqueDays = new Set(
                updatedHistory
                    .filter(e => new Date(e.timestamp) >= sevenDaysAgo)
                    .map(e => new Date(e.timestamp).toDateString())
            );
            if (uniqueDays.size >= 6) {
                setConsistencyMessage('🎉 Great job! You\'ve logged your basal dose consistently this week.');
            } else {
                setConsistencyMessage(null);
            }

            console.log('Basal Log:', newEntry);
            Alert.alert('Success', 'Basal dose logged successfully.');
            setBasalModalVisible(false);
            setBasalInsulinName('');
            setBasalDose('');
        } catch (error) {
            console.error('Error logging basal dose:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to log basal dose. Please try again.';
            Alert.alert('Error', errorMessage);
        }
    };


    // ===== Insulin Calculator Logic =====
    const calculateDose = () => {
        // Validate required fields
        if (!carbs || !icRatio) {
            Alert.alert('Missing Fields', 'Please enter carbohydrates and I:C ratio.');
            return;
        }

        const carbsNum = parseFloat(carbs);
        const icRatioNum = parseFloat(icRatio);

        if (isNaN(carbsNum) || isNaN(icRatioNum) || icRatioNum === 0) {
            Alert.alert('Invalid Input', 'Carbohydrates and I:C ratio must be numeric and I:C ratio cannot be zero.');
            return;
        }

        let meal = carbsNum / icRatioNum;
        let correction = 0;

        if (currentGlucose && targetGlucose && correctionFactor) {
            const currentNum = parseFloat(currentGlucose);
            const targetNum = parseFloat(targetGlucose);
            const correctionFactorNum = parseFloat(correctionFactor);

            if (isNaN(currentNum) || isNaN(targetNum) || isNaN(correctionFactorNum) || correctionFactorNum === 0) {
                Alert.alert('Invalid Input', 'Glucose values and correction factor must be numeric and correction factor cannot be zero.');
                return;
            }

            correction = (currentNum - targetNum) / correctionFactorNum;
        }

        const total = Math.round((meal + correction) * 2) / 2;

        setMealInsulin(meal);
        setCorrectionInsulin(correction);
        setTotalInsulin(total);

        // Low glucose warning
        if (currentGlucose && parseFloat(currentGlucose) < 70) {
            setLowGlucoseWarning(true);
        } else {
            setLowGlucoseWarning(false);
        }

        if (logBolusEntry) {
            const log = {
                insulinType: 'bolus',
                totalUnits: total,
                mealInsulin: meal,
                correctionInsulin: correction,
                timestamp: new Date().toISOString()
            };
            console.log('Bolus Log:', log);
            Alert.alert('Logged', 'Bolus calculation has been saved.');
        }
    };

    const navigateToEditProfile = () => {
        router.push('/edit-profile');
    };

    const handleSaveTargetGlucose = async () => {
        try {
            // Validate inputs
            const min = parseInt(tempTargetMin);
            const max = parseInt(tempTargetMax);
            
            if (isNaN(min) || isNaN(max)) {
                Alert.alert('Invalid Input', 'Please enter valid numbers for both minimum and maximum values.');
                return;
            }
            
            if (min < 50 || min > 250 || max < 50 || max > 250) {
                Alert.alert('Invalid Range', 'Target glucose values must be between 50-250 mg/dL.');
                return;
            }
            
            if (min >= max) {
                Alert.alert('Invalid Range', 'Minimum value must be less than maximum value.');
                return;
            }
            
            // Make API call to update target glucose
            const result = await apiClient.put('/api/update-user-profile', {
                clerk_user_id: clerkUser?.id,
                target_glucose_min: min,
                target_glucose_max: max,
            });
            
            if (result.success) {
                // Update local state
                setTargetGlucoseMin(min);
                setTargetGlucoseMax(max);
                setTargetGlucoseModalVisible(false);
                Alert.alert('Success', 'Target glucose range updated successfully.');
            } else {
                const errorMessage = result.data?.validation_errors?.join('\n') || result.error || 'Failed to update target glucose range.';
                Alert.alert('Error', errorMessage);
            }
        } catch (error) {
            console.error('Error updating target glucose:', error);
            Alert.alert('Error', 'Failed to update target glucose range. Please try again.');
        }
    };

    const handleLogout = async () => {
        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out? Your profile and preferences will be saved.',
            [
                {
                    text: 'Cancel',
                    style: 'cancel'
                },
                {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            console.log('🚪 Starting logout process...');
                            
                            // Sign out from Clerk
                            await signOut();
                            
                            console.log('✅ Successfully signed out');
                            
                            // Navigation will be handled automatically by InitialLayout
                            // which will detect the auth state change and redirect to login
                            
                        } catch (error) {
                            console.error('❌ Error during logout:', error);
                            Alert.alert(
                                'Logout Error', 
                                'Failed to sign out. Please try again.',
                                [{ text: 'OK' }]
                            );
                        }
                    }
                }
            ]
        );
    };

    return (
        <>
        <ScrollView style={styles.container}>
            <View style={styles.profileContainer}>
                <View style={styles.headerContainer}>
                    <Avatar
                        rounded
                        size={AVATAR_SIZE}
                        source={{ uri: user.profilePicture }}
                        containerStyle={styles.avatar}
                    />
                    <View style={styles.headerText}>
                        <Text style={styles.name}>{displayName}</Text>
                        {__DEV__ && (
                            <Text style={[styles.connectionStatus, { color: isConnected ? COLORS.success : COLORS.error }]}>
                                {isConnected ? '✅' : '❌'} {connectionStatus}
                            </Text>
                        )}
                    </View>
                </View>
            </View>



            {/* Apple Health Integration Section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Apple Health Integration</Text>
                
                <ListItem 
                    key="apple-health-sync" 
                    bottomDivider 
                    containerStyle={styles.listItem}
                    underlayColor="transparent"
                >
                    <View style={styles.listItemIconContainer}>
                        <Icon name="fitness-outline" type="ionicon" color={COLORS.primary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Sync Apple Health Data</ListItem.Title>
                        <ListItem.Subtitle style={styles.listItemSubtitle}>
                            {appleHealthSyncEnabledLocal 
                                ? `Auto-sync enabled${lastSyncTime ? ` • Last sync: ${lastSyncTime}` : ''}`
                                : 'Manually sync health data from Apple Health'
                            }
                        </ListItem.Subtitle>
                    </ListItem.Content>
                    <Switch
                        value={appleHealthSyncEnabledLocal}
                        onValueChange={handleAppleHealthToggle}
                        trackColor={{ false: COLORS.lightGray, true: COLORS.primary + '80' }}
                        thumbColor={appleHealthSyncEnabledLocal ? COLORS.primary : COLORS.mediumGray}
                        disabled={isSyncing}
                    />
                </ListItem>




            </View>

            {/* Connect Your CGM Section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Connect Your CGM</Text>
                
                <ListItem 
                    key="connect-cgm" 
                    bottomDivider 
                    containerStyle={styles.listItem}
                    onPress={() => router.push('/cgm-connection')}
                    underlayColor="transparent"
                >
                    <View style={styles.listItemIconContainer}>
                        <Icon name="glasses-outline" type="ionicon" color={COLORS.primary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Connect to CGM</ListItem.Title>
                        <ListItem.Subtitle style={styles.listItemSubtitle}>
                            Select your CGM (Dexcom or Libre) and connect
                        </ListItem.Subtitle>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
            </View>

            {/* Personal Information Section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Personal Information</Text>
                <ListItem key="diabetes-type" bottomDivider containerStyle={styles.listItem} onPress={() => setDiabetesTypeModalVisible(true)}>
                    <View style={styles.listItemIconContainer}>
                        <Icon name="medical-outline" type="ionicon" color={COLORS.primary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Diabetes Type</ListItem.Title>
                        <ListItem.Subtitle style={styles.listItemSubtitle}>{user.diabetesType}</ListItem.Subtitle>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
                <ListItem 
                    key="target-glucose" 
                    bottomDivider 
                    containerStyle={styles.listItem}
                    onPress={() => {
                        setTempTargetMin(targetGlucoseMin.toString());
                        setTempTargetMax(targetGlucoseMax.toString());
                        setTargetGlucoseModalVisible(true);
                    }}
                    underlayColor="transparent"
                >
                    <View style={styles.listItemIconContainer}>
                        <Icon name="locate-outline" type="ionicon" color={COLORS.secondary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Target Glucose</ListItem.Title>
                        <ListItem.Subtitle style={styles.listItemSubtitle}>{targetGlucoseMin}-{targetGlucoseMax} mg/dL</ListItem.Subtitle>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
                <ListItem key="a1c-goal" bottomDivider containerStyle={styles.listItem}>
                    <View style={styles.listItemIconContainer}>
                        <Icon name="heart-outline" type="ionicon" color={COLORS.accent} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>A1c Goal</ListItem.Title>
                        <ListItem.Subtitle style={styles.listItemSubtitle}>{user.a1cGoal}</ListItem.Subtitle>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
                <ListItem key="medications" bottomDivider containerStyle={styles.listItem}>
                    <View style={styles.listItemIconContainer}>
                        <Icon name="medkit-outline" type="ionicon" color={COLORS.primary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Medications</ListItem.Title>
                        <ListItem.Subtitle style={styles.listItemSubtitle}>{user.medications.join(', ')}</ListItem.Subtitle>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
            </View>

            {/* Insulin Logging Section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Insulin Logging</Text>

                {user.diabetesType === 'Type 2' && (
                    <ListItem 
                        key="show-bolus-toggle" 
                        bottomDivider 
                        containerStyle={styles.listItem}
                    >
                        <View style={styles.listItemIconContainer}>
                           <Icon name="calculator-outline" type="ionicon" color={COLORS.secondary} size={22} />
                        </View>
                        <ListItem.Content>
                            <ListItem.Title style={styles.listItemTitle}>Show Bolus Calculator</ListItem.Title>
                        </ListItem.Content>
                        <Switch
                            value={showBolusForType2}
                            onValueChange={setShowBolusForType2}
                            trackColor={{ false: COLORS.lightGray, true: COLORS.primary + '80' }}
                            thumbColor={showBolusForType2 ? COLORS.primary : COLORS.mediumGray}
                        />
                    </ListItem>
                )}

                {(user.diabetesType === 'Type 1' || (user.diabetesType === 'Type 2' && showBolusForType2)) && (
                    <ListItem
                        key="insulin-calculator"
                        containerStyle={styles.card}
                        onPress={() => setCalculatorVisible(true)}
                        underlayColor="transparent"
                    >
                        <View style={styles.listItemIconContainer}>
                            <Icon name="calculator-outline" type="ionicon" color={COLORS.secondary} size={22} />
                        </View>
                        <ListItem.Content>
                            <ListItem.Title style={styles.cardTitle}>Bolus Insulin Calculator</ListItem.Title>
                        </ListItem.Content>
                        <ListItem.Chevron color={COLORS.mediumGray} />
                    </ListItem>
                )}
                 {user.diabetesType && (
                    <ListItem
                        key="basal-logger"
                        containerStyle={styles.card}
                        onPress={() => setBasalModalVisible(true)}
                        underlayColor="transparent"
                    >
                        <View style={styles.listItemIconContainer}>
                            <Icon name="time-outline" type="ionicon" color={COLORS.accent} size={22} />
                        </View>
                        <ListItem.Content>
                            <ListItem.Title style={styles.cardTitle}>Log Basal Dose</ListItem.Title>
                        </ListItem.Content>
                        <ListItem.Chevron color={COLORS.mediumGray} />
                    </ListItem>
                )}
            </View>


            {/* Account Section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Account</Text>
                <ListItem
                    key="edit-profile"
                    bottomDivider
                    containerStyle={styles.listItem}
                    onPress={navigateToEditProfile}
                    underlayColor="transparent"
                >
                    <View style={styles.listItemIconContainer}>
                        <Icon name="person-outline" type="ionicon" color={COLORS.secondary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Edit Profile</ListItem.Title>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
                <ListItem key="password-security" bottomDivider containerStyle={styles.listItem} onPress={() => console.log('Password & Security')} underlayColor="transparent">
                    <View style={styles.listItemIconContainer}>
                        <Icon name="lock-closed-outline" type="ionicon" color={COLORS.accent} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Password & Security</ListItem.Title>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
                <ListItem key="connected-devices" bottomDivider containerStyle={styles.listItem} onPress={() => console.log('Connected Devices')} underlayColor="transparent">
                    <View style={styles.listItemIconContainer}>
                        <Icon name="link-outline" type="ionicon" color={COLORS.primary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Connected Devices & Apps</ListItem.Title>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
            </View>

            {/* Preferences & Support Section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Preferences & Support</Text>
                <ListItem key="notifications" bottomDivider containerStyle={styles.listItem} onPress={() => console.log('Notifications')} underlayColor="transparent">
                    <View style={styles.listItemIconContainer}>
                        <Icon name="notifications-outline" type="ionicon" color={COLORS.secondary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Notifications</ListItem.Title>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
                <ListItem key="language-units" bottomDivider containerStyle={styles.listItem} onPress={() => console.log('Language & Units')} underlayColor="transparent">
                    <View style={styles.listItemIconContainer}>
                        <Icon name="globe-outline" type="ionicon" color={COLORS.accent} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Language & Units</ListItem.Title>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
                <ListItem key="help-support" bottomDivider containerStyle={styles.listItem} onPress={() => console.log('Help & Support')} underlayColor="transparent">
                    <View style={styles.listItemIconContainer}>
                        <Icon name="help-circle-outline" type="ionicon" color={COLORS.primary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Help & Support</ListItem.Title>
                    </ListItem.Content>
                    <ListItem.Chevron color={COLORS.mediumGray} />
                </ListItem>
            </View>

            {/* Logout Section */}
            <View style={styles.logoutContainer}>
                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                    <Icon name="log-out-outline" type="ionicon" color={COLORS.white} size={20} />
                    <Text style={styles.logoutText}>Logout</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>

        {/* ===== Insulin Calculator Modal ===== */}
        <Modal
            visible={calculatorVisible}
            animationType="slide"
            transparent
            onRequestClose={handleCloseModal}
        >
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={0}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss} style={{ flex: 1 }}>
                    <View style={modalStyles.modalOverlay}>
                        <View style={modalStyles.modalContent}>
                            <ScrollView showsVerticalScrollIndicator={false}>
                                {/* Drag handle */}
                                <View style={modalStyles.handle} />

                                <Text style={modalStyles.title}>Bolus Insulin Calculator</Text>

                                <TextInput
                                    placeholder="Carbohydrates (g)*"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={carbs}
                                    onChangeText={setCarbs}
                                    style={modalStyles.input}
                                />
                                <TextInput
                                    placeholder="I:C Ratio*"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={icRatio}
                                    onChangeText={setIcRatio}
                                    style={modalStyles.input}
                                />
                                <TextInput
                                    placeholder="Current Blood Glucose (mg/dL)"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={currentGlucose}
                                    onChangeText={setCurrentGlucose}
                                    style={modalStyles.input}
                                />
                                <TextInput
                                    placeholder="Target Glucose (mg/dL)"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={targetGlucose}
                                    onChangeText={setTargetGlucose}
                                    style={modalStyles.input}
                                />
                                <TextInput
                                    placeholder="Correction Factor"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={correctionFactor}
                                    onChangeText={setCorrectionFactor}
                                    style={modalStyles.input}
                                />

                                <View style={modalStyles.switchContainer}>
                                    <Text style={modalStyles.switchLabel}>Save this entry</Text>
                                    <Switch
                                        value={logBolusEntry}
                                        onValueChange={setLogBolusEntry}
                                        trackColor={{ false: COLORS.lightGray, true: COLORS.primary + '80' }}
                                        thumbColor={logBolusEntry ? COLORS.primary : COLORS.mediumGray}
                                    />
                                </View>

                                {lowGlucoseWarning && (
                                    <Text style={modalStyles.warningText}>Low glucose — bolus not advised.</Text>
                                )}

                                <TouchableOpacity style={modalStyles.button} onPress={calculateDose}>
                                    <Text style={modalStyles.buttonText}>Calculate Dose</Text>
                                </TouchableOpacity>

                                {(mealInsulin !== null || correctionInsulin !== null) && (
                                    <View style={modalStyles.resultsContainer}>
                                        <Text style={modalStyles.resultText}>Meal Insulin: {mealInsulin?.toFixed(1)} U</Text>
                                        <Text style={modalStyles.resultText}>Correction Insulin: {correctionInsulin?.toFixed(1)} U</Text>
                                        <Text style={modalStyles.resultTotal}>Total Recommended Dose: {totalInsulin?.toFixed(1)} U</Text>
                                    </View>
                                )}

                                <TouchableOpacity style={modalStyles.closeButton} onPress={handleCloseModal}>
                                    <Text style={modalStyles.closeButtonText}>Close</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </Modal>

        {/* Basal Logger Modal */}
        <Modal
            visible={basalModalVisible}
            animationType="slide"
            transparent
            onRequestClose={() => setBasalModalVisible(false)}
        >
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss} style={{ flex: 1 }}>
                    <View style={modalStyles.modalOverlay}>
                        <View style={modalStyles.modalContent}>
                            <View style={modalStyles.handle} />
                            <Text style={modalStyles.title}>Log Basal Dose</Text>
                            
                            <ScrollView 
                                showsVerticalScrollIndicator={false}
                                style={modalStyles.scrollContent}
                                contentContainerStyle={modalStyles.scrollContentContainer}
                            >
                                <TextInput
                                    placeholder="Insulin Name (e.g., Lantus, Levemir)"
                                    placeholderTextColor="#999"
                                    value={basalInsulinName}
                                    onChangeText={setBasalInsulinName}
                                    style={modalStyles.input}
                                />
                                <TextInput
                                    placeholder="Dose (units)"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={basalDose}
                                    onChangeText={setBasalDose}
                                    style={modalStyles.input}
                                />
                                <Text style={modalStyles.infoText}>Time of injection will be logged as the current time.</Text>
                                <TouchableOpacity style={modalStyles.button} onPress={handleLogBasalDose}>
                                    <Text style={modalStyles.buttonText}>Log Basal Dose</Text>
                                </TouchableOpacity>
                                
                                {/* Smart Feedback Messages */}
                                {timingWarning && (
                                    <Text style={modalStyles.warningText}>{timingWarning}</Text>
                                )}
                                {consistencyMessage && (
                                    <Text style={modalStyles.successText}>{consistencyMessage}</Text>
                                )}

                                {/* Basal History Section */}
                                <View style={modalStyles.historyContainer}>
                                    <Text style={modalStyles.historyTitle}>Basal History (last 14 days)</Text>
                                    {(() => {
                                        // Generate last 14 days data
                                        const daysArray = [] as any[];
                                        for (let i = 0; i < 14; i++) {
                                            const date = new Date();
                                            date.setDate(date.getDate() - i);
                                            daysArray.push(date);
                                        }

                                        return daysArray.map(date => {
                                            const dayString = date.toDateString();
                                            const logsForDay = basalHistory.filter(e => new Date(e.timestamp).toDateString() === dayString);
                                            if (logsForDay.length === 0) {
                                                return (
                                                    <Text key={dayString} style={modalStyles.missingDay}>❌ No dose logged on {dayString}</Text>
                                                );
                                            }
                                            return logsForDay.map((entry, idx) => (
                                                <View key={entry.timestamp + idx} style={modalStyles.historyItem}>
                                                    <Text style={modalStyles.historyText}>{entry.insulinName} • {entry.doseUnits} U</Text>
                                                    <Text style={modalStyles.historySub}>{new Date(entry.timestamp).toLocaleString()}</Text>
                                                </View>
                                            ));
                                        });
                                    })()}
                                </View>
                            </ScrollView>
                            
                            {/* Cancel button fixed at bottom */}
                            <View style={modalStyles.bottomButtonContainer}>
                                <TouchableOpacity style={modalStyles.cancelButton} onPress={() => setBasalModalVisible(false)}>
                                    <Text style={modalStyles.cancelButtonText}>Cancel</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </Modal>

        {/* Diabetes Type Picker Modal */}
        <Modal
            visible={diabetesTypeModalVisible}
            animationType="fade"
            transparent
            onRequestClose={() => setDiabetesTypeModalVisible(false)}
        >
            <View style={modalStyles.modalOverlay}>
                <View style={modalStyles.pickerModalContent}>
                    <Text style={modalStyles.title}>Select Diabetes Type</Text>
                    {['Type 1', 'Type 2', 'Gestational'].map((type) => (
                        <TouchableOpacity
                            key={type}
                            style={modalStyles.pickerItem}
                            onPress={() => handleSelectDiabetesType(type)}
                        >
                            <Text style={modalStyles.pickerItemText}>{type}</Text>
                        </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={modalStyles.pickerCancelButton} onPress={() => setDiabetesTypeModalVisible(false)}>
                        <Text style={modalStyles.pickerCancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>

        {/* Target Glucose Range Modal */}
        <Modal
            visible={targetGlucoseModalVisible}
            animationType="slide"
            transparent
            onRequestClose={() => setTargetGlucoseModalVisible(false)}
        >
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={0}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={modalStyles.modalOverlay}>
                        <View style={modalStyles.modalContent}>
                            <View style={modalStyles.handle} />
                            
                            <Text style={modalStyles.title}>Set Target Glucose Range</Text>
                            <Text style={modalStyles.subtitle}>Define your personal glucose target range (mg/dL)</Text>
                            
                            <View style={modalStyles.inputContainer}>
                                <Text style={modalStyles.inputLabel}>Minimum Value</Text>
                                <TextInput
                                    style={modalStyles.input}
                                    placeholder="70"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={tempTargetMin}
                                    onChangeText={setTempTargetMin}
                                    maxLength={3}
                                />
                            </View>
                            
                            <View style={modalStyles.inputContainer}>
                                <Text style={modalStyles.inputLabel}>Maximum Value</Text>
                                <TextInput
                                    style={modalStyles.input}
                                    placeholder="140"
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={tempTargetMax}
                                    onChangeText={setTempTargetMax}
                                    maxLength={3}
                                />
                            </View>
                            
                            <Text style={modalStyles.helperText}>
                                Recommended range: 70-140 mg/dL for most individuals.
                                Valid range: 50-250 mg/dL.
                            </Text>
                            
                            <TouchableOpacity style={modalStyles.button} onPress={handleSaveTargetGlucose}>
                                <Text style={modalStyles.buttonText}>Save Range</Text>
                            </TouchableOpacity>
                            
                            <TouchableOpacity style={modalStyles.closeButton} onPress={() => setTargetGlucoseModalVisible(false)}>
                                <Text style={modalStyles.closeButtonText}>Cancel</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </Modal>

        </>
     );
 };
 
 export default ProfileScreen;
 
 // ===== Modal Styles =====
 const modalStyles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: COLORS.white,
        marginHorizontal: 20,
        marginVertical: 40,
        borderRadius: 12,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 80, // Extra padding for fixed Cancel button
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        maxHeight: '85%', // Ensure modal doesn't take full height
    },
    handle: {
        width: 40,
        height: 4,
        backgroundColor: COLORS.lightGray,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 12,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: COLORS.textDark,
        marginBottom: 16,
    },
    subtitle: {
        fontSize: 14,
        color: COLORS.mediumGray,
        marginBottom: 20,
        textAlign: 'center',
    },
    inputContainer: {
        marginBottom: 16,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: COLORS.textDark,
        marginBottom: 6,
    },
    helperText: {
        fontSize: 12,
        color: COLORS.mediumGray,
        marginBottom: 20,
        fontStyle: 'italic',
        textAlign: 'center',
    },
    input: {
        borderWidth: 1,
        borderColor: COLORS.lightGray,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 12,
        backgroundColor: '#f9f9f9',
        fontSize: 16,
    },
    button: {
        backgroundColor: COLORS.primary,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginBottom: 12,
    },
    buttonText: {
        color: COLORS.white,
        fontWeight: '600',
        fontSize: 16,
    },
    resultsContainer: {
        marginTop: 8,
        marginBottom: 8,
    },
    resultText: {
        fontSize: 16,
        color: COLORS.textDark,
        marginBottom: 4,
    },
    resultTotal: {
        fontSize: 18,
        fontWeight: 'bold',
        color: COLORS.accent,
        marginTop: 4,
    },
    closeButton: {
        alignItems: 'center',
        paddingVertical: 10,
    },
    closeButtonText: {
        color: COLORS.accent,
        fontSize: 16,
    },
    warningText: {
        color: COLORS.error,
        marginBottom: 8,
    },
    successText: {
        color: COLORS.success,
        marginBottom: 8,
        textAlign: 'center',
    },
    historyContainer: {
        marginTop: 16,
    },
    historyTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: COLORS.textDark,
        marginBottom: 8,
    },
    historyItem: {
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.liGray,
    },
    historyText: {
        fontSize: 15,
        color: COLORS.textDark,
    },
    historySub: {
        fontSize: 13,
        color: COLORS.textSecondary,
    },
    missingDay: {
        fontSize: 14,
        color: COLORS.mediumGray,
        fontStyle: 'italic',
        paddingVertical: 4,
    },
    infoText: {
        textAlign: 'center',
        color: COLORS.textSecondary,
        fontSize: 14,
        marginBottom: 16,
    },
    switchContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        paddingHorizontal: 4,
    },
    switchLabel: {
        fontSize: 16,
        color: COLORS.textDark,
    },
    pickerModalContent: {
        width: '90%',
        backgroundColor: COLORS.white,
        borderRadius: 12,
        padding: 20,
        alignItems: 'center',
    },
    pickerItem: {
        width: '100%',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.liGray,
    },
    pickerItemText: {
        textAlign: 'center',
        fontSize: 18,
        color: COLORS.primary1,
    },
    pickerCancelButton: {
        marginTop: 10,
        paddingVertical: 10,
    },
    pickerCancelButtonText: {
        color: COLORS.accent,
        fontSize: 16,
    },
    scrollContent: {
        flex: 1,
    },
    scrollContentContainer: {
        paddingBottom: 100, // Add padding to the bottom for the fixed button
    },
    bottomButtonContainer: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
        backgroundColor: COLORS.white,
        paddingVertical: 10,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    cancelButton: {
        alignItems: 'center',
        paddingVertical: 10,
    },
    cancelButtonText: {
        color: COLORS.accent,
        fontSize: 16,
    },
    connectionStatus: {
        fontSize: 12,
        marginTop: 4,
        fontStyle: 'italic',
    },
 });

