import React, { useState, useEffect } from 'react';
import { View, ScrollView, Text, TouchableOpacity, Switch, Alert, Modal, TextInput, StyleSheet, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Avatar, ListItem, Icon } from 'react-native-elements';
import { useNavigation } from '@react-navigation/native';
import { styles } from '@/styles/profile.styles';
import { COLORS } from '@/constants/theme';
import { 
  setAppleHealthSyncEnabled, 
  isAppleHealthSyncEnabledState, 
  triggerManualSync,
  hasHealthKitPermissions 
} from '@/services/healthKit';

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
    const navigation = useNavigation();
    const [user, setUser] = useState(dummyUser);
    const [appleHealthSyncEnabled, setAppleHealthSyncEnabledLocal] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
    
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

    // Load basal history from persistence on mount
    useEffect(() => {
        const loadHistory = async () => {
            try {
                const stored = await AsyncStorage.getItem('BASAL_HISTORY');
                if (stored) {
                    setBasalHistory(JSON.parse(stored));
                }
            } catch (error) {
                console.error('Failed to load basal history', error);
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
        setIsSyncing(true);
        try {
            console.log('🔄 Starting initial Apple Health sync...');
            const result = await triggerManualSync(1, 7); // User ID 1, last 7 days
            
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

    const handleManualSync = async () => {
        if (!appleHealthSyncEnabled) {
            Alert.alert(
                'Apple Health Sync Disabled',
                'Please enable Apple Health sync first to manually sync data.',
                [{ text: 'OK' }]
            );
            return;
        }

        await performInitialSync();
    };

    const handleSelectDiabetesType = (type: string) => {
        setUser({ ...user, diabetesType: type });
        setDiabetesTypeModalVisible(false);
    };

    const handleLogBasalDose = () => {
        if (!basalInsulinName.trim() || !basalDose) {
            Alert.alert('Missing Fields', 'Please fill in all fields.');
            return;
        }
        const doseUnits = parseFloat(basalDose);
        if (isNaN(doseUnits) || doseUnits <= 0) {
            Alert.alert('Invalid Input', 'Dose must be a positive number.');
            return;
        }
    
        const newEntry = {
            insulinType: 'basal',
            insulinName: basalInsulinName.trim(),
            doseUnits: doseUnits,
            timestamp: new Date().toISOString(),
        };
        const updatedHistory = [...basalHistory, newEntry];
        setBasalHistory(updatedHistory);
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
            setConsistencyMessage('🎉 Great job! You’ve logged your basal dose consistently this week.');
        } else {
            setConsistencyMessage(null);
        }

        console.log('Basal Log:', newEntry);
        Alert.alert('Success', 'Basal dose logged successfully.');
        setBasalModalVisible(false);
        setBasalInsulinName('');
        setBasalDose('');
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

    const navigateToLeaderboard = () => {
        console.log('Navigating to Leaderboard');
    };

    const navigateToEditProfile = () => {
        console.log('Navigating to Edit Profile');
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
                        <Text style={styles.name}>{user.name}</Text>
                        <Text style={styles.username}>@{user.username}</Text>
                    </View>
                </View>
            </View>

            <TouchableOpacity style={styles.card} onPress={navigateToLeaderboard}>
                <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Your Ranking</Text>
                    <Icon name="trophy-outline" type="ionicon" color={COLORS.accent} size={24} />
                </View>
                <View style={styles.cardBody}>
                    <View style={styles.leaderboardItem}>
                        <Text style={styles.leaderboardLabel}>Rank:</Text>
                        <Text style={[styles.leaderboardValue, { color: COLORS.primary }]}>{user.leaderboardRank}</Text>
                    </View>
                    <View style={styles.leaderboardItem}>
                        <Text style={styles.leaderboardLabel}>Tokens:</Text>
                        <Text style={[styles.leaderboardValue, { color: COLORS.success }]}>{user.tokenBalance}</Text>
                    </View>
                    <View style={styles.leaderboardItem}>
                        <Text style={styles.leaderboardLabel}>Activity:</Text>
                        <Text style={styles.leaderboardValue}>{user.activityScore}</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.cardFooterButton} onPress={navigateToLeaderboard}>
                    <Text style={styles.cardFooterText}>View Full Leaderboard</Text>
                    <Icon name="chevron-forward-outline" type="ionicon" color={COLORS.mediumGray} size={18} />
                </TouchableOpacity>
            </TouchableOpacity>

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
                            {appleHealthSyncEnabled 
                                ? `Auto-sync enabled${lastSyncTime ? ` • Last sync: ${lastSyncTime}` : ''}`
                                : 'Manually sync health data from Apple Health'
                            }
                        </ListItem.Subtitle>
                    </ListItem.Content>
                    <Switch
                        value={appleHealthSyncEnabled}
                        onValueChange={handleAppleHealthToggle}
                        trackColor={{ false: COLORS.lightGray, true: COLORS.primary + '80' }}
                        thumbColor={appleHealthSyncEnabled ? COLORS.primary : COLORS.mediumGray}
                        disabled={isSyncing}
                    />
                </ListItem>

                {appleHealthSyncEnabled && (
                    <ListItem 
                        key="manual-sync" 
                        bottomDivider 
                        containerStyle={styles.listItem}
                        onPress={handleManualSync}
                        disabled={isSyncing}
                        underlayColor="transparent"
                    >
                        <View style={styles.listItemIconContainer}>
                            <Icon 
                                name={isSyncing ? "sync" : "refresh-outline"} 
                                type="ionicon" 
                                color={isSyncing ? COLORS.accent : COLORS.secondary} 
                                size={22} 
                            />
                        </View>
                        <ListItem.Content>
                            <ListItem.Title style={[styles.listItemTitle, isSyncing && { color: COLORS.mediumGray }]}>
                                {isSyncing ? 'Syncing...' : 'Manual Sync Now'}
                            </ListItem.Title>
                            <ListItem.Subtitle style={styles.listItemSubtitle}>
                                {isSyncing 
                                    ? 'Syncing Apple Health data with dashboard'
                                    : 'Manually trigger Apple Health data sync'
                                }
                            </ListItem.Subtitle>
                        </ListItem.Content>
                        <ListItem.Chevron color={isSyncing ? COLORS.lightGray : COLORS.mediumGray} />
                    </ListItem>
                )}
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
                <ListItem key="target-glucose" bottomDivider containerStyle={styles.listItem}>
                    <View style={styles.listItemIconContainer}>
                        <Icon name="locate-outline" type="ionicon" color={COLORS.secondary} size={22} />
                    </View>
                    <ListItem.Content>
                        <ListItem.Title style={styles.listItemTitle}>Target Glucose</ListItem.Title>
                        <ListItem.Subtitle style={styles.listItemSubtitle}>{user.targetGlucose}</ListItem.Subtitle>
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
                <TouchableOpacity style={styles.logoutButton} onPress={() => console.log('Logout')}>
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
                            <ScrollView showsVerticalScrollIndicator={false}>
                                <View style={modalStyles.handle} />
                                <Text style={modalStyles.title}>Log Basal Dose</Text>
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
                                <TouchableOpacity style={modalStyles.closeButton} onPress={() => setBasalModalVisible(false)}>
                                    <Text style={modalStyles.closeButtonText}>Cancel</Text>
                                </TouchableOpacity>
                            </ScrollView>
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
        padding: 20,
    },
    modalContent: {
        width: '100%',
        backgroundColor: COLORS.white,
        borderRadius: 12,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
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
 });

