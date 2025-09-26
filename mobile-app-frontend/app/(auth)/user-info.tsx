import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
  Modal,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useUser } from "@clerk/clerk-expo";
import { COLORS } from "@/constants/theme";
import { StyleSheet } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { onboardingService } from "../../services/onboardingService";
import { getBaseUrl } from "@/services/api";

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

interface DiabetesInfo {
  hasDiabetes: "Yes" | "No" | "Not sure" | "";
  diabetesType: "Type 1" | "Type 2" | "Gestational" | "Pre-diabetes" | "Not sure" | "";
  yearOfDiagnosis: string;
  usesInsulin: "Yes" | "No" | "";
  insulinType: "Basal" | "Bolus" | "Both" | "";
  dailyBasalDose: string;
  insulinToCarbRatio: string;
}

interface CGMInfo {
  cgmStatus: "No – Decided against it" | "No – Still deciding" | "No – Trying to get one" | "Yes – I already use one" | "";
  cgmModel: "Dexcom G7 / One+" | "Dexcom G6 / G5 / One" | "Abbott Freestyle Libre" | "";
}

interface InsulinDeliveryInfo {
  insulinDeliveryStatus: "Not using insulin" | "Only using basal insulin" | "MDI now, but considering a pump or smart pen" | "MDI now, actively trying to get one" | "MDI now, decided against a pump or smart pen" | "Omnipod 5" | "Omnipod Dash" | "";
  pumpModel: "Omnipod 5" | "Omnipod Dash" | null;
}

// Generate height options
const generateHeightOptions = (unit: "cm" | "ft") => {
  if (unit === "cm") {
    return Array.from({ length: 151 }, (_, i) => (100 + i).toString());
  } else {
    const options: string[] = [];
    for (let ft = 3; ft <= 8; ft++) {
      for (let inch = 0; inch < 12; inch++) {
        if (ft === 8 && inch > 0) break; // Stop at 8'0"
        options.push(`${ft}'${inch}"`);
      }
    }
    return options;
  }
};

// Generate weight options
const generateWeightOptions = (unit: "kg" | "lbs") => {
  if (unit === "kg") {
    return Array.from({ length: 171 }, (_, i) => (30 + i).toString());
  } else {
    return Array.from({ length: 375 }, (_, i) => (66 + i).toString());
  }
};

// Generate year options from 2000 to 2025
const generateYearOptions = () => {
  const currentYear = new Date().getFullYear();
  const endYear = Math.max(currentYear, 2025);
  return Array.from({ length: endYear - 2000 + 1 }, (_, i) => (2000 + i).toString());
};

// Modal Picker Component
const ModalPicker = ({ 
  isVisible,
  options, 
  selectedValue, 
  onValueChange, 
  onClose,
  title,
  unit
}: {
  isVisible: boolean;
  options: string[];
  selectedValue: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  title: string;
  unit?: string;
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  
  React.useEffect(() => {
    if (isVisible && selectedValue) {
      const index = options.indexOf(selectedValue);
      if (index !== -1 && scrollViewRef.current) {
        // Scroll to selected item with a slight delay to ensure modal is rendered
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({
            y: index * 50,
            animated: false,
          });
        }, 100);
      }
    }
  }, [isVisible, selectedValue, options]);

  return (
    <Modal
      visible={isVisible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={COLORS.gray} />
            </TouchableOpacity>
          </View>
          
          <ScrollView 
            ref={scrollViewRef}
            style={styles.modalScrollView}
            showsVerticalScrollIndicator={true}
            contentContainerStyle={styles.modalScrollContent}
          >
            {options.map((option, index) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.modalOption,
                  selectedValue === option && styles.modalOptionSelected
                ]}
                onPress={() => {
                  onValueChange(option);
                  onClose();
                }}
              >
                <Text style={[
                  styles.modalOptionText,
                  selectedValue === option && styles.modalOptionTextSelected
                ]}>
                  {option} {unit || ""}
                </Text>
                {selectedValue === option && (
                  <Ionicons name="checkmark" size={20} color={COLORS.blue} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default function UserInfoScreen() {
  const router = useRouter();
  const { user } = useUser();
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showHeightPicker, setShowHeightPicker] = useState(false);
  const [showWeightPicker, setShowWeightPicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo>({
    fullName: "",
    dateOfBirth: null,
    gender: "",
    height: "",
    heightUnit: "cm",
    weight: "",
    weightUnit: "kg",
  });
  const [diabetesInfo, setDiabetesInfo] = useState<DiabetesInfo>({
    hasDiabetes: "",
    diabetesType: "",
    yearOfDiagnosis: "",
    usesInsulin: "",
    insulinType: "",
    dailyBasalDose: "",
    insulinToCarbRatio: "",
  });
  const [cgmInfo, setCgmInfo] = useState<CGMInfo>({
    cgmStatus: "",
    cgmModel: "",
  });
  const [insulinDeliveryInfo, setInsulinDeliveryInfo] = useState<InsulinDeliveryInfo>({
    insulinDeliveryStatus: "",
    pumpModel: null,
  });

  const handleDateChange = (event: any, selectedDate: Date | undefined) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setUserInfo({ ...userInfo, dateOfBirth: selectedDate });
    }
  };

  const validateStep1 = () => {
    if (!userInfo.fullName.trim()) {
      Alert.alert("Error", "Please enter your full name");
      return false;
    }
    if (!userInfo.dateOfBirth) {
      Alert.alert("Error", "Please select your date of birth");
      return false;
    }
    if (!userInfo.gender) {
      Alert.alert("Error", "Please select your gender");
      return false;
    }
    if (!userInfo.height) {
      Alert.alert("Error", "Please select your height");
      return false;
    }
    if (!userInfo.weight) {
      Alert.alert("Error", "Please select your weight");
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!diabetesInfo.hasDiabetes) {
      Alert.alert("Error", "Please select if you have diabetes");
      return false;
    }

    if (diabetesInfo.hasDiabetes === "Yes") {
      if (!diabetesInfo.diabetesType) {
        Alert.alert("Error", "Please select your diabetes type");
        return false;
      }
      if (!diabetesInfo.usesInsulin) {
        Alert.alert("Error", "Please select if you use insulin");
        return false;
      }
      if (diabetesInfo.usesInsulin === "Yes" && !diabetesInfo.insulinType) {
        Alert.alert("Error", "Please select your insulin type");
        return false;
      }
    }

    return true;
  };

  const validateStep3 = () => {
    if (!cgmInfo.cgmStatus) {
      Alert.alert("Error", "Please select your CGM status");
      return false;
    }

    if (cgmInfo.cgmStatus === "Yes – I already use one" && !cgmInfo.cgmModel) {
      Alert.alert("Error", "Please select which CGM you use");
      return false;
    }

    return true;
  };

  const validateStep4 = () => {
    if (!insulinDeliveryInfo.insulinDeliveryStatus) {
      Alert.alert("Error", "Please select your insulin delivery method");
      return false;
    }

    return true;
  };

  const handleContinue = async () => {
    if (currentStep === 1) {
      if (validateStep1()) {
        setCurrentStep(2);
        // Scroll to top when moving to next step
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    } else if (currentStep === 2) {
      if (validateStep2()) {
        setCurrentStep(3);
        // Scroll to top when moving to next step
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    } else if (currentStep === 3) {
      if (validateStep3()) {
        setCurrentStep(4);
        // Scroll to top when moving to next step
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    } else if (currentStep === 4) {
      if (validateStep4()) {
        setCurrentStep(5);
        // Scroll to top when moving to next step
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    } else if (currentStep === 5) {
      try {
        if (!user) {
          Alert.alert("Error", "User not found. Please try signing in again.");
          return;
        }

        console.log("User Info:", userInfo);
        console.log("Diabetes Info:", diabetesInfo);
        console.log("CGM Info:", cgmInfo);
        console.log("Insulin Delivery Info:", insulinDeliveryInfo);
        
        // Save onboarding data to backend
        try {
          const baseUrl = await getBaseUrl();
          console.log('🌐 Sending onboarding data to backend...');
          
          const onboardingData = {
            clerk_user_id: user.id,
            // User info
            date_of_birth: userInfo.dateOfBirth ? userInfo.dateOfBirth.toISOString().split('T')[0] : null,
            gender: userInfo.gender || null,
            height_value: userInfo.height ? parseFloat(userInfo.height) : null,
            height_unit: userInfo.heightUnit,
            weight_value: userInfo.weight ? parseFloat(userInfo.weight) : null,
            weight_unit: userInfo.weightUnit,
            // Diabetes info
            has_diabetes: diabetesInfo.hasDiabetes || null,
            diabetes_type: diabetesInfo.diabetesType || null,
            year_of_diagnosis: diabetesInfo.yearOfDiagnosis ? parseInt(diabetesInfo.yearOfDiagnosis) : null,
            uses_insulin: diabetesInfo.usesInsulin || null,
            insulin_type: diabetesInfo.insulinType || null,
            daily_basal_dose: diabetesInfo.dailyBasalDose ? parseFloat(diabetesInfo.dailyBasalDose) : null,
            insulin_to_carb_ratio: diabetesInfo.insulinToCarbRatio ? parseFloat(diabetesInfo.insulinToCarbRatio) : null,
            // CGM info
            cgm_status: cgmInfo.cgmStatus || null,
            cgm_model: cgmInfo.cgmModel || null,
            // Insulin delivery info
            insulin_delivery_status: insulinDeliveryInfo.insulinDeliveryStatus || null,
            pump_model: insulinDeliveryInfo.pumpModel || null
          };
          
          const response = await fetch(`${baseUrl}/api/save-onboarding-data`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(onboardingData),
          });
          
          const result = await response.json();
          
          if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to save onboarding data');
          }
          
          console.log('✅ Onboarding data saved to backend successfully');
          
        } catch (backendError) {
          console.error('❌ Failed to save onboarding data to backend:', backendError);
          Alert.alert(
            "Warning", 
            "Your information couldn't be saved to the server, but you can continue using the app. Your data will be saved on your device."
          );
        }
        
        // Mark onboarding as completed locally regardless of backend success
        await onboardingService.setOnboardingCompleted(user.id);
        console.log(`✅ Onboarding completed successfully for user ${user.id}`);
        
        // Add a small delay to ensure AsyncStorage write completes before navigation
        setTimeout(() => {
          console.log(`🚀 Navigating to main app for user ${user.id}`);
          router.replace("/(tabs)");
        }, 100);
      } catch (error) {
        console.error("Error completing onboarding:", error);
        Alert.alert("Error", "Failed to complete onboarding. Please try again.");
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "Select Date";
    return date.toLocaleDateString();
  };

  // Reset dependent fields when diabetes status changes
  const handleDiabetesChange = (value: string) => {
    setDiabetesInfo({
      ...diabetesInfo,
      hasDiabetes: value as any,
      diabetesType: value !== "Yes" ? "" : diabetesInfo.diabetesType,
      yearOfDiagnosis: value !== "Yes" ? "" : diabetesInfo.yearOfDiagnosis,
      usesInsulin: value !== "Yes" ? "" : diabetesInfo.usesInsulin,
      insulinType: value !== "Yes" ? "" : diabetesInfo.insulinType,
      dailyBasalDose: value !== "Yes" ? "" : diabetesInfo.dailyBasalDose,
      insulinToCarbRatio: value !== "Yes" ? "" : diabetesInfo.insulinToCarbRatio,
    });
  };

  // Reset insulin-related fields when insulin usage changes
  const handleInsulinUsageChange = (value: string) => {
    setDiabetesInfo({
      ...diabetesInfo,
      usesInsulin: value as any,
      insulinType: value !== "Yes" ? "" : diabetesInfo.insulinType,
      dailyBasalDose: value !== "Yes" ? "" : diabetesInfo.dailyBasalDose,
      insulinToCarbRatio: value !== "Yes" ? "" : diabetesInfo.insulinToCarbRatio,
    });
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

  const RadioButton = ({ 
    value, 
    label, 
    selectedValue, 
    onSelect 
  }: { 
    value: string; 
    label: string; 
    selectedValue: string; 
    onSelect: (value: string) => void; 
  }) => (
    <TouchableOpacity
      style={styles.radioButton}
      onPress={() => onSelect(value)}
    >
      <View style={styles.radioCircle}>
        {selectedValue === value && <View style={styles.radioSelected} />}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </TouchableOpacity>
  );

  const UnitToggle = ({ 
    value, 
    options, 
    onChange 
  }: { 
    value: string; 
    options: string[]; 
    onChange: (value: string) => void 
  }) => (
    <View style={styles.unitToggle}>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          style={[
            styles.unitToggleOption,
            value === option && styles.unitToggleOptionSelected,
          ]}
          onPress={() => onChange(option)}
        >
          <Text
            style={[
              styles.unitToggleText,
              value === option && styles.unitToggleTextSelected,
            ]}
          >
            {option}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const heightOptions = generateHeightOptions(userInfo.heightUnit);
  const weightOptions = generateWeightOptions(userInfo.weightUnit);
  const yearOptions = generateYearOptions();

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
    >
      <ScrollView 
        ref={scrollViewRef}
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          {/* Progress Indicator */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${(currentStep / 5) * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>Step {currentStep} of 5</Text>
          </View>

          {/* Back Button for Steps 2 and 3 */}
          {currentStep > 1 && (
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="chevron-back" size={24} color={COLORS.blue} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.title}>
            {currentStep === 1 
              ? "Tell us about yourself" 
              : currentStep === 2 
              ? "Help us understand your diabetes journey"
              : currentStep === 3
              ? "Do you use a CGM (Continuous Glucose Monitor)?"
              : currentStep === 4
              ? "Do you use a pump or smart pen?"
              : "You're all set!"
            }
          </Text>
          <Text style={styles.subtitle}>
            {currentStep === 1 
              ? "Help us personalize your experience"
              : currentStep === 2
              ? "This information helps us provide personalized insights"
              : currentStep === 3
              ? "Understanding your monitoring setup helps us provide better recommendations"
              : currentStep === 4
              ? "Tell us about your insulin delivery method"
              : "Thank you for completing your profile. Let's start your diabetes management journey!"
            }
          </Text>
        </View>

        <View style={styles.formContainer}>
          {currentStep === 1 ? (
            <>
              {/* Step 1: Basic User Info */}
              {/* Full Name */}
              <View style={styles.section}>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your full name"
                  placeholderTextColor={COLORS.lightGray}
                  value={userInfo.fullName}
                  onChangeText={(text) => setUserInfo({ ...userInfo, fullName: text })}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>

              {/* Date of Birth */}
              <View style={styles.section}>
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
              <View style={styles.section}>
                <Text style={styles.label}>Gender *</Text>
                <View style={styles.radioGroup}>
                  <GenderRadioButton value="Male" label="Male" />
                  <GenderRadioButton value="Female" label="Female" />
                  <GenderRadioButton value="Other" label="Other" />
                  <GenderRadioButton value="Prefer not to say" label="Prefer not to say" />
                </View>
              </View>

              {/* Height */}
              <View style={styles.section}>
                <Text style={styles.label}>Height *</Text>
                <View style={styles.inputWithUnit}>
                  <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() => setShowHeightPicker(true)}
                  >
                    <Text style={[
                      styles.pickerButtonText,
                      !userInfo.height && styles.pickerPlaceholder
                    ]}>
                      {userInfo.height ? `${userInfo.height} ${userInfo.heightUnit}` : `Select height in ${userInfo.heightUnit}`}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color={COLORS.gray} />
                  </TouchableOpacity>
                  
                  <UnitToggle
                    value={userInfo.heightUnit}
                    options={["cm", "ft"]}
                    onChange={(unit) => {
                      setUserInfo({ 
                        ...userInfo, 
                        heightUnit: unit as any,
                        height: "" // Reset height when unit changes
                      });
                    }}
                  />
                </View>
              </View>

              {/* Weight */}
              <View style={styles.section}>
                <Text style={styles.label}>Weight *</Text>
                <View style={styles.inputWithUnit}>
                  <TouchableOpacity
                    style={styles.pickerButton}
                    onPress={() => setShowWeightPicker(true)}
                  >
                    <Text style={[
                      styles.pickerButtonText,
                      !userInfo.weight && styles.pickerPlaceholder
                    ]}>
                      {userInfo.weight ? `${userInfo.weight} ${userInfo.weightUnit}` : `Select weight in ${userInfo.weightUnit}`}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color={COLORS.gray} />
                  </TouchableOpacity>
                  
                  <UnitToggle
                    value={userInfo.weightUnit}
                    options={["kg", "lbs"]}
                    onChange={(unit) => {
                      setUserInfo({ 
                        ...userInfo, 
                        weightUnit: unit as any,
                        weight: "" // Reset weight when unit changes
                      });
                    }}
                  />
                </View>
              </View>
            </>
          ) : currentStep === 2 ? (
            <>
              {/* Step 2: Diabetes Info */}
              {/* Do you have diabetes? */}
              <View style={styles.section}>
                <Text style={styles.label}>Do you have diabetes? *</Text>
                <View style={styles.radioGroup}>
                  <RadioButton 
                    value="Yes" 
                    label="Yes" 
                    selectedValue={diabetesInfo.hasDiabetes}
                    onSelect={handleDiabetesChange}
                  />
                  <RadioButton 
                    value="No" 
                    label="No" 
                    selectedValue={diabetesInfo.hasDiabetes}
                    onSelect={handleDiabetesChange}
                  />
                  <RadioButton 
                    value="Not sure" 
                    label="Not sure" 
                    selectedValue={diabetesInfo.hasDiabetes}
                    onSelect={handleDiabetesChange}
                  />
                </View>
              </View>

              {/* Conditional fields for diabetes = Yes */}
              {diabetesInfo.hasDiabetes === "Yes" && (
                <>
                  {/* Diabetes Type */}
                  <View style={styles.section}>
                    <Text style={styles.label}>What type of diabetes? *</Text>
                    <View style={styles.radioGroup}>
                      <RadioButton 
                        value="Type 1" 
                        label="Type 1" 
                        selectedValue={diabetesInfo.diabetesType}
                        onSelect={(value) => setDiabetesInfo({...diabetesInfo, diabetesType: value as any})}
                      />
                      <RadioButton 
                        value="Type 2" 
                        label="Type 2" 
                        selectedValue={diabetesInfo.diabetesType}
                        onSelect={(value) => setDiabetesInfo({...diabetesInfo, diabetesType: value as any})}
                      />
                      <RadioButton 
                        value="Gestational" 
                        label="Gestational" 
                        selectedValue={diabetesInfo.diabetesType}
                        onSelect={(value) => setDiabetesInfo({...diabetesInfo, diabetesType: value as any})}
                      />
                      <RadioButton 
                        value="Pre-diabetes" 
                        label="Pre-diabetes" 
                        selectedValue={diabetesInfo.diabetesType}
                        onSelect={(value) => setDiabetesInfo({...diabetesInfo, diabetesType: value as any})}
                      />
                      <RadioButton 
                        value="Not sure" 
                        label="Not sure" 
                        selectedValue={diabetesInfo.diabetesType}
                        onSelect={(value) => setDiabetesInfo({...diabetesInfo, diabetesType: value as any})}
                      />
                    </View>
                  </View>

                  {/* Year of Diagnosis */}
                  <View style={styles.section}>
                    <Text style={styles.label}>Year of diagnosis (optional)</Text>
                    <TouchableOpacity
                      style={styles.pickerButton}
                      onPress={() => setShowYearPicker(true)}
                    >
                      <Text style={[
                        styles.pickerButtonText,
                        !diabetesInfo.yearOfDiagnosis && styles.pickerPlaceholder
                      ]}>
                        {diabetesInfo.yearOfDiagnosis || "Select year"}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color={COLORS.gray} />
                    </TouchableOpacity>
                  </View>

                  {/* Insulin Usage */}
                  <View style={styles.section}>
                    <Text style={styles.label}>Do you use insulin? *</Text>
                    <View style={styles.radioGroup}>
                      <RadioButton 
                        value="Yes" 
                        label="Yes" 
                        selectedValue={diabetesInfo.usesInsulin}
                        onSelect={handleInsulinUsageChange}
                      />
                      <RadioButton 
                        value="No" 
                        label="No" 
                        selectedValue={diabetesInfo.usesInsulin}
                        onSelect={handleInsulinUsageChange}
                      />
                    </View>
                  </View>

                  {/* Conditional fields for insulin = Yes */}
                  {diabetesInfo.usesInsulin === "Yes" && (
                    <>
                      {/* Insulin Type */}
                      <View style={styles.section}>
                        <Text style={styles.label}>Type of insulin *</Text>
                        <View style={styles.radioGroup}>
                          <RadioButton 
                            value="Basal" 
                            label="Basal (long-acting)" 
                            selectedValue={diabetesInfo.insulinType}
                            onSelect={(value) => setDiabetesInfo({...diabetesInfo, insulinType: value as any})}
                          />
                          <RadioButton 
                            value="Bolus" 
                            label="Bolus (short-acting)" 
                            selectedValue={diabetesInfo.insulinType}
                            onSelect={(value) => setDiabetesInfo({...diabetesInfo, insulinType: value as any})}
                          />
                          <RadioButton 
                            value="Both" 
                            label="Both" 
                            selectedValue={diabetesInfo.insulinType}
                            onSelect={(value) => setDiabetesInfo({...diabetesInfo, insulinType: value as any})}
                          />
                        </View>
                      </View>

                      {/* Daily Basal Dose */}
                      <View style={styles.section}>
                        <Text style={styles.label}>Daily basal dose (optional)</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g., 20 units"
                          placeholderTextColor={COLORS.lightGray}
                          value={diabetesInfo.dailyBasalDose}
                          onChangeText={(text) => setDiabetesInfo({ ...diabetesInfo, dailyBasalDose: text })}
                          keyboardType="numeric"
                          returnKeyType="next"
                        />
                      </View>

                      {/* Insulin-to-Carb Ratio */}
                      <View style={styles.section}>
                        <Text style={styles.label}>Insulin-to-carb ratio (optional)</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g., 1:15 (1 unit per 15g carbs)"
                          placeholderTextColor={COLORS.lightGray}
                          value={diabetesInfo.insulinToCarbRatio}
                          onChangeText={(text) => setDiabetesInfo({ ...diabetesInfo, insulinToCarbRatio: text })}
                          returnKeyType="done"
                        />
                      </View>
                    </>
                  )}
                </>
              )}
            </>
          ) : currentStep === 3 ? (
            <>
              {/* Step 3: CGM Info */}
              {/* CGM Status */}
              <View style={styles.section}>
                <Text style={styles.label}>Do you use a CGM? *</Text>
                <View style={styles.radioGroup}>
                  <RadioButton 
                    value="No – Decided against it" 
                    label="No – Decided against it" 
                    selectedValue={cgmInfo.cgmStatus}
                    onSelect={(value) => setCgmInfo({...cgmInfo, cgmStatus: value as any, cgmModel: value.startsWith("No") ? "" : cgmInfo.cgmModel})}
                  />
                  <RadioButton 
                    value="No – Still deciding" 
                    label="No – Still deciding" 
                    selectedValue={cgmInfo.cgmStatus}
                    onSelect={(value) => setCgmInfo({...cgmInfo, cgmStatus: value as any, cgmModel: value.startsWith("No") ? "" : cgmInfo.cgmModel})}
                  />
                  <RadioButton 
                    value="No – Trying to get one" 
                    label="No – Trying to get one" 
                    selectedValue={cgmInfo.cgmStatus}
                    onSelect={(value) => setCgmInfo({...cgmInfo, cgmStatus: value as any, cgmModel: value.startsWith("No") ? "" : cgmInfo.cgmModel})}
                  />
                  <RadioButton 
                    value="Yes – I already use one" 
                    label="Yes – I already use one" 
                    selectedValue={cgmInfo.cgmStatus}
                    onSelect={(value) => setCgmInfo({...cgmInfo, cgmStatus: value as any})}
                  />
                </View>
              </View>

              {/* CGM Model - Conditional */}
              {cgmInfo.cgmStatus === "Yes – I already use one" && (
                <View style={styles.section}>
                  <Text style={styles.label}>Which CGM do you use? *</Text>
                  <View style={styles.cgmModelGrid}>
                    <TouchableOpacity
                      style={[
                        styles.cgmModelButton,
                        cgmInfo.cgmModel === "Dexcom G7 / One+" && styles.cgmModelButtonSelected
                      ]}
                      onPress={() => setCgmInfo({...cgmInfo, cgmModel: "Dexcom G7 / One+"})}
                    >
                      <Text style={[
                        styles.cgmModelButtonText,
                        cgmInfo.cgmModel === "Dexcom G7 / One+" && styles.cgmModelButtonTextSelected
                      ]}>
                        Dexcom G7 / One+
                      </Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={[
                        styles.cgmModelButton,
                        cgmInfo.cgmModel === "Dexcom G6 / G5 / One" && styles.cgmModelButtonSelected
                      ]}
                      onPress={() => setCgmInfo({...cgmInfo, cgmModel: "Dexcom G6 / G5 / One"})}
                    >
                      <Text style={[
                        styles.cgmModelButtonText,
                        cgmInfo.cgmModel === "Dexcom G6 / G5 / One" && styles.cgmModelButtonTextSelected
                      ]}>
                        Dexcom G6 / G5 / One
                      </Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={[
                        styles.cgmModelButton,
                        cgmInfo.cgmModel === "Abbott Freestyle Libre" && styles.cgmModelButtonSelected
                      ]}
                      onPress={() => setCgmInfo({...cgmInfo, cgmModel: "Abbott Freestyle Libre"})}
                    >
                      <Text style={[
                        styles.cgmModelButtonText,
                        cgmInfo.cgmModel === "Abbott Freestyle Libre" && styles.cgmModelButtonTextSelected
                      ]}>
                        Abbott Freestyle Libre
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          ) : currentStep === 4 ? (
            <>
              {/* Step 4: Insulin Delivery Info */}
              {/* Insulin Delivery Status */}
              <View style={styles.section}>
                <Text style={styles.label}>Do you use a pump or smart pen? *</Text>
                
                {/* No Options Group */}
                <View style={styles.optionGroup}>
                  <Text style={styles.optionGroupLabel}>❌ No</Text>
                  <View style={styles.radioGroup}>
                    <RadioButton 
                      value="Not using insulin" 
                      label="Not using insulin" 
                      selectedValue={insulinDeliveryInfo.insulinDeliveryStatus}
                      onSelect={(value) => setInsulinDeliveryInfo({insulinDeliveryStatus: value as any, pumpModel: null})}
                    />
                    <RadioButton 
                      value="Only using basal insulin" 
                      label="Only using basal insulin" 
                      selectedValue={insulinDeliveryInfo.insulinDeliveryStatus}
                      onSelect={(value) => setInsulinDeliveryInfo({insulinDeliveryStatus: value as any, pumpModel: null})}
                    />
                    <RadioButton 
                      value="MDI now, but considering a pump or smart pen" 
                      label="MDI now, but considering a pump or smart pen" 
                      selectedValue={insulinDeliveryInfo.insulinDeliveryStatus}
                      onSelect={(value) => setInsulinDeliveryInfo({insulinDeliveryStatus: value as any, pumpModel: null})}
                    />
                    <RadioButton 
                      value="MDI now, actively trying to get one" 
                      label="MDI now, actively trying to get one" 
                      selectedValue={insulinDeliveryInfo.insulinDeliveryStatus}
                      onSelect={(value) => setInsulinDeliveryInfo({insulinDeliveryStatus: value as any, pumpModel: null})}
                    />
                    <RadioButton 
                      value="MDI now, decided against a pump or smart pen" 
                      label="MDI now, decided against a pump or smart pen" 
                      selectedValue={insulinDeliveryInfo.insulinDeliveryStatus}
                      onSelect={(value) => setInsulinDeliveryInfo({insulinDeliveryStatus: value as any, pumpModel: null})}
                    />
                  </View>
                </View>

                {/* Yes Options Group */}
                <View style={styles.optionGroup}>
                  <Text style={styles.optionGroupLabel}>✅ Yes</Text>
                  <View style={styles.radioGroup}>
                    <RadioButton 
                      value="Omnipod 5" 
                      label="Omnipod 5" 
                      selectedValue={insulinDeliveryInfo.insulinDeliveryStatus}
                      onSelect={(value) => setInsulinDeliveryInfo({insulinDeliveryStatus: value as any, pumpModel: value as any})}
                    />
                    <RadioButton 
                      value="Omnipod Dash" 
                      label="Omnipod Dash" 
                      selectedValue={insulinDeliveryInfo.insulinDeliveryStatus}
                      onSelect={(value) => setInsulinDeliveryInfo({insulinDeliveryStatus: value as any, pumpModel: value as any})}
                    />
                  </View>
                </View>
              </View>
            </>
          ) : (
            <>
              {/* Step 5: Completion Screen */}
              <View style={styles.completionContainer}>
                {/* Success Icon */}
                <View style={styles.successIcon}>
                  <Ionicons name="checkmark-circle" size={80} color={COLORS.blue} />
                </View>

                {/* Success Message */}
                <Text style={styles.successMessage}>
                  Congratulations! Your profile is complete.
                </Text>

                {/* Summary Section */}
                <View style={styles.summarySection}>
                  <Text style={styles.summaryTitle}>Your Profile Summary</Text>
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryRow}>
                      <Ionicons name="person-outline" size={20} color={COLORS.gray} />
                      <Text style={styles.summaryLabel}>Diabetes:</Text>
                      <Text style={styles.summaryValue}>{diabetesInfo.hasDiabetes === "Yes" ? diabetesInfo.diabetesType : diabetesInfo.hasDiabetes}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Ionicons name="pulse-outline" size={20} color={COLORS.gray} />
                      <Text style={styles.summaryLabel}>CGM:</Text>
                      <Text style={styles.summaryValue}>
                        {cgmInfo.cgmStatus === "Yes – I already use one" ? cgmInfo.cgmModel : "Not using"}
                      </Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Ionicons name="medical-outline" size={20} color={COLORS.gray} />
                      <Text style={styles.summaryLabel}>Insulin:</Text>
                      <Text style={styles.summaryValue}>
                        {insulinDeliveryInfo.pumpModel ? insulinDeliveryInfo.pumpModel : "MDI"}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Review Info Button */}
                <TouchableOpacity style={styles.reviewButton} onPress={() => setCurrentStep(1)}>
                  <Ionicons name="create-outline" size={20} color={COLORS.blue} />
                  <Text style={styles.reviewButtonText}>Review my info</Text>
                </TouchableOpacity>

                {/* Next Steps Info */}
                <View style={styles.nextStepsSection}>
                  <Text style={styles.nextStepsTitle}>What's next?</Text>
                  <View style={styles.nextStepItem}>
                    <Ionicons name="fitness-outline" size={24} color={COLORS.blue} />
                    <View style={styles.nextStepContent}>
                      <Text style={styles.nextStepLabel}>Sync Apple Health</Text>
                      <Text style={styles.nextStepDescription}>Connect your health data from the Settings page</Text>
                    </View>
                  </View>
                  <View style={styles.nextStepItem}>
                    <Ionicons name="bluetooth-outline" size={24} color={COLORS.blue} />
                    <View style={styles.nextStepContent}>
                      <Text style={styles.nextStepLabel}>Connect your CGM</Text>
                      <Text style={styles.nextStepDescription}>Link your device for real-time glucose monitoring</Text>
                    </View>
                  </View>
                </View>
              </View>
            </>
          )}
        </View>

        {currentStep < 5 && (
          <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
            <Text style={styles.continueButtonText}>
              {currentStep < 4 ? "Next" : "Complete"}
            </Text>
          </TouchableOpacity>
        )}

        {currentStep === 5 && (
          <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
            <Text style={styles.continueButtonText}>Start using SugarSense.ai</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Height Picker Modal */}
      <ModalPicker
        isVisible={showHeightPicker}
        options={heightOptions}
        selectedValue={userInfo.height}
        onValueChange={(value) => setUserInfo({ ...userInfo, height: value })}
        onClose={() => setShowHeightPicker(false)}
        title="Select Height"
        unit={userInfo.heightUnit}
      />

      {/* Weight Picker Modal */}
      <ModalPicker
        isVisible={showWeightPicker}
        options={weightOptions}
        selectedValue={userInfo.weight}
        onValueChange={(value) => setUserInfo({ ...userInfo, weight: value })}
        onClose={() => setShowWeightPicker(false)}
        title="Select Weight"
        unit={userInfo.weightUnit}
      />

      {/* Year Picker Modal */}
      <ModalPicker
        isVisible={showYearPicker}
        options={yearOptions}
        selectedValue={diabetesInfo.yearOfDiagnosis}
        onValueChange={(value) => setDiabetesInfo({ ...diabetesInfo, yearOfDiagnosis: value })}
        onClose={() => setShowYearPicker(false)}
        title="Select Year of Diagnosis"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 100, // Extra padding to ensure Continue button is always accessible
  },
  header: {
    alignItems: "center",
    marginTop: height * 0.08,
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.blue,
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.gray,
    textAlign: "center",
    lineHeight: 22,
  },
  formContainer: {
    paddingHorizontal: 20,
    marginBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.surface,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 18,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    color: COLORS.surface,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  dateInput: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  dateText: {
    fontSize: 16,
    color: COLORS.surface,
  },
  placeholderText: {
    color: COLORS.lightGray,
  },
  radioGroup: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  radioButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.blue,
    marginRight: 14,
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
    fontWeight: "500",
  },
  inputWithUnit: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  pickerButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  pickerButtonText: {
    fontSize: 16,
    color: COLORS.surface,
    flex: 1,
  },
  pickerPlaceholder: {
    color: COLORS.lightGray,
  },
  unitToggle: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  unitToggleOption: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: COLORS.white,
    minWidth: 50,
    alignItems: "center",
  },
  unitToggleOptionSelected: {
    backgroundColor: COLORS.blue,
  },
  unitToggleText: {
    fontSize: 16,
    color: COLORS.surface,
    fontWeight: "600",
  },
  unitToggleTextSelected: {
    color: COLORS.white,
  },
  continueButton: {
    backgroundColor: COLORS.blue,
    marginHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 40,
    shadowColor: COLORS.blue,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  continueButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: height * 0.7,
    minHeight: height * 0.4,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.surface,
  },
  closeButton: {
    padding: 4,
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    paddingBottom: 20,
  },
  modalOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F5",
  },
  modalOptionSelected: {
    backgroundColor: "#F0F8FF",
  },
  modalOptionText: {
    fontSize: 16,
    color: COLORS.surface,
    flex: 1,
  },
  modalOptionTextSelected: {
    color: COLORS.blue,
    fontWeight: "600",
  },
  // Progress indicator styles
  progressContainer: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  progressBar: {
    width: "80%",
    height: 4,
    backgroundColor: "#E8E8E8",
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.blue,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 14,
    color: COLORS.gray,
    fontWeight: "500",
  },
  // Back button styles
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginBottom: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.blue,
    fontWeight: "600",
    marginLeft: 4,
  },
  // CGM Model Grid styles
  cgmModelGrid: {
    gap: 12,
  },
  cgmModelButton: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 8,
  },
  cgmModelButtonSelected: {
    borderColor: COLORS.blue,
    backgroundColor: "#F0F8FF",
  },
  cgmModelButtonText: {
    fontSize: 16,
    color: COLORS.surface,
    fontWeight: "600",
    textAlign: "center",
  },
  cgmModelButtonTextSelected: {
    color: COLORS.blue,
  },
  // Option Group styles
  optionGroup: {
    marginBottom: 20,
  },
  optionGroupLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.surface,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  // Completion Screen styles
  completionContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  successIcon: {
    marginBottom: 24,
  },
  successMessage: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.surface,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 32,
  },
  summarySection: {
    width: "100%",
    marginBottom: 24,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.surface,
    marginBottom: 16,
    textAlign: "center",
  },
  summaryCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: "#E8E8E8",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.surface,
    minWidth: 80,
  },
  summaryValue: {
    fontSize: 16,
    color: COLORS.gray,
    flex: 1,
  },
  reviewButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: COLORS.blue,
  },
  reviewButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.blue,
  },
  nextStepsSection: {
    width: "100%",
  },
  nextStepsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.surface,
    marginBottom: 16,
    textAlign: "center",
  },
  nextStepItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 20,
    gap: 16,
  },
  nextStepContent: {
    flex: 1,
  },
  nextStepLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.surface,
    marginBottom: 4,
  },
  nextStepDescription: {
    fontSize: 14,
    color: COLORS.gray,
    lineHeight: 20,
  },
}); 