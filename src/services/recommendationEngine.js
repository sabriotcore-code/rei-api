const {
  ACTION_TYPES,
  PROPERTY_STATUSES,
  COMMUNICATION_WEIGHTS,
  TIMELINE_THRESHOLDS,
  RECOMMENDATION_RULES,
  URGENCY_LEVELS
} = require('../config/recommendationRules');

class RecommendationEngine {
  constructor() {
    this.rules = RECOMMENDATION_RULES;
  }

  /**
   * Generate recommendations for a single property
   * @param {Object} property - Property data with status, communication history, etc.
   * @returns {Array} Array of recommended actions
   */
  generateRecommendationsForProperty(property) {
    try {
      const enrichedProperty = this.enrichPropertyData(property);
      const applicableRules = this.findApplicableRules(enrichedProperty);
      const recommendations = this.buildRecommendations(applicableRules, enrichedProperty);
      
      return this.prioritizeRecommendations(recommendations);
    } catch (error) {
      console.error('Error generating recommendations for property:', property.id, error);
      return [];
    }
  }

  /**
   * Generate recommendations for multiple properties
   * @param {Array} properties - Array of property objects
   * @returns {Array} Prioritized list of all recommendations
   */
  generateBatchRecommendations(properties) {
    try {
      const allRecommendations = [];
      
      properties.forEach(property => {
        const propertyRecommendations = this.generateRecommendationsForProperty(property);
        allRecommendations.push(...propertyRecommendations);
      });
      
      return this.prioritizeRecommendations(allRecommendations);
    } catch (error) {
      console.error('Error generating batch recommendations:', error);
      return [];
    }
  }

  /**
   * Enrich property data with calculated fields
   * @param {Object} property - Raw property data
   * @returns {Object} Enriched property data
   */
  enrichPropertyData(property) {
    const now = new Date();
    const delinquentDate = new Date(property.delinquentDate || property.createdDate);
    
    return {
      ...property,
      daysSinceDelinquent: Math.floor((now - delinquentDate) / (1000 * 60 * 60 * 24)),
      lastCommunication: this.getLastCommunication(property.communicationHistory || []),
      communicationScore: this.calculateCommunicationScore(property.communicationHistory || []),
      riskScore: this.calculateRiskScore(property)
    };
  }

  /**
   * Find rules that apply to the given property
   * @param {Object} property - Enriched property data
   * @returns {Array} Applicable rules
   */
  findApplicableRules(property) {
    return this.rules.filter(rule => {
      try {
        return rule.condition(property);
      } catch (error) {
        console.warn('Error evaluating rule condition:', rule.id, error);
        return false;
      }
    });
  }

  /**
   * Build recommendation objects from applicable rules
   * @param {Array} rules - Applicable rules
   * @param {Object} property - Property data
   * @returns {Array} Recommendation objects
   */
  buildRecommendations(rules, property) {
    return rules.map(rule => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + rule.daysUntilDue);
      
      return {
        id: `${property.id}_${rule.id}_${Date.now()}`,
        propertyId: property.id,
        propertyAddress: property.address,
        tenantName: property.tenantName,
        actionType: rule.action,
        description: rule.description,
        urgency: rule.urgency,
        urgencyScore: URGENCY_LEVELS[rule.urgency].score,
        priority: rule.action.priority,
        dueDate: dueDate,
        daysUntilDue: rule.daysUntilDue,
        outstandingAmount: property.outstandingAmount,
        daysSinceDelinquent: property.daysSinceDelinquent,
        lastCommunication: property.lastCommunication,
        riskScore: property.riskScore,
        createdAt: new Date(),
        category: rule.action.category,
        context: this.buildActionContext(property, rule)
      };
    });
  }

  /**
   * Prioritize recommendations based on urgency, priority, and risk
   * @param {Array} recommendations - Array of recommendation objects
   * @returns {Array} Sorted recommendations
   */
  prioritizeRecommendations(recommendations) {
    return recommendations.sort((a, b) => {
      // First sort by urgency score (higher is more urgent)
      if (a.urgencyScore !== b.urgencyScore) {
        return b.urgencyScore - a.urgencyScore;
      }
      
      // Then by action priority (lower number is higher priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      
      // Then by risk score (higher is more risky)
      if (a.riskScore !== b.riskScore) {
        return b.riskScore - a.riskScore;
      }
      
      // Then by outstanding amount (higher amount first)
      if (a.outstandingAmount !== b.outstandingAmount) {
        return b.outstandingAmount - a.outstandingAmount;
      }
      
      // Finally by days since delinquent (older first)
      return b.daysSinceDelinquent - a.daysSinceDelinquent;
    });
  }

  /**
   * Get the most recent communication
   * @param {Array} communicationHistory - Array of communication records
   * @returns {Object|null} Last communication or null
   */
  getLastCommunication(communicationHistory) {
    if (!communicationHistory || communicationHistory.length === 0) {
      return null;
    }
    
    const sorted = communicationHistory.sort((a, b) => 
      new Date(b.date) - new Date(a.date)
    );
    
    const lastComm = sorted[0];
    const now = new Date();
    const commDate = new Date(lastComm.date);
    
    return {
      ...lastComm,
      daysSince: Math.floor((now - commDate) / (1000 * 60 * 60 * 24))
    };
  }

  /**
   * Calculate a communication effectiveness score
   * @param {Array} communicationHistory - Array of communication records
   * @returns {number} Communication score (0-100)
   */
  calculateCommunicationScore(communicationHistory) {
    if (!communicationHistory || communicationHistory.length === 0) {
      return 0;
    }
    
    let totalWeight = 0;
    let recentWeight = 0;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    communicationHistory.forEach(comm => {
      const weight = COMMUNICATION_WEIGHTS[comm.type] || 1;
      totalWeight += weight;
      
      if (new Date(comm.date) > thirtyDaysAgo) {
        recentWeight += weight;
      }
    });
    
    // Score based on recent communication activity
    const baseScore = Math.min(totalWeight * 5, 100);
    const recentBonus = recentWeight * 10;
    
    return Math.min(baseScore + recentBonus, 100);
  }

  /**
   * Calculate risk score for a property
   * @param {Object} property - Property data
   * @returns {number} Risk score (0-100)
   */
  calculateRiskScore(property) {
    let riskScore = 0;
    
    // Amount-based risk
    if (property.outstandingAmount > 10000) riskScore += 30;
    else if (property.outstandingAmount > 5000) riskScore += 20;
    else if (property.outstandingAmount > 2000) riskScore += 10;
    
    // Time-based risk
    const daysSince = property.daysSinceDelinquent || 0;
    if (daysSince > 90) riskScore += 25;
    else if (daysSince > 60) riskScore += 20;
    else if (daysSince > 30) riskScore += 15;
    else if (daysSince > 14) riskScore += 10;
    
    // Communication-based risk
    const commHistory = property.communicationHistory || [];
    if (commHistory.length === 0) riskScore += 15;
    else if (commHistory.length === 1) riskScore += 10;
    
    // Status-based risk
    if (property.status === PROPERTY_STATUSES.LEGAL_PROCEEDING) riskScore += 20;
    else if (property.status === PROPERTY_STATUSES.ACTIVE_COLLECTION) riskScore += 10;
    
    // Payment plan risk
    if (property.paymentPlan && property.paymentPlan.missedPayments > 0) {
      riskScore += property.paymentPlan.missedPayments * 5;
    }
    
    return Math.min(riskScore, 100);
  }

  /**
   * Build context information for an action
   * @param {Object} property - Property data
   * @param {Object} rule - Applied rule
   * @returns {Object} Action context
   */
  buildActionContext(property, rule) {
    return {
      propertyStatus: property.status,
      daysSinceDelinquent: property.daysSinceDelinquent,
      outstandingAmount: property.outstandingAmount,
      communicationCount: property.communicationHistory ? property.communicationHistory.length : 0,
      lastCommunicationDays: property.lastCommunication ? property.lastCommunication.daysSince : null,
      hasPaymentPlan: !!property.paymentPlan,
      missedPayments: property.paymentPlan ? property.paymentPlan.missedPayments : 0,
      ruleTriggered: rule.id,
      suggestedActions: this.getSuggestedActionSteps(rule.action)
    };
  }

  /**
   * Get suggested action steps for an action type
   * @param {Object} actionType - Action type object
   * @returns {Array} Array of suggested steps
   */
  getSuggestedActionSteps(actionType) {
    const stepMap = {
      [ACTION_TYPES.INITIAL_CONTACT]: [
        'Send formal notice of delinquency',
        'Attempt phone contact with tenant',
        'Document all communication attempts'
      ],
      [ACTION_TYPES.PAYMENT_FOLLOW_UP]: [
        'Review payment plan terms',
        'Contact tenant about missed payment',
        'Consider payment plan modification if needed'
      ],
      [ACTION_TYPES.URGENT_LEGAL]: [
        'Review case for legal action',
        'Prepare legal documentation',
        'Consult with legal counsel',
        'Send final demand notice'
      ],
      [ACTION_TYPES.DOCUMENT_REQUEST]: [
        'Request lease agreements',
        'Obtain payment history',
        'Gather supporting documentation'
      ],
      [ACTION_TYPES.PAYMENT_PLAN]: [
        'Assess tenant financial situation',
        'Propose payment plan terms',
        'Document agreement if accepted'
      ],
      [ACTION_TYPES.STATUS_UPDATE]: [
        'Contact tenant for status update',
        'Review account activity',
        'Update case notes'
      ],
      [ACTION_TYPES.COURTESY_REMINDER]: [
        'Send friendly reminder',
        'Provide payment options',
        'Schedule follow-up if needed'
      ],
      [ACTION_TYPES.ROUTINE_CHECK]: [
        'Review case status',
        'Check for any payments received',
        'Update timeline as needed'
      ]
    };
    
    return stepMap[actionType] || ['Review case and take appropriate action'];
  }

  /**
   * Filter recommendations by criteria
   * @param {Array} recommendations - Array of recommendations
   * @param {Object} filters - Filter criteria
   * @returns {Array} Filtered recommendations
   */
  filterRecommendations(recommendations, filters = {}) {
    return recommendations.filter(rec => {
      if (filters.urgency && rec.urgency !== filters.urgency) return false;
      if (filters.category && rec.category !== filters.category) return false;
      if (filters.minAmount && rec.outstandingAmount < filters.minAmount) return false;
      if (filters.maxAmount && rec.outstandingAmount > filters.maxAmount) return false;
      if (filters.propertyIds && !filters.propertyIds.includes(rec.propertyId)) return false;
      
      return true;
    });
  }

  /**
   * Get summary statistics for recommendations
   * @param {Array} recommendations - Array of recommendations
   * @returns {Object} Summary statistics
   */
  getRecommendationSummary(recommendations) {
    const summary = {
      total: recommendations.length,
      byUrgency: {},
      byCategory: {},
      totalOutstanding: 0,
      averageRisk: 0
    };
    
    recommendations.forEach(rec => {
      // Count by urgency
      summary.byUrgency[rec.urgency] = (summary.byUrgency[rec.urgency] || 0) + 1;
      
      // Count by category
      summary.byCategory[rec.category] = (summary.byCategory[rec.category] || 0) + 1;
      
      // Sum outstanding amounts
      summary.totalOutstanding += rec.outstandingAmount || 0;
      
      // Sum risk scores for average
      summary.averageRisk += rec.riskScore || 0;
    });
    
    if (recommendations.length > 0) {
      summary.averageRisk = Math.round(summary.averageRisk / recommendations.length);
    }
    
    return summary;
  }
}

module.exports = RecommendationEngine;