const { OpenAI } = require('openai');

exports.handler = async (event, context) => {
  // Test OpenAI API key
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "Hello from COMPAS Navigator test!"' }
      ],
      max_tokens: 50
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: response.choices[0].message.content,
        apiKeyStatus: process.env.OPENAI_API_KEY ? 'configured' : 'missing'
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        apiKeyStatus: process.env.OPENAI_API_KEY ? 'configured but invalid' : 'missing'
      })
    };
  }
};