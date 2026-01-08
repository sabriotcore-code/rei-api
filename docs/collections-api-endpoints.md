# Collections API Endpoints
## Overview
The following API endpoints handle collections data for PME Master Sheet, including fields like BALANCE, LAST_PAYMENT, STATUS, and related tenant tracking workflows.
## Endpoints
### 1. GET /collections
* **Description**: Retrieves a list of all collections data.
* **Request Structure**:
  * `Authorization`: Bearer token (required)
  * `Query Parameters`:
    * `limit`: Number of records to return (optional, default: 100)
    * `offset`: Offset for pagination (optional, default: 0)
* **Response Structure**:
  * `collections`: Array of collection objects
    * `id`: Unique identifier for the collection
    * `BALANCE`: Current balance of the collection
    * `LAST_PAYMENT`: Date of the last payment
    * `STATUS`: Current status of the collection
* **Authentication Requirements**: Bearer token required
* **Business Logic**: The endpoint uses the provided query parameters to filter and paginate the results.

### 2. GET /collections/{id}
* **Description**: Retrieves a single collection by ID.
* **Request Structure**:
  * `Authorization`: Bearer token (required)
  * `Path Parameters`:
    * `id`: Unique identifier for the collection
* **Response Structure**:
  * `collection`: Collection object
    * `id`: Unique identifier for the collection
    * `BALANCE`: Current balance of the collection
    * `LAST_PAYMENT`: Date of the last payment
    * `STATUS`: Current status of the collection
* **Authentication Requirements**: Bearer token required
* **Business Logic**: The endpoint retrieves the collection data from the database using the provided ID.

### 3. POST /collections
* **Description**: Creates a new collection.
* **Request Structure**:
  * `Authorization`: Bearer token (required)
  * `Request Body`:
    * `BALANCE`: Initial balance of the collection
    * `LAST_PAYMENT`: Date of the first payment (optional)
    * `STATUS`: Initial status of the collection
* **Response Structure**:
  * `collection`: Created collection object
    * `id`: Unique identifier for the collection
    * `BALANCE`: Current balance of the collection
    * `LAST_PAYMENT`: Date of the last payment
    * `STATUS`: Current status of the collection
* **Authentication Requirements**: Bearer token required
* **Business Logic**: The endpoint validates the request data and creates a new collection in the database.

### 4. PUT /collections/{id}
* **Description**: Updates an existing collection.
* **Request Structure**:
  * `Authorization`: Bearer token (required)
  * `Path Parameters`:
    * `id`: Unique identifier for the collection
  * `Request Body`:
    * `BALANCE`: Updated balance of the collection (optional)
    * `LAST_PAYMENT`: Updated date of the last payment (optional)
    * `STATUS`: Updated status of the collection (optional)
* **Response Structure**:
  * `collection`: Updated collection object
    * `id`: Unique identifier for the collection
    * `BALANCE`: Current balance of the collection
    * `LAST_PAYMENT`: Date of the last payment
    * `STATUS`: Current status of the collection
* **Authentication Requirements**: Bearer token required
* **Business Logic**: The endpoint validates the request data and updates the existing collection in the database.

### 5. DELETE /collections/{id}
* **Description**: Deletes a collection by ID.
* **Request Structure**:
  * `Authorization`: Bearer token (required)
  * `Path Parameters`:
    * `id`: Unique identifier for the collection
* **Response Structure**:
  * `message`: Success message
* **Authentication Requirements**: Bearer token required
* **Business Logic**: The endpoint retrieves the collection data from the database using the provided ID and deletes it if it exists.