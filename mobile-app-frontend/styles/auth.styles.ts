import { COLORS } from "@/constants/theme";
import { StyleSheet, Dimensions } from "react-native";

const { width, height } = Dimensions.get("window");

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  brandSection: {
    alignItems: "center",
    marginTop: height * 0.10,
  },
  logoContainer: {
    width: 60,
    height: 80,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  appName: {
    fontSize: 42,
    fontWeight: "700",
    color: COLORS.blue,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: COLORS.gray,
    letterSpacing: 1,
    // textTransform: "lowercase",
  },
  illustrationContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  illustration: {
    width: width * 0.75,
    height: width * 0.75,
    maxHeight: 260,
  },
  loginSection: {
    width: "100%",
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 10,
    alignItems: "center",
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blue,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    marginBottom: 20,
    width: "100%",
    maxWidth: 300,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  googleIconContainer: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.surface,
  },
  termsText: {
    textAlign: "center",
    fontSize: 12,
    color: COLORS.gray,
    maxWidth: 280,
  },

  slide: {
    width: width,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },

  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.blue,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 10,
    color: COLORS.gray,
  },
  pagination: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginBottom: 20,
  },
  dot: {
    marginTop: 20,
    width: 10,
    height: 10,
    borderRadius: 8,
    backgroundColor: COLORS.lightGray,
    marginHorizontal: 5,
  },
  activeDot: {
    backgroundColor: COLORS.blue,
  },
  nextButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: COLORS.blue,
    padding: 15,
    borderRadius: 50,
  },
  backButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: COLORS.blue,
    padding: 15,
    borderRadius: 50,
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 100,
    backgroundColor: 'white',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  skipText: {
    position: 'absolute',
    top: 15,
    right: 30,
    fontSize: 15,
    color: COLORS.lightGray,
  },
});
