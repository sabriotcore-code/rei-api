# System Diagrams

## Microservices Architecture Diagram
![Microservices Architecture Diagram](images/microservices-architecture.png)

### Key Components
- **API Gateway**: Acts as the entry point for client requests, routing them to appropriate microservices.
- **Authentication Service**: Handles user authentication and authorization.
- **Task Automation Service**: Core service for implementing business logic related to automation tasks.
- **Data Service**: Responsible for data storage and retrieval.

## Data Flow Diagram
![Data Flow Diagram](images/data-flow.png)

### Data Flow Description
1. **User Request**: Initiated through a client application and sent to the API Gateway.
2. **Authentication**: Validated by the Authentication Service.
3. **Processing**: Request is routed to the relevant microservice.
4. **Data Storage**: Interaction with the Data Service for database operations.
