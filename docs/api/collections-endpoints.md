# Collections API Endpoints
## Introduction
The collections API provides endpoints for analyzing real estate collections and tracking communication history.
## Endpoints
### GET /collections
Returns a list of all collections.
### GET /collections/{id}
Returns a specific collection by ID.
### POST /collections
Creates a new collection.
### PUT /collections/{id}
Updates a specific collection by ID.
### DELETE /collections/{id}
Deletes a specific collection by ID.
## Authentication
All API requests require authentication using a valid API key or OAuth token.
## Rate Limiting
The API has a rate limit of 100 requests per hour. Exceeding this limit will result in a 429 error response.