const path = require('path');

module.exports = {
  chromePath: process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  baseUrl: process.env.QA_BASE_URL || 'http://localhost:5173',
  headless: process.env.QA_HEADLESS === 'false' ? false : 'new',
  screenshotsDir: path.join(__dirname, 'screenshots'),
  resultsDir: path.join(__dirname, 'results'),
};
