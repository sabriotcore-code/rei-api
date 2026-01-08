/**
 * Recommendation rules and configuration for property collections
 */

// Action types with priorities (lower number = higher priority)
const ACTION_TYPES = {
  URGENT_LEGAL: { priority: 1, category: 'legal' },
  PAYMENT_FOLLOW_UP: { priority: 2, category: 'communication' },
  INITIAL_CONTACT: { priority: 3, category: 'communication' },
  DOCUMENT_REQUEST: { priority: 4, category: 'documentation' },
  PAYMENT_PLAN: { priority: 5, category: 'negotiation' },
  STATUS_UPDATE: { priority: 6, category: 'monitoring' },
  COURTESY_REMINDER: { priority: 7, category: 'communication' },
  ROUTINE_CHECK: { priority: 8, category: 'monitoring' }
};

// Property status definitions
const PROPERTY_STATUSES = {
  NEW_DELINQUENT: 'new_delinquent',
  ACTIVE_COLLECTION: 'active_collection',
  PAYMENT_PLAN_ACTIVE: 'payment_plan_active',
  LEGAL_PROCEEDING: 'legal_proceeding',
  RESOLVED: 'resolved',
  WRITTEN_OFF: 'written_off'
};

// Communication types and their weights
const COMMUNICATION_WEIGHTS = {
  phone_call: 3,
  email: 2,
  text_message: 2,
  letter: 4,
  legal_notice: 5,
  in_person: 4
};

// Timeline thresholds (in days)
const TIMELINE_THRESHOLDS = {
  IMMEDIATE_ACTION: 0,
  URGENT_ACTION: 3,
  STANDARD_ACTION: 7,
  ROUTINE_ACTION: 14,
  LEGAL_THRESHOLD: 90,
  WRITE_OFF_THRESHOLD: 180
};

// Rule definitions for generating recommendations
const RECOMMENDATION_RULES = [
  {
    id: 'new_delinquent_initial',
    condition: (property) => {
      return property.status === PROPERTY_STATUSES.NEW_DELINQUENT &&
             property.daysSinceDelinquent <= 7 &&
             property.communicationHistory.length === 0;
    },
    action: ACTION_TYPES.INITIAL_CONTACT,
    description: 'Initial contact for new delinquent property',
    urgency: 'high',
    daysUntilDue: 1
  },
  {
    id: 'no_response_escalation',
    condition: (property) => {
      const lastComm = property.lastCommunication;
      return property.status === PROPERTY_STATUSES.ACTIVE_COLLECTION &&
             lastComm &&
             lastComm.daysSince > 14 &&
             property.communicationHistory.length >= 2;
    },
    action: ACTION_TYPES.URGENT_LEGAL,
    description: 'No response after multiple attempts - consider legal action',
    urgency: 'critical',
    daysUntilDue: 0
  },
  {
    id: 'payment_plan_follow_up',
    condition: (property) => {
      return property.status === PROPERTY_STATUSES.PAYMENT_PLAN_ACTIVE &&
             property.paymentPlan &&
             property.paymentPlan.missedPayments > 0;
    },
    action: ACTION_TYPES.PAYMENT_FOLLOW_UP,
    description: 'Follow up on missed payment plan installment',
    urgency: 'high',
    daysUntilDue: 2
  },
  {
    id: 'legal_threshold_reached',
    condition: (property) => {
      return property.daysSinceDelinquent >= TIMELINE_THRESHOLDS.LEGAL_THRESHOLD &&
             property.status !== PROPERTY_STATUSES.LEGAL_PROCEEDING &&
             property.outstandingAmount > 5000;
    },
    action: ACTION_TYPES.URGENT_LEGAL,
    description: 'Legal threshold reached for high-value debt',
    urgency: 'critical',
    daysUntilDue: 0
  },
  {
    id: 'document_collection',
    condition: (property) => {
      return property.status === PROPERTY_STATUSES.ACTIVE_COLLECTION &&
             (!property.documents || property.documents.length === 0) &&
             property.daysSinceDelinquent > 30;
    },
    action: ACTION_TYPES.DOCUMENT_REQUEST,
    description: 'Request supporting documentation for collection',
    urgency: 'medium',
    daysUntilDue: 7
  },
  {
    id: 'routine_status_check',
    condition: (property) => {
      const lastComm = property.lastCommunication;
      return property.status === PROPERTY_STATUSES.ACTIVE_COLLECTION &&
             lastComm &&
             lastComm.daysSince >= 30 &&
             lastComm.daysSince < 60;
    },
    action: ACTION_TYPES.STATUS_UPDATE,
    description: 'Routine status check and update',
    urgency: 'low',
    daysUntilDue: 14
  },
  {
    id: 'payment_plan_opportunity',
    condition: (property) => {
      return property.status === PROPERTY_STATUSES.ACTIVE_COLLECTION &&
             property.communicationHistory.length >= 2 &&
             !property.paymentPlan &&
             property.outstandingAmount < 10000;
    },
    action: ACTION_TYPES.PAYMENT_PLAN,
    description: 'Offer payment plan to resolve debt',
    urgency: 'medium',
    daysUntilDue: 5
  },
  {
    id: 'courtesy_reminder',
    condition: (property) => {
      const lastComm = property.lastCommunication;
      return property.status === PROPERTY_STATUSES.ACTIVE_COLLECTION &&
             lastComm &&
             lastComm.daysSince >= 7 &&
             lastComm.daysSince < 14 &&
             property.outstandingAmount < 5000;
    },
    action: ACTION_TYPES.COURTESY_REMINDER,
    description: 'Send courtesy reminder for outstanding balance',
    urgency: 'low',
    daysUntilDue: 7
  }
];

// Urgency level mappings
const URGENCY_LEVELS = {
  critical: { score: 100, color: '#dc3545' },
  high: { score: 75, color: '#fd7e14' },
  medium: { score: 50, color: '#ffc107' },
  low: { score: 25, color: '#28a745' }
};

module.exports = {
  ACTION_TYPES,
  PROPERTY_STATUSES,
  COMMUNICATION_WEIGHTS,
  TIMELINE_THRESHOLDS,
  RECOMMENDATION_RULES,
  URGENCY_LEVELS
};