const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');
const puppeteer = require('puppeteer');
const { Document, Paragraph, TextRun, Packer, HeadingLevel } = require('docx');

// Simple in-memory session storage for serverless
const sessions = new Map();

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// COMPAS stages with detailed definitions
const COMPAS_STAGES = {
  CONTEXT_DISCOVERY: 'context_discovery',
  OBJECTIVE_DEFINITION: 'objective_definition',
  METHOD_IDEATION: 'method_ideation',
  METHOD_SELECTION: 'method_selection', 
  IMPLEMENTATION_PLAN: 'implementation_plan',
  COMPLETE: 'complete'
};

// Stage completion criteria and progression rules
const STAGE_CRITERIA = {
  [COMPAS_STAGES.CONTEXT_DISCOVERY]: {
    required: ['situationDescription', 'stakeholders', 'constraints'],
    progressTrigger: 'User confirms the restated situation is accurate',
    nextStage: COMPAS_STAGES.OBJECTIVE_DEFINITION,
    timeEstimate: '5-10 minutes'
  },
  [COMPAS_STAGES.OBJECTIVE_DEFINITION]: {
    required: ['rootProblem', 'problemStatement'],
    progressTrigger: 'Clear problem statement identified (not solution)',
    nextStage: COMPAS_STAGES.METHOD_IDEATION,
    timeEstimate: '3-5 minutes'
  },
  [COMPAS_STAGES.METHOD_IDEATION]: {
    required: ['methods'],
    minimumMethods: 2,
    progressTrigger: 'At least 2 distinct methods proposed with rationales',
    nextStage: COMPAS_STAGES.METHOD_SELECTION,
    timeEstimate: '5-7 minutes'
  },
  [COMPAS_STAGES.METHOD_SELECTION]: {
    required: ['chosenMethod', 'methodRationale'],
    progressTrigger: 'User selects a method or accepts recommendation',
    nextStage: COMPAS_STAGES.IMPLEMENTATION_PLAN,
    timeEstimate: '2-3 minutes'
  },
  [COMPAS_STAGES.IMPLEMENTATION_PLAN]: {
    required: ['implementationSteps', 'timeline', 'performanceMeasures'],
    progressTrigger: 'Complete implementation plan with steps, timeline, and metrics',
    nextStage: COMPAS_STAGES.COMPLETE,
    timeEstimate: '5-7 minutes'
  },
  [COMPAS_STAGES.COMPLETE]: {
    required: ['finalReport'],
    progressTrigger: 'Report generated and approved',
    nextStage: null,
    timeEstimate: '2-3 minutes'
  }
};

// Session state class
class SessionState {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.stage = COMPAS_STAGES.CONTEXT_DISCOVERY;
    this.conversationHistory = [];
    this.stageData = {
      [COMPAS_STAGES.CONTEXT_DISCOVERY]: {
        situationDescription: '',
        stakeholders: [],
        constraints: [],
        artifacts: [],
        completed: false
      },
      [COMPAS_STAGES.OBJECTIVE_DEFINITION]: {
        rootProblem: '',
        problemStatement: '',
        completed: false
      },
      [COMPAS_STAGES.METHOD_IDEATION]: {
        methods: [],
        completed: false
      },
      [COMPAS_STAGES.METHOD_SELECTION]: {
        chosenMethod: null,
        methodRationale: '',
        completed: false
      },
      [COMPAS_STAGES.IMPLEMENTATION_PLAN]: {
        implementationSteps: [],
        timeline: '',
        performanceMeasures: [],
        learningQuestions: [],
        completed: false
      },
      [COMPAS_STAGES.COMPLETE]: {
        finalReport: '',
        completed: false
      }
    };
    this.progressMetrics = {
      startTime: new Date(),
      stageStartTimes: {
        [this.stage]: new Date()
      }
    };
  }

  addMessage(role, content) {
    this.conversationHistory.push({ role, content, timestamp: new Date() });
  }

  updateStageData(stage, data) {
    if (this.stageData[stage]) {
      Object.assign(this.stageData[stage], data);
    }
  }

  getCurrentStageData() {
    return this.stageData[this.stage];
  }

  getSystemPrompt() {
    const currentStageData = this.getCurrentStageData();
    const stageCriteria = STAGE_CRITERIA[this.stage];
    
    let stageSpecificPrompt = '';
    
    switch (this.stage) {
      case COMPAS_STAGES.CONTEXT_DISCOVERY:
        stageSpecificPrompt = `
CONTEXT DISCOVERY PHASE (${stageCriteria.timeEstimate}):
Your goal is to understand the user's challenge completely. Ask clarifying questions until you can restate their situation back to them accurately.

Required Information to Extract:
- Situation description: What exactly is the challenge?
- Stakeholders: Who is involved or affected?
- Constraints: What limitations exist (time, budget, resources, politics)?
- Context artifacts: What supporting documents/data exist?

Progress Trigger: When you can restate the situation and the user confirms "Yes, that's right," automatically progress to Objective Definition.

Current Status: ${JSON.stringify(currentStageData, null, 2)}`;
        break;
        
      case COMPAS_STAGES.OBJECTIVE_DEFINITION:
        stageSpecificPrompt = `
OBJECTIVE DEFINITION PHASE (${stageCriteria.timeEstimate}):
Help the user identify the ROOT PROBLEM, not solutions. Reject solution statements like "We need an AI chatbot" and push for problem statements like "We lose 20 hours/month triaging email."

Required Information to Extract:
- Root problem: The underlying issue causing the challenge
- Problem statement: Clear, measurable problem description

Progress Trigger: When you have a clear problem statement that focuses on the problem (not a solution), automatically progress to Method Ideation.

Previous Context: ${JSON.stringify(this.stageData[COMPAS_STAGES.CONTEXT_DISCOVERY], null, 2)}
Current Status: ${JSON.stringify(currentStageData, null, 2)}`;
        break;
        
      case COMPAS_STAGES.METHOD_IDEATION:
        stageSpecificPrompt = `
METHOD IDEATION PHASE (${stageCriteria.timeEstimate}):
Propose 2-3 distinct methods that could solve the identified problem. Each method should bridge Context → Objective with a clear rationale.

Required Information to Extract:
- Methods: At least 2 different approaches (tech, process, or hybrid)
- Rationales: One-line explanation for each method

Progress Trigger: When you have proposed at least 2 distinct methods with rationales, automatically progress to Method Selection.

Context: ${JSON.stringify(this.stageData[COMPAS_STAGES.CONTEXT_DISCOVERY], null, 2)}
Objective: ${JSON.stringify(this.stageData[COMPAS_STAGES.OBJECTIVE_DEFINITION], null, 2)}
Current Status: ${JSON.stringify(currentStageData, null, 2)}`;
        break;
        
      case COMPAS_STAGES.METHOD_SELECTION:
        stageSpecificPrompt = `
METHOD SELECTION PHASE (${stageCriteria.timeEstimate}):
Guide the user to select the best method from the proposed options. Provide recommendation if needed.

Required Information to Extract:
- Chosen method: The selected approach
- Method rationale: Why this method is best for their situation

Progress Trigger: When user selects a method or accepts your recommendation, automatically progress to Implementation Plan.

Available Methods: ${JSON.stringify(this.stageData[COMPAS_STAGES.METHOD_IDEATION], null, 2)}
Current Status: ${JSON.stringify(currentStageData, null, 2)}`;
        break;
        
      case COMPAS_STAGES.IMPLEMENTATION_PLAN:
        stageSpecificPrompt = `
IMPLEMENTATION PLAN PHASE (${stageCriteria.timeEstimate}):
Create a detailed, actionable implementation plan for the chosen method.

Required Information to Extract:
- Implementation steps: Specific, actionable steps with owners and timelines
- Timeline: When each step should be completed
- Performance measures: 2-5 success metrics with baselines and targets
- Learning questions: What results would trigger pivot, scale-up, or kill

Progress Trigger: When you have a complete implementation plan with all required elements, automatically progress to Complete.

Chosen Method: ${JSON.stringify(this.stageData[COMPAS_STAGES.METHOD_SELECTION], null, 2)}
Current Status: ${JSON.stringify(currentStageData, null, 2)}`;
        break;
        
      case COMPAS_STAGES.COMPLETE:
        stageSpecificPrompt = `
COMPLETION PHASE:
The COMPAS journey is complete. Generate the final report and prepare for export.

Status: Journey completed successfully!`;
        break;
    }

    return `You are COMPAS Navigator, a coaching agent for nonprofit practitioners. Your goal is to steer each user through a real-world challenge with the COMPAS framework and return a concise, action-ready plan.

${stageSpecificPrompt}

IMPORTANT INSTRUCTIONS:
1. Stay focused on the current stage - don't jump ahead
2. Ask clarifying questions to extract all required information
3. When stage completion criteria are met, clearly indicate readiness to progress
4. Keep responses conversational but structured
5. Extract and organize information for the final report
6. Use plain language, maximum 300 words per response`;
  }
}

// AI-powered stage progression and data extraction
async function analyzeAndProgressStage(session, userMessage, assistantResponse) {
  const analysisPrompt = `Analyze this COMPAS conversation to determine:
1. Should we progress to the next stage?
2. What structured data can be extracted from the conversation?

Current Stage: ${session.stage}
Stage Criteria: ${JSON.stringify(STAGE_CRITERIA[session.stage], null, 2)}
Current Stage Data: ${JSON.stringify(session.getCurrentStageData(), null, 2)}

Recent User Message: "${userMessage}"
Assistant Response: "${assistantResponse}"

Conversation History: ${JSON.stringify(session.conversationHistory.slice(-4), null, 2)}

Respond with a JSON object:
{
  "shouldProgress": boolean,
  "progressReason": "string explanation",
  "extractedData": {
    // Structured data based on current stage requirements
  },
  "completionPercentage": number (0-100),
  "missingInformation": ["list", "of", "missing", "items"]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 1000
    });

    const analysis = JSON.parse(completion.choices[0].message.content);
    
    // Update stage data with extracted information
    if (analysis.extractedData) {
      session.updateStageData(session.stage, analysis.extractedData);
    }

    // Progress to next stage if criteria met
    if (analysis.shouldProgress) {
      const nextStage = STAGE_CRITERIA[session.stage].nextStage;
      if (nextStage) {
        // Mark current stage as completed
        session.updateStageData(session.stage, { completed: true });
        
        // Move to next stage
        session.stage = nextStage;
        session.progressMetrics.stageStartTimes[nextStage] = new Date();
        
        console.log(`Stage progressed: ${session.stage} -> ${nextStage}. Reason: ${analysis.progressReason}`);
      }
    }

    return analysis;
  } catch (error) {
    console.error('Error in stage analysis:', error);
    return {
      shouldProgress: false,
      progressReason: 'Analysis error',
      extractedData: {},
      completionPercentage: 0,
      missingInformation: []
    };
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
      
      // Analyze conversation and potentially progress stage
      const analysis = await analyzeAndProgressStage(session, message, assistantMessage);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: assistantMessage,
          stage: session.stage,
          stageAnalysis: analysis,
          sessionState: {
            currentStageData: session.getCurrentStageData(),
            allStageData: session.stageData,
            progressMetrics: session.progressMetrics
          }
        })
      };
    }
    
    // Generate comprehensive report
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
      
      const report = generateComprehensiveReport(session);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ report })
      };
    }

    // Export report as PDF
    if (method === 'POST' && path.includes('/export/pdf')) {
      const sessionId = path.split('/')[2];
      const session = sessions.get(sessionId);
      
      if (!session) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Session not found' })
        };
      }

      try {
        const report = generateComprehensiveReport(session);
        const pdfBuffer = await generatePDF(report);
        
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="compas-report.pdf"'
          },
          body: pdfBuffer.toString('base64'),
          isBase64Encoded: true
        };
      } catch (error) {
        console.error('PDF generation error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to generate PDF' })
        };
      }
    }

    // Export report as DOCX
    if (method === 'POST' && path.includes('/export/docx')) {
      const sessionId = path.split('/')[2];
      const session = sessions.get(sessionId);
      
      if (!session) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Session not found' })
        };
      }

      try {
        const docxBuffer = await generateDOCX(session);
        
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': 'attachment; filename="compas-report.docx"'
          },
          body: docxBuffer.toString('base64'),
          isBase64Encoded: true
        };
      } catch (error) {
        console.error('DOCX generation error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to generate DOCX' })
        };
      }
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

// Report generation functions
function generateComprehensiveReport(session) {
  const contextData = session.stageData[COMPAS_STAGES.CONTEXT_DISCOVERY];
  const objectiveData = session.stageData[COMPAS_STAGES.OBJECTIVE_DEFINITION];
  const methodData = session.stageData[COMPAS_STAGES.METHOD_IDEATION];
  const selectionData = session.stageData[COMPAS_STAGES.METHOD_SELECTION];
  const planData = session.stageData[COMPAS_STAGES.IMPLEMENTATION_PLAN];

  const report = `# COMPAS Report – ${contextData.situationDescription || 'Challenge Analysis'}

*Generated on ${new Date().toLocaleDateString()} | Total Session Time: ${Math.round((new Date() - session.progressMetrics.startTime) / 60000)} minutes*

## Executive Summary

This report provides a structured analysis and actionable solution for the identified nonprofit challenge using the COMPAS (Context, Objective, Method, Plan, Assessment) framework.

## 1. Context Discovery

**Challenge Description:**
${contextData.situationDescription || 'Not provided'}

**Key Stakeholders:**
${contextData.stakeholders.length > 0 ? contextData.stakeholders.map(s => `• ${s}`).join('\n') : '• Not specified'}

**Constraints & Limitations:**
${contextData.constraints.length > 0 ? contextData.constraints.map(c => `• ${c}`).join('\n') : '• Not specified'}

**Supporting Artifacts:**
${contextData.artifacts.length > 0 ? contextData.artifacts.map(a => `• ${a.filename} (${a.owner})`).join('\n') : '• No artifacts uploaded'}

## 2. Objective Definition

**Root Problem Identified:**
${objectiveData.rootProblem || 'Not defined'}

**Problem Statement:**
${objectiveData.problemStatement || 'Not provided'}

## 3. Method Analysis

**Proposed Solutions:**
${methodData.methods.length > 0 ? methodData.methods.map((m, i) => `
### Method ${i + 1}: ${m.name || `Option ${i + 1}`}
**Approach:** ${m.description || 'Not provided'}
**Rationale:** ${m.rationale || 'Not provided'}
**Implementation Complexity:** ${m.complexity || 'Not assessed'}
`).join('\n') : 'No methods proposed'}

**Selected Method:**
${selectionData.chosenMethod ? `
**Chosen Approach:** ${selectionData.chosenMethod.name || 'Selected method'}
**Selection Rationale:** ${selectionData.methodRationale || 'Not provided'}
` : 'No method selected yet'}

## 4. Implementation Plan

${planData.implementationSteps.length > 0 ? `
**Action Steps:**
${planData.implementationSteps.map((step, i) => `
${i + 1}. **${step.title || `Step ${i + 1}`}**
   - **Owner:** ${step.owner || 'Not assigned'}
   - **Timeline:** ${step.timeline || 'Not specified'}
   - **Description:** ${step.description || 'Not provided'}
   - **Resources:** ${step.resources || 'Not specified'}
`).join('\n')}

**Overall Timeline:**
${planData.timeline || 'Not provided'}
` : 'Implementation plan not yet developed'}

## 5. Performance Measures & Success Metrics

${planData.performanceMeasures.length > 0 ? `
**Key Metrics:**
${planData.performanceMeasures.map((measure, i) => `
${i + 1}. **${measure.metric || `Metric ${i + 1}`}**
   - **Target:** ${measure.target || 'Not specified'}
   - **Baseline:** ${measure.baseline || 'Not specified'}
   - **Collection Method:** ${measure.collection || 'Not specified'}
   - **Frequency:** ${measure.frequency || 'Not specified'}
`).join('\n')}
` : 'Success metrics not yet defined'}

## 6. Learning Questions & Iteration Plan

${planData.learningQuestions.length > 0 ? `
**Key Learning Questions:**
${planData.learningQuestions.map(q => `• ${q}`).join('\n')}
` : 'Learning questions not yet defined'}

**Next Steps for Implementation:**
1. Review and validate this plan with key stakeholders
2. Secure necessary resources and approvals
3. Begin with the first implementation step
4. Establish measurement and monitoring systems
5. Schedule regular check-ins to assess progress

---

*This report was generated using the COMPAS Navigator framework, designed specifically for nonprofit organizations to transform challenges into actionable solutions.*`;

  return report;
}

async function generatePDF(reportContent) {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });
    
    const page = await browser.newPage();
    
    // Convert markdown to HTML for better PDF formatting
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        h3 { color: #7f8c8d; }
        p { margin: 10px 0; }
        ul { margin: 10px 0; padding-left: 20px; }
        li { margin: 5px 0; }
        em { color: #7f8c8d; font-size: 0.9em; }
        .executive-summary { 
            background: #f8f9fa; 
            padding: 15px; 
            border-left: 4px solid #3498db; 
            margin: 20px 0; 
        }
        .metric { background: #f1f3f4; padding: 10px; margin: 10px 0; border-radius: 5px; }
    </style>
</head>
<body>
    ${reportContent.replace(/\n/g, '<br>').replace(/# (.*)/g, '<h1>$1</h1>').replace(/## (.*)/g, '<h2>$1</h2>').replace(/### (.*)/g, '<h3>$1</h3>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')}
</body>
</html>`;
    
    await page.setContent(htmlContent);
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      },
      printBackground: true
    });
    
    return pdfBuffer;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function generateDOCX(session) {
  const contextData = session.stageData[COMPAS_STAGES.CONTEXT_DISCOVERY];
  const objectiveData = session.stageData[COMPAS_STAGES.OBJECTIVE_DEFINITION];
  const methodData = session.stageData[COMPAS_STAGES.METHOD_IDEATION];
  const selectionData = session.stageData[COMPAS_STAGES.METHOD_SELECTION];
  const planData = session.stageData[COMPAS_STAGES.IMPLEMENTATION_PLAN];

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: `COMPAS Report – ${contextData.situationDescription || 'Challenge Analysis'}`,
          heading: HeadingLevel.TITLE
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Generated on ${new Date().toLocaleDateString()} | Total Session Time: ${Math.round((new Date() - session.progressMetrics.startTime) / 60000)} minutes`,
              italics: true
            })
          ]
        }),
        new Paragraph({ text: "" }), // Spacer
        
        new Paragraph({
          text: "Executive Summary",
          heading: HeadingLevel.HEADING_1
        }),
        new Paragraph({
          text: "This report provides a structured analysis and actionable solution for the identified nonprofit challenge using the COMPAS (Context, Objective, Method, Plan, Assessment) framework."
        }),
        
        new Paragraph({
          text: "1. Context Discovery",
          heading: HeadingLevel.HEADING_1
        }),
        new Paragraph({
          text: "Challenge Description:",
          heading: HeadingLevel.HEADING_2
        }),
        new Paragraph({
          text: contextData.situationDescription || 'Not provided'
        }),
        
        new Paragraph({
          text: "Key Stakeholders:",
          heading: HeadingLevel.HEADING_2
        }),
        ...contextData.stakeholders.map(stakeholder => 
          new Paragraph({
            text: `• ${stakeholder}`,
            bullet: { level: 0 }
          })
        ),
        
        new Paragraph({
          text: "2. Objective Definition",
          heading: HeadingLevel.HEADING_1
        }),
        new Paragraph({
          text: "Root Problem Identified:",
          heading: HeadingLevel.HEADING_2
        }),
        new Paragraph({
          text: objectiveData.rootProblem || 'Not defined'
        }),
        
        new Paragraph({
          text: "Problem Statement:",
          heading: HeadingLevel.HEADING_2
        }),
        new Paragraph({
          text: objectiveData.problemStatement || 'Not provided'
        }),
        
        new Paragraph({
          text: "3. Implementation Plan",
          heading: HeadingLevel.HEADING_1
        }),
        ...(planData.implementationSteps.length > 0 ? 
          planData.implementationSteps.flatMap((step, i) => [
            new Paragraph({
              text: `${i + 1}. ${step.title || `Step ${i + 1}`}`,
              heading: HeadingLevel.HEADING_2
            }),
            new Paragraph({
              text: `Owner: ${step.owner || 'Not assigned'}`
            }),
            new Paragraph({
              text: `Timeline: ${step.timeline || 'Not specified'}`
            }),
            new Paragraph({
              text: `Description: ${step.description || 'Not provided'}`
            })
          ]) : [new Paragraph({ text: 'Implementation plan not yet developed' })]
        ),
        
        new Paragraph({
          text: "4. Performance Measures",
          heading: HeadingLevel.HEADING_1
        }),
        ...(planData.performanceMeasures.length > 0 ? 
          planData.performanceMeasures.flatMap((measure, i) => [
            new Paragraph({
              text: `${i + 1}. ${measure.metric || `Metric ${i + 1}`}`,
              heading: HeadingLevel.HEADING_2
            }),
            new Paragraph({
              text: `Target: ${measure.target || 'Not specified'}`
            }),
            new Paragraph({
              text: `Collection: ${measure.collection || 'Not specified'}`
            })
          ]) : [new Paragraph({ text: 'Success metrics not yet defined' })]
        )
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}