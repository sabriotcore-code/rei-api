const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const CollectionsAnalyzer = require('../services/CollectionsAnalyzer');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for API endpoints
const analysisRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 analysis requests per windowMs
  message: {
    error: 'Too many analysis requests, please try again later'
  }
});

const reportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 report requests per windowMs
  message: {
    error: 'Too many report requests, please try again later'
  }
});

// Validation middleware
const validateAnalysisRequest = [
  body('properties')
    .optional()
    .isArray()
    .withMessage('Properties must be an array')
    .custom((value) => {
      if (value && value.length > 100) {
        throw new Error('Cannot analyze more than 100 properties at once');
      }
      return true;
    }),
  body('properties.*')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Property ID must be a non-empty string with max 100 characters'),
  body('dateRange.start')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  body('dateRange.end')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date')
    .custom((value, { req }) => {
      if (value && req.body.dateRange?.start) {
        const start = new Date(req.body.dateRange.start);
        const end = new Date(value);
        if (end <= start) {
          throw new Error('End date must be after start date');
        }
      }
      return true;
    }),
  body('includeRecommendations')
    .optional()
    .isBoolean()
    .withMessage('includeRecommendations must be a boolean'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Priority must be one of: low, medium, high')
];

const validateReportRequest = [
  param('analysisId')
    .isUUID()
    .withMessage('Analysis ID must be a valid UUID'),
  query('format')
    .optional()
    .isIn(['json', 'pdf', 'excel'])
    .withMessage('Format must be one of: json, pdf, excel'),
  query('includeDetails')
    .optional()
    .isBoolean()
    .withMessage('includeDetails must be a boolean')
];

const validatePropertyStatusRequest = [
  param('propertyId')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Property ID must be a non-empty string with max 100 characters'),
  query('includeHistory')
    .optional()
    .isBoolean()
    .withMessage('includeHistory must be a boolean'),
  query('historyDays')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('historyDays must be an integer between 1 and 365')
];

// Error handling middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Initialize collections analyzer
const collectionsAnalyzer = new CollectionsAnalyzer();

/**
 * @route POST /api/collections/analyze
 * @desc Trigger collections analysis for properties
 * @access Private
 */
router.post('/analyze', 
  auth, 
  analysisRateLimit,
  validateAnalysisRequest,
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        properties,
        dateRange,
        includeRecommendations = true,
        priority = 'medium'
      } = req.body;

      // Start analysis
      const analysisId = await collectionsAnalyzer.startAnalysis({
        properties,
        dateRange,
        includeRecommendations,
        priority,
        userId: req.user.id
      });

      res.status(202).json({
        message: 'Analysis started successfully',
        analysisId,
        status: 'pending',
        estimatedCompletionTime: collectionsAnalyzer.getEstimatedCompletionTime(properties?.length || 'all')
      });
    } catch (error) {
      console.error('Analysis trigger error:', error);
      
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Invalid request parameters',
          message: error.message
        });
      }
      
      if (error.name === 'AuthenticationError') {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Unable to authenticate with external services'
        });
      }
      
      if (error.name === 'RateLimitError') {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests to external APIs'
        });
      }
      
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to start collections analysis'
      });
    }
  }
);

/**
 * @route GET /api/collections/reports/:analysisId
 * @desc Retrieve analysis report
 * @access Private
 */
router.get('/reports/:analysisId',
  auth,
  reportRateLimit,
  validateReportRequest,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { analysisId } = req.params;
      const { format = 'json', includeDetails = true } = req.query;
      
      // Check if user has access to this report
      const hasAccess = await collectionsAnalyzer.checkUserAccess(analysisId, req.user.id);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have access to this analysis report'
        });
      }
      
      const report = await collectionsAnalyzer.getReport(analysisId, {
        format,
        includeDetails: includeDetails === 'true'
      });
      
      if (!report) {
        return res.status(404).json({
          error: 'Report not found',
          message: 'Analysis report not found or still processing'
        });
      }
      
      // Handle different response formats
      switch (format) {
        case 'pdf':
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="collections-report-${analysisId}.pdf"`);
          res.send(report.buffer);
          break;
        case 'excel':
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="collections-report-${analysisId}.xlsx"`);
          res.send(report.buffer);
          break;
        default:
          res.json({
            analysisId,
            status: report.status,
            completedAt: report.completedAt,
            summary: report.summary,
            properties: report.properties,
            recommendations: report.recommendations,
            metadata: {
              totalProperties: report.totalProperties,
              propertiesInCollections: report.propertiesInCollections,
              analysisDate: report.analysisDate,
              dataSourcesUsed: report.dataSourcesUsed
            }
          });
      }
    } catch (error) {
      console.error('Report retrieval error:', error);
      
      if (error.name === 'NotFoundError') {
        return res.status(404).json({
          error: 'Report not found',
          message: error.message
        });
      }
      
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve analysis report'
      });
    }
  }
);

/**
 * @route GET /api/collections/reports
 * @desc Get list of analysis reports for the user
 * @access Private
 */
router.get('/reports',
  auth,
  reportRateLimit,
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be an integer between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer'),
    query('status')
      .optional()
      .isIn(['pending', 'processing', 'completed', 'failed'])
      .withMessage('Status must be one of: pending, processing, completed, failed')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { limit = 20, offset = 0, status } = req.query;
      
      const reports = await collectionsAnalyzer.getUserReports(req.user.id, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        status
      });
      
      res.json({
        reports: reports.items.map(report => ({
          analysisId: report.id,
          status: report.status,
          createdAt: report.createdAt,
          completedAt: report.completedAt,
          propertiesAnalyzed: report.propertiesCount,
          hasRecommendations: report.hasRecommendations
        })),
        pagination: {
          total: reports.total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasNext: reports.hasNext
        }
      });
    } catch (error) {
      console.error('Reports list error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve reports list'
      });
    }
  }
);

/**
 * @route GET /api/collections/properties/:propertyId/status
 * @desc Get individual property collection status
 * @access Private
 */
router.get('/properties/:propertyId/status',
  auth,
  reportRateLimit,
  validatePropertyStatusRequest,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { propertyId } = req.params;
      const { includeHistory = false, historyDays = 30 } = req.query;
      
      // Check if user has access to this property
      const hasAccess = await collectionsAnalyzer.checkPropertyAccess(propertyId, req.user.id);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have access to this property'
        });
      }
      
      const propertyStatus = await collectionsAnalyzer.getPropertyStatus(propertyId, {
        includeHistory: includeHistory === 'true',
        historyDays: parseInt(historyDays)
      });
      
      if (!propertyStatus) {
        return res.status(404).json({
          error: 'Property not found',
          message: 'Property not found in collections data'
        });
      }
      
      res.json({
        propertyId,
        collectionStatus: propertyStatus.status,
        lastUpdated: propertyStatus.lastUpdated,
        currentBalance: propertyStatus.currentBalance,
        daysPastDue: propertyStatus.daysPastDue,
        communicationSummary: {
          lastContact: propertyStatus.lastContact,
          totalContacts: propertyStatus.totalContacts,
          preferredMethod: propertyStatus.preferredContactMethod
        },
        recommendations: propertyStatus.recommendations,
        history: includeHistory === 'true' ? propertyStatus.history : undefined
      });
    } catch (error) {
      console.error('Property status error:', error);
      
      if (error.name === 'NotFoundError') {
        return res.status(404).json({
          error: 'Property not found',
          message: error.message
        });
      }
      
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve property status'
      });
    }
  }
);

/**
 * @route DELETE /api/collections/reports/:analysisId
 * @desc Delete analysis report
 * @access Private
 */
router.delete('/reports/:analysisId',
  auth,
  [
    param('analysisId')
      .isUUID()
      .withMessage('Analysis ID must be a valid UUID')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { analysisId } = req.params;
      
      // Check if user has access to this report
      const hasAccess = await collectionsAnalyzer.checkUserAccess(analysisId, req.user.id);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have access to this analysis report'
        });
      }
      
      const deleted = await collectionsAnalyzer.deleteReport(analysisId);
      if (!deleted) {
        return res.status(404).json({
          error: 'Report not found',
          message: 'Analysis report not found'
        });
      }
      
      res.json({
        message: 'Analysis report deleted successfully',
        analysisId
      });
    } catch (error) {
      console.error('Report deletion error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete analysis report'
      });
    }
  }
);

/**
 * @route GET /api/collections/status
 * @desc Get overall collections analysis system status
 * @access Private
 */
router.get('/status',
  auth,
  reportRateLimit,
  async (req, res) => {
    try {
      const systemStatus = await collectionsAnalyzer.getSystemStatus();
      
      res.json({
        status: 'operational',
        services: {
          pmeIntegration: systemStatus.pmeStatus,
          quoIntegration: systemStatus.quoStatus,
          gmailIntegration: systemStatus.gmailStatus,
          database: systemStatus.databaseStatus
        },
        statistics: {
          totalAnalysesCompleted: systemStatus.totalAnalyses,
          averageProcessingTime: systemStatus.averageProcessingTime,
          activeAnalyses: systemStatus.activeAnalyses
        },
        lastUpdated: systemStatus.lastUpdated
      });
    } catch (error) {
      console.error('System status error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve system status'
      });
    }
  }
);

module.exports = router;