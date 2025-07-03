import { StyleSheet} from "react-native";
export const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#f4f6f8',
      padding: 15,
    },
    card: {
      backgroundColor: 'white',
      borderRadius: 10,
      padding: 15,
      marginBottom: 40,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    cardTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#333',
      paddingBottom:10
    },
    manualEntryButton: {
      backgroundColor: '#e9ecef',
      borderRadius: 5,
      paddingVertical: 5,
      paddingHorizontal: 10,
    },
    manualEntryText: {
      color: '#555',
      fontSize: 14,
    },
    currentGlucose: {
      fontSize: 36,
      fontWeight: 'bold',
      color: '#2ecc71',
      marginBottom: 5,
    },
    unit: {
      fontSize: 18,
      fontWeight: 'normal',
      color: '#777',
    },
    inRange: {
      backgroundColor: '#2ecc71',
      borderRadius: 10,
      paddingVertical: 5,
      paddingHorizontal: 10,
      marginRight:160,
      color: '#FFFFFF',
      fontWeight: 'bold',
    },
    liveData: {
      color: '#777',
      fontSize: 12,
      marginBottom: 2,
    },
    updatedTime: {
      color: '#777',
      fontSize: 12,
      marginBottom: 15,
    },
    graphContainer: {
      marginBottom: 10,
      alignItems: 'center',
    },
    graphTimeLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      color: '#777',
      fontSize: 12,
    },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    statsItem: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: '#e9ecef',
      borderRadius: 10,
      padding: 15,
      marginBottom: 15,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
      marginRight:10
    },
    statsLabel: {
      color: '#555',
      fontSize: 14,
      marginBottom: 5,
    },
    statsValue: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#333',
    },
    comingUpItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: '#eee',
    },
    comingUpTime: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#333',
      width: 80,
      marginRight: 15,
    },
    comingUpEvent: {
      fontSize: 16,
      color: '#333',
      marginBottom: 2,
    },
    comingUpDetails: {
      color: '#777',
      fontSize: 12,
    },
    quickActionsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: 15,
    },
    quickActionButton: {
      alignItems: 'center',
    },
    quickActionText: {
      marginTop: 5,
      color: '#555',
      fontSize: 12,
    },
    viewAllLink: {
      color: '#007bff',
      fontSize: 14,
    },
    insightItem: {
      flexDirection: 'row',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: '#eee',
      alignItems: 'center',
    },
    insightIcon: {
      marginRight: 10,
    },
    insightTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#333',
      marginBottom: 2,
    },
    insightDetails: {
      color: '#555',
      fontSize: 12,
    },
    insightTextContainer: {
      flex: 1,
    },
  });