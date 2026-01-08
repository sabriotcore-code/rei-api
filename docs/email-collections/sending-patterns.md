# Sending Patterns
## Introduction
This document outlines the email sending logic, timing mechanisms, scheduling systems, and frequency patterns used in the email collections system.
## Email Triggers
Emails are triggered by the following events:
* Successful payment
* Failed payment
* Payment reminder
* Payment overdue
## Batch Sending Processes
Batch sending processes are used to send emails in bulk. The batch sending process is triggered every hour.
## Timing Intervals
The timing intervals used in the email collections system are as follows:
* Payment reminder: 3 days before payment due date
* Payment overdue: 1 day after payment due date
## Frequency Patterns
The frequency patterns used in the email collections system are as follows:
* Payment reminder: sent every 3 days until payment is made
* Payment overdue: sent every 7 days until payment is made