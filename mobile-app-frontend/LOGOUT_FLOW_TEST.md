# Logout Flow Testing Guide

## Overview
This document provides a comprehensive test plan for the complete logout flow implementation using Clerk authentication.

## Test Scenarios

### Scenario 1: First-Time User Complete Flow
**Purpose**: Test the complete onboarding and logout cycle

**Steps**:
1. ✅ Open the app (fresh install or cleared data)
2. ✅ Should see login screen
3. ✅ Tap "Sign in with Google"
4. ✅ Complete Google OAuth flow
5. ✅ Should be redirected to onboarding screens
6. ✅ Navigate through onboarding slides
7. ✅ Complete user info form (all 5 steps)
8. ✅ Should be redirected to main app (tabs)
9. ✅ Navigate to Profile tab
10. ✅ Tap "Logout" button
11. ✅ Should see confirmation dialog
12. ✅ Tap "Sign Out"
13. ✅ Should be redirected to login screen

**Expected Result**: User successfully completes full onboarding and logout flow

### Scenario 2: Returning User (Skip Onboarding)
**Purpose**: Verify onboarding data persists across sessions

**Prerequisites**: Complete Scenario 1 first

**Steps**:
1. ✅ From login screen (after completing Scenario 1)
2. ✅ Tap "Sign in with Google"
3. ✅ Use same Google account as before
4. ✅ Should skip onboarding completely
5. ✅ Should go directly to main app (tabs)
6. ✅ Verify profile data is intact

**Expected Result**: User bypasses onboarding and goes straight to main app

### Scenario 3: Logout Error Handling
**Purpose**: Test error handling during logout

**Steps**:
1. ✅ Turn off internet connection
2. ✅ Navigate to Profile tab
3. ✅ Tap "Logout" button
4. ✅ Tap "Sign Out" in confirmation dialog
5. ✅ Should see error dialog if network request fails
6. ✅ Turn internet back on and retry

**Expected Result**: Graceful error handling with retry option

### Scenario 4: Multiple Account Testing
**Purpose**: Verify user-specific onboarding data

**Steps**:
1. ✅ Complete onboarding with Account A
2. ✅ Logout
3. ✅ Login with Account B (different Google account)
4. ✅ Should show onboarding for Account B
5. ✅ Complete onboarding for Account B
6. ✅ Logout from Account B
7. ✅ Login back with Account A
8. ✅ Should skip onboarding for Account A

**Expected Result**: Each user has independent onboarding status

## Key Points to Verify

### ✅ Authentication State
- [ ] Clerk session is properly cleared on logout
- [ ] User object becomes null after logout
- [ ] Auth state changes trigger proper navigation

### ✅ Onboarding Persistence
- [ ] Onboarding completion status is stored per user ID
- [ ] Data persists after app restart
- [ ] Different users have independent onboarding states

### ✅ Navigation Flow
- [ ] Logout redirects to login screen
- [ ] Login with completed onboarding goes to main app
- [ ] Login without onboarding goes to onboarding flow
- [ ] InitialLayout handles all transitions smoothly

### ✅ User Experience
- [ ] Confirmation dialog prevents accidental logout
- [ ] Clear messaging about data preservation
- [ ] Smooth transitions without flickering
- [ ] Error messages are user-friendly

### ✅ Data Preservation
- [ ] User preferences remain intact
- [ ] Profile settings are preserved
- [ ] No data loss occurs during logout/login cycle

## Console Logs to Watch For

During testing, monitor console logs for these key messages:

### Successful Logout Flow:
```
🚪 Starting logout process...
✅ Successfully signed out
❌ User not signed in. Redirecting to login...
🔄 InitialLayout: Resetting onboarding state after logout
```

### Successful Login (Returning User):
```
✅ Successfully signed in with Google
🚀 InitialLayout: Auth loaded and user signed in (user_xxx)
🔍 InitialLayout: Checking onboarding status for user user_xxx
✅ Onboarding completed for user user_xxx: true
✅ User signed in and onboarding completed. Redirecting to main app...
```

### Successful Login (First-Time User):
```
✅ Successfully signed in with Google
🚀 InitialLayout: Auth loaded and user signed in (user_xxx)
🔍 InitialLayout: Checking onboarding status for user user_xxx
✅ Onboarding completed for user user_xxx: false
🚀 First-time user detected. Redirecting to onboarding...
```

## Debug Commands

To test specific scenarios, you can use these AsyncStorage commands in the React Native debugger:

### Clear specific user's onboarding data:
```javascript
AsyncStorage.removeItem('onboarding_completed_user_xxx')
```

### Check current onboarding status:
```javascript
AsyncStorage.getItem('onboarding_completed_user_xxx').then(console.log)
```

### List all onboarding keys:
```javascript
AsyncStorage.getAllKeys().then(keys => 
  console.log(keys.filter(key => key.includes('onboarding_completed')))
)
```

## Performance Considerations

- [ ] Logout completes within 2 seconds
- [ ] Login-to-main-app transition is under 3 seconds
- [ ] No unnecessary re-renders during auth state changes
- [ ] Smooth animations during screen transitions

## Security Checklist

- [ ] Session tokens are properly cleared
- [ ] No sensitive data remains in memory
- [ ] Biometric/device unlock works correctly after logout
- [ ] Deep links don't bypass authentication

## Success Criteria

✅ **Complete Implementation Success**: All test scenarios pass without issues
✅ **User Experience**: Smooth, intuitive flow with clear feedback
✅ **Data Integrity**: No data loss, proper persistence across sessions
✅ **Error Handling**: Graceful degradation with helpful error messages
✅ **Performance**: Fast, responsive interactions throughout the flow

---

## Notes for Developers

- The `InitialLayout` component is the central auth flow controller
- Onboarding status is stored as `onboarding_completed_{userId}` in AsyncStorage
- Clerk handles all authentication state management
- Navigation is handled automatically by `InitialLayout` based on auth/onboarding state 