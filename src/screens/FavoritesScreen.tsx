import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, FlatList, useWindowDimensions, Pressable } from 'react-native';
import { useStore } from '../store/useStore';
import { ChannelCard } from '../components/ChannelCard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Channel, isAdultContent } from '../utils/m3uParser';

export const FavoritesScreen = ({ navigation }: any) => {
  const { favorites, toggleFavorite, moveFavorite, setActivePlayback } = useStore();
  
  const cleanFavorites = React.useMemo(() => {
    return favorites.filter(ch => !isAdultContent(ch.name || '', ch.group || ''));
  }, [favorites]);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // States for management modal
  const [selectedChannel, setSelectedChannel] = React.useState<Channel | null>(null);
  const [selectedChannelIdx, setSelectedChannelIdx] = React.useState<number>(-1);
  const [isMenuVisible, setMenuVisible] = React.useState(false);
  const [isEditMode, setEditMode] = React.useState(false);

  // States for focus styles (TV/remote compatibility)
  const [isPlayFocused, setIsPlayFocused] = React.useState(false);
  const [isUpFocused, setIsUpFocused] = React.useState(false);
  const [isDownFocused, setIsDownFocused] = React.useState(false);
  const [isFavFocused, setIsFavFocused] = React.useState(false);
  const [isCancelFocused, setIsCancelFocused] = React.useState(false);

  const handleExport = async () => {
    if (cleanFavorites.length === 0) {
      Alert.alert('Ошибка', 'Нет каналов для экспорта');
      return;
    }

    try {
      let content = '#EXTM3U\n';
      cleanFavorites.forEach(ch => {
        content += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.group}",${ch.name}\n${ch.url}\n`;
      });
      
      // @ts-ignore
      const fileUri = FileSystem.documentDirectory + 'favorites.m3u';
      // @ts-ignore
      await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });
      
      // @ts-ignore
      if (await Sharing.isAvailableAsync()) {
        // @ts-ignore
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Избранное</Text>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity 
            style={[styles.editBtn, isEditMode && styles.editBtnActive]} 
            onPress={() => setEditMode(!isEditMode)}
          >
            <Text style={[styles.editText, isEditMode && styles.editTextActive]}>
              {isEditMode ? 'Готово' : 'Сортировка'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
            <Text style={styles.exportText}>Экспорт m3u</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.instructions}>
        <Text style={styles.instText}>
          {isEditMode 
            ? 'Выберите канал для перемещения или удаления' 
            : 'Зажмите канал для управления (сортировка, удаление)'}
        </Text>
      </View>

      {cleanFavorites.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>У вас пока нет избранных каналов.</Text>
          <Text style={styles.subText}>Нажмите на звёздочку на карточке канала.</Text>
        </View>
      ) : (
        <FlatList
          data={cleanFavorites}
          key={isLandscape ? 'favorites-landscape-5' : 'favorites-portrait-3'}
          keyExtractor={(item) => item.id}
          numColumns={isLandscape ? 5 : 3}
          removeClippedSubviews={false}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <ChannelCard
              channel={item}
              isFavorite={true}
              onToggleFavorite={() => toggleFavorite(item)}
              onPress={() => {
                if (isEditMode) {
                  setSelectedChannel(item);
                  setSelectedChannelIdx(index);
                  setMenuVisible(true);
                } else {
                  const idx = favorites.findIndex(c => c.id === item.id);
                  setActivePlayback(favorites, idx >= 0 ? idx : 0);
                  navigation.navigate('Player', { url: item.url, title: item.name, tvgId: item.tvgId, channel: item, initialFullscreen: false });
                }
              }}
              onLongPress={() => {
                setSelectedChannel(item);
                setSelectedChannelIdx(index);
                setMenuVisible(true);
              }}
              showFavoriteButton={true}
              focusable={!isMenuVisible}
            />
          )}
        />
      )}

      {/* Модальное меню управления каналом в Избранном */}
      {isMenuVisible && selectedChannel && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Управление каналом</Text>
            <Text style={styles.modalChannelName}>
              📺 {selectedChannel.name}
            </Text>
            <Text style={styles.modalChannelInfo}>
              Позиция в Избранном: {selectedChannelIdx + 1} из {cleanFavorites.length}
            </Text>

            <View style={styles.modalButtonsContainer}>
              {/* 1. Воспроизвести */}
              <Pressable
                style={[
                  styles.modalBtn,
                  styles.modalBtnPlay,
                  isPlayFocused && styles.modalBtnFocused
                ]}
                onPress={() => {
                  setMenuVisible(false);
                  const idx = favorites.findIndex(c => c.id === selectedChannel.id);
                  setActivePlayback(favorites, idx >= 0 ? idx : 0);
                  navigation.navigate('Player', { url: selectedChannel.url, title: selectedChannel.name, tvgId: selectedChannel.tvgId, channel: selectedChannel, initialFullscreen: false });
                }}
                onFocus={() => setIsPlayFocused(true)}
                onBlur={() => setIsPlayFocused(false)}
                focusable={true}
                accessible={true}
                hasTVPreferredFocus={true}
              >
                <Text style={[styles.modalBtnText, styles.modalBtnTextPlay]}>
                  ▶ Воспроизвести
                </Text>
              </Pressable>

              {/* 2. Переместить выше */}
              <Pressable
                style={[
                  styles.modalBtn,
                  styles.modalBtnAction,
                  selectedChannelIdx === 0 && { opacity: 0.3 },
                  isUpFocused && styles.modalBtnFocused
                ]}
                onPress={() => {
                  if (selectedChannelIdx > 0) {
                    moveFavorite(selectedChannel.id, 'up');
                    setSelectedChannelIdx(prev => prev - 1);
                  }
                }}
                onFocus={() => setIsUpFocused(true)}
                onBlur={() => setIsUpFocused(false)}
                focusable={selectedChannelIdx > 0}
                accessible={true}
              >
                <Text style={styles.modalBtnText}>▲ Переместить выше</Text>
              </Pressable>

              {/* 3. Переместить ниже */}
              <Pressable
                style={[
                  styles.modalBtn,
                  styles.modalBtnAction,
                  selectedChannelIdx === cleanFavorites.length - 1 && { opacity: 0.3 },
                  isDownFocused && styles.modalBtnFocused
                ]}
                onPress={() => {
                  if (selectedChannelIdx < cleanFavorites.length - 1) {
                    moveFavorite(selectedChannel.id, 'down');
                    setSelectedChannelIdx(prev => prev + 1);
                  }
                }}
                onFocus={() => setIsDownFocused(true)}
                onBlur={() => setIsDownFocused(false)}
                focusable={selectedChannelIdx < cleanFavorites.length - 1}
                accessible={true}
              >
                <Text style={styles.modalBtnText}>▼ Переместить ниже</Text>
              </Pressable>

              {/* 4. Удалить из избранного */}
              <Pressable
                style={[
                  styles.modalBtn,
                  styles.modalBtnDelete,
                  isFavFocused && styles.modalBtnFocused
                ]}
                onPress={() => {
                  toggleFavorite(selectedChannel);
                  setMenuVisible(false);
                }}
                onFocus={() => setIsFavFocused(true)}
                onBlur={() => setIsFavFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={[styles.modalBtnText, { color: '#ffffff' }]}>
                  ★ Удалить из Избранного
                </Text>
              </Pressable>

              {/* 5. Отмена */}
              <Pressable
                style={[
                  styles.modalBtn,
                  styles.modalBtnCancel,
                  isCancelFocused && styles.modalBtnFocused
                ]}
                onPress={() => {
                  setMenuVisible(false);
                }}
                onFocus={() => setIsCancelFocused(true)}
                onBlur={() => setIsCancelFocused(false)}
                focusable={true}
                accessible={true}
              >
                <Text style={styles.modalBtnText}>Отмена</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    padding: 12,
    paddingTop: 50,
    backgroundColor: '#1c1c1e',
    borderBottomWidth: 1,
    borderBottomColor: '#3a3a3c',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  exportBtn: {
    backgroundColor: 'rgba(10, 132, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#0A84FF',
  },
  editBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginRight: 10,
  },
  editBtnActive: {
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
    borderColor: '#30D158',
  },
  editText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  editTextActive: {
    color: '#30D158',
  },
  exportText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  instructions: {
    padding: 6,
    alignItems: 'center',
    backgroundColor: '#111',
  },
  instText: {
    color: '#8E8E93',
    fontSize: 11,
  },
  list: {
    padding: 6,
    paddingBottom: 30,
  },
  dragItem: {
    marginBottom: 4,
    width: '100%',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subText: {
    color: '#8E8E93',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
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
    width: 360,
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#2c2c2e',
    alignItems: 'center',
  },
  modalTitle: {
    color: '#8e8e93',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalChannelName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalChannelInfo: {
    color: '#8e8e93',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalButtonsContainer: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  modalBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  modalBtnPlay: {
    backgroundColor: '#0A84FF',
  },
  modalBtnAction: {
    backgroundColor: '#2c2c2e',
  },
  modalBtnDelete: {
    backgroundColor: '#FF453A',
  },
  modalBtnCancel: {
    backgroundColor: '#1c1c1e',
    borderWidth: 1.5,
    borderColor: '#3a3a3c',
    marginBottom: 0,
  },
  modalBtnFocused: {
    borderColor: '#ffffff',
    transform: [{ scale: 1.03 }],
  },
  modalBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  modalBtnTextPlay: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
