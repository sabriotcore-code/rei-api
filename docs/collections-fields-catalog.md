# Collections Fields Catalog

This document provides a comprehensive inventory of data fields related to collections in the PME Master Sheet, including database schemas, models, and API responses. This catalog aims to standardize field usage and improve collections management effectiveness.

## Field Inventory

### Common Fields

- **BALANCE**
  - **Type**: Decimal(10, 2)
  - **Usage**: Represents the outstanding balance for a tenant's account. Typically found in database tables and API endpoints related to billing and payments.

- **LAST_PAYMENT**
  - **Type**: DateTime
  - **Usage**: Records the date and time of the most recent payment made by the tenant. Used to track payment history and determine overdue accounts.

- **STATUS**
  - **Type**: Enum ('Current', 'Overdue', 'Delinquent', 'Closed')
  - **Usage**: Indicates the current status of the tenant's account. Critical for identifying accounts that require collection efforts.

### Tenant Tracking Fields

- **TENANT_ID**
  - **Type**: String (UUID format)
  - **Usage**: Unique identifier for each tenant. Used across all systems to link tenant-specific data.

- **CONTACT_NUMBER**
  - **Type**: String
  - **Usage**: Tenant's contact number, useful for direct communication in case of collections efforts.

- **EMAIL**
  - **Type**: String
  - **Usage**: Tenant's email address for sending payment reminders and notices of overdue accounts.

### Other Relevant Fields

- **PAYMENT_METHOD**
  - **Type**: Enum ('Credit Card', 'ACH', 'Check')
  - **Usage**: Tracks the method of payment used most recently or regularly by the tenant.

- **DUE_DATE**
  - **Type**: Date
  - **Usage**: Represents the next due date for payment, used to generate reminders and assess overdue status.

- **CREATED_AT**
  - **Type**: DateTime
  - **Usage**: Timestamp for when the account or entry was created, which helps in auditing and tracking changes over time.

- **UPDATED_AT**
  - **Type**: DateTime
  - **Usage**: Timestamp for the last update made to the account or entry, essential for understanding the history and lifecycle of the data.

## Recommendations
- Ensure all systems and agents use the same vocabulary and severity ratings (Critical, High, Medium, Low) to describe and prioritize issues.
- Regular audits should be conducted to ensure that the data fields align with current collections practices and requirements.

This inventory will be maintained and updated as needed to reflect any changes or additions to the data fields in use across the PME Master Sheet collections.
