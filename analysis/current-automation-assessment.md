# Current State of SMS Collections Automation
## Overview
The QUO SMS Collections Integration for the rei-api codebase currently utilizes a combination of scheduled sends, trigger-based messaging, and rule-based escalations for automating SMS collections. The assessment of the existing automation revealed the following components:
### Scheduled Sends
* A daily cron job is set up in the `config/cron.js` file to send reminder SMS to customers with overdue payments.
* The `services/smsService.js` file contains a function `sendScheduledSms` that handles the logic for sending scheduled SMS.
### Trigger-Based Messaging
* The `controllers/collectionsController.js` file contains a function `sendTriggerSms` that sends an SMS to customers when a specific trigger event occurs (e.g., payment failure).
* The `models/collectionsModel.js` file defines a schema for storing trigger events and corresponding SMS templates.
### Rule-Based Escalations
* The `config/rules.js` file defines a set of rules for escalating collections cases based on customer payment history and other factors.
* The `services/escalationService.js` file contains a function `evaluateEscalationRules` that applies the defined rules to determine if a case should be escalated.

## Gaps Identified
After reviewing the existing automation, the following gaps were identified:
* Manual review of customer payment history to determine eligibility for SMS reminders.
* Lack of automation for handling bounced or undeliverable SMS.
* Inadequate logging and tracking of SMS sends and responses.

## Recommendations
Based on the identified gaps, the following recommendations are made:
* Implement automated review of customer payment history using a scheduled job or trigger-based approach.
* Develop a system for handling bounced or undeliverable SMS, including automatic retry or notification of collections agents.
* Enhance logging and tracking of SMS sends and responses to improve visibility and compliance with regulatory requirements (TCPA).
