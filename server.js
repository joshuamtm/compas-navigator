const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const { createValidationMiddleware } = require('./validation');
const { createExportRoutes } = require('./export');
const { SecurityService, createSecurityMiddleware, startSecurityTasks } = require('./security');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const securityService = new SecurityService();
const validationMiddleware = createValidationMiddleware();
const securityMiddleware = createSecurityMiddleware(securityService);

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'compas-navigator-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(securityMiddleware.sanitizeInput);
app.use(securityMiddleware.securityHeaders);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'text/csv', 'application/json', 'text/plain'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// In-memory session storage (use Redis in production)
const sessions = new Map();
app.locals.sessions = sessions;

// COMPAS stages
const COMPAS_STAGES = {
  CONTEXT_DISCOVERY: 'context_discovery',
  OBJECTIVE_DEFINITION: 'objective_definition',
  METHOD_IDEATION: 'method_ideation',
  METHOD_SELECTION: 'method_selection',
  IMPLEMENTATION_PLAN: 'implementation_plan',
  COMPLETE: 'complete'
};

// Session state management
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
    this.uploadedFiles = [];
  }

  addMessage(role, content) {
    this.conversationHistory.push({ role, content, timestamp: new Date() });
  }

  addArtifact(artifact) {
    this.context.artifacts.push(artifact);
  }

  addFact(fact) {
    this.context.facts.push(fact);
  }

  setStage(stage) {
    this.stage = stage;
  }

  getSystemPrompt() {
    const promptPath = path.join(__dirname, 'agent-prompt.md');
    const basePrompt = fs.readFileSync(promptPath, 'utf8');
    
    return `${basePrompt}

Current Stage: ${this.stage}
Context Facts: ${JSON.stringify(this.context.facts, null, 2)}
Artifacts Inventory: ${JSON.stringify(this.context.artifacts, null, 2)}
Objective: ${this.objective || 'Not yet defined'}
Methods: ${JSON.stringify(this.methods, null, 2)}
Chosen Method: ${this.chosenMethod || 'Not yet selected'}

Based on the current stage, guide the conversation appropriately.`;
  }
}

// Create new session
app.post('/api/sessions', (req, res) => {
  const sessionId = uuidv4();
  const session = new SessionState(sessionId);
  sessions.set(sessionId, session);
  
  res.json({ sessionId, stage: session.stage });
});

// Get session state
app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    sessionId: session.sessionId,
    stage: session.stage,
    context: session.context,
    objective: session.objective,
    methods: session.methods,
    chosenMethod: session.chosenMethod,
    implementationPlan: session.implementationPlan,
    performanceMeasures: session.performanceMeasures,
    learningQuestions: session.learningQuestions,
    conversationHistory: session.conversationHistory
  });
});

// Process conversation
app.post('/api/sessions/:sessionId/chat', validationMiddleware.validateObjective, async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const { message } = req.body;
  session.addMessage('user', message);
  
  try {
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
    
    // Analyze response to update stage
    await updateSessionStage(session, assistantMessage);
    
    res.json({
      message: assistantMessage,
      stage: session.stage,
      sessionState: {
        artifacts: session.context.artifacts,
        objective: session.objective,
        methods: session.methods
      }
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// File upload endpoint
app.post('/api/sessions/:sessionId/upload', upload.single('file'), validationMiddleware.validateUpload, async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const artifact = {
    id: uuidv4(),
    filename: req.file.originalname,
    path: req.file.path,
    size: req.file.size,
    mimetype: req.file.mimetype,
    uploadedAt: new Date(),
    owner: req.body.owner || 'Unknown',
    sensitivity: req.body.sensitivity || 'normal',
    source: req.body.source || 'Manual upload'
  };
  
  session.addArtifact(artifact);
  session.uploadedFiles.push(artifact);
  
  res.json({ artifact });
});

// Generate report
app.get('/api/sessions/:sessionId/report', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const report = generateCOMPASReport(session);
  res.json({ report });
});

// Helper function to update session stage
async function updateSessionStage(session, response) {
  const lowerResponse = response.toLowerCase();
  
  switch (session.stage) {
    case COMPAS_STAGES.CONTEXT_DISCOVERY:
      if (lowerResponse.includes("yes, that's right") || lowerResponse.includes("correct")) {
        session.setStage(COMPAS_STAGES.OBJECTIVE_DEFINITION);
      }
      break;
    
    case COMPAS_STAGES.OBJECTIVE_DEFINITION:
      if (lowerResponse.includes("root cause") || lowerResponse.includes("problem statement")) {
        session.setStage(COMPAS_STAGES.METHOD_IDEATION);
      }
      break;
    
    case COMPAS_STAGES.METHOD_IDEATION:
      if (lowerResponse.includes("method") && (lowerResponse.includes("1.") || lowerResponse.includes("2.") || lowerResponse.includes("3."))) {
        session.setStage(COMPAS_STAGES.METHOD_SELECTION);
      }
      break;
    
    case COMPAS_STAGES.METHOD_SELECTION:
      if (lowerResponse.includes("implementation plan")) {
        session.setStage(COMPAS_STAGES.IMPLEMENTATION_PLAN);
      }
      break;
    
    case COMPAS_STAGES.IMPLEMENTATION_PLAN:
      if (lowerResponse.includes("performance measures") && lowerResponse.includes("learning questions")) {
        session.setStage(COMPAS_STAGES.COMPLETE);
      }
      break;
  }
}

// Generate COMPAS report
function generateCOMPASReport(session) {
  const challengeTitle = session.objective || 'Nonprofit Challenge';
  
  let report = `## COMPAS Report – ${challengeTitle}\n\n`;
  
  // Data/Context section
  report += `### 0. Data / Context to Supply AI\n`;
  report += `| Artifact | Current format | Owner | Prep needed | Upload method |\n`;
  report += `|----------|----------------|-------|-------------|---------------|\n`;
  
  session.context.artifacts.forEach(artifact => {
    report += `| ${artifact.filename} | ${artifact.mimetype} | ${artifact.owner} | ${artifact.sensitivity === 'high' ? 'Redact PII' : 'None'} | ${artifact.source} |\n`;
  });
  
  // Context summary
  report += `\n### 1. Context (summary)\n`;
  session.context.facts.forEach(fact => {
    report += `- ${fact}\n`;
  });
  
  // Objective
  report += `\n### 2. Objective (root problem)\n`;
  report += `- ${session.objective || 'To be defined'}\n`;
  
  // Chosen method
  report += `\n### 3. Chosen Method(s)\n`;
  report += `- ${session.chosenMethod || 'To be selected'}\n`;
  
  // Implementation plan
  report += `\n### 4. Implementation Plan\n`;
  if (session.implementationPlan) {
    report += `| Step | Owner | When | Notes |\n`;
    report += `|------|-------|------|-------|\n`;
    // Implementation details would be parsed from session data
  }
  
  // Performance measures
  report += `\n### 5. Performance Measures\n`;
  session.performanceMeasures.forEach(measure => {
    report += `- ${measure}\n`;
  });
  
  // Learning questions
  report += `\n### 6. Learning Questions\n`;
  session.learningQuestions.forEach(question => {
    report += `- ${question}\n`;
  });
  
  return report;
}

// Add export routes
createExportRoutes(app);

// Static files
app.use(express.static('public'));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
app.listen(PORT, () => {
  console.log(`COMPAS Navigator server running on port ${PORT}`);
  
  // Start security tasks
  startSecurityTasks(securityService);
});

module.exports = app;