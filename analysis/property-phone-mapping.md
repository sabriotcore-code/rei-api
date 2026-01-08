# Current State
## Introduction
The current state of phone number mapping to properties in the rei-api codebase is analyzed in this document.
## Data Sources
The data sources for phone numbers are:
* Property management database
* Collections database
* User input
## Validation of Relationships
The relationships between phone numbers and properties are validated through:
* Database constraints
* Business logic in the application
## Multiple Contacts per Property
The system currently supports multiple contacts per property. Each contact has a preferred method of communication, which can be either SMS or email.
## Contact Preference Management
Contact preference management is handled through the user interface, where users can select their preferred method of communication.
## Coverage Gaps
The following coverage gaps were identified:
* Lack of validation for phone number format
* No handling for cases where a property has no associated contacts
* Insufficient logging for SMS-related events

# Gaps Identified
## Lack of Validation for Phone Number Format
The current implementation does not validate the format of phone numbers, which can lead to errors when sending SMS messages.
## No Handling for Cases Where a Property Has No Associated Contacts
The system does not handle cases where a property has no associated contacts, which can result in errors when attempting to send SMS messages.
## Insufficient Logging for SMS-Related Events
The current implementation does not provide sufficient logging for SMS-related events, making it difficult to diagnose issues.

# Recommendations
## Implement Phone Number Format Validation
Implement phone number format validation to ensure that only valid phone numbers are stored in the database.
## Handle Cases Where a Property Has No Associated Contacts
Handle cases where a property has no associated contacts by providing a default contact or by skipping SMS sending for such properties.
## Improve Logging for SMS-Related Events
Improve logging for SMS-related events to provide better visibility into system issues.