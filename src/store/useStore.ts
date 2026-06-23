import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Channel, isAdultContent } from '../utils/m3uParser';

interface StoreState {
  channels: Channel[];
  favorites: Channel[];
  isAuthorized: boolean;
  isFreeMode: boolean;
  trialStartDate: number | null;
  activationKey: string | null;
  hasHydrated: boolean; // New flag
  setHasHydrated: (status: boolean) => void;
  setAuthorized: (status: boolean) => void;
  setFreeMode: (status: boolean) => void;
  startTrial: () => void;
  setActivationKey: (key: string | null) => void;
  setChannels: (channels: Channel[]) => void;
  toggleFavorite: (channel: Channel) => void;
  reorderFavorites: (newOrder: string[]) => void;
  moveFavorite: (id: string, direction: 'up' | 'down') => void;
  customPlaylists: { id: string; name: string; url: string; }[];
  addCustomPlaylist: (pl: { id: string; name: string; url: string; }) => void;
  removeCustomPlaylist: (id: string) => void;
  tvgUrl: string | null;
  setTvgUrl: (url: string | null) => void;
  
  // Для воспроизведения и переключения
  activePlaybackList: Channel[];
  activePlaybackIndex: number;
  setActivePlayback: (list: Channel[], index: number) => void;
  playNextChannel: () => Channel | null;
  playPrevChannel: () => Channel | null;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      channels: [],
      favorites: [],
      customPlaylists: [],
      isAuthorized: false,
      isFreeMode: false,
      trialStartDate: null,
      activationKey: null,
      hasHydrated: false,
      setHasHydrated: (status) => set({ hasHydrated: status }),
      setAuthorized: (status) => set({ isAuthorized: status }),
      setFreeMode: (status) => set({ isFreeMode: status }),
      startTrial: () => set({ trialStartDate: Date.now(), isFreeMode: false }),
      setActivationKey: (key) => set({ activationKey: key }),
      setChannels: (channels) => set({ channels }),
      toggleFavorite: (channel) => set((state) => {
        const exists = state.favorites.some(f => f.id === channel.id);
        return {
          favorites: exists 
            ? state.favorites.filter(f => f.id !== channel.id)
            : [...state.favorites, channel]
        };
      }),
      reorderFavorites: (newOrder) => set({ favorites: newOrder as any }), 
      moveFavorite: (id, direction) => set((state) => {
        const clean = state.favorites.filter(ch => !isAdultContent(ch.name || '', ch.group || ''));
        const adult = state.favorites.filter(ch => isAdultContent(ch.name || '', ch.group || ''));

        const idx = clean.findIndex(f => f.id === id);
        if (idx === -1) return state;
        if (direction === 'up' && idx === 0) return state;
        if (direction === 'down' && idx === clean.length - 1) return state;

        const newClean = [...clean];
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        [newClean[idx], newClean[swapIdx]] = [newClean[swapIdx], newClean[idx]];

        return { favorites: [...newClean, ...adult] };
      }),
      addCustomPlaylist: (playlist) => set((state) => ({ customPlaylists: [...state.customPlaylists, playlist] })),
      removeCustomPlaylist: (id) => set((state) => ({
        customPlaylists: state.customPlaylists.filter(pl => pl.id !== id)
      })),
      tvgUrl: null,
      setTvgUrl: (url) => set({ tvgUrl: url }),

      activePlaybackList: [],
      activePlaybackIndex: 0,
      setActivePlayback: (list, index) => set({ activePlaybackList: list, activePlaybackIndex: index }),
      playNextChannel: () => {
        const { activePlaybackList, activePlaybackIndex } = get();
        if (activePlaybackList.length === 0) return null;
        const nextIndex = (activePlaybackIndex + 1) % activePlaybackList.length;
        set({ activePlaybackIndex: nextIndex });
        return activePlaybackList[nextIndex];
      },
      playPrevChannel: () => {
        const { activePlaybackList, activePlaybackIndex } = get();
        if (activePlaybackList.length === 0) return null;
        const prevIndex = (activePlaybackIndex - 1 + activePlaybackList.length) % activePlaybackList.length;
        set({ activePlaybackIndex: prevIndex });
        return activePlaybackList[prevIndex];
      }
    }),
    {
      name: 'streamlume-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({ 
        isAuthorized: state.isAuthorized, 
        isFreeMode: state.isFreeMode,
        trialStartDate: state.trialStartDate,
        activationKey: state.activationKey,
        favorites: state.favorites, 
        customPlaylists: state.customPlaylists 
      }),
    }
  )
);
