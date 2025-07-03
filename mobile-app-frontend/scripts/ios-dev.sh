#!/bin/bash

# iOS Development Script for SugarSense.ai
# This script helps debug and run the iOS app with proper environment setup

echo "🍎 SugarSense.ai iOS Development Setup"
echo "======================================"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Creating .env template..."
    cat > .env << EOF
# Clerk Authentication
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_key_here

# Replace 'pk_test_your_clerk_key_here' with your actual Clerk publishable key
# You can get this from your Clerk dashboard at https://dashboard.clerk.dev
EOF
    echo "✅ .env template created. Please update with your actual Clerk key."
    exit 1
fi

# Check if Clerk key is set
if grep -q "pk_test_your_clerk_key_here" .env; then
    echo "⚠️  Please update your Clerk publishable key in .env file"
    echo "   Current: pk_test_your_clerk_key_here"
    echo "   Get your key from: https://dashboard.clerk.dev"
    exit 1
fi

echo "✅ Environment configuration looks good"

# Clear Metro cache
echo "🧹 Clearing Metro cache..."
npx expo start --clear

echo "🚀 Starting iOS development server..."
echo "   - Make sure Xcode is installed"
echo "   - Make sure iOS Simulator is available"
echo "   - Press 'i' to open iOS simulator" 