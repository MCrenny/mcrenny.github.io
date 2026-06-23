import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, TouchableHighlight, Pressable, StyleSheet, Linking, Alert, ActivityIndicator, Modal, Platform } from 'react-native';
import { useStore } from '../store/useStore';
import { LinearGradient } from 'expo-linear-gradient';

// Замените на реальную ссылку вашего бота
const TELEGRAM_BOT_URL = 'https://t.me/StreameLumeBot'; 

export const AuthScreen = () => {
  const { setAuthorized, setActivationKey, startTrial, setFreeMode, trialStartDate } = useStore();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [telegramModalVisible, setTelegramModalVisible] = useState(false);

  const trialDuration = 3 * 24 * 60 * 60 * 1000; // 3 days
  const isTrialExpired = trialStartDate && (Date.now() - trialStartDate > trialDuration);

  const handleActivate = async () => {
    if (!key.trim()) {
      Alert.alert('Ошибка', 'Пожалуйста, введите ключ доступа');
      return;
    }

    setLoading(true);

    try {
      const API_URL = 'https://iptvpay-svmorozoww.amvera.io'; 
      
      const response = await fetch(`${API_URL}/api/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: key.trim() }),
      });

      const data = await response.json();

      if (data.valid) {
        setActivationKey(key.trim());
        setAuthorized(true);
        setFreeMode(false);
      } else {
        Alert.alert('Ошибка', data.message || 'Неверный или неактивный ключ');
      }
    } catch (error) {
      console.error('API Error:', error);
      Alert.alert('Ошибка соединения', 'Не удалось связаться с сервером. Убедитесь, что backend запущен.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTelegram = () => {
    if (Platform.OS === 'web' || Platform.isTV) {
      setTelegramModalVisible(true);
    } else {
      Linking.openURL(TELEGRAM_BOT_URL).catch(() => {
        Alert.alert('Ошибка', 'Не удалось открыть Telegram');
      });
    }
  };

  const handleOpenTelegramForKey = () => {
    if (Platform.OS === 'web' || Platform.isTV) {
      setTelegramModalVisible(true);
    } else {
      Linking.openURL(TELEGRAM_BOT_URL).catch(() => {
        Alert.alert('Ошибка', 'Не удалось открыть Telegram');
      });
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1c1c1e', '#000000']} style={styles.background} />
      
      <View style={styles.content}>
        <Text style={styles.title}>StreamLume</Text>
        <Text style={styles.subtitle}>
          Премиальное IPTV нового поколения. Введите ваш ключ или получите пробный доступ на 3 дня бесплатно через Telegram-бот.
        </Text>
        
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Ваш ключ (например: VIP-12345)"
            placeholderTextColor="#8E8E93"
            value={key}
            onChangeText={setKey}
            autoCapitalize="characters"
          />
        </View>

        <Pressable 
          style={(state: any) => [
            styles.activateBtn, 
            state.focused && styles.activateBtnFocused
          ]} 
          onPress={handleActivate}
          disabled={loading}
          focusable={true}
          accessible={true}
        >
          {(state: any) => loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={[styles.activateText, state.focused && styles.activateTextFocused]}>Войти</Text>
          )}
        </Pressable>

        <View style={styles.dividerContainer}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>или</Text>
          <View style={styles.divider} />
        </View>

        <Pressable 
          style={(state: any) => [
            styles.telegramBtn, 
            state.focused && styles.telegramBtnFocused
          ]} 
          onPress={handleOpenTelegramForKey}
          focusable={true}
          accessible={true}
        >
          {(state: any) => (
            <Text style={[styles.telegramText, state.focused && styles.telegramTextFocused]}>
              🎁 Получить бесплатный ключ (3 дня)
            </Text>
          )}
        </Pressable>

        <Text style={{ color: '#636366', fontSize: 12, marginTop: 15, textAlign: 'center' }}>
          После пробного периода — от 49 ₽/мес
        </Text>
      </View>

      <Modal
        animationType="fade"
        transparent={true}
        visible={telegramModalVisible}
        onRequestClose={() => setTelegramModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Получить ключ 🔑</Text>
            <Text style={styles.modalText}>
              Откройте Telegram на вашем телефоне и найдите бота:
            </Text>
            <Text style={styles.modalBotName}>@StreameLumeBot</Text>
            <Text style={styles.modalText}>
              В боте нажмите «Старт», чтобы получить бесплатный доступ на 3 дня.
            </Text>
            <Pressable 
              style={(state: any) => [styles.modalCloseBtn, state.focused && styles.modalCloseBtnFocused]}
              onPress={() => setTelegramModalVisible(false)}
              focusable={true}
              accessible={true}
            >
              {(state: any) => (
                <Text style={[styles.modalCloseText, state.focused && styles.modalCloseTextFocused]}>Понятно</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#0A84FF',
    marginBottom: 10,
    textShadowColor: 'rgba(10, 132, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  inputContainer: {
    width: '100%',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#2c2c2e',
    color: '#fff',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    textAlign: 'center',
  },
  activateBtn: {
    backgroundColor: '#0A84FF',
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#0A84FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  activateText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 30,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#3a3a3c',
  },
  dividerText: {
    color: '#8E8E93',
    paddingHorizontal: 15,
  },
  telegramBtn: {
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#0A84FF',
  },
  telegramText: {
    color: '#0A84FF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  activateBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    borderWidth: 2,
    transform: [{ scale: 1.05 }],
    shadowColor: '#0A84FF',
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 8,
  },
  activateTextFocused: {
    color: '#000000',
  },
  telegramBtnFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    borderWidth: 2,
    transform: [{ scale: 1.05 }],
  },
  telegramTextFocused: {
    color: '#000000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1c1c1e',
    padding: 30,
    borderRadius: 20,
    width: '80%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  modalText: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 24,
  },
  modalBotName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0A84FF',
    marginVertical: 15,
  },
  modalCloseBtn: {
    marginTop: 20,
    backgroundColor: '#2c2c2e',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  modalCloseBtnFocused: {
    backgroundColor: '#ffffff',
    transform: [{ scale: 1.05 }],
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalCloseTextFocused: {
    color: '#000',
  }
});
