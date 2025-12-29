# REI API - Cloud Functions

Replacement for Apps Script web app API.

## Endpoints

All endpoints use POST to `/` with JSON body containing `action` field.

| Action | Description | Required Fields |
|--------|-------------|-----------------|
| `ping` | Health check | - |
| `getTodos` | Get to-do list | `filter` (optional) |
| `queueTodo` | Add new to-do | `reid`, `primary`, `payload.action`, `payload.who` |
| `updateTodo` | Update to-do | `todoId`, `updates` |
| `queueNote` | Add note | `reid`, `primary`, `payload.note` |
| `getAllPropertyLabels` | Get all property data | - |
| `getStatusConfig` | Get status list | - |
| `updatePropertyFlag` | Flag/unflag property | `reid`, `flagged` |

## Deployment

### Prerequisites
1. Google Cloud project with Cloud Functions API enabled
2. Service account with Sheets access
3. gcloud CLI installed and configured

### Deploy
```bash
npm run deploy
```

### Local Development
```bash
npm install
npm run dev
```

## Environment

Uses Application Default Credentials (ADC) for Google Sheets access.
For local dev, run: `gcloud auth application-default login`
