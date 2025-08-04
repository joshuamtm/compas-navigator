const serverless = require('serverless-http');
const app = require('../../server');

// Configure serverless-http for better compatibility
const handler = serverless(app, {
  binary: false,
  requestId: false,
  stripBasePath: true
});

// Export handler for Netlify Functions
exports.handler = async (event, context) => {
  // Set Netlify environment flag
  process.env.NETLIFY = 'true';
  
  try {
    const result = await handler(event, context);
    return result;
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};