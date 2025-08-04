const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');

// Simple in-memory session storage for serverless
const sessions = new Map();

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// COMPAS stages
const COMPAS_STAGES = {
  CONTEXT_DISCOVERY: 'context_discovery',
  OBJECTIVE_DEFINITION: 'objective_definition',
  METHOD_IDEATION: 'method_ideation',
  METHOD_SELECTION: 'method_selection', 
  IMPLEMENTATION_PLAN: 'implementation_plan',
  COMPLETE: 'complete'
};

// Session state class
class SessionState {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.stage = COMPAS_STAGES.CONTEXT_DISCOVERY;
    this.conversationHistory = [];
    this.context = {
      facts: [],
      artifacts: []
    };
    this.objective = null;
    this.methods = [];
    this.chosenMethod = null;
    this.implementationPlan = null;
    this.performanceMeasures = [];
    this.learningQuestions = [];
  }

  addMessage(role, content) {
    this.conversationHistory.push({ role, content, timestamp: new Date() });
  }

  getSystemPrompt() {
    return `You are COMPAS Navigator, a coaching agent for nonprofit practitioners. Your goal is to steer each user through a real-world challenge with the COMPAS framework and return a concise, action-ready plan.

Current Stage: ${this.stage}
Context Facts: ${JSON.stringify(this.context.facts, null, 2)}
Objective: ${this.objective || 'Not yet defined'}

Based on the current stage, guide the conversation appropriately. Keep responses focused and helpful.`;
  }
}

// Helper function to update session stage
function updateSessionStage(session, response) {
  const lowerResponse = response.toLowerCase();
  
  switch (session.stage) {
    case COMPAS_STAGES.CONTEXT_DISCOVERY:
      if (lowerResponse.includes("yes, that's right") || lowerResponse.includes("correct")) {
        session.stage = COMPAS_STAGES.OBJECTIVE_DEFINITION;
      }
      break;
    
    case COMPAS_STAGES.OBJECTIVE_DEFINITION:
      if (lowerResponse.includes("root cause") || lowerResponse.includes("problem statement")) {
        session.stage = COMPAS_STAGES.METHOD_IDEATION;
      }
      break;
    
    case COMPAS_STAGES.METHOD_IDEATION:
      if (lowerResponse.includes("method") && (lowerResponse.includes("1.") || lowerResponse.includes("2.") || lowerResponse.includes("3."))) {
        session.stage = COMPAS_STAGES.METHOD_SELECTION;
      }
      break;
    
    case COMPAS_STAGES.METHOD_SELECTION:
      if (lowerResponse.includes("implementation plan")) {
        session.stage = COMPAS_STAGES.IMPLEMENTATION_PLAN;
      }
      break;
    
    case COMPAS_STAGES.IMPLEMENTATION_PLAN:
      if (lowerResponse.includes("performance measures") && lowerResponse.includes("learning questions")) {
        session.stage = COMPAS_STAGES.COMPLETE;
      }
      break;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const path = event.path.replace('/.netlify/functions/simple-api', '');
    const method = event.httpMethod;
    
    // Create new session
    if (method === 'POST' && path === '/sessions') {
      const sessionId = uuidv4();
      const session = new SessionState(sessionId);
      sessions.set(sessionId, session);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ sessionId, stage: session.stage })
      };
    }
    
    // Get session state
    if (method === 'GET' && path.startsWith('/sessions/')) {
      const sessionId = path.split('/')[2];
      const session = sessions.get(sessionId);
      
      if (!session) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Session not found' })
        };
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          sessionId: session.sessionId,
          stage: session.stage,
          context: session.context,
          objective: session.objective,
          conversationHistory: session.conversationHistory
        })
      };
    }
    
    // Process conversation
    if (method === 'POST' && path.includes('/chat')) {
      const sessionId = path.split('/')[2];
      const session = sessions.get(sessionId);
      
      if (!session) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Session not found' })
        };
      }
      
      const { message } = JSON.parse(event.body);
      session.addMessage('user', message);
      
      const messages = [
        { role: 'system', content: session.getSystemPrompt() },
        ...session.conversationHistory.map(msg => ({ role: msg.role, content: msg.content }))
      ];
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
      });
      
      const assistantMessage = completion.choices[0].message.content;
      session.addMessage('assistant', assistantMessage);
      
      // Update stage
      updateSessionStage(session, assistantMessage);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: assistantMessage,
          stage: session.stage,
          sessionState: {
            artifacts: session.context.artifacts,
            objective: session.objective,
            methods: session.methods
          }
        })
      };
    }
    
    // Generate report
    if (method === 'GET' && path.includes('/report')) {
      const sessionId = path.split('/')[2];
      const session = sessions.get(sessionId);
      
      if (!session) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Session not found' })
        };
      }
      
      const report = `# COMPAS Report\n\n## Context\n${session.context.facts.join('\n- ')}\n\n## Objective\n${session.objective || 'To be defined'}\n\n## Implementation Plan\nDetailed plan to be developed based on conversation.`;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ report })
      };
    }
    
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };
    
  } catch (error) {
    console.error('API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};