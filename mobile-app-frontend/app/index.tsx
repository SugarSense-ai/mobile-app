
import { View, Text } from 'react-native'
import { COLORS } from '@/constants/theme';

export default function Index() {
    // This component should not render due to InitialLayout navigation
    // But we provide a fallback just in case
    return (
        <View style={{ 
            flex: 1, 
            backgroundColor: COLORS.blue, 
            justifyContent: 'center', 
            alignItems: 'center' 
        }}>
            <Text style={{ color: 'white', fontSize: 18 }}>
                Loading SugarSense.ai...
            </Text>
        </View>
    );
}