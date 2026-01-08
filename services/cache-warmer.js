const redis = require('../config/redis');
const logger = require('../utils/logger');
const config = require('../config/database');

/**
 * Cache Warmer Service
 * Pre-populates Redis cache with frequently accessed data
 */
class CacheWarmerService {
  constructor() {
    this.warmupTasks = [];
    this.isWarming = false;
    this.warmupInterval = null;
    
    // Default cache configurations
    this.cacheConfigs = {
      products: {
        keyPattern: 'rei:api:products:*',
        ttl: parseInt(process.env.CACHE_TTL_PRODUCTS) || 3600, // 1 hour
        priority: 1
      },
      categories: {
        keyPattern: 'rei:api:categories:*',
        ttl: parseInt(process.env.CACHE_TTL_CATEGORIES) || 7200, // 2 hours
        priority: 2
      },
      users: {
        keyPattern: 'rei:api:users:*',
        ttl: parseInt(process.env.CACHE_TTL_USERS) || 1800, // 30 minutes
        priority: 3
      },
      orders: {
        keyPattern: 'rei:api:orders:*',
        ttl: parseInt(process.env.CACHE_TTL_ORDERS) || 900, // 15 minutes
        priority: 4
      }
    };
  }

  /**
   * Register a cache warmup task
   * @param {string} name - Task name
   * @param {Function} dataFetcher - Function to fetch data
   * @param {string} cacheKey - Redis cache key
   * @param {Object} options - Additional options
   */
  registerWarmupTask(name, dataFetcher, cacheKey, options = {}) {
    const task = {
      name,
      dataFetcher,
      cacheKey,
      ttl: options.ttl || 3600,
      priority: options.priority || 5,
      enabled: options.enabled !== false,
      lastRun: null,
      errorCount: 0,
      maxErrors: options.maxErrors || 3
    };

    this.warmupTasks.push(task);
    logger.info(`Cache warmup task registered: ${name}`);
  }

  /**
   * Initialize default warmup tasks
   */
  initializeDefaultTasks() {
    // Popular products warmup
    this.registerWarmupTask(
      'popular-products',
      this.fetchPopularProducts.bind(this),
      'rei:api:products:popular',
      { ttl: this.cacheConfigs.products.ttl, priority: 1 }
    );

    // Categories warmup
    this.registerWarmupTask(
      'categories',
      this.fetchCategories.bind(this),
      'rei:api:categories:all',
      { ttl: this.cacheConfigs.categories.ttl, priority: 2 }
    );

    // Featured products warmup
    this.registerWarmupTask(
      'featured-products',
      this.fetchFeaturedProducts.bind(this),
      'rei:api:products:featured',
      { ttl: this.cacheConfigs.products.ttl, priority: 1 }
    );

    // Product recommendations warmup
    this.registerWarmupTask(
      'product-recommendations',
      this.fetchProductRecommendations.bind(this),
      'rei:api:products:recommendations:default',
      { ttl: this.cacheConfigs.products.ttl, priority: 3 }
    );

    logger.info(`Initialized ${this.warmupTasks.length} default warmup tasks`);
  }

  /**
   * Execute cache warmup
   * @param {Object} options - Warmup options
   */
  async warmCache(options = {}) {
    if (this.isWarming) {
      logger.warn('Cache warming already in progress');
      return;
    }

    this.isWarming = true;
    const startTime = Date.now();
    const { force = false, taskNames = null } = options;

    try {
      logger.info('Starting cache warmup process');
      
      // Filter tasks if specific names provided
      let tasksToRun = this.warmupTasks.filter(task => task.enabled);
      if (taskNames && taskNames.length > 0) {
        tasksToRun = tasksToRun.filter(task => taskNames.includes(task.name));
      }

      // Sort by priority
      tasksToRun.sort((a, b) => a.priority - b.priority);

      const results = {
        success: 0,
        failed: 0,
        skipped: 0,
        details: []
      };

      for (const task of tasksToRun) {
        try {
          const taskResult = await this.executeWarmupTask(task, force);
          results.details.push(taskResult);
          
          if (taskResult.status === 'success') {
            results.success++;
          } else if (taskResult.status === 'failed') {
            results.failed++;
          } else {
            results.skipped++;
          }
        } catch (error) {
          logger.error(`Error executing warmup task ${task.name}:`, error);
          results.failed++;
          results.details.push({
            taskName: task.name,
            status: 'failed',
            error: error.message,
            duration: 0
          });
        }
      }

      const totalTime = Date.now() - startTime;
      logger.info(`Cache warmup completed in ${totalTime}ms. Success: ${results.success}, Failed: ${results.failed}, Skipped: ${results.skipped}`);
      
      return results;
    } catch (error) {
      logger.error('Cache warmup process failed:', error);
      throw error;
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Execute a single warmup task
   * @param {Object} task - Warmup task
   * @param {boolean} force - Force execution even if cache exists
   */
  async executeWarmupTask(task, force = false) {
    const taskStartTime = Date.now();
    
    try {
      // Check if cache key already exists
      if (!force) {
        const exists = await redis.exists(task.cacheKey);
        if (exists) {
          logger.debug(`Skipping warmup for ${task.name} - cache key exists`);
          return {
            taskName: task.name,
            status: 'skipped',
            reason: 'cache_exists',
            duration: Date.now() - taskStartTime
          };
        }
      }

      // Fetch data
      logger.debug(`Executing warmup task: ${task.name}`);
      const data = await task.dataFetcher();
      
      if (data === null || data === undefined) {
        logger.warn(`No data returned for warmup task: ${task.name}`);
        return {
          taskName: task.name,
          status: 'skipped',
          reason: 'no_data',
          duration: Date.now() - taskStartTime
        };
      }

      // Store in cache
      await redis.setex(task.cacheKey, task.ttl, JSON.stringify(data));
      
      // Update task metadata
      task.lastRun = new Date();
      task.errorCount = 0;

      const duration = Date.now() - taskStartTime;
      logger.debug(`Warmup task ${task.name} completed successfully in ${duration}ms`);
      
      return {
        taskName: task.name,
        status: 'success',
        cacheKey: task.cacheKey,
        dataSize: JSON.stringify(data).length,
        ttl: task.ttl,
        duration
      };
    } catch (error) {
      task.errorCount++;
      
      if (task.errorCount >= task.maxErrors) {
        task.enabled = false;
        logger.error(`Disabling warmup task ${task.name} after ${task.errorCount} errors`);
      }

      logger.error(`Warmup task ${task.name} failed:`, error);
      
      return {
        taskName: task.name,
        status: 'failed',
        error: error.message,
        errorCount: task.errorCount,
        duration: Date.now() - taskStartTime
      };
    }
  }

  /**
   * Start scheduled cache warming
   * @param {number} intervalMs - Interval in milliseconds
   */
  startScheduledWarming(intervalMs = null) {
    const interval = intervalMs || (parseInt(process.env.CACHE_WARM_INTERVAL) || 3600) * 1000;
    
    if (this.warmupInterval) {
      logger.warn('Scheduled cache warming already running');
      return;
    }

    logger.info(`Starting scheduled cache warming every ${interval / 1000} seconds`);
    
    this.warmupInterval = setInterval(async () => {
      try {
        await this.warmCache({ force: false });
      } catch (error) {
        logger.error('Scheduled cache warming failed:', error);
      }
    }, interval);
  }

  /**
   * Stop scheduled cache warming
   */
  stopScheduledWarming() {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = null;
      logger.info('Stopped scheduled cache warming');
    }
  }

  /**
   * Get warmup task status
   */
  getTaskStatus() {
    return this.warmupTasks.map(task => ({
      name: task.name,
      enabled: task.enabled,
      priority: task.priority,
      lastRun: task.lastRun,
      errorCount: task.errorCount,
      cacheKey: task.cacheKey,
      ttl: task.ttl
    }));
  }

  // Data fetcher methods for default tasks
  async fetchPopularProducts() {
    // This would typically fetch from database
    // For now, return mock data structure
    return {
      products: [],
      timestamp: new Date().toISOString(),
      source: 'warmup'
    };
  }

  async fetchCategories() {
    return {
      categories: [],
      timestamp: new Date().toISOString(),
      source: 'warmup'
    };
  }

  async fetchFeaturedProducts() {
    return {
      featured: [],
      timestamp: new Date().toISOString(),
      source: 'warmup'
    };
  }

  async fetchProductRecommendations() {
    return {
      recommendations: [],
      timestamp: new Date().toISOString(),
      source: 'warmup'
    };
  }

  /**
   * Clear all cache keys managed by warmer
   */
  async clearWarmCache() {
    const clearedKeys = [];
    
    for (const task of this.warmupTasks) {
      try {
        const deleted = await redis.del(task.cacheKey);
        if (deleted) {
          clearedKeys.push(task.cacheKey);
        }
      } catch (error) {
        logger.error(`Error clearing cache key ${task.cacheKey}:`, error);
      }
    }

    logger.info(`Cleared ${clearedKeys.length} warm cache keys`);
    return clearedKeys;
  }

  /**
   * Get cache statistics for warmed keys
   */
  async getCacheStats() {
    const stats = {
      totalTasks: this.warmupTasks.length,
      enabledTasks: this.warmupTasks.filter(t => t.enabled).length,
      disabledTasks: this.warmupTasks.filter(t => !t.enabled).length,
      cachedKeys: 0,
      totalCacheSize: 0,
      keyDetails: []
    };

    for (const task of this.warmupTasks) {
      try {
        const exists = await redis.exists(task.cacheKey);
        if (exists) {
          stats.cachedKeys++;
          const ttl = await redis.ttl(task.cacheKey);
          const value = await redis.get(task.cacheKey);
          const size = value ? value.length : 0;
          stats.totalCacheSize += size;
          
          stats.keyDetails.push({
            taskName: task.name,
            cacheKey: task.cacheKey,
            size,
            ttl,
            lastRun: task.lastRun
          });
        }
      } catch (error) {
        logger.error(`Error getting stats for cache key ${task.cacheKey}:`, error);
      }
    }

    return stats;
  }
}

// Export singleton instance
module.exports = new CacheWarmerService();