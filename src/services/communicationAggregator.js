const { QuoService } = require('./quoService');
const { GmailService } = require('./gmailService');
const { PropertyService } = require('./propertyService');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

class CommunicationAggregator {
  constructor() {
    this.quoService = new QuoService();
    this.gmailService = new GmailService();
    this.propertyService = new PropertyService();
    this.communicationCache = new Map();
  }

  /**
   * Aggregates communication data from all sources for a given property
   * @param {string} propertyId - The property identifier
   * @param {Object} options - Aggregation options
   * @param {Date} options.startDate - Start date for communication retrieval
   * @param {Date} options.endDate - End date for communication retrieval
   * @param {boolean} options.includeArchived - Whether to include archived communications
   * @returns {Promise<Object>} Aggregated and deduplicated communication data
   */
  async aggregateForProperty(propertyId, options = {}) {
    try {
      logger.info(`Starting communication aggregation for property: ${propertyId}`);
      
      const { startDate, endDate, includeArchived = false } = options;
      
      // Get property details for contact matching
      const property = await this.propertyService.getProperty(propertyId);
      if (!property) {
        throw new Error(`Property not found: ${propertyId}`);
      }

      // Aggregate communications from all sources in parallel
      const [quoCommunications, gmailCommunications] = await Promise.allSettled([
        this.aggregateQuoCommunications(property, { startDate, endDate }),
        this.aggregateGmailCommunications(property, { startDate, endDate })
      ]);

      // Process results and handle any failures
      const allCommunications = [];
      
      if (quoCommunications.status === 'fulfilled') {
        allCommunications.push(...quoCommunications.value);
      } else {
        logger.error('Failed to retrieve Quo communications:', quoCommunications.reason);
      }

      if (gmailCommunications.status === 'fulfilled') {
        allCommunications.push(...gmailCommunications.value);
      } else {
        logger.error('Failed to retrieve Gmail communications:', gmailCommunications.reason);
      }

      // Deduplicate communications
      const deduplicatedCommunications = this.deduplicateCommunications(allCommunications);
      
      // Sort chronologically (newest first)
      const sortedCommunications = this.sortChronologically(deduplicatedCommunications);
      
      // Filter archived if needed
      const filteredCommunications = includeArchived ? 
        sortedCommunications : 
        sortedCommunications.filter(comm => !comm.archived);

      const result = {
        propertyId,
        property,
        communications: filteredCommunications,
        summary: this.generateSummary(filteredCommunications),
        lastUpdated: new Date().toISOString()
      };

      // Cache the result
      this.communicationCache.set(propertyId, {
        data: result,
        timestamp: Date.now()
      });

      logger.info(`Communication aggregation completed for property ${propertyId}: ${filteredCommunications.length} communications found`);
      return result;

    } catch (error) {
      logger.error(`Failed to aggregate communications for property ${propertyId}:`, error);
      throw error;
    }
  }

  /**
   * Aggregates communications from multiple properties
   * @param {string[]} propertyIds - Array of property identifiers
   * @param {Object} options - Aggregation options
   * @returns {Promise<Object[]>} Array of aggregated communication data
   */
  async aggregateForProperties(propertyIds, options = {}) {
    try {
      logger.info(`Starting bulk communication aggregation for ${propertyIds.length} properties`);
      
      // Process in batches to avoid overwhelming APIs
      const batchSize = 10;
      const results = [];
      
      for (let i = 0; i < propertyIds.length; i += batchSize) {
        const batch = propertyIds.slice(i, i + batchSize);
        const batchPromises = batch.map(propertyId => 
          this.aggregateForProperty(propertyId, options)
            .catch(error => {
              logger.error(`Failed to aggregate for property ${propertyId}:`, error);
              return { propertyId, error: error.message };
            })
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Add delay between batches to respect rate limits
        if (i + batchSize < propertyIds.length) {
          await this.delay(1000);
        }
      }
      
      logger.info(`Bulk communication aggregation completed: ${results.length} properties processed`);
      return results;
      
    } catch (error) {
      logger.error('Failed to aggregate communications for multiple properties:', error);
      throw error;
    }
  }

  /**
   * Retrieves communications from Quo service
   * @param {Object} property - Property object
   * @param {Object} options - Query options
   * @returns {Promise<Object[]>} Array of Quo communications
   */
  async aggregateQuoCommunications(property, options = {}) {
    try {
      const { startDate, endDate } = options;
      
      // Get contacts associated with the property
      const contacts = await this.getPropertyContacts(property);
      
      const communications = [];
      
      for (const contact of contacts) {
        try {
          const contactComms = await this.quoService.getCommunications({
            contact: contact.phone || contact.email,
            startDate,
            endDate
          });
          
          // Standardize the communication format
          const standardizedComms = contactComms.map(comm => this.standardizeCommunication({
            ...comm,
            source: 'quo',
            propertyId: property.id,
            contact
          }));
          
          communications.push(...standardizedComms);
          
        } catch (error) {
          logger.warn(`Failed to get Quo communications for contact ${contact.email || contact.phone}:`, error);
        }
      }
      
      return communications;
      
    } catch (error) {
      logger.error('Failed to aggregate Quo communications:', error);
      throw error;
    }
  }

  /**
   * Retrieves communications from Gmail service
   * @param {Object} property - Property object
   * @param {Object} options - Query options
   * @returns {Promise<Object[]>} Array of Gmail communications
   */
  async aggregateGmailCommunications(property, options = {}) {
    try {
      const { startDate, endDate } = options;
      
      // Get contacts associated with the property
      const contacts = await this.getPropertyContacts(property);
      
      const communications = [];
      
      for (const contact of contacts) {
        if (!contact.email) continue;
        
        try {
          const emailComms = await this.gmailService.getCommunications({
            contact: contact.email,
            startDate,
            endDate,
            propertyAddress: property.address
          });
          
          // Standardize the communication format
          const standardizedComms = emailComms.map(comm => this.standardizeCommunication({
            ...comm,
            source: 'gmail',
            propertyId: property.id,
            contact
          }));
          
          communications.push(...standardizedComms);
          
        } catch (error) {
          logger.warn(`Failed to get Gmail communications for contact ${contact.email}:`, error);
        }
      }
      
      return communications;
      
    } catch (error) {
      logger.error('Failed to aggregate Gmail communications:', error);
      throw error;
    }
  }

  /**
   * Gets contacts associated with a property
   * @param {Object} property - Property object
   * @returns {Promise<Object[]>} Array of contact objects
   */
  async getPropertyContacts(property) {
    const contacts = [];
    
    // Add tenant contacts
    if (property.tenant) {
      if (property.tenant.email || property.tenant.phone) {
        contacts.push({
          type: 'tenant',
          name: property.tenant.name,
          email: property.tenant.email,
          phone: property.tenant.phone
        });
      }
    }
    
    // Add property manager contacts
    if (property.propertyManager) {
      if (property.propertyManager.email || property.propertyManager.phone) {
        contacts.push({
          type: 'property_manager',
          name: property.propertyManager.name,
          email: property.propertyManager.email,
          phone: property.propertyManager.phone
        });
      }
    }
    
    // Add owner contacts
    if (property.owner) {
      if (property.owner.email || property.owner.phone) {
        contacts.push({
          type: 'owner',
          name: property.owner.name,
          email: property.owner.email,
          phone: property.owner.phone
        });
      }
    }
    
    return contacts;
  }

  /**
   * Standardizes communication objects from different sources
   * @param {Object} communication - Raw communication object
   * @returns {Object} Standardized communication object
   */
  standardizeCommunication(communication) {
    const standardized = {
      id: communication.id || this.generateCommunicationId(communication),
      propertyId: communication.propertyId,
      source: communication.source,
      type: communication.type || 'unknown', // email, sms, call, voicemail
      direction: communication.direction || 'unknown', // inbound, outbound
      timestamp: new Date(communication.timestamp || communication.date).toISOString(),
      contact: communication.contact,
      subject: communication.subject || '',
      content: communication.content || communication.body || '',
      metadata: {
        sourceId: communication.sourceId || communication.id,
        threadId: communication.threadId,
        messageId: communication.messageId,
        duration: communication.duration, // for calls
        attachments: communication.attachments || [],
        tags: communication.tags || [],
        priority: communication.priority || 'normal'
      },
      archived: communication.archived || false,
      read: communication.read !== undefined ? communication.read : true
    };
    
    // Generate content hash for deduplication
    standardized.contentHash = this.generateContentHash(standardized);
    
    return standardized;
  }

  /**
   * Deduplicates communications based on content and metadata
   * @param {Object[]} communications - Array of communications
   * @returns {Object[]} Deduplicated communications
   */
  deduplicateCommunications(communications) {
    const seen = new Map();
    const deduplicated = [];
    
    for (const comm of communications) {
      const key = comm.contentHash;
      
      if (!seen.has(key)) {
        seen.set(key, comm);
        deduplicated.push(comm);
      } else {
        // If duplicate found, merge metadata from different sources
        const existing = seen.get(key);
        existing.sources = existing.sources || [existing.source];
        
        if (!existing.sources.includes(comm.source)) {
          existing.sources.push(comm.source);
          // Update metadata with additional source info
          existing.metadata = {
            ...existing.metadata,
            [`${comm.source}Data`]: comm.metadata
          };
        }
      }
    }
    
    return deduplicated;
  }

  /**
   * Sorts communications chronologically (newest first)
   * @param {Object[]} communications - Array of communications
   * @returns {Object[]} Sorted communications
   */
  sortChronologically(communications) {
    return communications.sort((a, b) => {
      const dateA = new Date(a.timestamp);
      const dateB = new Date(b.timestamp);
      return dateB - dateA; // Newest first
    });
  }

  /**
   * Generates a summary of communications
   * @param {Object[]} communications - Array of communications
   * @returns {Object} Communication summary
   */
  generateSummary(communications) {
    const summary = {
      total: communications.length,
      byType: {},
      bySource: {},
      byDirection: {},
      dateRange: {},
      recentActivity: communications.slice(0, 5),
      unreadCount: communications.filter(c => !c.read).length
    };
    
    // Group by type
    communications.forEach(comm => {
      summary.byType[comm.type] = (summary.byType[comm.type] || 0) + 1;
      summary.bySource[comm.source] = (summary.bySource[comm.source] || 0) + 1;
      summary.byDirection[comm.direction] = (summary.byDirection[comm.direction] || 0) + 1;
    });
    
    // Calculate date range
    if (communications.length > 0) {
      const dates = communications.map(c => new Date(c.timestamp)).sort((a, b) => a - b);
      summary.dateRange = {
        earliest: dates[0].toISOString(),
        latest: dates[dates.length - 1].toISOString()
      };
    }
    
    return summary;
  }

  /**
   * Generates a unique ID for a communication
   * @param {Object} communication - Communication object
   * @returns {string} Generated ID
   */
  generateCommunicationId(communication) {
    const data = {
      source: communication.source,
      timestamp: communication.timestamp || communication.date,
      contact: communication.contact?.email || communication.contact?.phone,
      content: (communication.content || communication.body || '').substring(0, 100)
    };
    
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Generates a content hash for deduplication
   * @param {Object} communication - Standardized communication object
   * @returns {string} Content hash
   */
  generateContentHash(communication) {
    const hashData = {
      type: communication.type,
      direction: communication.direction,
      timestamp: communication.timestamp,
      contact: communication.contact?.email || communication.contact?.phone,
      subject: communication.subject,
      content: communication.content.replace(/\s+/g, ' ').trim().toLowerCase()
    };
    
    return crypto.createHash('sha256').update(JSON.stringify(hashData)).digest('hex');
  }

  /**
   * Clears the communication cache
   */
  clearCache() {
    this.communicationCache.clear();
    logger.info('Communication cache cleared');
  }

  /**
   * Gets cached communication data if available and not expired
   * @param {string} propertyId - Property identifier
   * @param {number} maxAge - Maximum age in milliseconds (default: 5 minutes)
   * @returns {Object|null} Cached data or null if not available/expired
   */
  getCachedData(propertyId, maxAge = 5 * 60 * 1000) {
    const cached = this.communicationCache.get(propertyId);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > maxAge) {
      this.communicationCache.delete(propertyId);
      return null;
    }
    
    return cached.data;
  }

  /**
   * Utility method to add delay
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets real-time communication updates for a property
   * @param {string} propertyId - Property identifier
   * @param {Date} since - Get updates since this date
   * @returns {Promise<Object[]>} New communications since the specified date
   */
  async getUpdates(propertyId, since) {
    try {
      logger.info(`Getting communication updates for property ${propertyId} since ${since}`);
      
      const property = await this.propertyService.getProperty(propertyId);
      if (!property) {
        throw new Error(`Property not found: ${propertyId}`);
      }

      // Get updates from all sources
      const [quoUpdates, gmailUpdates] = await Promise.allSettled([
        this.aggregateQuoCommunications(property, { startDate: since }),
        this.aggregateGmailCommunications(property, { startDate: since })
      ]);

      const allUpdates = [];
      
      if (quoUpdates.status === 'fulfilled') {
        allUpdates.push(...quoUpdates.value);
      }
      
      if (gmailUpdates.status === 'fulfilled') {
        allUpdates.push(...gmailUpdates.value);
      }

      return this.sortChronologically(this.deduplicateCommunications(allUpdates));
      
    } catch (error) {
      logger.error(`Failed to get communication updates for property ${propertyId}:`, error);
      throw error;
    }
  }
}

module.exports = { CommunicationAggregator };