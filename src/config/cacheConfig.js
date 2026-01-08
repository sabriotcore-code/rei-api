/**
 * Cache configuration for collections analysis system
 * Handles caching strategies for expensive operations like API calls and analysis results
 */

const NodeCache = require('node-cache');
const Redis = require('redis');

// Cache TTL configurations (in seconds)
const CACHE_TTL = {
  // External API results
  PME_DATA: 60 * 60 * 2, // 2 hours
  GMAIL_DATA: 60 * 30, // 30 minutes
  QUO_OPENPHONE_DATA: 60 * 30, // 30 minutes
  
  // Analysis results
  COLLECTIONS_ANALYSIS: 60 * 60, // 1 hour
  PROPERTY_ANALYSIS: 60 * 30, // 30 minutes
  COMMUNICATION_SUMMARY: 60 * 15, // 15 minutes
  
  // Authentication tokens
  AUTH_TOKENS: 60 * 45, // 45 minutes (refresh before expiry)
  
  // Rate limiting data
  RATE_LIMIT_COUNTERS: 60 * 5, // 5 minutes
  
  // Aggregated reports
  DAILY_REPORTS: 60 * 60 * 24, // 24 hours
  WEEKLY_REPORTS: 60 * 60 * 24 * 7, // 7 days
};

// Cache size limits
const CACHE_LIMITS = {
  MEMORY_CACHE_SIZE: 1000, // Max number of items in memory cache
  REDIS_MAX_MEMORY: '256mb',
};

// Cache key prefixes for organization
const CACHE_PREFIXES = {
  PME: 'pme:',
  GMAIL: 'gmail:',
  QUO: 'quo:',
  ANALYSIS: 'analysis:',
  AUTH: 'auth:',
  RATE_LIMIT: 'rate:',
  REPORTS: 'reports:',
};

class CacheManager {
  constructor() {
    this.memoryCache = new NodeCache({ 
      stdTTL: 600, // Default 10 minutes
      checkperiod: 120, // Check for expired keys every 2 minutes
      maxKeys: CACHE_LIMITS.MEMORY_CACHE_SIZE
    });
    
    this.redisClient = null;
    this.redisConnected = false;
    
    this.initializeRedis();
  }
  
  async initializeRedis() {
    if (process.env.REDIS_URL || process.env.NODE_ENV === 'production') {
      try {
        this.redisClient = Redis.createClient({
          url: process.env.REDIS_URL || 'redis://localhost:6379',
          retry_strategy: (options) => {
            if (options.error && options.error.code === 'ECONNREFUSED') {
              console.warn('Redis connection refused, using memory cache only');
              return undefined;
            }
            if (options.total_retry_time > 1000 * 60 * 60) {
              return new Error('Redis retry time exhausted');
            }
            return Math.min(options.attempt * 100, 3000);
          }
        });
        
        await this.redisClient.connect();
        this.redisConnected = true;
        console.log('Redis cache connected successfully');
      } catch (error) {
        console.warn('Failed to connect to Redis, using memory cache only:', error.message);
        this.redisConnected = false;
      }
    }
  }
  
  // Generate cache key with prefix
  generateKey(prefix, identifier) {
    return `${prefix}${identifier}`;
  }
  
  // Get cache instance based on data type and size
  getCacheInstance(dataSize = 0) {
    // Use Redis for large data or in production
    if (this.redisConnected && (dataSize > 10000 || process.env.NODE_ENV === 'production')) {
      return this.redisClient;
    }
    return this.memoryCache;
  }
  
  // Handle cache errors gracefully
  handleCacheError(error, operation, key) {
    console.warn(`Cache ${operation} failed for key ${key}:`, error.message);
    // Continue operation without cache
    return null;
  }
}

// Export singleton instance
const cacheManager = new CacheManager();

module.exports = {
  CACHE_TTL,
  CACHE_LIMITS,
  CACHE_PREFIXES,
  cacheManager
};