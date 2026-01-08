const PMEIntegrationService = require('../services/pmeIntegrationService');
const CommunicationService = require('../services/communicationService');
const AnalyticsService = require('../services/analyticsService');
const RecommendationService = require('../services/recommendationService');
const logger = require('../utils/logger');
const { ValidationError, IntegrationError } = require('../utils/errors');

class CollectionsController {
  constructor() {
    this.pmeService = new PMEIntegrationService();
    this.communicationService = new CommunicationService();
    this.analyticsService = new AnalyticsService();
    this.recommendationService = new RecommendationService();
  }

  /**
   * Execute the complete collections analysis workflow
   * @param {Object} options - Configuration options
   * @param {string} options.propertyId - Optional specific property ID
   * @param {Date} options.dateFrom - Analysis start date
   * @param {Date} options.dateTo - Analysis end date
   * @param {Array} options.stages - Specific collection stages to analyze
   * @returns {Promise<Object>} Complete analysis results
   */
  async executeAnalysisWorkflow(options = {}) {
    const startTime = Date.now();
    logger.info('Starting collections analysis workflow', { options });

    try {
      // Validate input parameters
      this._validateWorkflowOptions(options);

      const results = {
        timestamp: new Date().toISOString(),
        options,
        data: {},
        analytics: {},
        recommendations: {},
        errors: [],
        executionTime: null
      };

      // Step 1: Fetch PME Master sheet data
      logger.info('Step 1: Fetching PME Master sheet data');
      try {
        results.data.pmeData = await this._fetchPMEData(options);
        logger.info(`Successfully fetched ${results.data.pmeData.length} PME records`);
      } catch (error) {
        logger.error('Failed to fetch PME data', { error: error.message });
        results.errors.push({ step: 'pme_fetch', error: error.message });
        throw new IntegrationError('Critical error: Unable to fetch PME data', error);
      }

      // Step 2: Fetch communication records
      logger.info('Step 2: Fetching communication records');
      try {
        results.data.communications = await this._fetchCommunications(options, results.data.pmeData);
        logger.info(`Successfully fetched ${results.data.communications.length} communication records`);
      } catch (error) {
        logger.error('Failed to fetch communications', { error: error.message });
        results.errors.push({ step: 'communications_fetch', error: error.message });
        // Continue with analysis using available data
        results.data.communications = [];
      }

      // Step 3: Perform analytics
      logger.info('Step 3: Performing collections analytics');
      try {
        results.analytics = await this._performAnalytics(results.data);
        logger.info('Successfully completed analytics');
      } catch (error) {
        logger.error('Failed to perform analytics', { error: error.message });
        results.errors.push({ step: 'analytics', error: error.message });
        // Continue to try recommendations
      }

      // Step 4: Generate recommendations
      logger.info('Step 4: Generating recommendations');
      try {
        results.recommendations = await this._generateRecommendations(
          results.data,
          results.analytics
        );
        logger.info(`Generated ${Object.keys(results.recommendations).length} recommendation categories`);
      } catch (error) {
        logger.error('Failed to generate recommendations', { error: error.message });
        results.errors.push({ step: 'recommendations', error: error.message });
      }

      // Calculate execution time
      results.executionTime = Date.now() - startTime;
      
      logger.info('Collections analysis workflow completed', {
        executionTime: results.executionTime,
        errorCount: results.errors.length
      });

      return results;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Collections analysis workflow failed', {
        error: error.message,
        executionTime
      });
      throw error;
    }
  }

  /**
   * Execute workflow for a specific property
   * @param {string} propertyId - Property identifier
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Property-specific analysis results
   */
  async executePropertyAnalysis(propertyId, options = {}) {
    if (!propertyId) {
      throw new ValidationError('Property ID is required');
    }

    logger.info('Starting property-specific analysis', { propertyId });

    return this.executeAnalysisWorkflow({
      ...options,
      propertyId
    });
  }

  /**
   * Execute workflow for properties in specific collection stages
   * @param {Array<string>} stages - Collection stages to analyze
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Stage-specific analysis results
   */
  async executeStageAnalysis(stages, options = {}) {
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new ValidationError('At least one collection stage is required');
    }

    logger.info('Starting stage-specific analysis', { stages });

    return this.executeAnalysisWorkflow({
      ...options,
      stages
    });
  }

  /**
   * Get workflow status for long-running operations
   * @param {string} workflowId - Workflow identifier
   * @returns {Promise<Object>} Workflow status
   */
  async getWorkflowStatus(workflowId) {
    // This would typically integrate with a job queue system
    logger.info('Getting workflow status', { workflowId });
    
    // Placeholder implementation
    return {
      id: workflowId,
      status: 'unknown',
      message: 'Workflow status tracking not yet implemented'
    };
  }

  /**
   * Validate workflow options
   * @private
   */
  _validateWorkflowOptions(options) {
    if (options.dateFrom && options.dateTo) {
      if (new Date(options.dateFrom) > new Date(options.dateTo)) {
        throw new ValidationError('dateFrom must be before dateTo');
      }
    }

    if (options.stages && !Array.isArray(options.stages)) {
      throw new ValidationError('stages must be an array');
    }

    if (options.propertyId && typeof options.propertyId !== 'string') {
      throw new ValidationError('propertyId must be a string');
    }
  }

  /**
   * Fetch PME Master sheet data with error handling
   * @private
   */
  async _fetchPMEData(options) {
    const retryOptions = {
      maxRetries: 3,
      backoffMs: 1000
    };

    return this._retryOperation(
      () => this.pmeService.fetchCollectionsData(options),
      retryOptions,
      'PME data fetch'
    );
  }

  /**
   * Fetch communication records with error handling
   * @private
   */
  async _fetchCommunications(options, pmeData) {
    const communicationPromises = [];

    // Extract relevant identifiers from PME data for communication lookup
    const identifiers = this._extractCommunicationIdentifiers(pmeData);

    // Fetch from multiple sources in parallel with individual error handling
    communicationPromises.push(
      this._safeFetchCommunications('quo', identifiers, options)
    );
    communicationPromises.push(
      this._safeFetchCommunications('gmail', identifiers, options)
    );

    const results = await Promise.allSettled(communicationPromises);
    
    // Combine successful results
    const communications = [];
    results.forEach((result, index) => {
      const source = index === 0 ? 'quo' : 'gmail';
      if (result.status === 'fulfilled') {
        communications.push(...result.value);
      } else {
        logger.warn(`Failed to fetch communications from ${source}`, {
          error: result.reason.message
        });
      }
    });

    return communications;
  }

  /**
   * Safely fetch communications from a specific source
   * @private
   */
  async _safeFetchCommunications(source, identifiers, options) {
    try {
      const retryOptions = {
        maxRetries: 2,
        backoffMs: 2000
      };

      return await this._retryOperation(
        () => this.communicationService.fetchCommunications(source, identifiers, options),
        retryOptions,
        `${source} communications fetch`
      );
    } catch (error) {
      logger.warn(`Non-critical error fetching ${source} communications`, {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Perform collections analytics
   * @private
   */
  async _performAnalytics(data) {
    try {
      return await this.analyticsService.performCollectionsAnalysis(data);
    } catch (error) {
      logger.error('Analytics service error', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate actionable recommendations
   * @private
   */
  async _generateRecommendations(data, analytics) {
    try {
      return await this.recommendationService.generateRecommendations(data, analytics);
    } catch (error) {
      logger.error('Recommendation service error', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract communication identifiers from PME data
   * @private
   */
  _extractCommunicationIdentifiers(pmeData) {
    const identifiers = {
      phoneNumbers: new Set(),
      emails: new Set(),
      propertyIds: new Set(),
      tenantNames: new Set()
    };

    pmeData.forEach(record => {
      if (record.tenantPhone) {
        identifiers.phoneNumbers.add(record.tenantPhone);
      }
      if (record.tenantEmail) {
        identifiers.emails.add(record.tenantEmail);
      }
      if (record.propertyId) {
        identifiers.propertyIds.add(record.propertyId);
      }
      if (record.tenantName) {
        identifiers.tenantNames.add(record.tenantName);
      }
    });

    // Convert Sets to Arrays for easier handling
    return {
      phoneNumbers: Array.from(identifiers.phoneNumbers),
      emails: Array.from(identifiers.emails),
      propertyIds: Array.from(identifiers.propertyIds),
      tenantNames: Array.from(identifiers.tenantNames)
    };
  }

  /**
   * Retry operation with exponential backoff
   * @private
   */
  async _retryOperation(operation, options, operationName) {
    const { maxRetries = 3, backoffMs = 1000 } = options;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        logger.warn(`${operationName} attempt ${attempt} failed`, {
          error: error.message,
          attempt,
          maxRetries
        });

        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Health check for all integrated services
   * @returns {Promise<Object>} Health status of all services
   */
  async healthCheck() {
    logger.info('Performing health check on all services');

    const services = [
      { name: 'PME Integration', service: this.pmeService },
      { name: 'Communication', service: this.communicationService },
      { name: 'Analytics', service: this.analyticsService },
      { name: 'Recommendation', service: this.recommendationService }
    ];

    const healthResults = await Promise.allSettled(
      services.map(async ({ name, service }) => {
        try {
          const isHealthy = service.healthCheck ? await service.healthCheck() : true;
          return { name, status: isHealthy ? 'healthy' : 'unhealthy' };
        } catch (error) {
          return { name, status: 'error', error: error.message };
        }
      })
    );

    const results = {
      overall: 'healthy',
      services: {},
      timestamp: new Date().toISOString()
    };

    healthResults.forEach((result, index) => {
      const serviceName = services[index].name;
      if (result.status === 'fulfilled') {
        results.services[serviceName] = result.value;
        if (result.value.status !== 'healthy') {
          results.overall = 'degraded';
        }
      } else {
        results.services[serviceName] = {
          status: 'error',
          error: result.reason.message
        };
        results.overall = 'degraded';
      }
    });

    logger.info('Health check completed', { overall: results.overall });
    return results;
  }
}

module.exports = CollectionsController;