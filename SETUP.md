# REI API Setup Guide

## Step 1: Create Google Cloud Service Account

1. Go to: https://console.cloud.google.com/iam-admin/serviceaccounts
2. Select your project (or create one)
3. Click **+ CREATE SERVICE ACCOUNT**
4. Name: `rei-api-sheets`
5. Click **CREATE AND CONTINUE**
6. Skip role assignment, click **DONE**
7. Click on the new service account
8. Go to **KEYS** tab
9. Click **ADD KEY > Create new key > JSON**
10. Download the JSON file

## Step 2: Share Sheets with Service Account

The service account email looks like: `rei-api-sheets@your-project.iam.gserviceaccount.com`

Share these sheets with that email (Editor access):
- PME Sheet: `1AlnsbdcNAPK1pCCa_WQnlBicZ-jKl8fFSXSgn5eSOhg`
- Workflow Processor: `1MBGcdzYKcE_5VVk07b1iwlhXN0JDqSWv4o-fG29Ie7E`

## Step 3: Deploy to Railway

1. Go to: https://railway.app/new
2. Click **Deploy from GitHub repo**
3. Select `sabriotcore-code/rei-api`
4. Once created, go to **Variables** tab
5. Add variable:
   - Name: `GOOGLE_SERVICE_ACCOUNT_KEY`
   - Value: (paste the entire JSON key file contents)
6. Add variable:
   - Name: `NODE_ENV`
   - Value: `production`
7. Railway will auto-deploy

## Step 4: Get API URL

After deployment, Railway provides a URL like:
`https://rei-api-production.up.railway.app`

## Step 5: Update Dashboard

Update the dashboard's API_URL to point to the new Railway API:
```javascript
const DEFAULT_API_URL = 'https://rei-api-production.up.railway.app';
```

## Testing

```bash
# Health check
curl https://rei-api-production.up.railway.app/

# Ping
curl -X POST https://rei-api-production.up.railway.app/ \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}'

# Get todos
curl -X POST https://rei-api-production.up.railway.app/ \
  -H "Content-Type: application/json" \
  -d '{"action":"getTodos"}'
```
