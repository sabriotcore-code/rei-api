# SMS Database Schema
## Introduction
The SMS database schema is designed to store message history, customer preferences, opt-out handling, and communication logs for collections/debt recovery communications within the rei-api system.
## Message History Storage
The message history storage table is used to store all incoming and outgoing SMS messages.
### Table: `message_history`
| Column Name | Data Type | Description |
| --- | --- | --- |
| `id` | `integer` | Unique message ID |
| `customer_id` | `integer` | Foreign key referencing the `customers` table |
| `message_type` | `string` | Type of message (e.g., incoming, outgoing) |
| `message_content` | `text` | Content of the SMS message |
| `created_at` | `timestamp` | Timestamp when the message was sent/received |
## Customer Preferences
The customer preferences table is used to store customer communication preferences.
### Table: `customer_preferences`
| Column Name | Data Type | Description |
| --- | --- | --- |
| `id` | `integer` | Unique customer preference ID |
| `customer_id` | `integer` | Foreign key referencing the `customers` table |
| `communication_channel` | `string` | Preferred communication channel (e.g., SMS, email) |
| `opt_out` | `boolean` | Whether the customer has opted out of communications |
## Opt-out Handling
The opt-out handling table is used to store customer opt-out requests.
### Table: `opt_out_requests`
| Column Name | Data Type | Description |
| --- | --- | --- |
| `id` | `integer` | Unique opt-out request ID |
| `customer_id` | `integer` | Foreign key referencing the `customers` table |
| `request_date` | `date` | Date the opt-out request was made |
## Communication Logs
The communication logs table is used to store all communication attempts.
### Table: `communication_logs`
| Column Name | Data Type | Description |
| --- | --- | --- |
| `id` | `integer` | Unique communication log ID |
| `customer_id` | `integer` | Foreign key referencing the `customers` table |
| `communication_channel` | `string` | Channel used for communication (e.g., SMS, email) |
| `attempt_date` | `date` | Date the communication attempt was made |
| `success` | `boolean` | Whether the communication attempt was successful |
