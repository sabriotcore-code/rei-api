const redis = require('redis');
const CacheKeyGenerator = require('../utils/cache-key-generator');

/**
 * Intelligent caching middleware for REI API
 * Supports conditional caching, configurable TTL, and response serialization
 */
class CacheMiddleware {
  constructor(redisClient = null) {
    this.client = redisClient || this._createRedisClient();
    this.defaultTTL = parseInt(process.env.CACHE_DEFAULT_TTL) || 300; // 5 minutes
    this.maxTTL = parseInt(process.env.CACHE_MAX_TTL) || 3600; // 1 hour
    this.hitCount = 0;
    this.missCount = 0;
  }
  
  /**
   * Create Redis client with connection handling
   * @private
   */
  _createRedisClient() {
    const client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.error('Redis connection refused');
          return new Error('Redis connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          return new Error('Redis retry time exhausted');
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });
    
    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    client.on('connect', () => {
      console.log('Redis Client Connected');
    });
    
    return client;
  }
  
  /**
   * Main caching middleware function
   * @param {Object} options - Caching options
   * @returns {Function} Express middleware function
   */
  cache(options = {}) {
    const {
      ttl = this.defaultTTL,
      condition = () => true,
      keyOptions = {},
      skipMethods = ['POST', 'PUT', 'PATCH', 'DELETE'],
      skipQuery = [],
      skipHeaders = true,
      varyBy = []
    } = options;
    
    return async (req, res, next) => {
      try {
        // Skip caching for certain HTTP methods
        if (skipMethods.includes(req.method)) {
          return next();
        }
        
        // Check custom condition
        if (!condition(req, res)) {
          return next();
        }
        
        // Generate cache key
        const endpoint = req.route ? req.route.path : req.path;
        const params = this._extractParams(req, { skipQuery, skipHeaders, varyBy });
        const cacheKey = CacheKeyGenerator.generate(endpoint, params, keyOptions);
        
        // Try to get from cache
        const cachedResponse = await this._getFromCache(cacheKey);
        if (cachedResponse) {
          this.hitCount++;
          res.set('X-Cache', 'HIT');
          res.set('X-Cache-Key', cacheKey);
          
          // Restore response
          if (cachedResponse.headers) {
            res.set(cachedResponse.headers);
          }
          return res.status(cachedResponse.status || 200).json(cachedResponse.data);
        }
        
        // Cache miss - intercept response
        this.missCount++;
        res.set('X-Cache', 'MISS');
        res.set('X-Cache-Key', cacheKey);
        
        // Override res.json to capture response
        const originalJson = res.json;
        const originalStatus = res.status;
        let statusCode = 200;
        
        res.status = function(code) {
          statusCode = code;
          return originalStatus.call(this, code);
        };
        
        res.json = async function(data) {
          // Only cache successful responses
          if (statusCode >= 200 && statusCode < 300) {
            const responseToCache = {
              data,
              status: statusCode,
              headers: CacheMiddleware._filterHeaders(res.getHeaders()),
              timestamp: Date.now()
            };
            
            await this._setToCache(cacheKey, responseToCache, ttl);
          }
          
          return originalJson.call(this, data);
        }.bind(this);
        
        next();
      } catch (error) {
        console.error('Cache middleware error:', error);
        // Don't break the request on cache errors
        next();
      }
    };
  }
  
  /**
   * Invalidate cache by pattern or specific key
   * @param {string} pattern - Cache key or pattern
   * @returns {Promise<number>} Number of keys deleted
   */
  async invalidate(pattern) {
    try {
      if (pattern.includes('*')) {
        // Pattern-based invalidation
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          return await this.client.del(keys);
        }
        return 0;
      } else {
        // Single key invalidation
        return await this.client.del(pattern);
      }
    } catch (error) {
      console.error('Cache invalidation error:', error);
      return 0;
    }
  }
  
  /**
   * Get cache statistics
   * @returns {Object} Cache hit/miss statistics
   */
  getStats() {
    const total = this.hitCount + this.missCount;
    const hitRate = total > 0 ? (this.hitCount / total * 100).toFixed(2) : 0;
    
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: `${hitRate}%`,
      total
    };
  }
  
  /**
   * Reset cache statistics
   */
  resetStats() {
    this.hitCount = 0;
    this.missCount = 0;
  }
  
  /**
   * Extract parameters for cache key generation
   * @private
   */
  _extractParams(req, options = {}) {
    const { skipQuery = [], skipHeaders = true, varyBy = [] } = options;
    
    const params = {
      query: {},
      body: req.body || {},
      user: req.user || null,
      headers: {}
    };
    
    // Filter query parameters
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        if (!skipQuery.includes(key)) {
          params.query[key] = req.query[key];
        }
      });
    }
    
    // Include specific headers if requested
    if (!skipHeaders && varyBy.length > 0) {
      varyBy.forEach(header => {
        if (req.headers[header]) {
          params.headers[header] = req.headers[header];
        }
      });
    }
    
    return params;
  }
  
  /**
   * Get data from cache
   * @private
   */
  async _getFromCache(key) {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }
  
  /**
   * Set data to cache
   * @private
   */
  async _setToCache(key, data, ttl) {
    try {
      const serialized = JSON.stringify(data);
      const actualTTL = Math.min(ttl, this.maxTTL);
      await this.client.setex(key, actualTTL, serialized);
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }
  
  /**
   * Filter response headers for caching
   * @private
   */
  static _filterHeaders(headers) {
    const allowedHeaders = [
      'content-type',
      'content-encoding',
      'cache-control',
      'etag',
      'last-modified',
      'x-api-version'
    ];
    
    const filtered = {};
    Object.keys(headers).forEach(key => {
      if (allowedHeaders.includes(key.toLowerCase())) {
        filtered[key] = headers[key];
      }
    });
    
    return filtered;
  }
  
  /**
   * Create middleware instance with predefined options
   */
  static create(options = {}) {
    const instance = new CacheMiddleware(options.redisClient);
    return instance.cache.bind(instance);
  }
  
  /**
   * Middleware for different caching strategies
   */
  static strategies = {
    // Short-term caching for frequently accessed data
    shortTerm: (options = {}) => {
      return CacheMiddleware.create({
        ttl: parseInt(process.env.CACHE_SHORT_TTL) || 60, // 1 minute
        ...options
      });
    },
    
    // Long-term caching for static or rarely changing data
    longTerm: (options = {}) => {
      return CacheMiddleware.create({
        ttl: parseInt(process.env.CACHE_LONG_TTL) || 1800, // 30 minutes
        ...options
      });
    },
    
    // User-specific caching
    userSpecific: (options = {}) => {
      return CacheMiddleware.create({
        ttl: parseInt(process.env.CACHE_USER_TTL) || 300, // 5 minutes
        keyOptions: { includeUser: true },
        condition: (req) => req.user && req.user.id,
        ...options
      });
    },
    
    // Search results caching
    searchResults: (options = {}) => {
      return CacheMiddleware.create({
        ttl: parseInt(process.env.CACHE_SEARCH_TTL) || 180, // 3 minutes
        skipQuery: ['page', 'limit'], // Don't vary cache by pagination
        ...options
      });
    }
  };
}

module.exports = CacheMiddleware;