import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, FlatList, StyleSheet, Text, ActivityIndicator, TextInput, TouchableOpacity, TouchableHighlight, Pressable, Modal, Alert, ScrollView, useWindowDimensions } from 'react-native';
import { useStore } from '../store/useStore';
import { ChannelCard } from '../components/ChannelCard';
import { parseM3U, groupChannels, ChannelGroup } from '../utils/m3uParser';

const PLAYLISTS = [
  { id: 'pl1', name: 'Playlist 1', url: 'http://iptvin.ru/p/?web1t&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl2', name: 'Playlist 2', url: 'http://iptvin.ru/p/?web3-3&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl3', name: 'Playlist 3', url: 'http://iptvin.ru/p/?web4&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl4', name: 'Playlist 4', url: 'http://iptvin.ru/p/?web9u&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl5', name: 'Playlist 5', url: 'http://iptvin.ru/p/?web10&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl6', name: 'Playlist 6', url: 'https://smolnp.github.io/IPTVru//IPTVru.m3u' },
  { id: 'pl7', name: 'Playlist 7', url: 'http://iptvin.ru/p/?web6i&yuri1245&FnY2zctuSXJG3u2' }
];

const PlaylistChip = ({ pl, activePlaylistId, customPlaylists, isLandscape, onPress, onLongPress, hasTVPreferredFocus }: any) => {
  const isCustom = customPlaylists.some((c: any) => c.id === pl.id);
  
  return (
    <Pressable 
      onPress={onPress}
      onLongPress={onLongPress}
      focusable={true}
      accessible={true}
      // @ts-ignore
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={(state: any) => [
        styles.sourceChip, 
        activePlaylistId === pl.id && styles.sourceChipActive, 
        isCustom && { borderColor: '#0A84FF', borderWidth: 1 },
        isLandscape && { paddingVertical: 6 },
        state.focused && styles.sourceChipFocused
      ]}
    >
      {(state: any) => (
        <Text style={[
          styles.sourceText, 
          activePlaylistId === pl.id && styles.sourceTextActive, 
          isLandscape && { fontSize: 12 },
          state.focused && styles.sourceTextFocused
        ]}>
          {isCustom ? `★ ${pl.name}` : pl.name}
        </Text>
      )}
    </Pressable>
  );
};

const AddSourceButton = ({ isLandscape, onPress }: any) => {
  return (
    <Pressable 
      onPress={onPress}
      focusable={true}
      accessible={true}
      style={(state: any) => [
        styles.addSourceBtn, 
        isLandscape && { paddingVertical: 6 },
        state.focused && styles.addSourceBtnFocused
      ]}
    >
      {(state: any) => (
        <Text style={[
          styles.addSourceText, 
          isLandscape && { fontSize: 12 },
          state.focused && styles.addSourceTextFocused
        ]}>
          + Добавить
        </Text>
      )}
    </Pressable>
  );
};

export const HomeScreen = ({ navigation }: any) => {
  const { channels, setChannels, favorites, toggleFavorite, customPlaylists, addCustomPlaylist, removeCustomPlaylist, setActivePlayback, activationKey, isAuthorized, isFreeMode, trialStartDate } = useStore();
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isModalVisible, setModalVisible] = useState(false);
  const [newPlName, setNewPlName] = useState('');
  const [newPlUrl, setNewPlUrl] = useState('');
  
  const [selectedGroup, setSelectedGroup] = useState<ChannelGroup | null>(null);
  const [focusedVariantIndex, setFocusedVariantIndex] = useState<number | null>(null);
  const [isCloseModalFocused, setIsCloseModalFocused] = useState(false);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Determine access level
  const isTrialActive = trialStartDate != null && (Date.now() - trialStartDate <= 3 * 24 * 60 * 60 * 1000);
  const isPro = isAuthorized || isTrialActive; // PRO = paid key OR active trial
  // isFreeMode = after trial expired, user chose "continue free" → restricted

  const allPlaylists = useMemo(() => {
    const premiumList = { 
      id: 'premium_amvera', 
      name: '🆓 Общедоступные', 
      url: `https://iptvpay-svmorozoww.amvera.io/api/playlist?key=${activationKey || 'VIP-TEST'}` 
    };
    // Free users only get the public playlist
    if (isFreeMode && !isPro) return [premiumList];
    return [premiumList, ...PLAYLISTS, ...customPlaylists];
  }, [customPlaylists, activationKey, isFreeMode, isPro]);

  const [activePlaylistId, setActivePlaylistId] = useState(allPlaylists[0].id);
  const activePlaylist = useMemo(() => allPlaylists.find(p => p.id === activePlaylistId) || allPlaylists[0], [allPlaylists, activePlaylistId]);

  useEffect(() => {
    const loadPlaylist = async () => {
      setLoading(true);
      setChannels([]); // Clear the array first to release memory
      try {
        console.log(`[DEBUG] Loading playlist from: ${activePlaylist.url}`);
        const response = await fetch(activePlaylist.url);
        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        console.log(`[DEBUG] Fetched ${text.length} bytes`);
        const parsed = parseM3U(text);
        console.log(`[DEBUG] Parsed ${parsed.channels.length} channels`);
        setChannels(parsed.channels);
        
        // Use provided EPG URL or a fallback uncompressed EPG source
        const fallbackEpgUrl = 'http://epg.it999.ru/epg.xml';
        const finalTvgUrl = parsed.tvgUrl || fallbackEpgUrl;
        
        useStore.getState().setTvgUrl(finalTvgUrl);
      } catch (e: any) {
        console.error('[DEBUG] Failed to load playlist', e);
        setChannels([]);
        Alert.alert(
          'Ошибка загрузки', 
          `URL: ${activePlaylist.url}\n\nОшибка: ${e.message}\n\nВозможные причины: нет интернета, блокировка HTTP (cleartext), неверный формат ссылки.`
        );
      } finally {
        setLoading(false);
      }
    };

    loadPlaylist();
  }, [activePlaylist.url]);

  const normalizeForSearch = useCallback((str: string) => str.toLowerCase().replace(/[-\s]/g, ''), []);
  
  const filteredChannels = useMemo(() => {
    const query = normalizeForSearch(searchQuery);
    if (!query) return channels;
    return channels.filter(c => normalizeForSearch(c.name).includes(query));
  }, [channels, searchQuery, normalizeForSearch]);

  const groupedChannels = useMemo(() => {
    return groupChannels(filteredChannels);
  }, [filteredChannels]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: isLandscape ? 20 : 60 }]}>
        <View style={isLandscape ? styles.headerRowLandscape : styles.brandRow}>
          <View style={styles.brandRowInner}>
            <Text style={styles.brandTitle}>StreamLume</Text>
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumText}>PREMIUM</Text>
            </View>
          </View>
          
          {isLandscape && (
            <TextInput
              style={[styles.searchInput, { marginTop: 0, flex: 1, marginLeft: 20 }]}
              placeholder="Поиск каналов..."
              placeholderTextColor="#8E8E93"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sourceScroll}>
          {allPlaylists.map((pl) => {
            const isCustom = customPlaylists.some(c => c.id === pl.id);
            return (
              <PlaylistChip
                key={pl.id}
                pl={pl}
                activePlaylistId={activePlaylistId}
                customPlaylists={customPlaylists}
                isLandscape={isLandscape}
                hasTVPreferredFocus={pl.id === activePlaylistId}
                onPress={() => {
                  const isActive = activePlaylistId === pl.id;
                  if (isActive && isCustom) {
                    Alert.alert('Управление плейлистом', pl.name, [
                      { text: 'Открыть', style: 'default' },
                      { text: 'Удалить плейлист', style: 'destructive', onPress: () => {
                          removeCustomPlaylist(pl.id);
                          setActivePlaylistId(PLAYLISTS[0].id);
                      }},
                      { text: 'Отмена', style: 'cancel' }
                    ]);
                  } else {
                    setActivePlaylistId(pl.id);
                  }
                }}
                onLongPress={() => {
                  if (isCustom) {
                    Alert.alert('Удалить плейлист?', pl.name, [
                      { text: 'Отмена', style: 'cancel' },
                      { text: 'Удалить', style: 'destructive', onPress: () => {
                          removeCustomPlaylist(pl.id);
                          if (activePlaylistId === pl.id) setActivePlaylistId(PLAYLISTS[0].id);
                      }}
                    ]);
                  }
                }}
              />
            );
          })}
          {/* Only PRO users can add custom playlists */}
          {isPro && (
            <AddSourceButton
              isLandscape={isLandscape}
              onPress={() => setModalVisible(true)}
            />
          )}
        </ScrollView>
        {!isLandscape && (
          <TextInput
            style={styles.searchInput}
            placeholder="Поиск каналов..."
            placeholderTextColor="#8E8E93"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#0A84FF" style={styles.loader} />
      ) : (
        <FlatList
          data={groupedChannels}
          key={isLandscape ? 'landscape-5' : 'portrait-3'}
          keyExtractor={(item) => item.id}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={3}
          numColumns={isLandscape ? 5 : 3}
          removeClippedSubviews={true}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ChannelCard
              channel={{...item.variants[0], name: item.baseName, group: item.group, logo: item.logo}}
              isFavorite={favorites.some(f => f.id === item.variants[0].id)}
              variantsCount={item.variants.length}
              onToggleFavorite={() => {
                if (!isPro) {
                  Alert.alert(
                    '🔒 Функция PRO',
                    'Избранное доступно только в PRO-версии.\n\nПолучите ключ доступа через Telegram-бот @StreameLumeBot.',
                    [{ text: 'Понятно', style: 'cancel' }]
                  );
                  return;
                }
                toggleFavorite(item.variants[0]);
              }}
              onPress={() => {
                const listToPlay = groupedChannels.map(g => g.variants[0]);
                if (item.variants.length === 1) {
                  const index = listToPlay.findIndex(c => c.id === item.variants[0].id);
                  setActivePlayback(listToPlay, index >= 0 ? index : 0);
                  navigation.navigate('Player', { 
                    url: item.variants[0].url, 
                    title: item.baseName,
                    tvgId: item.variants[0].tvgId,
                    channel: item.variants[0],
                    initialFullscreen: false
                  });
                } else {
                  setSelectedGroup(item);
                }
              }}
            />
          )}
        />
      )}

      <Modal visible={isModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Новый плейлист</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Название (например: Мой список)"
              placeholderTextColor="#8E8E93"
              value={newPlName}
              onChangeText={setNewPlName}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="http://iptvin.ru/p/?web10&yuri1245&FnY2zctuSXJG3u2"
              placeholderTextColor="#8E8E93"
              value={newPlUrl}
              onChangeText={setNewPlUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalBtnText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnSave} onPress={() => {
                if (!newPlName.trim() || !newPlUrl.trim()) {
                  Alert.alert('Ошибка', 'Заполните все поля');
                  return;
                }
                const newId = 'custom-' + Date.now();
                addCustomPlaylist({
                  id: newId,
                  name: newPlName.trim(),
                  url: newPlUrl.trim()
                });
                setModalVisible(false);
                setNewPlName('');
                setNewPlUrl('');
                setActivePlaylistId(newId);
              }}>
                <Text style={styles.modalBtnSaveText}>Сохранить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!selectedGroup} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{selectedGroup?.baseName}</Text>
            <Text style={styles.modalSubtitle}>Выберите вариант трансляции:</Text>
            <ScrollView style={{maxHeight: 300}}>
              {selectedGroup?.variants.map((variant, index) => {
                const isItemFocused = focusedVariantIndex === index;
                return (
                  <TouchableOpacity 
                    key={index} 
                    style={[styles.variantBtn, isItemFocused && { backgroundColor: '#ffffff', borderColor: '#ffffff', borderWidth: 2 }]}
                    onPress={() => {
                      setSelectedGroup(null);
                      setFocusedVariantIndex(null);
                      const listToPlay = groupedChannels.map(g => g.variants[0]);
                      const idx = listToPlay.findIndex(c => c.id === variant.id);
                      setActivePlayback(listToPlay, idx >= 0 ? idx : listToPlay.findIndex(c => c.name === selectedGroup?.baseName) || 0);
                      navigation.navigate('Player', { 
                        url: variant.url, 
                        title: variant.name,
                        tvgId: variant.tvgId,
                        channel: variant,
                        initialFullscreen: false
                      });
                    }}
                    onFocus={() => setFocusedVariantIndex(index)}
                    onBlur={() => setFocusedVariantIndex(null)}
                    focusable={true}
                    accessible={true}
                    // @ts-ignore
                    onPointerEnter={() => setFocusedVariantIndex(index)}
                    // @ts-ignore
                    onPointerLeave={() => setFocusedVariantIndex(null)}
                  >
                    <Text style={[styles.variantText, isItemFocused && { color: '#000000', fontWeight: 'bold' }]}>{variant.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity 
              style={[styles.modalBtnCancel, {marginTop: 20}, isCloseModalFocused && { backgroundColor: '#ffffff', borderColor: '#ffffff', borderWidth: 2 }]} 
              onPress={() => {
                setSelectedGroup(null);
                setIsCloseModalFocused(false);
              }}
              onFocus={() => setIsCloseModalFocused(true)}
              onBlur={() => setIsCloseModalFocused(false)}
              focusable={true}
              accessible={true}
              // @ts-ignore
              onPointerEnter={() => setIsCloseModalFocused(true)}
              // @ts-ignore
              onPointerLeave={() => setIsCloseModalFocused(false)}
            >
              <Text style={[styles.modalBtnText, isCloseModalFocused && { color: '#000000', fontWeight: 'bold' }]}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    padding: 16,
    paddingTop: 60,
    backgroundColor: '#050505',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    justifyContent: 'space-between',
  },
  headerRowLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    justifyContent: 'space-between',
  },
  brandRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
    textShadowColor: 'rgba(10, 132, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  premiumBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  premiumText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
  },
  searchInput: {
    backgroundColor: '#2c2c2e',
    color: '#fff',
    padding: 12,
    borderRadius: 10,
    fontSize: 16,
    marginTop: 15,
  },
  sourceScroll: {
    flexDirection: 'row',
  },
  sourceChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2c2c2e',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  sourceChipActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.2)',
    borderColor: '#0A84FF',
  },
  sourceText: {
    color: '#8E8E93',
    fontWeight: 'bold',
  },
  sourceTextActive: {
    color: '#0A84FF',
  },
  list: {
    padding: 8,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addSourceBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    marginRight: 20,
    borderWidth: 1,
    borderColor: '#0A84FF',
    justifyContent: 'center',
  },
  addSourceText: {
    color: '#0A84FF',
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#2c2c2e',
    color: '#fff',
    padding: 10,
    borderRadius: 8,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  modalBtnCancel: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
    backgroundColor: '#2c2c2e',
    borderRadius: 8,
    marginRight: 8,
  },
  modalBtnSave: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
    backgroundColor: '#0A84FF',
    borderRadius: 8,
    marginLeft: 8,
  },
  modalBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  modalBtnSaveText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  modalSubtitle: {
    color: '#8E8E93',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  variantBtn: {
    backgroundColor: '#2c2c2e',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  variantText: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
  },
  sourceChipFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    borderWidth: 2,
    transform: [{ scale: 1.05 }],
  },
  sourceTextFocused: {
    color: '#000000',
  },
  addSourceBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    borderWidth: 2,
    transform: [{ scale: 1.05 }],
  },
  addSourceTextFocused: {
    color: '#000000',
  }
});
