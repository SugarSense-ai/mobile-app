import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-expo'
import { useRouter, useSegments } from 'expo-router';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { initializeApi } from '@/services/api';

export default function InitialLayout() {
    const { isLoaded, isSignedIn } = useAuth();
    const router = useRouter();
    const segments = useSegments();
    const [apiInitialized, setApiInitialized] = useState(false);

    useEffect(() => {
        // Initialize the API connection once.
        initializeApi().catch(err => {
            console.error("API initialization failed", err);
        }).finally(() => {
            setApiInitialized(true);
        });
    }, []); // Empty dependency array ensures this runs only once on mount.

    useEffect(() => {
        // This effect will run whenever the auth state or route changes.
        console.log('🔄 Layout Effect:', { isLoaded, isSignedIn, apiInitialized, segments: segments.join('/') });

        if (!isLoaded || !apiInitialized) {
            // Don't do anything until Clerk and the API are ready.
            return;
        }

        const inTabsGroup = segments[0] === '(tabs)';

        if (isSignedIn && !inTabsGroup) {
            // If the user is signed in but not in the main '(tabs)' group,
            // redirect them there. This handles the initial login navigation.
            console.log('✅ User signed in. Redirecting to main app...');
            router.replace('/(tabs)');
        } else if (!isSignedIn) {
            // If the user is not signed in, make sure they are in the auth flow.
            console.log('❌ User not signed in. Redirecting to login...');
            router.replace('/(auth)/login');
        } else {
            console.log('👍 User in correct route group. No redirect needed.');
        }

    }, [isLoaded, isSignedIn, segments, apiInitialized]);

    if (!isLoaded || !apiInitialized) {
        // Show a loading spinner while Clerk and API initializes.
        return (
            <View style={{ flex: 1, backgroundColor: COLORS.blue, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={{ color: 'white', fontSize: 16, marginTop: 10 }}>Loading SugarSense.ai...</Text>
            </View>
        );
    }

    return <Stack screenOptions={{ headerShown: false }} />;
}