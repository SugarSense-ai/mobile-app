import { View, Text, Image, TouchableOpacity } from 'react-native'
import React from 'react'
import { styles } from '@/styles/auth.styles'
import { Ionicons } from '@expo/vector-icons'
import { COLORS } from '@/constants/theme'
import { useSSO } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'

export default function login() {
    const { startSSOFlow }: any = useSSO();
    const router = useRouter();

    const handleGoogleSignIn = async () => {
        try {
            const { createdSessionId, setActive } = await startSSOFlow({ strategy: "oauth_google" });
            if (setActive && createdSessionId) {
                setActive({ session: createdSessionId });
                // Let InitialLayout handle the routing based on onboarding status
                console.log("✅ Successfully signed in with Google");
            }

        } catch (error) {
            console.log("Outh Error",error);
        }
    }
    return (
        <View style={styles.container}>
            <View style={styles.brandSection}>
                <Image source={require("../../assets/images/sugar-sense-ai-logo.png")}
                    style={styles.logoContainer}
                    resizeMode='cover'
                />
                <Text style={styles.appName}>SugarSense.ai</Text>
                <Text style={styles.tagline}>Predict. Prevent. Prosper.</Text>
            </View>
            <View style={styles.illustrationContainer}>
                <Image source={require("../../assets/images/home-page.png")}
                    style={styles.illustration}
                    resizeMode='cover'
                />
            </View>
            <View style={styles.loginSection}>
                <TouchableOpacity
                    style={styles.googleButton}
                    onPress={handleGoogleSignIn}
                    activeOpacity={0.9}
                >
                    <View style={styles.googleIconContainer}>
                        <Ionicons name="logo-google" size={20} color={COLORS.surface} />
                    </View>
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                </TouchableOpacity>
                <Text style={styles.termsText}>
                    By continuing, you agree to our Terms and Privacy Policy
                </Text>
            </View>
        </View>
    )
}