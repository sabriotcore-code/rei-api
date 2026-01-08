# Repository Structure for PME Master Sheet Collections Data

## Overview
The repository structure for PME Master Sheet collections data is organized into the following main components:

* `database/models`: contains database models for PME Master Sheet and collections data
* `api/endpoints`: contains API endpoints for interacting with PME Master Sheet and collections data
* `config`: contains configuration files for the application

## Database Models
The database models for PME Master Sheet and collections data are defined in the `database/models` directory. The main models are:

* `PmeMasterSheet.js`: defines the structure for the PME Master Sheet data, including fields like BALANCE, LAST_PAYMENT, and STATUS
* `CollectionsData.js`: defines the structure for the collections data, including fields like tenant tracking workflows

## API Endpoints
The API endpoints for interacting with PME Master Sheet and collections data are defined in the `api/endpoints` directory. The main endpoints are:

* `GET /pme-master-sheets`: retrieves a list of all PME Master Sheets
* `GET /pme-master-sheets/{id}`: retrieves a single PME Master Sheet by ID
* `POST /pme-master-sheets`: creates a new PME Master Sheet
* `PUT /pme-master-sheets/{id}`: updates an existing PME Master Sheet
* `DELETE /pme-master-sheets/{id}`: deletes a PME Master Sheet
* `GET /collections-data`: retrieves a list of all collections data
* `GET /collections-data/{id}`: retrieves a single collections data by ID
* `POST /collections-data`: creates a new collections data
* `PUT /collections-data/{id}`: updates an existing collections data
* `DELETE /collections-data/{id}`: deletes a collections data

## Configuration Files
The configuration files for the application are defined in the `config` directory. The main configuration files are:

* `database.js`: defines the database connection settings
* `api.js`: defines the API settings, including authentication and authorization
* `collections.js`: defines the collections settings, including tenant tracking workflows

## Map of Relevant Files and their Purposes
The following is a comprehensive map of relevant files and their purposes:

* `database/models/PmeMasterSheet.js`: defines the PME Master Sheet database model
* `database/models/CollectionsData.js`: defines the collections data database model
* `api/endpoints/pme-master-sheets.js`: defines the API endpoints for PME Master Sheet data
* `api/endpoints/collections-data.js`: defines the API endpoints for collections data
* `config/database.js`: defines the database connection settings
* `config/api.js`: defines the API settings
* `config/collections.js`: defines the collections settings