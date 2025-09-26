
import { Redirect } from 'expo-router';

export default function Index() {
    // Redirect to the dashboard (which is the new default screen)
    return <Redirect href="/(tabs)/dashboard" />;
}