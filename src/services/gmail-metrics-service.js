// Import necessary modules
const { google } = require('googleapis');

// GmailMetricsService class
class GmailMetricsService {
  constructor() {
    this.auth = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      process.env.REDIRECT_URI
    );

    this.auth.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
  }

  async fetchCollectionEmails() {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: 'label:collections after:2022/08/01 before:2023/08/01',
        maxResults: 1000 // Adjust as needed
      });

      const messages = response.data.messages || [];
      console.log(`Fetched ${messages.length} messages from Gmail.`);

      const fullMessages = await Promise.all(messages.map(msg => this.fetchMessageById(msg.id)));
      return fullMessages;
    } catch (error) {
      console.error('Error fetching emails:', error.message);
      throw error;
    }
  }

  async fetchMessageById(messageId) {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId
      });

      const messageData = res.data;
      return {
        id: messageData.id,
        opened: this.messageWasOpened(messageData),
        clicked: this.messageHasClicks(messageData),
        responded: this.messageHasResponse(messageData)
      };
    } catch (error) {
      console.error(`Error fetching message by ID: ${messageId}`, error.message);
      throw error;
    }
  }

  messageWasOpened(messageData) {
    // Placeholder logic
    return messageData.labelIds.includes('UNREAD') === false;
  }

  messageHasClicks(messageData) {
    // Placeholder logic
    return messageData.labelIds.includes('CLICKED');
  }

  messageHasResponse(messageData) {
    // Placeholder logic
    return messageData.labelIds.includes('RESPONDED');
  }
}

module.exports = GmailMetricsService;
