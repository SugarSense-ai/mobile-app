import { useEffect, useState } from 'react'
import { useAuth, useUser } from '@clerk/clerk-expo'
import { useRouter, useSegments } from 'expo-router';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { initializeApi, getBaseUrl } from '@/services/api';
import { onboardingService } from '../services/onboardingService';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function InitialLayout() {
    const { isLoaded, isSignedIn } = useAuth();
    const { user } = useUser();
    const router = useRouter();
    const segments = useSegments();
    const [apiInitialized, setApiInitialized] = useState(false);
    const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
    const [userRegistered, setUserRegistered] = useState(false);

    useEffect(() => {
        // Initialize the API connection once.
        initializeApi().catch(err => {
            console.error("API initialization failed", err);
        }).finally(() => {
            setApiInitialized(true);
        });
    }, []); // Empty dependency array ensures this runs only once on mount.

    // Helper function to check and update onboarding status
    const checkAndUpdateOnboardingStatus = async (userId: string) => {
        console.log(`🔍 InitialLayout: Checking onboarding status for user ${userId}...`);
        const completed = await onboardingService.isOnboardingCompleted(userId);
        console.log(`🎯 InitialLayout: Onboarding status result for user ${userId}: ${completed}`);
        setOnboardingCompleted(completed);
        console.log(`📝 InitialLayout: Set onboardingCompleted state to: ${completed}`);
        return completed;
    };

    // Helper function to register user in backend
    const registerUserInBackend = async (clerkUser: any) => {
        try {
            console.log(`👤 InitialLayout: Registering user in backend for ${clerkUser.id}...`);
            
            // Use dynamic URL resolution instead of hardcoded localhost
            const baseUrl = await getBaseUrl();
            console.log(`🌐 InitialLayout: Using backend URL: ${baseUrl}`);
            
            const response = await fetch(`${baseUrl}/api/register-user`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    clerk_user_id: clerkUser.id,
                    email: clerkUser.emailAddresses[0]?.emailAddress || '',
                    full_name: clerkUser.fullName || '',
                    profile_image_url: clerkUser.imageUrl || ''
                })
            });

            if (!response.ok) {
                throw new Error(`Registration failed: ${response.status}`);
            }

            const result = await response.json();
            console.log(`✅ InitialLayout: User registration result:`, result);

            // Store the database user_id for future use
            if (result.user_id) {
                await AsyncStorage.setItem(`db_user_id_${clerkUser.id}`, result.user_id.toString());
                console.log(`💾 InitialLayout: Stored database user_id ${result.user_id} for clerk user ${clerkUser.id}`);
            }

            // Update onboarding status based on backend response
            if (result.onboarding_completed !== undefined) {
                setOnboardingCompleted(result.onboarding_completed);
                console.log(`📝 InitialLayout: Set onboarding status from backend: ${result.onboarding_completed}`);
            }

            setUserRegistered(true);
            return result;

        } catch (error) {
            console.error('❌ InitialLayout: User registration failed:', error);
            // Don't throw - allow app to continue with local onboarding status
            setUserRegistered(true);
            return null;
        }
    };

    useEffect(() => {
        // Check onboarding status and register user when the component mounts
        const checkOnboardingAndRegisterUser = async () => {
            if (isSignedIn && user) {
                console.log(`🔍 InitialLayout: User is signed in (${user.id}), registering and checking onboarding...`);
                
                // Clean up old onboarding data first (for migration)
                await onboardingService.cleanupOldOnboardingData();
                
                // Register user in backend (idempotent operation)
                await registerUserInBackend(user);
                
                // Check onboarding status (might be updated by backend registration)
                if (onboardingCompleted === null) {
                    await checkAndUpdateOnboardingStatus(user.id);
                }
            } else {
                console.log('❌ InitialLayout: User not signed in or user object not available, skipping registration/onboarding check');
            }
        };

        if (isLoaded && isSignedIn && user && !userRegistered) {
            console.log(`🚀 InitialLayout: Auth loaded and user signed in (${user.id}), registering user and checking onboarding...`);
            checkOnboardingAndRegisterUser();
        } else {
            console.log(`⏳ InitialLayout: Waiting... isLoaded: ${isLoaded}, isSignedIn: ${isSignedIn}, user: ${user ? 'available' : 'null'}, userRegistered: ${userRegistered}`);
        }
    }, [isLoaded, isSignedIn, user, userRegistered]);

    useEffect(() => {
        // This effect will run whenever the auth state or route changes.
        console.log('🔄 Layout Effect:', { isLoaded, isSignedIn, apiInitialized, onboardingCompleted, userRegistered, segments: segments.join('/') });

        if (!isLoaded || !apiInitialized) {
            // Don't do anything until Clerk and the API are ready.
            console.log('⏳ InitialLayout: Waiting for Clerk and API to load...');
            return;
        }

        if (!isSignedIn) {
            // If the user is not signed in, make sure they are in the auth flow.
            console.log('❌ User not signed in. Redirecting to login...');
            
            // Reset states when user is logged out
            if (onboardingCompleted !== null) {
                console.log('🔄 InitialLayout: Resetting onboarding state after logout');
                setOnboardingCompleted(null);
            }
            if (userRegistered) {
                console.log('🔄 InitialLayout: Resetting user registration state after logout');
                setUserRegistered(false);
            }
            
            router.replace('/(auth)/login');
            return;
        }

        // User is signed in - wait for registration and onboarding status
        if (!userRegistered) {
            console.log('⏳ InitialLayout: Waiting for user registration...');
            return;
        }
        
        if (onboardingCompleted === null) {
            // Still loading onboarding status
            console.log('⏳ InitialLayout: Still loading onboarding status...');
            return;
        }

        const inTabsGroup = segments[0] === '(tabs)';
        const inOnboardingFlow = segments[0] === '(auth)' && (segments[1] === 'onboarding' || segments[1] === 'user-info');
        
        // Allow certain screens that are not in tabs but are valid authenticated screens
        const allowedNonTabScreens = ['edit-profile', 'cgm-connection'];
        const inAllowedScreen = allowedNonTabScreens.includes(segments[0]);

        console.log(`📍 InitialLayout: Current location analysis:
            - inTabsGroup: ${inTabsGroup}
            - inOnboardingFlow: ${inOnboardingFlow}
            - inAllowedScreen: ${inAllowedScreen}
            - onboardingCompleted: ${onboardingCompleted}
            - segments: ${segments.join('/')}`);

        // Special case: If user is in tabs but our local state shows onboarding not completed,
        // re-check the onboarding status in case it was completed in another component
        if (inTabsGroup && !onboardingCompleted && user) {
            console.log('🔄 InitialLayout: User in tabs but local state shows onboarding incomplete. Re-checking...');
            checkAndUpdateOnboardingStatus(user.id).then((actualStatus) => {
                if (!actualStatus) {
                    // Onboarding is actually not completed, redirect to onboarding
                    console.log('🚀 Re-check confirmed: First-time user detected. Redirecting to onboarding...');
                    router.replace('/(auth)/onboarding');
                } else {
                    // Onboarding was completed, user can stay in tabs
                    console.log('✅ Re-check confirmed: Onboarding completed. User can stay in main app.');
                }
            });
            return;
        }

        if (!onboardingCompleted && !inOnboardingFlow) {
            // User is signed in but hasn't completed onboarding
            console.log('🚀 First-time user detected. Redirecting to onboarding...');
            router.replace('/(auth)/onboarding');
        } else if (onboardingCompleted && !inTabsGroup && !inAllowedScreen) {
            // User has completed onboarding but is not in main app or allowed screen
            console.log('✅ User signed in and onboarding completed. Redirecting to main app...');
            router.replace('/(tabs)');
        } else {
            console.log('👍 User in correct route group or allowed screen. No redirect needed.');
        }

    }, [isLoaded, isSignedIn, segments, apiInitialized, onboardingCompleted, userRegistered]);

    if (!isLoaded || !apiInitialized || (isSignedIn && (!userRegistered || onboardingCompleted === null))) {
        // Show a loading spinner while Clerk, API, and onboarding status initialize.
        return (
            <View style={{ flex: 1, backgroundColor: COLORS.blue, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={{ color: 'white', fontSize: 16, marginTop: 10 }}>Loading SugarSense.ai...</Text>
            </View>
        );
    }

    return <Stack screenOptions={{ headerShown: false }} />;
}