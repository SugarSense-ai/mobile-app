import React, { useState, useEffect } from 'react';
import { View, ScrollView, Text, TouchableOpacity, Switch, Alert } from 'react-native';
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

    useEffect(() => {
        // Initialize Apple Health sync state
        const currentState = isAppleHealthSyncEnabledState();
        setAppleHealthSyncEnabledLocal(currentState);
        
        // Check for permissions
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
                            setAppleHealthSyncEnabled(true);
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
                        onPress: () => {
                            setAppleHealthSyncEnabled(false);
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

    const navigateToLeaderboard = () => {
        console.log('Navigating to Leaderboard');
    };

    const navigateToEditProfile = () => {
        console.log('Navigating to Edit Profile');
    };

    return (
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
                <ListItem key="diabetes-type" bottomDivider containerStyle={styles.listItem}>
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
    );
};

export default ProfileScreen;

