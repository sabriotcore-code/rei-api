/**
 * Collections Cache Service
 * Implements caching for expensive operations in the real estate collections analysis system
 */

const crypto = require('crypto');
const { CACHE_TTL, CACHE_PREFIXES, cacheManager } = require('../config/cacheConfig');

class CollectionsCache {
  constructor() {
    this.cache = cacheManager;
  }

  /**
   * Generate a hash key for complex objects to ensure consistent caching
   * @param {Object} data - Data to hash
   * @returns {string} - Hash key
   */
  generateHashKey(data) {
    const stringified = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('md5').update(stringified).digest('hex');
  }

  /**
   * Cache PME Master sheet data
   */
  async cachePMEData(key, data, customTTL = null) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.PME, key);
      const ttl = customTTL || CACHE_TTL.PME_DATA;
      const cacheInstance = this.cache.getCacheInstance(JSON.stringify(data).length);
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.setEx(cacheKey, ttl, JSON.stringify(data));
      } else {
        cacheInstance.set(cacheKey, data, ttl);
      }
      
      console.log(`PME data cached with key: ${cacheKey}`);
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'set', key);
    }
  }

  async getPMEData(key) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.PME, key);
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const data = await cacheInstance.get(cacheKey);
        return data ? JSON.parse(data) : null;
      } else {
        return cacheInstance.get(cacheKey) || null;
      }
    } catch (error) {
      return this.cache.handleCacheError(error, 'get', key);
    }
  }

  /**
   * Cache Gmail communication data
   */
  async cacheGmailData(query, data, customTTL = null) {
    try {
      const queryHash = this.generateHashKey(query);
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.GMAIL, queryHash);
      const ttl = customTTL || CACHE_TTL.GMAIL_DATA;
      const cacheInstance = this.cache.getCacheInstance(JSON.stringify(data).length);
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.setEx(cacheKey, ttl, JSON.stringify({
          data,
          query,
          timestamp: Date.now()
        }));
      } else {
        cacheInstance.set(cacheKey, { data, query, timestamp: Date.now() }, ttl);
      }
      
      console.log(`Gmail data cached with key: ${cacheKey}`);
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'set', queryHash);
    }
  }

  async getGmailData(query) {
    try {
      const queryHash = this.generateHashKey(query);
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.GMAIL, queryHash);
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const cached = await cacheInstance.get(cacheKey);
        return cached ? JSON.parse(cached) : null;
      } else {
        return cacheInstance.get(cacheKey) || null;
      }
    } catch (error) {
      return this.cache.handleCacheError(error, 'get', queryHash);
    }
  }

  /**
   * Cache Quo/OpenPhone communication data
   */
  async cacheQuoData(identifier, data, customTTL = null) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.QUO, identifier);
      const ttl = customTTL || CACHE_TTL.QUO_OPENPHONE_DATA;
      const cacheInstance = this.cache.getCacheInstance(JSON.stringify(data).length);
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.setEx(cacheKey, ttl, JSON.stringify({
          data,
          timestamp: Date.now()
        }));
      } else {
        cacheInstance.set(cacheKey, { data, timestamp: Date.now() }, ttl);
      }
      
      console.log(`Quo data cached with key: ${cacheKey}`);
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'set', identifier);
    }
  }

  async getQuoData(identifier) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.QUO, identifier);
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const cached = await cacheInstance.get(cacheKey);
        return cached ? JSON.parse(cached) : null;
      } else {
        return cacheInstance.get(cacheKey) || null;
      }
    } catch (error) {
      return this.cache.handleCacheError(error, 'get', identifier);
    }
  }

  /**
   * Cache analysis results
   */
  async cacheAnalysis(analysisType, identifier, result, customTTL = null) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.ANALYSIS, `${analysisType}:${identifier}`);
      const ttl = customTTL || CACHE_TTL.COLLECTIONS_ANALYSIS;
      const cacheInstance = this.cache.getCacheInstance(JSON.stringify(result).length);
      
      const cacheData = {
        result,
        analysisType,
        identifier,
        timestamp: Date.now(),
        version: '1.0' // For cache invalidation when analysis logic changes
      };
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.setEx(cacheKey, ttl, JSON.stringify(cacheData));
      } else {
        cacheInstance.set(cacheKey, cacheData, ttl);
      }
      
      console.log(`Analysis cached with key: ${cacheKey}`);
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'set', `${analysisType}:${identifier}`);
    }
  }

  async getAnalysis(analysisType, identifier) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.ANALYSIS, `${analysisType}:${identifier}`);
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const cached = await cacheInstance.get(cacheKey);
        return cached ? JSON.parse(cached) : null;
      } else {
        return cacheInstance.get(cacheKey) || null;
      }
    } catch (error) {
      return this.cache.handleCacheError(error, 'get', `${analysisType}:${identifier}`);
    }
  }

  /**
   * Cache authentication tokens
   */
  async cacheAuthToken(service, token, customTTL = null) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.AUTH, service);
      const ttl = customTTL || CACHE_TTL.AUTH_TOKENS;
      const cacheInstance = this.cache.getCacheInstance();
      
      const tokenData = {
        token,
        service,
        timestamp: Date.now(),
        expiresAt: Date.now() + (ttl * 1000)
      };
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.setEx(cacheKey, ttl, JSON.stringify(tokenData));
      } else {
        cacheInstance.set(cacheKey, tokenData, ttl);
      }
      
      console.log(`Auth token cached for service: ${service}`);
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'set', service);
    }
  }

  async getAuthToken(service) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.AUTH, service);
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const cached = await cacheInstance.get(cacheKey);
        const tokenData = cached ? JSON.parse(cached) : null;
        
        // Check if token is still valid (refresh 5 minutes before expiry)
        if (tokenData && tokenData.expiresAt > (Date.now() + 300000)) {
          return tokenData;
        }
        return null;
      } else {
        const tokenData = cacheInstance.get(cacheKey);
        if (tokenData && tokenData.expiresAt > (Date.now() + 300000)) {
          return tokenData;
        }
        return null;
      }
    } catch (error) {
      return this.cache.handleCacheError(error, 'get', service);
    }
  }

  /**
   * Cache rate limiting data
   */
  async updateRateLimit(service, endpoint, requestCount = 1) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.RATE_LIMIT, `${service}:${endpoint}`);
      const ttl = CACHE_TTL.RATE_LIMIT_COUNTERS;
      const cacheInstance = this.cache.getCacheInstance();
      
      let currentData = null;
      if (cacheInstance === this.cache.redisClient) {
        const cached = await cacheInstance.get(cacheKey);
        currentData = cached ? JSON.parse(cached) : null;
      } else {
        currentData = cacheInstance.get(cacheKey);
      }
      
      const rateLimitData = {
        service,
        endpoint,
        count: currentData ? currentData.count + requestCount : requestCount,
        resetTime: currentData ? currentData.resetTime : Date.now() + (ttl * 1000),
        timestamp: Date.now()
      };
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.setEx(cacheKey, ttl, JSON.stringify(rateLimitData));
      } else {
        cacheInstance.set(cacheKey, rateLimitData, ttl);
      }
      
      return rateLimitData;
    } catch (error) {
      return this.cache.handleCacheError(error, 'update', `${service}:${endpoint}`);
    }
  }

  async getRateLimit(service, endpoint) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.RATE_LIMIT, `${service}:${endpoint}`);
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const cached = await cacheInstance.get(cacheKey);
        return cached ? JSON.parse(cached) : null;
      } else {
        return cacheInstance.get(cacheKey) || null;
      }
    } catch (error) {
      return this.cache.handleCacheError(error, 'get', `${service}:${endpoint}`);
    }
  }

  /**
   * Cache reports
   */
  async cacheReport(reportType, identifier, report, customTTL = null) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.REPORTS, `${reportType}:${identifier}`);
      const ttl = customTTL || (reportType.includes('daily') ? CACHE_TTL.DAILY_REPORTS : CACHE_TTL.WEEKLY_REPORTS);
      const cacheInstance = this.cache.getCacheInstance(JSON.stringify(report).length);
      
      const reportData = {
        report,
        reportType,
        identifier,
        generatedAt: Date.now(),
        version: '1.0'
      };
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.setEx(cacheKey, ttl, JSON.stringify(reportData));
      } else {
        cacheInstance.set(cacheKey, reportData, ttl);
      }
      
      console.log(`Report cached with key: ${cacheKey}`);
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'set', `${reportType}:${identifier}`);
    }
  }

  async getReport(reportType, identifier) {
    try {
      const cacheKey = this.cache.generateKey(CACHE_PREFIXES.REPORTS, `${reportType}:${identifier}`);
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const cached = await cacheInstance.get(cacheKey);
        return cached ? JSON.parse(cached) : null;
      } else {
        return cacheInstance.get(cacheKey) || null;
      }
    } catch (error) {
      return this.cache.handleCacheError(error, 'get', `${reportType}:${identifier}`);
    }
  }

  /**
   * Cache invalidation methods
   */
  async invalidateCache(pattern) {
    try {
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        const keys = await cacheInstance.keys(pattern);
        if (keys.length > 0) {
          await cacheInstance.del(keys);
        }
      } else {
        // For memory cache, get all keys and filter
        const allKeys = cacheInstance.keys();
        const matchingKeys = allKeys.filter(key => key.includes(pattern.replace('*', '')));
        matchingKeys.forEach(key => cacheInstance.del(key));
      }
      
      console.log(`Cache invalidated for pattern: ${pattern}`);
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'invalidate', pattern);
    }
  }

  async clearAllCache() {
    try {
      const cacheInstance = this.cache.getCacheInstance();
      
      if (cacheInstance === this.cache.redisClient) {
        await cacheInstance.flushAll();
      } else {
        cacheInstance.flushAll();
      }
      
      console.log('All cache cleared');
      return true;
    } catch (error) {
      return this.cache.handleCacheError(error, 'clear', 'all');
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      const stats = {
        memoryCache: {
          keys: this.cache.memoryCache.keys().length,
          hits: this.cache.memoryCache.getStats().hits,
          misses: this.cache.memoryCache.getStats().misses
        },
        redisCache: {
          connected: this.cache.redisConnected
        }
      };
      
      if (this.cache.redisConnected) {
        const info = await this.cache.redisClient.info('memory');
        stats.redisCache.memory = info;
      }
      
      return stats;
    } catch (error) {
      console.warn('Failed to get cache stats:', error.message);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new CollectionsCache();