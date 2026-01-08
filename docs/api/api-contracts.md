# API Contracts
## Introduction
This document outlines the API contracts for integrating PME, QUO SMS, and Gmail.
## Endpoints
### PME Data
* **GET /pme-data**: Retrieve PME data
### QUO SMS
* **POST /quo-sms**: Send SMS via QUO SMS
### Gmail Workflow
* **POST /gmail-workflow**: Trigger Gmail workflow
## Authentication
* **Bearer Token**: Authentication using bearer token (JWT)
## Data Formats
* **JSON**: All data will be sent and received in JSON format
## Security Considerations
* All API requests must be made over HTTPS
* Authentication tokens must be kept secure and not shared with unauthorized parties