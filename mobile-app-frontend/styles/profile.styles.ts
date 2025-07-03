import { COLORS } from "@/constants/theme";
import { StyleSheet} from "react-native";

// export const styles = StyleSheet.create({
//     container: {
//       flex: 1, 
//       padding: 20,
//       justifyContent: 'center', 
//       alignItems: 'center', 
//     },
//     contentWrapper: {
//       width: '100%', 
//     },
//     userAvatar: {
//       width: 80,
//       height: 80,
//       borderRadius: 15,
//       marginRight: 10,
//     },
//     title: {
//       color: COLORS.blue,
//       fontSize: 30,
//       fontWeight: '700',
//       marginBottom: 20,
//       marginTop:20,
//       textAlign: 'center',
//     },
//     subTitle: {
//       fontSize: 18,
//       fontWeight: '600',
//       marginBottom: 10,
//     },
//     inputGroup: {
//       marginBottom: 15,
//       width: '100%', 
//     },
//     label: {
//       fontSize: 15,
//       fontWeight: '500',
//       marginBottom: 5,
//     },
//     input: {
//       borderWidth: 1,
//       borderColor: '#ccc',
//       borderRadius: 6,
//       paddingHorizontal: 12,
//       paddingVertical: 8,
//       backgroundColor: '#fff',
//     },
//     switchGroup: {
//       flexDirection: 'row',
//       justifyContent: 'space-between',
//       alignItems: 'center',
//       marginBottom: 15,
//       width: '100%', 
//     },
//     diabeticSection: {
//       padding: 15,
//       backgroundColor: '#e9ecef',
//       borderRadius: 10,
//       marginBottom: 20,
//       width: '100%', 
//     },
//     button: {
//       backgroundColor: COLORS.blue,
//       paddingVertical: 14,
//       borderRadius: 8,
//       alignItems: 'center',
//       marginTop: 10,
//       marginBottom:30,
//       width: '100%',
//     },
//     buttonText: {
//       color: '#fff',
//       fontSize: 16,
//       fontWeight: '600',
//     },

//     customPickerButton: {
//       borderWidth: 1,
//       borderColor: '#ccc',
//       borderRadius: 6,
//       paddingHorizontal: 12,
//       paddingVertical: 8,
//       backgroundColor: '#fff',
//       justifyContent: 'center',
//       width: '100%', 
//     },
//     customPickerValue: {
//       fontSize: 16,
//     },
//     modalOverlay: {
//       flex: 1,
//       justifyContent: 'flex-end',
//       backgroundColor: 'rgba(0, 0, 0, 0.5)',
//     },
//     modalContent: {
//       backgroundColor: '#fff',
//       borderTopLeftRadius: 10,
//       borderTopRightRadius: 10,
//       padding: 20,
//       maxHeight: 300,
//     },
//     pickerItem: {
//       paddingVertical: 15,
//       borderBottomWidth: 1,
//       borderColor: '#eee',
//       borderRadius:20,
//       paddingHorizontal:20
//     },
//     pickerItemSelected: {
//       backgroundColor: '#f0f0f0',
//     },
//     pickerItemText: {
//       fontSize: 16,
//     },
//     modalCloseButton: {
//       paddingVertical: 15,
//       alignItems: 'center',
//       backgroundColor: COLORS.blue,
//       borderRadius: 8,
//       marginTop: 15,
//     },
//     modalCloseText: {
//       color: '#fff',
//       fontSize: 16,
//       fontWeight: '600',
//     },
//   });

const SPACING = 16;
const BORDER_RADIUS = 12;


export const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.liGray,
        paddingHorizontal: SPACING,
        paddingTop: SPACING,
    },
    profileContainer: {
        flexDirection: 'column',
        alignItems: 'center',
        marginBottom: SPACING * 1.5,
    },
    headerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingBottom: SPACING * 1,
        marginBottom: SPACING * 1,
    },
    avatar: {
        marginRight: SPACING,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
    },
    headerText: {
        flex: 1,
    },
    name: {
        fontSize: 24,
        fontWeight: 'bold',
        color: COLORS.textDark,
        marginBottom: 4,
    },
    username: {
        fontSize: 16,
        color: COLORS.secondary,
    },
    section: {
        marginBottom: SPACING * 2,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: COLORS.textDark,
        marginBottom: SPACING,
    },
    listItem: {
        paddingVertical: SPACING,
        borderRadius: BORDER_RADIUS,
        backgroundColor: COLORS.white,
    },
    listItemIconContainer: {
        marginRight: SPACING,
        width: 30,
        alignItems: 'center',
    },
    listItemTitle: {
        fontSize: 16,
        color: COLORS.textDark,
        fontWeight: '500',
    },
    listItemSubtitle: {
        fontSize: 14,
        color: COLORS.textSecondary,
    },
    card: {
        backgroundColor: COLORS.white,
        borderRadius: BORDER_RADIUS,
        padding: SPACING,
        marginBottom: SPACING * 1.5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
        elevation: 3,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: COLORS.primary1,
    },
    cardBody: {
        marginBottom: SPACING,
    },
    leaderboardItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: SPACING / 2,
        alignItems: 'center',
    },
    leaderboardLabel: {
        fontSize: 16,
        color: COLORS.textSecondary,
    },
    leaderboardValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: COLORS.textDark,
    },
    cardFooterButton: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    cardFooterText: {
        color: COLORS.primary1,
        marginRight: SPACING / 4,
        fontSize: 15,
    },
    logoutContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: SPACING,
        marginBottom: SPACING * 2,
    },
    logoutButton: {
        backgroundColor: COLORS.error,
        paddingVertical: SPACING * 0.75,
        paddingHorizontal: SPACING * 1.5,
        borderRadius: 5,
        alignItems: 'center',
        flexDirection: 'row',
        marginBottom:30
    },
    logoutText: {
        color: COLORS.white,
        fontSize: 16,
        marginLeft: SPACING / 2,
    },
});