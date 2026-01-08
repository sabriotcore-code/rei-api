// Import required modules
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./../swagger.json');
const redis = require('redis');
const client = redis.createClient({
  host: 'localhost',
  port: 6379
});

// Create a route handler for the docs
const router = express.Router();

// Serve the Swagger UI
router.get('/', (req, res) => {
  res.render('swagger-ui/index', {
    swaggerUrl: '/api/v1/docs/swagger.json'
  });
});

// Serve the Swagger JSON
router.get('/swagger.json', (req, res) => {
  res.json(swaggerDocument);
});

// Cache setup
const cacheTTL = process.env.CACHE_TTL || 3600; // 1 hour default TTL

// Create a route handler for the API
router.get('/api/v1/*', (req, res, next) => {
  const endpoint = req.path;
  const params = Object.keys(req.query).map(key => `${key}=${req.query[key]}`).join(',');
  const cacheKey = `rei:api:${endpoint}:${params}`;

  // Check the cache
  client.get(cacheKey, (err, reply) => {
    if (err) {
      console.error('Error checking cache:', err);
      next();
    } else if (reply) {
      console.log('Cache hit for', cacheKey);
      res.json(JSON.parse(reply));
    } else {
      next();
    }
  });
});

module.exports = router;