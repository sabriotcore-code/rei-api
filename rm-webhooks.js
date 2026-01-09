// ============================================================================
// RENT MANAGER WEBHOOKS - Add to index.js before CLOUD FUNCTIONS EXPORT
// ============================================================================

// Log Rent Manager webhook to sheet
async function logRMWebhook(eventType, payload) {
  try {
    const tabName = 'RM_WEBHOOKS';
    await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, tabName,
      ['WEBHOOK_ID', 'TIMESTAMP', 'EVENT_TYPE', 'ENTITY_ID', 'ENTITY_TYPE', 'PAYLOAD', 'PROCESSED']);

    const webhookId = generateId('RMWH');
    const entityId = payload.id || payload.TenantID || payload.PropertyID || payload.OwnerID || '';
    const entityType = eventType.split('.')[0] || eventType;

    await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${tabName}!A:G`, [
      webhookId,
      formatTimestamp(new Date()),
      eventType,
      entityId,
      entityType,
      JSON.stringify(payload).substring(0, 5000),
      'NEW'
    ]);

    console.log('RM webhook logged:', { webhookId, eventType, entityId });
    return webhookId;
  } catch (err) {
    console.error('Failed to log RM webhook:', err.message);
    return null;
  }
}

// POST /webhooks/rentmanager - Main Rent Manager webhook receiver
app.post('/webhooks/rentmanager', async (req, res) => {
  try {
    const event = req.body;
    console.log('RM webhook:', JSON.stringify(event).substring(0, 300));
    const eventType = event.type || event.eventType || 'unknown';
    const webhookId = await logRMWebhook(eventType, event);
    res.json({ success: true, webhookId, eventType });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tenant webhook
app.post('/webhooks/rentmanager/tenant', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('tenant', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Tenant contact webhook
app.post('/webhooks/rentmanager/tenant-contact', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('tenant-contact', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Tenant history webhook
app.post('/webhooks/rentmanager/tenant-history', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('tenant-history', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Owner webhook
app.post('/webhooks/rentmanager/owner', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('owner', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Prospect webhook
app.post('/webhooks/rentmanager/prospect', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('prospect', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Service issue webhook
app.post('/webhooks/rentmanager/service-issue', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('service-issue', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Vendor webhook
app.post('/webhooks/rentmanager/vendor', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('vendor', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Application webhook
app.post('/webhooks/rentmanager/application', async (req, res) => {
  try { res.json({ success: true, webhookId: await logRMWebhook('application', req.body) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Webhook status endpoint
app.get('/webhooks/rentmanager/status', (req, res) => {
  res.json({
    success: true,
    service: 'Rent Manager Webhooks',
    endpoints: [
      '/webhooks/rentmanager',
      '/webhooks/rentmanager/tenant',
      '/webhooks/rentmanager/tenant-contact',
      '/webhooks/rentmanager/tenant-history',
      '/webhooks/rentmanager/owner',
      '/webhooks/rentmanager/prospect',
      '/webhooks/rentmanager/service-issue',
      '/webhooks/rentmanager/vendor',
      '/webhooks/rentmanager/application'
    ],
    baseUrl: 'https://rei-api-production.up.railway.app'
  });
});
