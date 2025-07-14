import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/theme";
import { StyleSheet, Dimensions } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { onboardingService } from "@/services/onboardingService";

const { width, height } = Dimensions.get("window");

interface UserInfo {
  fullName: string;
  dateOfBirth: Date | null;
  gender: "Male" | "Female" | "Other" | "Prefer not to say" | "";
  height: string;
  heightUnit: "cm" | "ft";
  weight: string;
  weightUnit: "kg" | "lbs";
}

export default function UserInfoScreen() {
  const router = useRouter();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo>({
    fullName: "",
    dateOfBirth: null,
    gender: "",
    height: "",
    heightUnit: "cm",
    weight: "",
    weightUnit: "kg",
  });

  const handleDateChange = (event: any, selectedDate: Date | undefined) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setUserInfo({ ...userInfo, dateOfBirth: selectedDate });
    }
  };

  const validateForm = () => {
    if (!userInfo.dateOfBirth) {
      Alert.alert("Error", "Please select your date of birth");
      return false;
    }
    if (!userInfo.gender) {
      Alert.alert("Error", "Please select your gender");
      return false;
    }
    if (!userInfo.height) {
      Alert.alert("Error", "Please enter your height");
      return false;
    }
    if (!userInfo.weight) {
      Alert.alert("Error", "Please enter your weight");
      return false;
    }
    return true;
  };

  const handleContinue = async () => {
    if (validateForm()) {
      try {
        // Here you would typically save the user info to AsyncStorage or send to API
        console.log("User Info:", userInfo);
        
        // Mark onboarding as completed
        await onboardingService.setOnboardingCompleted();
        console.log("✅ Onboarding completed successfully");
        
        // Navigate to main app
        router.replace("/(tabs)");
      } catch (error) {
        console.error("Error completing onboarding:", error);
        Alert.alert("Error", "Failed to complete onboarding. Please try again.");
      }
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "Select Date";
    return date.toLocaleDateString();
  };

  const GenderRadioButton = ({ value, label }: { value: string; label: string }) => (
    <TouchableOpacity
      style={styles.radioButton}
      onPress={() => setUserInfo({ ...userInfo, gender: value as any })}
    >
      <View style={styles.radioCircle}>
        {userInfo.gender === value && <View style={styles.radioSelected} />}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </TouchableOpacity>
  );

  const UnitSelector = ({ 
    value, 
    options, 
    onChange 
  }: { 
    value: string; 
    options: string[]; 
    onChange: (value: string) => void 
  }) => (
    <View style={styles.unitSelector}>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          style={[
            styles.unitOption,
            value === option && styles.unitOptionSelected,
          ]}
          onPress={() => onChange(option)}
        >
          <Text
            style={[
              styles.unitOptionText,
              value === option && styles.unitOptionTextSelected,
            ]}
          >
            {option}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tell us about yourself</Text>
        <Text style={styles.subtitle}>
          Help us personalize your experience
        </Text>
      </View>

      <View style={styles.formContainer}>
        {/* Full Name */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your full name"
            value={userInfo.fullName}
            onChangeText={(text) => setUserInfo({ ...userInfo, fullName: text })}
          />
        </View>

        {/* Date of Birth */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date of Birth *</Text>
          <TouchableOpacity
            style={styles.dateInput}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={[
              styles.dateText,
              !userInfo.dateOfBirth && styles.placeholderText
            ]}>
              {formatDate(userInfo.dateOfBirth)}
            </Text>
            <Ionicons name="calendar-outline" size={20} color={COLORS.gray} />
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={userInfo.dateOfBirth || new Date()}
              mode="date"
              display="default"
              onChange={handleDateChange}
              maximumDate={new Date()}
            />
          )}
        </View>

        {/* Gender */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Gender *</Text>
          <View style={styles.radioGroup}>
            <GenderRadioButton value="Male" label="Male" />
            <GenderRadioButton value="Female" label="Female" />
            <GenderRadioButton value="Other" label="Other" />
            <GenderRadioButton value="Prefer not to say" label="Prefer not to say" />
          </View>
        </View>

        {/* Height */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Height *</Text>
          <View style={styles.inputWithUnit}>
            <TextInput
              style={styles.numberInput}
              placeholder="Enter height"
              value={userInfo.height}
              onChangeText={(text) => setUserInfo({ ...userInfo, height: text })}
              keyboardType="numeric"
            />
            <UnitSelector
              value={userInfo.heightUnit}
              options={["cm", "ft"]}
              onChange={(unit) => setUserInfo({ ...userInfo, heightUnit: unit as any })}
            />
          </View>
        </View>

        {/* Weight */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Weight *</Text>
          <View style={styles.inputWithUnit}>
            <TextInput
              style={styles.numberInput}
              placeholder="Enter weight"
              value={userInfo.weight}
              onChangeText={(text) => setUserInfo({ ...userInfo, weight: text })}
              keyboardType="numeric"
            />
            <UnitSelector
              value={userInfo.weightUnit}
              options={["kg", "lbs"]}
              onChange={(unit) => setUserInfo({ ...userInfo, weightUnit: unit as any })}
            />
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
        <Text style={styles.continueButtonText}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    alignItems: "center",
    marginTop: height * 0.08,
    paddingHorizontal: 20,
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.blue,
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: "center",
  },
  formContainer: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.surface,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    color: COLORS.surface,
  },
  dateInput: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dateText: {
    fontSize: 16,
    color: COLORS.surface,
  },
  placeholderText: {
    color: COLORS.lightGray,
  },
  radioGroup: {
    gap: 12,
  },
  radioButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.blue,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.blue,
  },
  radioLabel: {
    fontSize: 16,
    color: COLORS.surface,
  },
  inputWithUnit: {
    flexDirection: "row",
    gap: 12,
  },
  numberInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    color: COLORS.surface,
  },
  unitSelector: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    overflow: "hidden",
  },
  unitOption: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: COLORS.white,
  },
  unitOptionSelected: {
    backgroundColor: COLORS.blue,
  },
  unitOptionText: {
    fontSize: 16,
    color: COLORS.surface,
    fontWeight: "500",
  },
  unitOptionTextSelected: {
    color: COLORS.white,
  },
  continueButton: {
    backgroundColor: COLORS.blue,
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 40,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  continueButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "600",
  },
}); 