const fs = require('fs');
const file = 'e:\\app.new_backup\\src\\tv\\TVHomeScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

const target = `          {loading ? (
            <ActivityIndicator size="large" color="#0A84FF" style={styles.loader} />
          ) : (
            <FlatList`;

const replacement = `          {loading ? (
            <ActivityIndicator size="large" color="#0A84FF" style={styles.loader} />
          ) : Platform.OS === 'web' ? (
            <ScrollView 
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.channelsGrid, { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' }]}
            >
              {filteredChannels.map((item, index) => {
                const cardStyle = getCardStyle(viewMode);
                const nameStyle = getNameStyle(viewMode);
                const isList = viewMode === 'list';
                const isFocused = focusedRegion === 'channels' && focusedChannelIdx === index;
                return (
                  <Pressable
                    key={item.id + '-' + index}
                    onPress={() => {
                      const playList = selectedCategory?.includes('Избранное') ? filteredChannels : channels;
                      const idx = playList.findIndex(c => c.id === item.id);
                      setActivePlayback(playList, idx >= 0 ? idx : 0);
                      navigation.navigate('Player', { url: item.url, title: item.name, tvgId: item.tvgId, channel: item, initialFullscreen: false });
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
                    // @ts-ignore
                    className="focusable"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.keyCode === 13) {
                        e.preventDefault();
                        const playList = selectedCategory?.includes('Избранное') ? filteredChannels : channels;
                        const idx = playList.findIndex(c => c.id === item.id);
                        setActivePlayback(playList, idx >= 0 ? idx : 0);
                        navigation.navigate('Player', { url: item.url, title: item.name, tvgId: item.tvgId, channel: item, initialFullscreen: false });
                      }
                    }}
                    hasTVPreferredFocus={isScreenFocused && index === 0 && focusedChannelIdx === 0}
                    style={(state) => [
                      cardStyle, 
                      (isFocused || state.focused) && styles.channelCardFocused,
                      { margin: 4 }
                    ]}
                  >
                    {(state) => (
                      <Text 
                        style={[nameStyle, (isFocused || state.focused) && styles.channelNameFocused]} 
                        numberOfLines={isList ? 1 : 2}
                      >
                      📺  {item.name}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <FlatList`;

content = content.replace(target, replacement);

fs.writeFileSync(file, content);
console.log('Done replacing!');
