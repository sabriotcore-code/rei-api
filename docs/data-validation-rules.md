# Collections Data Validation Rules

## Introduction
This document outlines the existing validation rules for collections data fields in the PME Master Sheet. It covers the current validation logic, constraints, and business rules applied to collections data entry and updates.

## Validation Rules
The following validation rules are currently applied to collections data fields:

### Balance Field
* The balance field must be a numeric value.
* The balance field must be greater than or equal to 0.

### Last Payment Field
* The last payment field must be a date in the format YYYY-MM-DD.
* The last payment field must not be in the future.

### Status Field
* The status field must be one of the following values: Active, Inactive, Pending, or Closed.

## Constraints
The following constraints are currently applied to collections data entry and updates:

### Tenant Tracking Workflows
* All tenant tracking workflows must be completed before updating the status field.

## Business Rules
The following business rules are currently applied to collections data entry and updates:

### Collections Management Effectiveness
* All collections data must be accurate and up-to-date to ensure effective collections management.

## Severity Ratings
The following severity ratings are used to document issues:

* Critical: Issues that have a significant impact on collections management effectiveness.
* High: Issues that have a moderate impact on collections management effectiveness.
* Medium: Issues that have a minor impact on collections management effectiveness.
* Low: Issues that have a minimal impact on collections management effectiveness.

## Terminology
All agents must use consistent terminology when documenting issues. The following terms are defined:

* Collections data: Refers to the data stored in the PME Master Sheet related to collections.
* Tenant tracking workflows: Refers to the workflows used to track tenant information.
