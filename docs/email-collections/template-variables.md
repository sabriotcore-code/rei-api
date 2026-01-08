# Email Template Variables Documentation
## Introduction
This document outlines the variables used in email templates, their data sources, formatting rules, and conditional logic for personalization.
## Variables
The following variables are used in email templates:
* `{{username}}`: The username of the user receiving the email.
* `{{emailAddress}}`: The email address of the user receiving the email.
* `{{collectionName}}`: The name of the collection being emailed.
* `{{collectionDescription}}`: A brief description of the collection being emailed.
## Data Sources
The data sources for these variables are:
* `username` and `emailAddress`: Retrieved from the user's profile information in the database.
* `collectionName` and `collectionDescription`: Retrieved from the collection's metadata in the database.
## Formatting Rules
The following formatting rules apply to the variables:
* `username` is displayed in title case.
* `emailAddress` is displayed in lowercase.
* `collectionName` is displayed in title case.
* `collectionDescription` is displayed in sentence case.
## Conditional Logic
The following conditional logic applies to the variables:
* If the user has not provided a username, the `{{username}}` variable will display the user's email address instead.
* If the collection does not have a description, the `{{collectionDescription}}` variable will display a default message.