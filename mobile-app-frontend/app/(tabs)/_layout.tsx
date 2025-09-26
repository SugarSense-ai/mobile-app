import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { FontAwesome5 } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';

export default function TabLayout() {
    return (
        <>
            {/* Redirect from /tabs/ to /tabs/dashboard */}
            <Redirect href="/(tabs)/dashboard" />
            
            <Tabs
                screenOptions={{
                    tabBarShowLabel: false,
                    headerShown: false,
                    tabBarActiveTintColor: COLORS.primary,
                    tabBarInactiveTintColor: COLORS.gray,
                    tabBarStyle: {
                        backgroundColor: '#fff',
                        borderTopWidth: 1,
                        borderTopColor: '#f0f0f0',
                        height: 60,
                        paddingBottom: 10,
                        paddingTop: 10,
                    }
                }}
            >
                {/* Removed index tab - CGM connection is now only in Profile */}
                
                <Tabs.Screen
                    name="dashboard"
                    options={{
                        title: 'Dashboard',
                        tabBarIcon: ({ color }) => <FontAwesome5 name="chart-bar" size={24} color={color} />,
                    }}
                />
                <Tabs.Screen
                    name="prediction"
                    options={{
                        title: 'Insights',
                        tabBarIcon: ({ color }) => <FontAwesome5 name="lightbulb" size={24} color={color} />,
                    }}
                />
                <Tabs.Screen
                    name="chat"
                    options={{
                        title: 'Assistant',
                        tabBarIcon: ({ color }) => <FontAwesome5 name="comments" size={24} color={color} />,
                    }}
                />
                <Tabs.Screen
                    name="profile"
                    options={{
                        title: 'Profile',
                        tabBarIcon: ({ color }) => <FontAwesome5 name="user-alt" size={24} color={color} />,
                    }}
                />
                
                {/* Hide the index screen from tabs if it still exists */}
                <Tabs.Screen
                    name="index"
                    options={{
                        href: null, // This hides the screen from the tab bar
                    }}
                />
            </Tabs>
        </>
    )
}