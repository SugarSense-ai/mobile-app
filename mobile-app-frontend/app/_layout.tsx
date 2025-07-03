import { Stack } from "expo-router";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ClerkLoaded, ClerkProvider } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { COLORS } from "@/constants/theme";
import InitialLayout from "@/components/initialLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { View, Text } from "react-native";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout() {
  console.log('🚀 RootLayout starting with SDK 53 + React 19');
  console.log('🔑 Clerk key available:', !!publishableKey);
  
  // Handle missing environment variable gracefully
  if (!publishableKey) {
    console.warn("⚠️ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY not found. Using fallback mode.");
    return (
      <ErrorBoundary>
        <SafeAreaProvider>
          <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.blue }}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
              <Text style={{ color: 'white', fontSize: 18, textAlign: 'center', marginBottom: 20 }}>
                Configuration Error
              </Text>
              <Text style={{ color: 'white', fontSize: 14, textAlign: 'center' }}>
                Please set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in your .env file
              </Text>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </ErrorBoundary>
    );
  }

  console.log('✅ Starting with Clerk authentication');
  return (
    <ErrorBoundary>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <ClerkLoaded>
          <SafeAreaProvider>
            <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.blue }}>
              <InitialLayout />
            </SafeAreaView>
          </SafeAreaProvider>
        </ClerkLoaded>
      </ClerkProvider>
    </ErrorBoundary>
  );
}

