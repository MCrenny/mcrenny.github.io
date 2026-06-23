import { Platform } from 'react-native';

/**
 * Utility for detecting if the application is running on a TV device.
 * On web platform (e.g., Media Station X browser), we always return true
 * because MSX renders our React Native Web build and needs the TV interface.
 */
export const isTVDevice = (): boolean => {
  // On web (Media Station X / Smart TV browser), always use TV layout
  if (Platform.OS === 'web') return true;
  // Built-in React Native platform check for Android TV, Fire TV, etc.
  return Platform.isTV;
};

/**
 * TV Focus Section identifier types for managed focus grids.
 */
export type TVFocusSection = 'playlists' | 'categories' | 'channels' | 'player_controls';
