#!/usr/bin/env node

const cacheWarmer = require('../services/cache-warmer');
const logger = require('../utils/logger');
const redis = require('../config/redis');

/**
 * Cache Warming Script
 * Can be run manually or via cron job
 */

class CacheWarmingScript {
  constructor() {
    this.options = {
      force: false,
      tasks: null,
      verbose: false,
      stats: false,
      clear: false,
      schedule: false
    };
  }

  /**
   * Parse command line arguments
   */
  parseArguments() {
    const args = process.argv.slice(2);
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      switch (arg) {
        case '--force':
        case '-f':
          this.options.force = true;
          break;
          
        case '--tasks':
        case '-t':
          if (i + 1 < args.length) {
            this.options.tasks = args[i + 1].split(',').map(t => t.trim());
            i++; // Skip next argument
          }
          break;
          
        case '--verbose':
        case '-v':
          this.options.verbose = true;
          break;
          
        case '--stats':
        case '-s':
          this.options.stats = true;
          break;
          
        case '--clear':
        case '-c':
          this.options.clear = true;
          break;
          
        case '--schedule':
          this.options.schedule = true;
          break;
          
        case '--help':
        case '-h':
          this.showHelp();
          process.exit(0);
          break;
          
        default:
          if (arg.startsWith('-')) {
            logger.error(`Unknown option: ${arg}`);
            this.showHelp();
            process.exit(1);
          }
      }
    }
  }

  /**
   * Show help information
   */
  showHelp() {
    console.log(`
REI API Cache Warming Script

Usage: node scripts/warm-cache.js [options]

Options:
  -f, --force      Force warming even if cache keys exist
  -t, --tasks      Comma-separated list of specific tasks to run
  -v, --verbose    Enable verbose logging
  -s, --stats      Show cache statistics after warming
  -c, --clear      Clear all warm cache keys before warming
      --schedule   Start scheduled cache warming (runs continuously)
  -h, --help       Show this help message

Examples:
  node scripts/warm-cache.js
  node scripts/warm-cache.js --force --verbose
  node scripts/warm-cache.js --tasks "popular-products,categories"
  node scripts/warm-cache.js --clear --force
  node scripts/warm-cache.js --schedule
  node scripts/warm-cache.js --stats

Environment Variables:
  CACHE_WARM_INTERVAL     Scheduled warming interval in seconds (default: 3600)
  CACHE_TTL_PRODUCTS      Product cache TTL in seconds (default: 3600)
  CACHE_TTL_CATEGORIES    Category cache TTL in seconds (default: 7200)
  CACHE_TTL_USERS         User cache TTL in seconds (default: 1800)
  CACHE_TTL_ORDERS        Order cache TTL in seconds (default: 900)
`);
  }

  /**
   * Validate Redis connection
   */
  async validateRedisConnection() {
    try {
      await redis.ping();
      if (this.options.verbose) {
        logger.info('Redis connection validated');
      }
    } catch (error) {
      logger.error('Failed to connect to Redis:', error.message);
      process.exit(1);
    }
  }

  /**
   * Initialize cache warmer
   */
  initializeCacheWarmer() {
    cacheWarmer.initializeDefaultTasks();
    
    if (this.options.verbose) {
      const taskStatus = cacheWarmer.getTaskStatus();
      logger.info(`Initialized ${taskStatus.length} warmup tasks`);
      
      taskStatus.forEach(task => {
        logger.info(`Task: ${task.name} | Priority: ${task.priority} | Enabled: ${task.enabled}`);
      });
    }
  }

  /**
   * Clear cache if requested
   */
  async clearCache() {
    if (this.options.clear) {
      logger.info('Clearing existing warm cache keys...');
      const clearedKeys = await cacheWarmer.clearWarmCache();
      logger.info(`Cleared ${clearedKeys.length} cache keys`);
      
      if (this.options.verbose && clearedKeys.length > 0) {
        logger.info('Cleared keys:', clearedKeys);
      }
    }
  }

  /**
   * Execute cache warming
   */
  async executeWarming() {
    const startTime = Date.now();
    
    logger.info('Starting cache warming process...');
    
    try {
      const results = await cacheWarmer.warmCache({
        force: this.options.force,
        taskNames: this.options.tasks
      });
      
      const totalTime = Date.now() - startTime;
      
      // Log summary
      logger.info('Cache warming completed!');
      logger.info(`Total time: ${totalTime}ms`);
      logger.info(`Success: ${results.success} | Failed: ${results.failed} | Skipped: ${results.skipped}`);
      
      // Verbose output
      if (this.options.verbose) {
        logger.info('Detailed results:');
        results.details.forEach(detail => {
          const status = detail.status.toUpperCase();
          const duration = detail.duration || 0;
          let message = `[${status}] ${detail.taskName} (${duration}ms)`;
          
          if (detail.status === 'success') {
            message += ` | Key: ${detail.cacheKey} | Size: ${detail.dataSize} bytes | TTL: ${detail.ttl}s`;
          } else if (detail.status === 'failed') {
            message += ` | Error: ${detail.error}`;
            if (detail.errorCount) {
              message += ` | Error Count: ${detail.errorCount}`;
            }
          } else if (detail.status === 'skipped') {
            message += ` | Reason: ${detail.reason}`;
          }
          
          logger.info(message);
        });
      }
      
      return results;
    } catch (error) {
      logger.error('Cache warming failed:', error);
      throw error;
    }
  }

  /**
   * Show cache statistics
   */
  async showStats() {
    if (this.options.stats) {
      logger.info('Gathering cache statistics...');
      
      try {
        const stats = await cacheWarmer.getCacheStats();
        
        logger.info('\n=== Cache Statistics ===');
        logger.info(`Total tasks: ${stats.totalTasks}`);
        logger.info(`Enabled tasks: ${stats.enabledTasks}`);
        logger.info(`Disabled tasks: ${stats.disabledTasks}`);
        logger.info(`Cached keys: ${stats.cachedKeys}`);
        logger.info(`Total cache size: ${stats.totalCacheSize} bytes`);
        
        if (this.options.verbose && stats.keyDetails.length > 0) {
          logger.info('\nKey Details:');
          stats.keyDetails.forEach(detail => {
            const ttlInfo = detail.ttl > 0 ? `${detail.ttl}s remaining` : 'expired';
            const lastRun = detail.lastRun ? new Date(detail.lastRun).toLocaleString() : 'never';
            logger.info(`${detail.taskName}: ${detail.size} bytes, TTL: ${ttlInfo}, Last run: ${lastRun}`);
          });
        }
        
        logger.info('========================\n');
      } catch (error) {
        logger.error('Failed to get cache statistics:', error);
      }
    }
  }

  /**
   * Start scheduled warming
   */
  startScheduledWarming() {
    if (this.options.schedule) {
      logger.info('Starting scheduled cache warming...');
      logger.info('Press Ctrl+C to stop');
      
      cacheWarmer.startScheduledWarming();
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        logger.info('\nStopping scheduled cache warming...');
        cacheWarmer.stopScheduledWarming();
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        logger.info('\nStopping scheduled cache warming...');
        cacheWarmer.stopScheduledWarming();
        process.exit(0);
      });
      
      // Keep process alive
      setInterval(() => {
        // Do nothing, just keep alive
      }, 1000);
    }
  }

  /**
   * Main execution function
   */
  async run() {
    try {
      // Parse command line arguments
      this.parseArguments();
      
      // Set verbose logging if requested
      if (this.options.verbose) {
        process.env.LOG_LEVEL = 'debug';
      }
      
      // Validate Redis connection
      await this.validateRedisConnection();
      
      // Initialize cache warmer
      this.initializeCacheWarmer();
      
      // Handle scheduled warming
      if (this.options.schedule) {
        this.startScheduledWarming();
        return; // Keep running
      }
      
      // Clear cache if requested
      await this.clearCache();
      
      // Execute warming if not just showing stats
      if (!this.options.stats || this.options.clear || this.options.force || this.options.tasks) {
        await this.executeWarming();
      }
      
      // Show statistics if requested
      await this.showStats();
      
      logger.info('Script completed successfully');
      process.exit(0);
      
    } catch (error) {
      logger.error('Script execution failed:', error);
      process.exit(1);
    }
  }
}

// Run the script if called directly
if (require.main === module) {
  const script = new CacheWarmingScript();
  script.run();
}

module.exports = CacheWarmingScript;