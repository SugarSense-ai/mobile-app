import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-expo'
import { useRouter, useSegments } from 'expo-router';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { initializeApi } from '@/services/api';
import { onboardingService } from '@/services/onboardingService';

export default function InitialLayout() {
    const { isLoaded, isSignedIn } = useAuth();
    const router = useRouter();
    const segments = useSegments();
    const [apiInitialized, setApiInitialized] = useState(false);
    const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

    useEffect(() => {
        // Initialize the API connection once.
        initializeApi().catch(err => {
            console.error("API initialization failed", err);
        }).finally(() => {
            setApiInitialized(true);
        });
    }, []); // Empty dependency array ensures this runs only once on mount.

    useEffect(() => {
        // Check onboarding status when the component mounts
        const checkOnboardingStatus = async () => {
            if (isSignedIn) {
                const completed = await onboardingService.isOnboardingCompleted();
                setOnboardingCompleted(completed);
            }
        };

        if (isLoaded && isSignedIn) {
            checkOnboardingStatus();
        }
    }, [isLoaded, isSignedIn]);

    useEffect(() => {
        // This effect will run whenever the auth state or route changes.
        console.log('🔄 Layout Effect:', { isLoaded, isSignedIn, apiInitialized, onboardingCompleted, segments: segments.join('/') });

        if (!isLoaded || !apiInitialized) {
            // Don't do anything until Clerk and the API are ready.
            return;
        }

        if (!isSignedIn) {
            // If the user is not signed in, make sure they are in the auth flow.
            console.log('❌ User not signed in. Redirecting to login...');
            router.replace('/(auth)/login');
            return;
        }

        // User is signed in - check onboarding status
        if (onboardingCompleted === null) {
            // Still loading onboarding status
            return;
        }

        const inTabsGroup = segments[0] === '(tabs)';
        const inOnboardingFlow = segments[0] === '(auth)' && (segments[1] === 'onboarding' || segments[1] === 'user-info');

        if (!onboardingCompleted && !inOnboardingFlow) {
            // User is signed in but hasn't completed onboarding
            console.log('🚀 First-time user detected. Redirecting to onboarding...');
            router.replace('/(auth)/onboarding');
        } else if (onboardingCompleted && !inTabsGroup) {
            // User has completed onboarding but is not in main app
            console.log('✅ User signed in and onboarding completed. Redirecting to main app...');
            router.replace('/(tabs)');
        } else {
            console.log('👍 User in correct route group. No redirect needed.');
        }

    }, [isLoaded, isSignedIn, segments, apiInitialized, onboardingCompleted]);

    if (!isLoaded || !apiInitialized || (isSignedIn && onboardingCompleted === null)) {
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