const serverless = require('serverless-http');
const app = require('../../server');

// Export handler for Netlify Functions
exports.handler = serverless(app);