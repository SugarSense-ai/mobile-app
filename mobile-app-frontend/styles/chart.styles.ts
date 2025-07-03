import { StyleSheet} from "react-native";

export const chartLegendStyle = StyleSheet.create({
    container: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 10,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 15,
    },
    color: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 5,
    },
    text: {
      fontSize: 12,
      color: '#555',
    },
  });