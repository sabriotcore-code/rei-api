const crypto = require('crypto');

/**
 * Generates cache keys following the REI API pattern: 'rei:api:{endpoint}:{params}'
 */
class CacheKeyGenerator {
  /**
   * Generate a cache key for a route
   * @param {string} endpoint - The API endpoint
   * @param {Object} params - Request parameters (query, body, user context)
   * @param {Object} options - Additional options for key generation
   * @returns {string} Generated cache key
   */
  static generate(endpoint, params = {}, options = {}) {
    // Clean endpoint by removing leading slash and replacing slashes with colons
    const cleanEndpoint = endpoint.replace(/^\//, '').replace(/\//g, ':');
    
    // Extract relevant parameters
    const { query = {}, body = {}, user = null, headers = {} } = params;
    const { includeUser = false, includeHeaders = [], customSuffix = '' } = options;
    
    // Build parameter string
    const paramParts = [];
    
    // Add query parameters (sorted for consistency)
    if (Object.keys(query).length > 0) {
      const sortedQuery = Object.keys(query)
        .sort()
        .map(key => `${key}=${query[key]}`)
        .join('&');
      paramParts.push(`q:${this._hashString(sortedQuery)}`);
    }
    
    // Add body parameters (hash for security and length)
    if (Object.keys(body).length > 0) {
      const bodyHash = this._hashString(JSON.stringify(body));
      paramParts.push(`b:${bodyHash}`);
    }
    
    // Add user context if requested
    if (includeUser && user) {
      const userId = user.id || user._id || user.userId;
      if (userId) {
        paramParts.push(`u:${userId}`);
      }
    }
    
    // Add specific headers if requested
    if (includeHeaders.length > 0) {
      const headerParts = includeHeaders
        .filter(headerName => headers[headerName])
        .map(headerName => `${headerName}:${headers[headerName]}`)
        .join('|');
      if (headerParts) {
        paramParts.push(`h:${this._hashString(headerParts)}`);
      }
    }
    
    // Add custom suffix
    if (customSuffix) {
      paramParts.push(customSuffix);
    }
    
    // Build final key
    const paramString = paramParts.length > 0 ? `:${paramParts.join(':')}` : '';
    return `rei:api:${cleanEndpoint}${paramString}`;
  }
  
  /**
   * Generate a wildcard pattern for cache invalidation
   * @param {string} endpoint - The API endpoint
   * @param {Object} options - Options for pattern generation
   * @returns {string} Cache key pattern
   */
  static generatePattern(endpoint, options = {}) {
    const cleanEndpoint = endpoint.replace(/^\//, '').replace(/\//g, ':');
    const { includeParams = false } = options;
    
    if (includeParams) {
      return `rei:api:${cleanEndpoint}:*`;
    }
    return `rei:api:${cleanEndpoint}`;
  }
  
  /**
   * Extract endpoint from cache key
   * @param {string} cacheKey - The cache key
   * @returns {string|null} The endpoint or null if invalid key
   */
  static extractEndpoint(cacheKey) {
    const match = cacheKey.match(/^rei:api:([^:]+(?::[^:]+)*?)(?::.*)?$/);
    return match ? match[1].replace(/:/g, '/') : null;
  }
  
  /**
   * Validate cache key format
   * @param {string} cacheKey - The cache key to validate
   * @returns {boolean} Whether the key is valid
   */
  static isValidKey(cacheKey) {
    return /^rei:api:[a-zA-Z0-9:_-]+/.test(cacheKey);
  }
  
  /**
   * Hash a string for consistent key generation
   * @private
   * @param {string} str - String to hash
   * @returns {string} Hashed string (first 8 characters)
   */
  static _hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 8);
  }
}

module.exports = CacheKeyGenerator;