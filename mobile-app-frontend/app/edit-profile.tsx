import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Dimensions,
  Modal,
  SafeAreaView,
} from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUserIds } from '../services/userService';
import { getBaseUrl } from '../services/api';

const { width } = Dimensions.get('window');

interface ProfileData {
  full_name: string;
  email: string;
  height_value: string;
  height_unit: string;
  weight_value: string;
  weight_unit: string;
  gender: string;
  cgm_model: string;
  pump_model: string;
  has_diabetes: string;
  diabetes_type: string;
  year_of_diagnosis: string;
  uses_insulin: string;
  insulin_type: string;
  daily_basal_dose: string;
  insulin_to_carb_ratio: string;
}

interface ValidationErrors {
  [key: string]: string;
}

// Simple Modal Picker Component
const ModalPicker = ({ 
  isVisible,
  options, 
  selectedValue, 
  onValueChange, 
  onClose,
  title,
}: {
  isVisible: boolean;
  options: string[];
  selectedValue: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  title: string;
}) => {
  if (!isVisible) return null;

  console.log('ModalPicker rendering with:', { title, optionsLength: options.length, options });

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
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          
          <ScrollView 
            style={styles.modalScrollView}
            showsVerticalScrollIndicator={true}
            contentContainerStyle={styles.modalScrollContent}
          >
            {options && options.length > 0 ? (
              options.map((option, index) => (
                <TouchableOpacity
                  key={`${option}-${index}`}
                  style={[
                    styles.modalOption,
                    selectedValue === option && styles.modalOptionSelected
                  ]}
                  onPress={() => {
                    console.log('Option selected:', option);
                    onValueChange(option);
                    onClose();
                  }}
                >
                  <Text style={[
                    styles.modalOptionText,
                    selectedValue === option && styles.modalOptionTextSelected
                  ]}>
                    {option}
                  </Text>
                  {selectedValue === option && (
                    <Ionicons name="checkmark" size={20} color="#007AFF" />
                  )}
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.modalOption}>
                <Text style={styles.modalOptionText}>No options available</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const EditProfileScreen = () => {
  const { user } = useUser();
  const router = useRouter();
  const { updateUserProfile } = useUserIds();
  
  const [profileData, setProfileData] = useState<ProfileData>({
    full_name: '',
    email: '',
    height_value: '',
    height_unit: 'cm',
    weight_value: '',
    weight_unit: 'kg',
    gender: '',
    cgm_model: '',
    pump_model: '',
    has_diabetes: '',
    diabetes_type: '',
    year_of_diagnosis: '',
    uses_insulin: '',
    insulin_type: '',
    daily_basal_dose: '',
    insulin_to_carb_ratio: '',
  });
  
  const [originalData, setOriginalData] = useState<ProfileData | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Modal visibility states
  const [showGenderPicker, setShowGenderPicker] = useState(false);
  const [showCgmPicker, setShowCgmPicker] = useState(false);
  const [showPumpPicker, setShowPumpPicker] = useState(false);
  const [showHasDiabetesPicker, setShowHasDiabetesPicker] = useState(false);
  const [showDiabetesTypePicker, setShowDiabetesTypePicker] = useState(false);
  const [showYearOfDiagnosisPicker, setShowYearOfDiagnosisPicker] = useState(false);
  const [showUsesInsulinPicker, setShowUsesInsulinPicker] = useState(false);
  const [showInsulinTypePicker, setShowInsulinTypePicker] = useState(false);

  // Options for dropdowns
  const genderOptions = ['Male', 'Female', 'Other', 'Prefer not to say'];
  const cgmOptions = ['Dexcom G7 / One+', 'Dexcom G6 / G5 / One', 'Abbott Freestyle Libre'];
  const pumpOptions = ['Omnipod 5', 'Omnipod Dash'];
  const hasDiabetesOptions = ['Yes', 'No', 'Not sure'];
  const diabetesTypeOptions = ['Type 1', 'Type 2', 'Gestational', 'Pre-diabetes', 'Not sure'];
  const usesInsulinOptions = ['Yes', 'No'];
  const insulinTypeOptions = ['Basal', 'Bolus', 'Both'];
  
  // Generate years from 1990 to current year
  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let year = currentYear; year >= 1990; year--) {
    yearOptions.push(year.toString());
  }

  // Debug logging
  console.log('Gender options:', genderOptions);
  console.log('CGM options:', cgmOptions);
  console.log('Pump options:', pumpOptions);
  console.log('Has Diabetes options:', hasDiabetesOptions);
  console.log('Diabetes Type options:', diabetesTypeOptions);
  console.log('Year options:', yearOptions);
  console.log('Uses Insulin options:', usesInsulinOptions);
  console.log('Insulin Type options:', insulinTypeOptions);
  console.log('Modal states:', { showGenderPicker, showCgmPicker, showPumpPicker, showHasDiabetesPicker, showDiabetesTypePicker, showYearOfDiagnosisPicker, showUsesInsulinPicker, showInsulinTypePicker });

  // Load the user profile once the Clerk user object is available (or changes)
  useEffect(() => {
    if (user?.id) {
      loadUserProfile();
    }
  }, [user?.id]);

  useEffect(() => {
    // Check if there are changes
    if (originalData) {
      const changes = Object.keys(profileData).some(
        key => profileData[key as keyof ProfileData] !== originalData[key as keyof ProfileData]
      );
      setHasChanges(changes);
    }
  }, [profileData, originalData]);

  const loadUserProfile = async () => {
    if (!user?.id) return;
    
    setIsLoading(true);
    try {
      const baseUrl = await getBaseUrl();
      const response = await fetch(`${baseUrl}/api/user-profile?clerk_user_id=${user.id}`);
      const data = await response.json();
      
      if (data.success && data.user) {
        const userData = data.user;
        const formattedData: ProfileData = {
          full_name: userData.full_name || '',
          email: userData.email || '',
          height_value: userData.height_value?.toString() || '',
          height_unit: userData.height_unit || 'cm',
          weight_value: userData.weight_value?.toString() || '',
          weight_unit: userData.weight_unit || 'kg',
          gender: userData.gender || '',
          cgm_model: userData.cgm_model || '',
          pump_model: userData.pump_model || '',
          has_diabetes: userData.has_diabetes || '',
          diabetes_type: userData.diabetes_type || '',
          year_of_diagnosis: userData.year_of_diagnosis || '',
          uses_insulin: userData.uses_insulin || '',
          insulin_type: userData.insulin_type || '',
          daily_basal_dose: userData.daily_basal_dose || '',
          insulin_to_carb_ratio: userData.insulin_to_carb_ratio || '',
        };
        
        setProfileData(formattedData);
        setOriginalData(formattedData);
      } else {
        Alert.alert('Error', 'Failed to load profile data');
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      Alert.alert('Error', 'Failed to load profile data');
    } finally {
      setIsLoading(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: ValidationErrors = {};

    // Name validation
    if (!profileData.full_name.trim()) {
      errors.full_name = 'Name is required';
    }

    // Email validation
    if (!profileData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(profileData.email)) {
      errors.email = 'Invalid email format';
    }

    // Height validation
    if (profileData.height_value) {
      const height = parseFloat(profileData.height_value);
      if (isNaN(height)) {
        errors.height_value = 'Height must be a valid number';
      } else if (profileData.height_unit === 'cm') {
        if (height < 50 || height > 250) {
          errors.height_value = 'Height must be between 50-250 cm';
        }
      } else if (profileData.height_unit === 'ft') {
        if (height < 2 || height > 8) {
          errors.height_value = 'Height must be between 2-8 feet';
        }
      }
    }

    // Weight validation
    if (profileData.weight_value) {
      const weight = parseFloat(profileData.weight_value);
      if (isNaN(weight)) {
        errors.weight_value = 'Weight must be a valid number';
      } else if (profileData.weight_unit === 'kg') {
        if (weight < 20 || weight > 300) {
          errors.weight_value = 'Weight must be between 20-300 kg';
        }
      } else if (profileData.weight_unit === 'lbs') {
        if (weight < 40 || weight > 660) {
          errors.weight_value = 'Weight must be between 40-660 lbs';
        }
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      Alert.alert('Validation Error', 'Please fix the errors before saving');
      return;
    }

    if (!hasChanges) {
      Alert.alert('No Changes', 'No changes to save');
      return;
    }

    setIsSaving(true);
    try {
      // Only send changed fields
      const changedFields: Partial<ProfileData> = {};
      if (originalData) {
        Object.keys(profileData).forEach(key => {
          const typedKey = key as keyof ProfileData;
          if (profileData[typedKey] !== originalData[typedKey]) {
            changedFields[typedKey] = profileData[typedKey];
          }
        });
      }

      const data = await updateUserProfile(changedFields);

      if (data.success) {
        Alert.alert(
          'Success', 
          'Profile updated successfully',
          [
            {
              text: 'OK',
              onPress: () => {
                setOriginalData(profileData);
                setHasChanges(false);
                router.back();
              }
            }
          ]
        );
      } else {
        if (data.validation_errors) {
          setValidationErrors(data.validation_errors.reduce((acc: ValidationErrors, error: string) => {
            // Simple mapping - in production you'd want more sophisticated error mapping
            if (error.includes('Height')) acc.height_value = error;
            if (error.includes('Weight')) acc.weight_value = error;
            if (error.includes('email')) acc.email = error;
            return acc;
          }, {}));
        }
        Alert.alert('Error', data.error || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to leave?',
        [
          { text: 'Stay', style: 'cancel' },
          { 
            text: 'Leave', 
            style: 'destructive',
            onPress: () => router.back()
          }
        ]
      );
    } else {
      router.back();
    }
  };

  const updateField = (field: keyof ProfileData, value: string) => {
    setProfileData(prev => ({ ...prev, [field]: value }));
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa' }}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ marginTop: 16, fontSize: 16, color: '#666' }}>Loading profile...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Fixed Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleCancel} style={styles.headerButton}>
          <Text style={styles.cancelButton}>Cancel</Text>
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Edit Profile</Text>
        
        <TouchableOpacity 
          onPress={handleSave}
          disabled={!hasChanges || isSaving}
          style={[styles.headerButton, (!hasChanges || isSaving) && styles.disabledButton]}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : (
            <Text style={[
              styles.saveButton, 
              hasChanges && styles.saveButtonActive,
              (!hasChanges || isSaving) && styles.saveButtonDisabled
            ]}>
              Save
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        style={styles.keyboardContainer} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 20}
      >
        {/* Header moved above - content begins */}
        <ScrollView 
          style={styles.scrollView} 
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {/* Basic Information Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="person-outline" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Basic Information</Text>
            </View>

            {/* Full Name */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Full Name *</Text>
              <TextInput
                style={[
                  styles.textInput,
                  validationErrors.full_name && styles.inputError
                ]}
                value={profileData.full_name}
                onChangeText={(text) => updateField('full_name', text)}
                placeholder="Enter your full name"
                placeholderTextColor="#8E8E93"
                autoCapitalize="words"
                returnKeyType="next"
              />
              {validationErrors.full_name && (
                <Text style={styles.errorText}>
                  {validationErrors.full_name}
                </Text>
              )}
            </View>

            {/* Email */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Email *</Text>
              <TextInput
                style={[
                  styles.textInput,
                  validationErrors.email && styles.inputError
                ]}
                value={profileData.email}
                onChangeText={(text) => updateField('email', text)}
                placeholder="Enter your email"
                placeholderTextColor="#8E8E93"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              {validationErrors.email && (
                <Text style={styles.errorText}>
                  {validationErrors.email}
                </Text>
              )}
            </View>

            {/* Gender */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Gender</Text>
                          <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => {
                console.log('Gender picker button pressed, options:', genderOptions);
                setShowGenderPicker(true);
              }}
            >
                <Text style={[
                  styles.pickerButtonText,
                  !profileData.gender && styles.pickerPlaceholder
                ]}>
                  {profileData.gender || "Select gender"}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#8E8E93" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Physical Measurements Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="fitness-outline" size={20} color="#34C759" />
              <Text style={styles.sectionTitle}>Physical Measurements</Text>
            </View>

            {/* Height */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Height</Text>
              <View style={styles.measurementRow}>
                <View style={styles.measurementInput}>
                  <TextInput
                    style={[
                      styles.textInput,
                      validationErrors.height_value && styles.inputError
                    ]}
                    value={profileData.height_value}
                    onChangeText={(text) => updateField('height_value', text)}
                    placeholder="0"
                    placeholderTextColor="#8E8E93"
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.unitSelector}>
                  <TouchableOpacity 
                    style={[
                      styles.unitButton, 
                      profileData.height_unit === 'cm' && styles.unitButtonActive
                    ]}
                    onPress={() => updateField('height_unit', 'cm')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      profileData.height_unit === 'cm' && styles.unitButtonTextActive
                    ]}>cm</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[
                      styles.unitButton, 
                      profileData.height_unit === 'ft' && styles.unitButtonActive
                    ]}
                    onPress={() => updateField('height_unit', 'ft')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      profileData.height_unit === 'ft' && styles.unitButtonTextActive
                    ]}>ft</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {validationErrors.height_value && (
                <Text style={styles.errorText}>
                  {validationErrors.height_value}
                </Text>
              )}
            </View>

            {/* Weight */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Weight</Text>
              <View style={styles.measurementRow}>
                <View style={styles.measurementInput}>
                  <TextInput
                    style={[
                      styles.textInput,
                      validationErrors.weight_value && styles.inputError
                    ]}
                    value={profileData.weight_value}
                    onChangeText={(text) => updateField('weight_value', text)}
                    placeholder="0"
                    placeholderTextColor="#8E8E93"
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.unitSelector}>
                  <TouchableOpacity 
                    style={[
                      styles.unitButton, 
                      profileData.weight_unit === 'kg' && styles.unitButtonActive
                    ]}
                    onPress={() => updateField('weight_unit', 'kg')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      profileData.weight_unit === 'kg' && styles.unitButtonTextActive
                    ]}>kg</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[
                      styles.unitButton, 
                      profileData.weight_unit === 'lbs' && styles.unitButtonActive
                    ]}
                    onPress={() => updateField('weight_unit', 'lbs')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      profileData.weight_unit === 'lbs' && styles.unitButtonTextActive
                    ]}>lbs</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {validationErrors.weight_value && (
                <Text style={styles.errorText}>
                  {validationErrors.weight_value}
                </Text>
              )}
            </View>
          </View>

          {/* Device Preferences Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="medical-outline" size={20} color="#FF9500" />
              <Text style={styles.sectionTitle}>Device Preferences</Text>
            </View>

            {/* CGM Model */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>CGM Model</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => {
                  console.log('CGM picker button pressed, options:', cgmOptions);
                  setShowCgmPicker(true);
                }}
              >
                <Text style={[
                  styles.pickerButtonText,
                  !profileData.cgm_model && styles.pickerPlaceholder
                ]}>
                  {profileData.cgm_model || "Select CGM model"}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            {/* Pump Model */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Insulin Pump Model</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => {
                  console.log('Pump picker button pressed, options:', pumpOptions);
                  setShowPumpPicker(true);
                }}
              >
                <Text style={[
                  styles.pickerButtonText,
                  !profileData.pump_model && styles.pickerPlaceholder
                ]}>
                  {profileData.pump_model || "Select pump model"}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#8E8E93" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Diabetes Info Section */}
          <View style={[styles.section, styles.lastSection]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="heart-outline" size={20} color="#FF3B30" />
              <Text style={styles.sectionTitle}>Diabetes Info</Text>
            </View>

            {/* Do you have diabetes? */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Do you have diabetes?</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowHasDiabetesPicker(true)}
              >
                <Text style={[
                  styles.pickerButtonText,
                  !profileData.has_diabetes && styles.pickerPlaceholder
                ]}>
                  {profileData.has_diabetes || "Select option"}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            {/* Diabetes type */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Diabetes type</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowDiabetesTypePicker(true)}
              >
                <Text style={[
                  styles.pickerButtonText,
                  !profileData.diabetes_type && styles.pickerPlaceholder
                ]}>
                  {profileData.diabetes_type || "Select diabetes type"}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            {/* Year of diagnosis */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Year of diagnosis</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowYearOfDiagnosisPicker(true)}
              >
                <Text style={[
                  styles.pickerButtonText,
                  !profileData.year_of_diagnosis && styles.pickerPlaceholder
                ]}>
                  {profileData.year_of_diagnosis || "Select year"}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            {/* Uses insulin? */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Uses insulin?</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowUsesInsulinPicker(true)}
              >
                <Text style={[
                  styles.pickerButtonText,
                  !profileData.uses_insulin && styles.pickerPlaceholder
                ]}>
                  {profileData.uses_insulin || "Select option"}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            {/* Insulin type - only show if usesInsulin is "Yes" */}
            {profileData.uses_insulin === 'Yes' && (
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Insulin type</Text>
                <TouchableOpacity
                  style={styles.pickerButton}
                  onPress={() => setShowInsulinTypePicker(true)}
                >
                  <Text style={[
                    styles.pickerButtonText,
                    !profileData.insulin_type && styles.pickerPlaceholder
                  ]}>
                    {profileData.insulin_type || "Select insulin type"}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color="#8E8E93" />
                </TouchableOpacity>
              </View>
            )}

            {/* Daily basal dose */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Daily basal dose</Text>
              <TextInput
                style={styles.textInput}
                value={profileData.daily_basal_dose}
                onChangeText={(text) => updateField('daily_basal_dose', text)}
                placeholder="Enter dose (e.g., 24)"
                placeholderTextColor="#8E8E93"
                keyboardType="decimal-pad"
                returnKeyType="next"
              />
            </View>

            {/* Insulin-to-carb ratio */}
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Insulin-to-carb ratio</Text>
              <TextInput
                style={styles.textInput}
                value={profileData.insulin_to_carb_ratio}
                onChangeText={(text) => updateField('insulin_to_carb_ratio', text)}
                placeholder="Enter ratio (e.g., 1:15)"
                placeholderTextColor="#8E8E93"
                returnKeyType="done"
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Gender Picker Modal */}
      <ModalPicker
        isVisible={showGenderPicker}
        options={genderOptions}
        selectedValue={profileData.gender}
        onValueChange={(value) => {
          console.log('Gender value changed to:', value);
          updateField('gender', value);
        }}
        onClose={() => {
          console.log('Gender picker closed');
          setShowGenderPicker(false);
        }}
        title="Select Gender"
      />

      {/* CGM Picker Modal */}
      <ModalPicker
        isVisible={showCgmPicker}
        options={cgmOptions}
        selectedValue={profileData.cgm_model}
        onValueChange={(value) => updateField('cgm_model', value)}
        onClose={() => setShowCgmPicker(false)}
        title="Select CGM Model"
      />

      {/* Pump Picker Modal */}
      <ModalPicker
        isVisible={showPumpPicker}
        options={pumpOptions}
        selectedValue={profileData.pump_model}
        onValueChange={(value) => updateField('pump_model', value)}
        onClose={() => setShowPumpPicker(false)}
        title="Select Pump Model"
      />

      {/* Has Diabetes Picker Modal */}
      <ModalPicker
        isVisible={showHasDiabetesPicker}
        options={hasDiabetesOptions}
        selectedValue={profileData.has_diabetes}
        onValueChange={(value) => updateField('has_diabetes', value)}
        onClose={() => setShowHasDiabetesPicker(false)}
        title="Do you have diabetes?"
      />

      {/* Diabetes Type Picker Modal */}
      <ModalPicker
        isVisible={showDiabetesTypePicker}
        options={diabetesTypeOptions}
        selectedValue={profileData.diabetes_type}
        onValueChange={(value) => updateField('diabetes_type', value)}
        onClose={() => setShowDiabetesTypePicker(false)}
        title="Select Diabetes Type"
      />

      {/* Year of Diagnosis Picker Modal */}
      <ModalPicker
        isVisible={showYearOfDiagnosisPicker}
        options={yearOptions}
        selectedValue={profileData.year_of_diagnosis}
        onValueChange={(value) => updateField('year_of_diagnosis', value)}
        onClose={() => setShowYearOfDiagnosisPicker(false)}
        title="Select Year of Diagnosis"
      />

      {/* Uses Insulin Picker Modal */}
      <ModalPicker
        isVisible={showUsesInsulinPicker}
        options={usesInsulinOptions}
        selectedValue={profileData.uses_insulin}
        onValueChange={(value) => {
          updateField('uses_insulin', value);
          // Clear insulin type if user selects "No"
          if (value === 'No') {
            updateField('insulin_type', '');
          }
        }}
        onClose={() => setShowUsesInsulinPicker(false)}
        title="Uses insulin?"
      />

      {/* Insulin Type Picker Modal */}
      <ModalPicker
        isVisible={showInsulinTypePicker}
        options={insulinTypeOptions}
        selectedValue={profileData.insulin_type}
        onValueChange={(value) => updateField('insulin_type', value)}
        onClose={() => setShowInsulinTypePicker(false)}
        title="Select Insulin Type"
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  keyboardContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
  },
  cancelButton: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '400',
  },
  saveButton: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '400',
    textAlign: 'right',
  },
  saveButtonActive: {
    fontWeight: '600',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  disabledButton: {
    opacity: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  lastSection: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    marginLeft: 12,
  },
  fieldContainer: {
    marginBottom: 24,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3C3C43',
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 17,
    color: '#1C1C1E',
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 52,
  },
  inputError: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFF5F5',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    marginTop: 8,
    fontWeight: '500',
  },
  pickerButton: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 52,
  },
  pickerButtonText: {
    fontSize: 17,
    color: '#1C1C1E',
  },
  pickerPlaceholder: {
    color: '#8E8E93',
  },
  measurementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  measurementInput: {
    flex: 1,
  },
  unitSelector: {
    flexDirection: 'row',
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    padding: 2,
    width: 100,
  },
  unitButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  unitButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#8E8E93',
  },
  unitButtonTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: width * 1.4, // Use a larger, more reliable height
    minHeight: width * 0.8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  closeButton: {
    padding: 4,
  },
  modalScrollView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalScrollContent: {
    paddingBottom: 20,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
    backgroundColor: '#FFFFFF',
  },
  modalOptionSelected: {
    backgroundColor: '#F0F8FF',
  },
  modalOptionText: {
    fontSize: 16,
    color: '#1C1C1E',
    flex: 1,
  },
  modalOptionTextSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
});

export default EditProfileScreen; 