const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyManager {
  constructor() {
    this.cachedAgent = null;
    this.cachedProxy = null;
    this.sources = [
      'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
      'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
      'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt'
    ];
  }

  clearCache() {
    if (this.cachedProxy) {
      console.log(`[ProxyManager] Сброс прокси ${this.cachedProxy} (вероятно, перестал отвечать)`);
    }
    this.cachedAgent = null;
    this.cachedProxy = null;
  }

  async fetchProxies() {
    let proxies = [];
    for (const source of this.sources) {
      try {
        const res = await axios.get(source, { timeout: 10000 });
        const list = res.data.split('\n').map(p => p.trim()).filter(p => p.length > 5 && p.includes(':'));
        proxies = proxies.concat(list);
      } catch (err) {
        console.log(`[ProxyManager] Ошибка загрузки прокси с ${source}: ${err.message}`);
      }
    }
    // Удаляем дубликаты
    proxies = [...new Set(proxies)];
    // Перемешиваем
    proxies = proxies.sort(() => 0.5 - Math.random());
    return proxies;
  }

  async getWorkingProxy(forceRefresh = false) {
    if (forceRefresh) this.clearCache();
    
    if (this.cachedAgent) {
      console.log(`[ProxyManager] Используем кэшированный прокси: ${this.cachedProxy}`);
      return this.cachedAgent;
    }

    console.log(`[ProxyManager] Ищем новый рабочий прокси...`);
    const proxies = await this.fetchProxies();
    console.log(`[ProxyManager] Загружено ${proxies.length} потенциальных прокси.`);

    // Берем первые 30 для быстрой проверки (чтобы не ждать слишком долго)
    const testList = proxies.slice(0, 30);
    
    for (const proxy of testList) {
      const proxyUrl = `http://${proxy}`;
      const agent = new HttpsProxyAgent(proxyUrl);
      
      try {
        // Делаем легкий запрос к YouTube для проверки работоспособности HTTPS
        // Тайм-аут 3 секунды, нам нужны только быстрые прокси
        await axios.get('https://www.youtube.com', {
          httpsAgent: agent,
          timeout: 3000,
          validateStatus: () => true // Любой ответ от сервера (даже 404) означает, что прокси работает
        });
        
        console.log(`[ProxyManager] ✅ Найден рабочий прокси: ${proxy}`);
        this.cachedProxy = proxy;
        this.cachedAgent = agent;
        return agent;
      } catch (e) {
        // Прокси не работает (таймаут или ошибка сети), идем дальше
      }
    }

    console.log(`[ProxyManager] ❌ Не удалось найти рабочий прокси из 30 вариантов.`);
    return null;
  }
}

const proxyManager = new ProxyManager();
module.exports = proxyManager;
