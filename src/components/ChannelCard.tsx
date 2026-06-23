import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Pressable } from 'react-native';
import { Channel } from '../utils/m3uParser';

interface Props {
  channel: Channel;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  fullWidth?: boolean;
  onLongPress?: () => void;
  variantsCount?: number;
  showFavoriteButton?: boolean;
  focusable?: boolean;
}

export const ChannelCard: React.FC<Props> = ({ channel, isFavorite, onPress, onToggleFavorite, fullWidth, onLongPress, variantsCount, showFavoriteButton, focusable = true }) => {
  return (
    <Pressable 
      onPress={onPress} 
      onLongPress={onLongPress}
      focusable={focusable}
      accessible={true}
      style={(state: any) => [
        styles.container, 
        fullWidth && styles.fullWidthContainer,
        state.focused && styles.containerFocused
      ]}
    >
      {(state: any) => (
        <View
          style={[
            styles.card, 
            state.focused ? { borderColor: '#ffffff', borderWidth: 2, backgroundColor: '#ffffff' } : { borderColor: '#2c2c2e', borderWidth: 1.5, backgroundColor: '#1c1c1e' }
          ]}
        >
          <View style={[styles.imageContainer, { backgroundColor: state.focused ? 'transparent' : '#050505' }]}>
            {channel.logo ? (
              <Image source={{ uri: channel.logo }} style={styles.logo} resizeMode="contain" />
            ) : (
              <Text style={[styles.noLogoText, state.focused && { color: '#000000' }]}>{channel.name.charAt(0)}</Text>
            )}
          </View>
          <View style={[styles.infoContainer, { backgroundColor: 'transparent' }]}>
            <Text style={[styles.name, state.focused ? { color: '#000000', fontWeight: 'bold' } : { color: '#ffffff' }]} numberOfLines={1}>{channel.name}</Text>
            <Text style={[styles.category, state.focused ? { color: '#333333' } : { color: '#8E8E93' }]} numberOfLines={1}>{channel.group}</Text>
          </View>
          {showFavoriteButton && (
            <TouchableOpacity style={styles.favoriteBtn} onPress={onToggleFavorite}>
              <Text style={{ fontSize: 22, color: isFavorite ? '#FFD700' : 'rgba(255,255,255,0.3)' }}>
                {isFavorite ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
          )}

          {variantsCount !== undefined && variantsCount > 1 && (
            <View style={styles.variantsBadge}>
              <Text style={styles.variantsText}>{variantsCount} вар.</Text>
            </View>
          )}


        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    margin: 3,
    borderRadius: 10,
    backgroundColor: '#1c1c1e', // Обязательно для корректной нативной подсветки подложки TouchableHighlight
    shadowColor: '#0A84FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  containerFocused: {
    transform: [{ scale: 1.06 }],
    shadowColor: '#0A84FF',
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 10,
  },
  fullWidthContainer: {
    maxWidth: '100%',
  },
  card: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#2c2c2e',
  },
  cardFocused: {
    borderColor: '#ffffff',
    borderWidth: 2,
  },
  imageContainer: {
    height: 55,
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  noLogoText: {
    fontSize: 24,
    color: '#0A84FF',
    fontWeight: 'bold',
  },
  infoContainer: {
    padding: 6,
    backgroundColor: 'rgba(20,20,20,0.9)',
  },
  name: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  category: {
    color: '#8E8E93',
    fontSize: 9,
    marginTop: 1,
  },
  favoriteBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },

  variantsBadge: {
    position: 'absolute',
    top: 3,
    left: 3,
    backgroundColor: '#0A84FF',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  variantsText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  }
});
