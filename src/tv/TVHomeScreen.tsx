import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, Pressable, ScrollView, FlatList, useWindowDimensions, Modal, TextInput, Alert, Platform } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { parseM3U, Channel, isAdultContent } from '../utils/m3uParser';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
// FileSystem and Sharing are native-only; import conditionally to avoid web crashes
const FileSystem = Platform.OS !== 'web' ? require('expo-file-system/legacy') : null;
const Sharing = Platform.OS !== 'web' ? require('expo-sharing') : null;

const PLAYLISTS = [
  { id: 'pl1', name: 'Playlist 1', url: 'http://iptvin.ru/p/?web1t&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl2', name: 'Playlist 2', url: 'http://iptvin.ru/p/?web3-3&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl3', name: 'Playlist 3', url: 'http://iptvin.ru/p/?web4&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl4', name: 'Playlist 4', url: 'http://iptvin.ru/p/?web9u&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl5', name: 'Playlist 5', url: 'http://iptvin.ru/p/?web10&yuri1245&FnY2zctuSXJG3u2' },
  { id: 'pl6', name: 'Playlist 6', url: 'https://smolnp.github.io/IPTVru//IPTVru.m3u' },
  { id: 'pl7', name: 'Playlist 7', url: 'http://iptvin.ru/p/?web6i&yuri1245&FnY2zctuSXJG3u2' }
];

type ViewMode = 'normal' | 'small' | 'large' | 'list';

export const TVHomeScreen = ({ navigation }: any) => {
  const { channels, setChannels, favorites, toggleFavorite, moveFavorite, customPlaylists, addCustomPlaylist, removeCustomPlaylist, setActivePlayback, activationKey } = useStore();
  const [loading, setLoading] = useState(false);
  // On web (MSX), useIsFocused can misbehave — treat web as always focused
  const isFocusedNative = useIsFocused();
  const isScreenFocused = Platform.OS === 'web' ? true : isFocusedNative;
  
  // Объединяем плейлисты, добавляя наш Premium в самое начало
  const allPlaylists = useMemo(() => {
    const premiumList = { 
      id: 'premium_amvera', 
      name: '🆓 Общедоступные', 
      url: `https://iptvpay-svmorozoww.amvera.io/api/playlist?key=${activationKey || 'VIP-TEST'}` 
    };
    return [premiumList, ...PLAYLISTS, ...customPlaylists];
  }, [customPlaylists, activationKey]);

  const [activePlaylistId, setActivePlaylistId] = useState(allPlaylists[0].id);
  const activePlaylist = useMemo(() => allPlaylists.find(p => p.id === activePlaylistId) || allPlaylists[0], [allPlaylists, activePlaylistId]);

  const [selectedCategory, setSelectedCategory] = useState<string>('Все каналы');
  
  // Режим отображения: 'normal' (обычные плитки), 'small' (маленькие), 'large' (большие), 'list' (классический список)
  const [viewMode, setViewMode] = useState<ViewMode>(Platform.OS === 'web' ? 'small' : 'normal');

  // Отслеживание текущего активного индекса для плавного скролла
  const [focusedPlaylistIdx, setFocusedPlaylistIdx] = useState(0);
  const [focusedCategoryIdx, setFocusedCategoryIdx] = useState(0);
  const [focusedChannelIdx, setFocusedChannelIdx] = useState(0);
  const [focusedRegion, setFocusedRegion] = useState<'playlists' | 'categories' | 'channels' | 'viewMode' | 'exportBtn' | 'editBtn' | 'clockBtn'>('channels');

  // Часы
  const [showClock, setShowClock] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isClockFocused, setIsClockFocused] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatClock = (d: Date) =>
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Состояния для добавления пользовательского плейлиста
  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [newPlName, setNewPlName] = useState('');
  const [newPlUrl, setNewPlUrl] = useState('');
  const [isModalCancelFocused, setIsModalCancelFocused] = useState(false);
  const [isModalSaveFocused, setIsModalSaveFocused] = useState(false);
  const [isNameInputFocused, setIsNameInputFocused] = useState(false);
  const [isUrlInputFocused, setIsUrlInputFocused] = useState(false);

  // Состояния для управления пользовательским плейлистом (активация / удаление)
  const [isActionModalVisible, setActionModalVisible] = useState(false);
  const [selectedActionPlaylist, setSelectedActionPlaylist] = useState<{ id: string, name: string } | null>(null);
  const [isActionSelectFocused, setIsActionSelectFocused] = useState(false);
  const [isActionDeleteFocused, setIsActionDeleteFocused] = useState(false);
  const [isActionCancelFocused, setIsActionCancelFocused] = useState(false);

  // Состояния для управления каналом (избранное, перемещение)
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedChannelIdx, setSelectedChannelIdx] = useState<number>(-1);
  const [isChannelModalVisible, setChannelModalVisible] = useState(false);
  const [isChannelPlayFocused, setIsChannelPlayFocused] = useState(false);
  const [isChannelUpFocused, setIsChannelUpFocused] = useState(false);
  const [isChannelDownFocused, setIsChannelDownFocused] = useState(false);
  const [isChannelFavFocused, setIsChannelFavFocused] = useState(false);
  const [isChannelExportFocused, setIsChannelExportFocused] = useState(false);
  const [isChannelCancelFocused, setIsChannelCancelFocused] = useState(false);
  const [isEditMode, setEditMode] = useState(false);

  const handleExport = async () => {
    const cleanFavorites = favorites.filter(ch => !isAdultContent(ch.name || '', ch.group || ''));
    if (cleanFavorites.length === 0) {
      Alert.alert('Ошибка', 'Нет каналов для экспорта');
      return;
    }

    let content = '#EXTM3U\n';
    cleanFavorites.forEach(ch => {
      content += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.group}",${ch.name}\n${ch.url}\n`;
    });

    // On web (MSX): use browser download
    if (Platform.OS === 'web') {
      try {
        const blob = new Blob([content], { type: 'audio/x-mpegurl' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'favorites.m3u';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error(e);
        Alert.alert('Ошибка', 'Не удалось сохранить файл');
      }
      return;
    }

    // Native: use expo-file-system + expo-sharing
    try {
      const fileUri = FileSystem.documentDirectory + 'favorites.m3u';
      await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'audio/x-mpegurl',
          dialogTitle: 'Сохранить плейлист',
          UTI: 'public.plain-text'
        });
      } else {
        Alert.alert('Упс', 'Экспорт не поддерживается на этом устройстве');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Ошибка', 'Не удалось сохранить файл');
    }
  };

  // Извлекаем уникальные категории каналов
  const categories = useMemo(() => {
    const set = new Set<string>();
    set.add('⭐ Избранное');
    set.add('Все каналы');
    channels.forEach(c => {
      if (c.group) set.add(c.group);
    });
    return Array.from(set);
  }, [channels]);

  // Фильтруем каналы по выбранной категории
  const filteredChannels = useMemo(() => {
    if (selectedCategory?.includes('Избранное')) {
      return favorites.filter(ch => !isAdultContent(ch.name || '', ch.group || ''));
    }
    if (!selectedCategory || selectedCategory === 'Все каналы') return channels;
    return channels.filter(c => c.group === selectedCategory);
  }, [channels, selectedCategory, favorites]);

  // Загрузка выбранного плейлиста
  useEffect(() => {
    const loadPlaylist = async () => {
      setLoading(true);
      setChannels([]); // Clear the array first to release memory
      try {
        const response = await fetch(activePlaylist.url);
        const text = await response.text();
        const parsed = parseM3U(text);
        setChannels(parsed.channels || parsed);
        setSelectedCategory('Все каналы');
      } catch (error) {
        console.error('Ошибка загрузки плейлиста:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPlaylist();
  }, [activePlaylist.url]);

  // Воспроизведение канала по индексу
  const playChannel = (index: number) => {
    if (filteredChannels.length > 0) {
      setActivePlayback(filteredChannels, index);
      const ch = filteredChannels[index];
      navigation.navigate('Player', {
        url: ch.url,
        title: ch.name,
        tvgId: ch.tvgId,
        channel: ch,
        initialFullscreen: false
      });
    }
  };

  // Ротация режимов отображения
  const toggleViewMode = () => {
    const modes: ViewMode[] = ['normal', 'small', 'large', 'list'];
    const nextIndex = (modes.indexOf(viewMode) + 1) % modes.length;
    setViewMode(modes[nextIndex]);
  };

  // Динамические стили карточек на основе выбранного режима отображения
  const getCardStyle = (mode: ViewMode) => {
    switch (mode) {
      case 'small':
        return styles.channelCardSmall;
      case 'large':
        return styles.channelCardLarge;
      case 'list':
        return styles.channelCardList;
      case 'normal':
      default:
        return styles.channelCardNormal;
    }
  };

  // Динамические стили текста названия на основе режима
  const getNameStyle = (mode: ViewMode) => {
    switch (mode) {
      case 'small':
        return styles.channelNameSmall;
      case 'large':
        return styles.channelNameLarge;
      case 'list':
        return styles.channelNameList;
      case 'normal':
      default:
        return styles.channelNameNormal;
    }
  };

  // Иконка для кнопки смены режима
  const getViewModeIcon = (mode: ViewMode) => {
    switch (mode) {
      case 'small':
        return 'grid-sharp';
      case 'large':
        return 'apps-sharp';
      case 'list':
        return 'list-sharp';
      case 'normal':
      default:
        return 'apps-outline';
    }
  };

  const getViewModeText = (mode: ViewMode) => {
    switch (mode) {
      case 'small':
        return 'Маленькие плитки';
      case 'large':
        return 'Большие плитки';
      case 'list':
        return 'Список';
      case 'normal':
      default:
        return 'Обычные плитки';
    }
  };

  const getNumColumns = (mode: ViewMode) => {
    switch (mode) {
      case 'small':
        return 8;
      case 'large':
        return 4;
      case 'list':
        return 1;
      case 'normal':
      default:
        return 6;
    }
  };

  return (
    <>
      <View style={styles.container}>
      <LinearGradient colors={['#1a1a1c', '#0a0a0c']} style={StyleSheet.absoluteFillObject} />

      {/* Шапка плейлистов */}
      <View style={styles.header}>
        <Text style={styles.logo}>StreamLume <Text style={styles.tvBadge}>TV</Text></Text>
        
        {/* Кнопка смены размера карточек */}
        <Pressable
          onPress={toggleViewMode}
          onFocus={() => setFocusedRegion('viewMode')}
          focusable={!isAddModalVisible && !isActionModalVisible}
          accessible={true}
          style={[
            styles.viewModeBtn,
            focusedRegion === 'viewMode' && styles.viewModeBtnFocused
          ]}
        >
          <View style={styles.viewModeBtnContent}>
            <Ionicons 
              name={getViewModeIcon(viewMode)} 
              size={20} 
              color={focusedRegion === 'viewMode' ? "#000000" : "#0A84FF"} 
            />
            <Text style={[
              styles.viewModeText,
              focusedRegion === 'viewMode' && styles.viewModeTextFocused
            ]}>
              {getViewModeText(viewMode)}
            </Text>
          </View>
        </Pressable>

        {/* Кнопка экспорта избранного (только в Избранном) */}
        {selectedCategory?.includes('Избранное') && (
          <Pressable
            onPress={handleExport}
            onFocus={() => setFocusedRegion('exportBtn')}
            focusable={!isAddModalVisible && !isActionModalVisible && !isChannelModalVisible}
            accessible={true}
            style={[
              styles.exportBtn,
              focusedRegion === 'exportBtn' && styles.exportBtnFocused
            ]}
          >
            <View style={styles.viewModeBtnContent}>
              <Ionicons 
                name="share-outline" 
                size={20} 
                color={focusedRegion === 'exportBtn' ? "#000000" : "#0A84FF"} 
              />
              <Text style={[
                styles.viewModeText,
                focusedRegion === 'exportBtn' && styles.viewModeTextFocused
              ]}>
                Экспорт m3u
              </Text>
            </View>
          </Pressable>
        )}

        {/* Кнопка часов */}
        <Pressable
          onPress={() => setShowClock(prev => !prev)}
          onFocus={() => { setIsClockFocused(true); setFocusedRegion('clockBtn'); }}
          onBlur={() => setIsClockFocused(false)}
          focusable={!isAddModalVisible && !isActionModalVisible && !isChannelModalVisible}
          accessible={true}
          style={[
            styles.viewModeBtn,
            isClockFocused && styles.viewModeBtnFocused,
            showClock && { backgroundColor: 'rgba(255, 215, 0, 0.12)', borderColor: 'rgba(255,215,0,0.3)' }
          ]}
        >
          <View style={styles.viewModeBtnContent}>
            <Ionicons
              name="time-outline"
              size={20}
              color={isClockFocused ? '#000000' : (showClock ? '#FFD700' : '#8e8e93')}
            />
            {showClock && (
              <Text style={[
                styles.viewModeText,
                { color: isClockFocused ? '#000000' : '#FFD700', fontVariant: ['tabular-nums'], letterSpacing: 1 }
              ]}>
                {formatClock(currentTime)}
              </Text>
            )}
          </View>
        </Pressable>

        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.playlistsScrollView}
          contentContainerStyle={styles.playlistsScroll}
        >
          {allPlaylists.map((pl, idx) => {
            const isActive = activePlaylistId === pl.id;
            const isFocused = focusedRegion === 'playlists' && focusedPlaylistIdx === idx;
            const isCustom = customPlaylists.some(c => c.id === pl.id);
            return (
              <Pressable 
                key={pl.id}
                onPress={() => {
                  if (isCustom) {
                    setSelectedActionPlaylist(pl);
                    setActionModalVisible(true);
                  } else {
                    setActivePlaylistId(pl.id);
                  }
                }}
                onFocus={() => {
                  setFocusedPlaylistIdx(idx);
                  setFocusedRegion('playlists');
                }}
                focusable={!isAddModalVisible && !isActionModalVisible}
                accessible={true}
                style={[
                  styles.playlistChip, 
                  isActive && styles.playlistChipActive, 
                  isFocused && styles.playlistChipFocused
                ]}
              >
                <Text style={[
                  styles.playlistText, 
                  isActive && styles.playlistTextActive,
                  isFocused && styles.playlistTextFocused
                ]}>
                  {isCustom ? `★ ${pl.name}` : pl.name}
                </Text>
              </Pressable>
            );
          })}

          {/* Кнопка добавления пользовательского плейлиста */}
          <Pressable
            onPress={() => setAddModalVisible(true)}
            onFocus={() => {
              setFocusedPlaylistIdx(allPlaylists.length);
              setFocusedRegion('playlists');
            }}
            focusable={!isAddModalVisible && !isActionModalVisible}
            accessible={true}
            style={[
              styles.playlistChip,
              styles.addPlaylistChip,
              focusedRegion === 'playlists' && focusedPlaylistIdx === allPlaylists.length && styles.playlistChipFocused
            ]}
          >
            <Text style={[
              styles.playlistText,
              styles.addPlaylistText,
              focusedRegion === 'playlists' && focusedPlaylistIdx === allPlaylists.length && styles.playlistTextFocused
            ]}>
              + Плейлист
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.mainContent}>
        {/* Боковая колонка категорий */}
        <View style={styles.sidebar}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {categories.map((category, idx) => {
              const isSelected = selectedCategory === category;
              const isFocused = focusedRegion === 'categories' && focusedCategoryIdx === idx;
              return (
                <Pressable
                  key={category}
                  onPress={() => setSelectedCategory(category)}
                  onFocus={() => {
                    setFocusedCategoryIdx(idx);
                    setSelectedCategory(category);
                    setFocusedRegion('categories');
                  }}
                  focusable={!isAddModalVisible && !isActionModalVisible}
                  accessible={true}
                  style={[
                    styles.groupItem, 
                    isSelected && styles.groupItemActive, 
                    isFocused && styles.groupItemFocused
                  ]}
                >
                  <Text style={[
                    styles.groupText, 
                    isSelected && styles.groupTextActive,
                    isFocused && styles.groupTextFocused
                  ]}>
                    📁  {category}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Сетка/Список каналов */}
        <View style={styles.gridContainer}>
          {loading ? (
            <ActivityIndicator size="large" color="#0A84FF" style={styles.loader} />
          ) : (
            <FlatList
              key={viewMode} // Re-creates FlatList when viewMode changes to update columns
              data={filteredChannels}
              keyExtractor={(item, index) => item.id + index}
              numColumns={getNumColumns(viewMode)}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false} // Keeps views mounted so they remain reachable by spatial D-pad engine
              initialNumToRender={15}
              maxToRenderPerBatch={10}
              windowSize={3}
              contentContainerStyle={styles.channelsGrid}
              renderItem={({ item, index }) => {
                const cardStyle = getCardStyle(viewMode);
                const nameStyle = getNameStyle(viewMode);
                const isList = viewMode === 'list';

                const isFocused = focusedRegion === 'channels' && focusedChannelIdx === index;

                 return (
                  <Pressable
                    onPress={() => {
                      // Нажатие OK — всегда воспроизводим канал (сортировка — через кнопки ▲/▼ на экране плеера)
                      const playList = selectedCategory?.includes('Избранное') ? filteredChannels : channels;
                      const idx = playList.findIndex(c => c.id === item.id);
                      setActivePlayback(playList, idx >= 0 ? idx : 0);
                      navigation.navigate('Player', {
                        url: item.url,
                        title: item.name,
                        tvgId: item.tvgId,
                        channel: item,
                        initialFullscreen: false
                      });
                    }}
                    onLongPress={() => {
                      setSelectedChannel(item);
                      setSelectedChannelIdx(index);
                      setChannelModalVisible(true);
                    }}
                    onFocus={() => {
                      setFocusedChannelIdx(index);
                      setFocusedRegion('channels');
                    }}
                    focusable={!isAddModalVisible && !isActionModalVisible && !isChannelModalVisible}
                    accessible={true}
                    // Capture focus instantly on mount for the first channel card
                    hasTVPreferredFocus={isScreenFocused && index === 0 && focusedChannelIdx === 0}
                    style={[
                      cardStyle, 
                      isFocused && styles.channelCardFocused
                    ]}
                  >
                    <Text 
                      style={[
                        nameStyle, 
                        isFocused && styles.channelNameFocused
                      ]} 
                      numberOfLines={isList ? 1 : 2}
                    >
                      📺  {item.name}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </View>

    {/* Модальное окно добавления плейлиста */}
    {isAddModalVisible && (
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Добавить IPTV плейлист</Text>
          
          <Text style={styles.modalLabel}>Название плейлиста:</Text>
          <TextInput
            style={[
              styles.modalInput,
              isNameInputFocused && styles.modalInputFocused
            ]}
            placeholder="Например: Мой Плейлист"
            placeholderTextColor="#8E8E93"
            value={newPlName}
            onChangeText={setNewPlName}
            onFocus={() => setIsNameInputFocused(true)}
            onBlur={() => setIsNameInputFocused(false)}
            focusable={true}
          />

          <Text style={styles.modalLabel}>Ссылка на M3U плейлист:</Text>
          <TextInput
            style={[
              styles.modalInput,
              isUrlInputFocused && styles.modalInputFocused
            ]}
            placeholder="http://example.com/playlist.m3u"
            placeholderTextColor="#8E8E93"
            value={newPlUrl}
            onChangeText={setNewPlUrl}
            autoCapitalize="none"
            keyboardType="url"
            onFocus={() => setIsUrlInputFocused(true)}
            onBlur={() => setIsUrlInputFocused(false)}
            focusable={true}
          />

          <View style={styles.modalButtons}>
            <Pressable 
              style={[
                styles.modalBtnCancel,
                isModalCancelFocused && styles.modalBtnFocused
              ]} 
              hasTVPreferredFocus={true}
              onPress={() => {
                setAddModalVisible(false);
                setNewPlName('');
                setNewPlUrl('');
              }}
              onFocus={() => setIsModalCancelFocused(true)}
              onBlur={() => setIsModalCancelFocused(false)}
              focusable={true}
            >
              <Text style={[
                styles.modalBtnText,
                isModalCancelFocused && styles.modalBtnTextFocused
              ]}>
                Отмена
              </Text>
            </Pressable>

            <Pressable 
              style={[
                styles.modalBtnSave,
                isModalSaveFocused && styles.modalBtnFocused
              ]} 
              onPress={() => {
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
                setAddModalVisible(false);
                setNewPlName('');
                setNewPlUrl('');
                setActivePlaylistId(newId);
              }}
              onFocus={() => setIsModalSaveFocused(true)}
              onBlur={() => setIsModalSaveFocused(false)}
              focusable={true}
            >
              <Text style={[
                styles.modalBtnSaveText,
                isModalSaveFocused && styles.modalBtnTextFocused
              ]}>
                Сохранить
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    )}

    {/* Модальное окно управления плейлистом */}
    {isActionModalVisible && (
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { width: 500 }]}>
          <Text style={styles.modalTitle}>Управление плейлистом</Text>
          <Text style={{ color: '#8e8e93', fontSize: 16, textAlign: 'center', marginBottom: 24, fontWeight: '600' }}>
            {selectedActionPlaylist?.name}
          </Text>
          
          <View style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {/* Кнопка активации */}
            <Pressable 
              style={[
                styles.modalBtnSave,
                { width: '100%', alignItems: 'center', alignSelf: 'stretch', marginBottom: 16 },
                isActionSelectFocused && styles.modalBtnFocused
              ]} 
              onPress={() => {
                if (selectedActionPlaylist) {
                  setActivePlaylistId(selectedActionPlaylist.id);
                }
                setActionModalVisible(false);
              }}
              onFocus={() => setIsActionSelectFocused(true)}
              onBlur={() => setIsActionSelectFocused(false)}
              focusable={true}
              accessible={true}
              hasTVPreferredFocus={true}
            >
              <Text style={[
                styles.modalBtnSaveText,
                isActionSelectFocused && styles.modalBtnTextFocused
              ]}>
                Выбрать плейлист
              </Text>
            </Pressable>

            {/* Кнопка удаления */}
            <Pressable 
              style={[
                styles.modalBtnCancel,
                { backgroundColor: '#FF453A', width: '100%', alignItems: 'center', alignSelf: 'stretch', marginRight: 0, marginBottom: 16 },
                isActionDeleteFocused && styles.modalBtnFocused
              ]} 
              onPress={() => {
                if (selectedActionPlaylist) {
                  removeCustomPlaylist(selectedActionPlaylist.id);
                  if (activePlaylistId === selectedActionPlaylist.id) {
                    setActivePlaylistId(allPlaylists[0].id);
                  }
                }
                setActionModalVisible(false);
              }}
              onFocus={() => setIsActionDeleteFocused(true)}
              onBlur={() => setIsActionDeleteFocused(false)}
              focusable={true}
              accessible={true}
            >
              <Text style={[
                styles.modalBtnText,
                { color: '#ffffff' },
                isActionDeleteFocused && styles.modalBtnTextFocused
              ]}>
                Удалить плейлист
              </Text>
            </Pressable>

            {/* Кнопка отмены */}
            <Pressable 
              style={[
                styles.modalBtnCancel,
                { width: '100%', alignItems: 'center', alignSelf: 'stretch', marginRight: 0 },
                isActionCancelFocused && styles.modalBtnFocused
              ]} 
              onPress={() => {
                setActionModalVisible(false);
              }}
              onFocus={() => setIsActionCancelFocused(true)}
              onBlur={() => setIsActionCancelFocused(false)}
              focusable={true}
              accessible={true}
            >
              <Text style={[
                styles.modalBtnText,
                isActionCancelFocused && styles.modalBtnTextFocused
              ]}>
                Отмена
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    )}

    {/* Модальное окно управления каналом (в виде абсолютного View для стабильности пульта) */}
    {isChannelModalVisible && (
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { width: 500 }]}>
          <Text style={styles.modalTitle}>Управление каналом</Text>
          <Text style={{ color: '#ffffff', fontSize: 18, textAlign: 'center', marginBottom: 8, fontWeight: 'bold' }}>
            📺 {selectedChannel?.name}
          </Text>
          {selectedCategory?.includes('Избранное') && (
            <Text style={{ color: '#8e8e93', fontSize: 14, textAlign: 'center', marginBottom: 24, fontWeight: '600' }}>
              Позиция в Избранном: {selectedChannelIdx + 1} из {filteredChannels.length}
            </Text>
          )}
          
          <View style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {/* 1. Воспроизвести */}
            <Pressable 
              style={[
                styles.modalBtnSave,
                { width: '100%', alignItems: 'center', alignSelf: 'stretch', marginBottom: 16 },
                isChannelPlayFocused && styles.modalBtnFocused
              ]} 
              onPress={() => {
                setChannelModalVisible(false);
                if (selectedChannel) {
                  // Используем selectedChannel напрямую (индекс мог измениться после сортировки)
                  const playList = selectedCategory?.includes('Избранное') ? filteredChannels : channels;
                  const playIdx = playList.findIndex(c => c.id === selectedChannel.id);
                  setActivePlayback(playList, playIdx >= 0 ? playIdx : 0);
                  navigation.navigate('Player', {
                    url: selectedChannel.url,
                    title: selectedChannel.name,
                    tvgId: selectedChannel.tvgId,
                    channel: selectedChannel,
                    initialFullscreen: false
                  });
                }
              }}
              onFocus={() => setIsChannelPlayFocused(true)}
              onBlur={() => setIsChannelPlayFocused(false)}
              focusable={true}
              accessible={true}
              hasTVPreferredFocus={true}
            >
              <Text style={[
                styles.modalBtnSaveText,
                isChannelPlayFocused && styles.modalBtnTextFocused
              ]}>
                ▶ Воспроизвести
              </Text>
            </Pressable>

            {/* 2. Переместить вверх (только в Избранном) */}
            {selectedCategory === '⭐ Избранное' && (
              <Pressable 
                style={[
                  styles.modalBtnCancel,
                  { 
                    width: '100%', 
                    alignItems: 'center', 
                    alignSelf: 'stretch', 
                    marginRight: 0, 
                    marginBottom: 16,
                    opacity: selectedChannelIdx > 0 ? 1 : 0.4
                  },
                  isChannelUpFocused && styles.modalBtnFocused
                ]} 
                onPress={() => {
                  if (selectedChannel && selectedChannelIdx > 0) {
                    moveFavorite(selectedChannel.id, 'up');
                    setSelectedChannelIdx(prev => prev - 1);
                  }
                }}
                onFocus={() => setIsChannelUpFocused(true)}
                onBlur={() => setIsChannelUpFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={[
                  styles.modalBtnText,
                  isChannelUpFocused && styles.modalBtnTextFocused
                ]}>
                  ▲ Переместить вверх
                </Text>
              </Pressable>
            )}

            {/* 3. Переместить вниз (только в Избранном) */}
            {selectedCategory === '⭐ Избранное' && (
              <Pressable 
                style={[
                  styles.modalBtnCancel,
                  { 
                    width: '100%', 
                    alignItems: 'center', 
                    alignSelf: 'stretch', 
                    marginRight: 0, 
                    marginBottom: 16,
                    opacity: selectedChannelIdx < filteredChannels.length - 1 ? 1 : 0.4
                  },
                  isChannelDownFocused && styles.modalBtnFocused
                ]} 
                onPress={() => {
                  if (selectedChannel && selectedChannelIdx < filteredChannels.length - 1) {
                    moveFavorite(selectedChannel.id, 'down');
                    setSelectedChannelIdx(prev => prev + 1);
                  }
                }}
                onFocus={() => setIsChannelDownFocused(true)}
                onBlur={() => setIsChannelDownFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={[
                  styles.modalBtnText,
                  isChannelDownFocused && styles.modalBtnTextFocused
                ]}>
                  ▼ Переместить вниз
                </Text>
              </Pressable>
            )}

            {/* 4. Удалить / Добавить в Избранное */}
            {selectedChannel && (
              <Pressable 
                style={[
                  styles.modalBtnCancel,
                  { 
                    backgroundColor: favorites.some(f => f.id === selectedChannel.id) ? '#FF453A' : '#30D158',
                    width: '100%', 
                    alignItems: 'center', 
                    alignSelf: 'stretch', 
                    marginRight: 0, 
                    marginBottom: 16 
                  },
                  isChannelFavFocused && styles.modalBtnFocused
                ]} 
                onPress={() => {
                  if (selectedChannel) {
                    toggleFavorite(selectedChannel);
                  }
                  setChannelModalVisible(false);
                }}
                onFocus={() => setIsChannelFavFocused(true)}
                onBlur={() => setIsChannelFavFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={[
                  styles.modalBtnText,
                  { color: '#ffffff' },
                  isChannelFavFocused && styles.modalBtnTextFocused
                ]}>
                  {favorites.some(f => f.id === selectedChannel.id) ? '★ Удалить из Избранного' : '☆ Добавить в Избранное'}
                </Text>
              </Pressable>
            )}

            {/* 5. Экспорт избранного (только в Избранном) */}
            {selectedCategory?.includes('Избранное') && (
              <Pressable 
                style={[
                  styles.modalBtnCancel,
                  { 
                    width: '100%', 
                    alignItems: 'center', 
                    alignSelf: 'stretch', 
                    marginRight: 0, 
                    marginBottom: 16,
                    borderColor: 'rgba(10,132,255,0.4)'
                  },
                  isChannelExportFocused && styles.modalBtnFocused
                ]} 
                onPress={() => {
                  setChannelModalVisible(false);
                  handleExport();
                }}
                onFocus={() => setIsChannelExportFocused(true)}
                onBlur={() => setIsChannelExportFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={[
                  styles.modalBtnText,
                  { color: '#0A84FF' },
                  isChannelExportFocused && styles.modalBtnTextFocused
                ]}>
                  📤 Экспорт Избранного (m3u)
                </Text>
              </Pressable>
            )}

            {/* 6. Готово */}
            <Pressable 
              style={[
                styles.modalBtnCancel,
                { width: '100%', alignItems: 'center', alignSelf: 'stretch', marginRight: 0 },
                isChannelCancelFocused && styles.modalBtnFocused
              ]} 
              onPress={() => {
                setChannelModalVisible(false);
              }}
              onFocus={() => setIsChannelCancelFocused(true)}
              onBlur={() => setIsChannelCancelFocused(false)}
              focusable={true}
              accessible={true}
            >
              <Text style={[
                styles.modalBtnText,
                isChannelCancelFocused && styles.modalBtnTextFocused
              ]}>
                Готово
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    )}
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  logo: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0A84FF',
    marginRight: 16,
  },
  tvBadge: {
    fontSize: 10,
    color: '#FFD700',
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  viewModeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  viewModeBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  exportBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    marginRight: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  exportBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    marginRight: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  editBtnActive: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderColor: 'rgba(48, 209, 88, 0.3)',
  },
  editBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  viewModeBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewModeText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  viewModeTextFocused: {
    color: '#000000',
  },
  playlistsScrollView: {
    flex: 1,
    marginLeft: 8,
  },
  playlistsScroll: {
    alignItems: 'center',
  },
  playlistChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  playlistChipActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.2)',
    borderColor: '#0A84FF',
  },
  playlistChipFocused: {
    backgroundColor: '#ffffff',
    transform: [{ scale: 1.05 }],
  },
  playlistText: {
    color: '#8e8e93',
    fontSize: 13,
    fontWeight: '600',
  },
  playlistTextActive: {
    color: '#0A84FF',
  },
  playlistTextFocused: {
    color: '#000000',
  },
  mainContent: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 180,
    minWidth: 160,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 10,
  },
  groupItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 2,
    borderRadius: 8,
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  groupItemActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  groupItemFocused: {
    backgroundColor: '#ffffff',
    transform: [{ scale: 1.03 }],
  },
  groupText: {
    color: '#8e8e93',
    fontSize: 15,
    fontWeight: '600',
  },
  groupTextActive: {
    color: '#ffffff',
  },
  groupTextFocused: {
    color: '#000000',
  },
  gridContainer: {
    flex: 1,
    padding: 16,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelsGrid: {
    paddingBottom: 40,
  },
  
  // === СТИЛИ КАРТОЧЕК ДЛЯ РАЗНЫХ РЕЖИМОВ ===
  
  // 1. Обычные плитки (5 колонок)
  channelCardNormal: {
    width: '13%',
    aspectRatio: 1.35,
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    margin: 4,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  channelNameNormal: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: 'bold',
    lineHeight: 16,
    textAlign: 'center',
  },

  // 2. Маленькие плитки (7 колонок)
  channelCardSmall: {
    width: '9%',
    aspectRatio: 1.4,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    margin: 3,
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  channelNameSmall: {
    fontSize: 10,
    color: '#ffffff',
    fontWeight: 'bold',
    lineHeight: 12,
    textAlign: 'center',
  },

  // 3. Большие плитки (3 колонки)
  channelCardLarge: {
    width: '24%',
    aspectRatio: 1.3,
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    margin: 6,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  channelNameLarge: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: 'bold',
    lineHeight: 20,
    textAlign: 'center',
  },

  // 4. Классический список (одна колонка во всю ширину)
  channelCardList: {
    width: '96%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    marginHorizontal: 8,
    marginVertical: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  channelNameList: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: 'bold',
    marginLeft: 16,
    flex: 1,
  },

  channelCardFocused: {
    backgroundColor: '#ffffff',
    transform: [{ scale: 1.05 }],
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
    borderColor: '#ffffff',
  },
  cardHeader: {
    alignItems: 'flex-start',
  },
  cardHeaderList: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelNameFocused: {
    color: '#000000',
  },
  
  // === СТИЛИ ДОБАВЛЕНИЯ ПЛЕЙЛИСТА И МОДАЛЬНОГО ОКНА ===
  addPlaylistChip: {
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    borderColor: 'rgba(10, 132, 255, 0.3)',
    borderStyle: 'dashed',
    borderWidth: 1.5,
  },
  addPlaylistText: {
    color: '#0A84FF',
  },
  modalOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  modalContent: {
    width: 600,
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 24,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8e8e93',
    marginBottom: 8,
    marginTop: 16,
    textTransform: 'uppercase',
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalInputFocused: {
    borderColor: '#0A84FF',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 32,
  },
  modalBtnCancel: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginRight: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  modalBtnSave: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#0A84FF',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  modalBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    transform: [{ scale: 1.05 }],
  },
  modalBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalBtnSaveText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalBtnTextFocused: {
    color: '#000000',
  },
});
