# Automation Touchpoints Specification
## Introduction
This document outlines the automation points, triggers, and rules for integrating PME Master Sheet, QUO SMS, and Gmail for automated collections processes.
## Automation Points
The following automation points have been identified:
### 1. Payment Reminders
* Trigger: Overdue payment status in PME
* Action: Send payment reminder via QUO SMS and email via Gmail
* Rule: Send reminders 3 days after payment due date
### 2. Payment Confirmations
* Trigger: Payment receipt in PME
* Action: Send payment confirmation via QUO SMS and email via Gmail
* Rule: Send confirmations within 1 hour of payment receipt
### 3. Collections Escalations
* Trigger: Overdue payment status in PME
* Action: Escalate to collections team via email via Gmail
* Rule: Escalate 7 days after payment due date
## API Calls
The following API calls will be used to interact with the integrated systems:
### PME API
* GET /payments: Retrieve payment status
* POST /payments: Update payment status
### QUO SMS API
* POST /send-message: Send SMS message
### Gmail API
* POST /send-email: Send email
## Data Transformations
The following data transformations will be applied:
### Payment Status
* Overdue: 3 days after payment due date
* Paid: Payment receipt in PME
### Collections Status
* Escalated: 7 days after payment due date
## System Interactions
The following system interactions will be used:
### PME and QUO SMS
* PME will trigger QUO SMS to send payment reminders and confirmations
### QUO SMS and Gmail
* QUO SMS will trigger Gmail to send payment reminders and confirmations
### PME and Gmail
* PME will trigger Gmail to send collections escalations
