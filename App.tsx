import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './src/screens/HomeScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';

import { AuthScreen } from './src/screens/AuthScreen';
import { useStore } from './src/store/useStore';
import { Audio } from 'expo-av';
import { isTVDevice } from './src/utils/TVLayoutManager';
import { TVHomeScreen } from './src/tv/TVHomeScreen';
import * as FileSystem from 'expo-file-system/legacy';

// Enable audio even in silent mode
Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  staysActiveInBackground: true,
  interruptionModeIOS: 1, // interruptionModeIOS.DoNotMix
  playsInSilentModeIOS: true,
  shouldDuckAndroid: true,
  interruptionModeAndroid: 1, // interruptionModeAndroid.DoNotMix
  playThroughEarpieceAndroid: false,
});

const cleanCache = async () => {
  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (cacheDir) {
      console.log("[Cache Cleaner] Starting cache cleanup...");
      const files = await FileSystem.readDirectoryAsync(cacheDir);
      console.log(`[Cache Cleaner] Found ${files.length} items to clean.`);
      for (const file of files) {
        try {
          await FileSystem.deleteAsync(cacheDir + file, { idempotent: true });
        } catch (err: any) {
          console.warn(`[Cache Cleaner] Failed to delete ${file}:`, err.message);
        }
      }
      console.log("[Cache Cleaner] Cache cleanup completed successfully.");
    }
  } catch (error: any) {
    console.error("[Cache Cleaner] Error during cache cleanup:", error.message);
  }
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const MainTabs = ({ isPro }: { isPro: boolean }) => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1c1c1e',
          borderTopColor: '#3a3a3c',
        },
        tabBarActiveTintColor: '#0A84FF',
        tabBarInactiveTintColor: '#8E8E93',
      }}
    >
      <Tab.Screen 
        name="Все каналы" 
        component={HomeScreen} 
        options={{ tabBarIcon: () => null, tabBarLabelStyle: { fontSize: 14, paddingBottom: 5 } }}
      />
      {isPro && (
        <Tab.Screen 
          name="Избранное" 
          component={FavoritesScreen} 
          options={{ tabBarIcon: () => null, tabBarLabelStyle: { fontSize: 14, paddingBottom: 5 } }}
        />
      )}
    </Tab.Navigator>
  );
};

import { View, ActivityIndicator } from 'react-native';

const MainScreen = () => {
  const isAuthorized = useStore(state => state.isAuthorized);
  const trialStartDate = useStore(state => state.trialStartDate);
  const isTrialActive = trialStartDate != null && (Date.now() - trialStartDate <= 3 * 24 * 60 * 60 * 1000);
  const isPro = isAuthorized || isTrialActive;

  return isTVDevice() ? <TVHomeScreen /> : <MainTabs isPro={isPro} />;
};

export default function App() {
  const isAuthorized = useStore(state => state.isAuthorized);
  const isFreeMode = useStore(state => state.isFreeMode);
  const trialStartDate = useStore(state => state.trialStartDate);
  
  const [isReady, setIsReady] = React.useState(false);

  const isTrialActive = trialStartDate != null && (Date.now() - trialStartDate <= 3 * 24 * 60 * 60 * 1000);
  const isPro = isAuthorized || isTrialActive;

  React.useEffect(() => {
    cleanCache();
    
    // Fallback: if hydration fails or hangs, force ready state after 1.5s
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 1500);
    
    // Subscribe to store changes to detect hydration
    const unsub = useStore.subscribe((state) => {
      if (state.hasHydrated) {
        setIsReady(true);
      }
    });
    
    // Initial check
    if (useStore.getState().hasHydrated) {
      setIsReady(true);
    }
    
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  const canAccess = isPro || isFreeMode;

  const customDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: '#000000',
      card: '#1c1c1e',
      text: '#ffffff',
    },
  };

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={customDarkTheme}>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!canAccess ? (
            <Stack.Screen name="Auth" component={AuthScreen} />
          ) : (
            <>
              <Stack.Screen 
                name="Main" 
                component={MainScreen} 
              />

              <Stack.Screen name="Player" component={PlayerScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
