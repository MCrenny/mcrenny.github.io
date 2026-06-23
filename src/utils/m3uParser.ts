export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  tvgId?: string;
  tvgName?: string;
  isFavorite?: boolean;
  catchup?: string;
  catchupDays?: number;
  catchupSource?: string;
  headers?: {
    'User-Agent'?: string;
    'Referer'?: string;
  };
}

export interface ChannelGroup {
  id: string;
  baseName: string;
  logo: string;
  group: string;
  variants: Channel[];
}

export const getBaseChannelName = (name: string): string => {
  return name
    .replace(/\b([0-9]{3,4}p|HD|SD|FHD|4K|UHD)\b/gi, '')
    .replace(/\(\+[0-9]+\)/g, '')
    .replace(/\+[0-9]+/g, '')
    .replace(/\(мск\)/gi, '')
    .replace(/\[.+?\]/g, '')
    .trim()
    .replace(/\s{2,}/g, ' ');
};

export const groupChannels = (channels: Channel[]): ChannelGroup[] => {
  const map = new Map<string, ChannelGroup>();
  
  channels.forEach(ch => {
    const baseName = getBaseChannelName(ch.name);
    const key = baseName.toLowerCase();
    
    if (!map.has(key)) {
      map.set(key, {
        id: 'group-' + Math.random().toString(36).substring(2, 11),
        baseName: baseName,
        logo: ch.logo,
        group: ch.group,
        variants: []
      });
    }
    
    const group = map.get(key)!;
    if (!group.logo && ch.logo) {
      group.logo = ch.logo;
    }
    group.variants.push(ch);
  });
  
  return Array.from(map.values());
};

export const isAdultContent = (name: string, group: string): boolean => {
  const normName = name.toLowerCase();
  const normGroup = group.toLowerCase();

  // 1. Group keywords: '18+', 'xxx', 'adult', 'erotic', 'эротик', 'взросл', 'porn', 'sex', 'ночные', 'ночной клуб', 'эротика'
  const adultGroupRegex = /18\+|xxx|adult|erotic|эротик|взросл|porn|sex|ночные|ночной/i;
  if (adultGroupRegex.test(normGroup)) {
    return true;
  }

  // 2. Channel name keywords
  const adultNameKeywords = [
    '18+',
    'xxx',
    'hustler',
    'playboy',
    'penthouse',
    'brazzers',
    'private tv',
    'dorcel',
    'redlight',
    'o-la-la',
    'oлала',
    'русская ночь',
    'ночной клуб',
    'эротик',
    'erotic',
    'pornhub',
    'sex'
  ];

  if (adultNameKeywords.some(keyword => normName.includes(keyword))) {
    return true;
  }

  // Standalone 'adult' check to avoid matching 'Adult Contemporary'
  if (/\badult\b/i.test(normName) && !/contemporary|pop|music/i.test(normName)) {
    return true;
  }

  return false;
};

export const parseM3U = (content: string): { channels: Channel[], tvgUrl?: string } => {
  const lines = content.split('\n');
  const channels: Channel[] = [];
  let currentChannel: Partial<Channel> | null = null;
  let tvgUrl: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    if (line.startsWith('#EXTM3U')) {
      const urlMatch = line.match(/x-tvg-url="([^"]+)"/);
      if (urlMatch) {
        tvgUrl = urlMatch[1];
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const tvgIdMatch = line.match(/tvg-id="([^"]+)"/);
      const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
      const logoMatch = line.match(/tvg-logo="([^"]+)"/);
      const groupMatch = line.match(/group-title="([^"]+)"/);
      const userAgentMatch = line.match(/http-user-agent="([^"]+)"/);
      const catchupMatch = line.match(/catchup="([^"]+)"/);
      const catchupDaysMatch = line.match(/catchup-days="([^"]+)"/);
      const catchupSourceMatch = line.match(/catchup-source="([^"]+)"/);
      const tvgRecMatch = line.match(/tvg-rec="([^"]+)"/);
      
      const nameMatch = line.split(',').pop();

      currentChannel = {
        id: '',  // будет установлен стабильный id при получении URL
        name: nameMatch ? nameMatch.trim() : 'Unknown Channel',
        tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
        tvgName: tvgNameMatch ? tvgNameMatch[1] : undefined,
        logo: logoMatch ? logoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        catchup: catchupMatch ? catchupMatch[1] : (tvgRecMatch ? 'append' : undefined),
        catchupDays: catchupDaysMatch ? parseInt(catchupDaysMatch[1], 10) : undefined,
        catchupSource: catchupSourceMatch ? catchupSourceMatch[1] : undefined,
        headers: userAgentMatch ? { 'User-Agent': userAgentMatch[1] } : undefined
      };
    } else if (line.startsWith('#EXTGRP:')) {
      if (currentChannel) {
        currentChannel.group = line.replace('#EXTGRP:', '').trim();
      }
    } else if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      if (currentChannel) {
        const uaMatch = line.match(/http-user-agent=(.+)/);
        if (uaMatch) {
          const ua = uaMatch[1].replace(/^["'](.*)["']$/, '$1');
          currentChannel.headers = { ...currentChannel.headers, 'User-Agent': ua };
        }
      }
    } else if (line.startsWith('http')) {
      if (currentChannel) {
        currentChannel.url = line;
        // Генерируем стабильный id на основе URL канала (детерминированный хэш)
        // Это гарантирует, что избранное сохраняется между перезагрузками плейлиста
        let hash = 0;
        for (let ci = 0; ci < line.length; ci++) {
          const chr = line.charCodeAt(ci);
          hash = ((hash << 5) - hash) + chr;
          hash |= 0;
        }
        currentChannel.id = 'ch_' + Math.abs(hash).toString(36);
        
        // Filter out adult content
        if (!isAdultContent(currentChannel.name || '', currentChannel.group || '')) {
          channels.push(currentChannel as Channel);
        }
        
        currentChannel = null;
      }
    }
  }

  return { channels, tvgUrl };
};
