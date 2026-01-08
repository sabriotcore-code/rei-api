// Import necessary modules
const fs = require('fs');
const path = require('path');

// Sample email templates data
const emailTemplates = [
  {
    id: "template1",
    purpose: "initial notice",
    tone: "friendly",
    usageFrequency: "high",
    openRate: 0.65,
    responseRate: 0.3,
    collectionSuccess: 0.2
  },
  {
    id: "template2",
    purpose: "reminder",
    tone: "formal",
    usageFrequency: "medium",
    openRate: 0.55,
    responseRate: 0.25,
    collectionSuccess: 0.15
  },
  {
    id: "template3",
    purpose: "final notice",
    tone: "urgent",
    usageFrequency: "low",
    openRate: 0.45,
    responseRate: 0.17,
    collectionSuccess: 0.1
  },
  {
    id: "template4",
    purpose: "payment confirmation",
    tone: "friendly",
    usageFrequency: "high",
    openRate: 0.90,
    responseRate: 0.85,
    collectionSuccess: 0.9
  }
];

// Function to categorize email templates
function categorizeTemplates(templates) {
  const categorized = templates.reduce((acc, template) => {
    if (!acc[template.purpose]) {
      acc[template.purpose] = [];
    }
    acc[template.purpose].push(template);
    return acc;
  }, {});

  return categorized;
}

// Get categorized email templates
const categorizedTemplates = categorizeTemplates(emailTemplates);

// Define path for output JSON file
const outputPath = path.join(__dirname, '../../data/email-templates-categorized.json');

// Save the categorized templates to a JSON file
fs.writeFileSync(outputPath, JSON.stringify(categorizedTemplates, null, 2));

console.log('Email templates have been categorized and saved to:', outputPath);
