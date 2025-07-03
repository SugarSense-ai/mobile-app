import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { COLORS } from '@/constants/theme';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: any;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    console.error('🚨 Error caught by boundary:', error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('🚨 Error details:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ 
          flex: 1, 
          backgroundColor: COLORS.blue, 
          justifyContent: 'center', 
          padding: 20 
        }}>
          <Text style={{ 
            color: 'white', 
            fontSize: 20, 
            fontWeight: 'bold', 
            textAlign: 'center',
            marginBottom: 20 
          }}>
            App Error Detected
          </Text>
          <ScrollView style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 15 }}>
            <Text style={{ color: 'white', fontSize: 14 }}>
              Error: {this.state.error?.message || 'Unknown error'}
            </Text>
            <Text style={{ color: 'white', fontSize: 12, marginTop: 10 }}>
              Stack: {this.state.error?.stack || 'No stack trace available'}
            </Text>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
} 