// Import necessary modules
const GmailMetricsService = require('../services/gmail-metrics-service');
const fs = require('fs');
const path = require('path');

// EmailMetricsExtractor class
class EmailMetricsExtractor {
  constructor() {
    this.metricsService = new GmailMetricsService();
    this.dataFilePath = path.resolve(__dirname, '../../data/email_metrics.json');
  }

  async extractMetrics() {
    try {
      console.log('Starting to extract email metrics...');

      // Retrieve messages from Gmail
      const messages = await this.metricsService.fetchCollectionEmails();
      if (!messages) throw new Error('No messages retrieved from Gmail.');

      // Calculate metrics
      const metrics = {
        totalEmails: messages.length,
        openRate: this.calculateOpenRate(messages),
        clickRate: this.calculateClickRate(messages),
        responseRate: this.calculateResponseRate(messages)
      };

      // Save metrics to file
      fs.writeFileSync(this.dataFilePath, JSON.stringify(metrics, null, 2));
      console.log('Metrics extraction complete. Data saved to email_metrics.json');
    } catch (error) {
      console.error('Error extracting metrics:', error.message);
      throw error;
    }
  }

  calculateOpenRate(messages) {
    const opened = messages.filter(m => m.opened).length;
    return Math.round((opened / messages.length) * 100);
  }

  calculateClickRate(messages) {
    const clicked = messages.filter(m => m.clicked).length;
    return Math.round((clicked / messages.length) * 100);
  }

  calculateResponseRate(messages) {
    const responded = messages.filter(m => m.responded).length;
    return Math.round((responded / messages.length) * 100);
  }
}

module.exports = EmailMetricsExtractor;
