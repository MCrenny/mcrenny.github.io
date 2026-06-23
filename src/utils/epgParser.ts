export interface EpgProgram {
  id: string;
  title: string;
  desc?: string;
  start: Date;
  stop: Date;
  channelId: string;
}

// Simple XMLTV parser to extract programs for a specific channel
export const parseEpgForChannel = (xmlContent: string, channelIds: string[]): EpgProgram[] => {
  const programs: EpgProgram[] = [];
  
  // Filter out empty/undefined IDs and normalize
  const validIds = channelIds.filter(Boolean).map(id => id.toLowerCase().trim());
  if (validIds.length === 0) return [];
  
  // 1. First, find all matching channel IDs from the <channel> blocks by display-name or id
  const targetChannelIds = new Set<string>();
  
  // If they directly match the ID, add them
  validIds.forEach(id => targetChannelIds.add(id));
  
  // Look through <channel> blocks to map display-name to id
  const channelRegex = /<channel id=["']([^"']+)["']>(.*?)<\/channel>/gs;
  let channelMatch;
  while ((channelMatch = channelRegex.exec(xmlContent)) !== null) {
    const id = channelMatch[1];
    const inner = channelMatch[2];
    
    // Check if the id itself matches (case-insensitive)
    if (validIds.includes(id.toLowerCase())) {
      targetChannelIds.add(id);
      continue;
    }
    
    // Extract display-names
    const nameRegex = /<display-name[^>]*>(.*?)<\/display-name>/gs;
    let nameMatch;
    while ((nameMatch = nameRegex.exec(inner)) !== null) {
      const name = nameMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim().toLowerCase();
      if (validIds.includes(name)) {
        targetChannelIds.add(id);
      }
    }
  }
  
  if (targetChannelIds.size === 0) return [];
  
  // 2. Now extract programmes for the matched channel IDs
  const idPattern = Array.from(targetChannelIds).map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`<programme[^>]*channel=["'](${idPattern})["'][^>]*>(.*?)</programme>`, 'gs');
  
  let match;
  while ((match = regex.exec(xmlContent)) !== null) {
    const block = match[0];
    const matchedChannelId = match[1];
    const innerContent = match[2];
    
    const startMatch = block.match(/start=["']([^"']+)["']/);
    const stopMatch = block.match(/stop=["']([^"']+)["']/);
    
    if (startMatch && stopMatch) {
      const startStr = startMatch[1];
      const stopStr = stopMatch[1];
      
      const titleMatch = innerContent.match(/<title[^>]*>(.*?)<\/title>/s);
      const descMatch = innerContent.match(/<desc[^>]*>(.*?)<\/desc>/s);
      
      const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : 'Unknown';
      const desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      
      const parseDate = (str: string) => {
        const year = parseInt(str.substring(0, 4));
        const month = parseInt(str.substring(4, 6)) - 1;
        const day = parseInt(str.substring(6, 8));
        const hour = parseInt(str.substring(8, 10));
        const min = parseInt(str.substring(10, 12));
        const sec = parseInt(str.substring(12, 14));
        return new Date(year, month, day, hour, min, sec);
      };
      
      programs.push({
        id: Math.random().toString(36).substring(2, 9),
        title,
        desc,
        start: parseDate(startStr),
        stop: parseDate(stopStr),
        channelId: matchedChannelId
      });
    }
  }
  
  return programs.sort((a, b) => a.start.getTime() - b.start.getTime());
};

export const fetchEpgForChannel = async (epgUrl: string, channelIds: string[]): Promise<EpgProgram[]> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(epgUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return parseEpgForChannel(text, channelIds);
  } catch (error) {
    console.error('[EPG Parser] Error fetching or parsing EPG:', error);
    return [];
  }
};
