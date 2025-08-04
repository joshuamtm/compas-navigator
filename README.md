# COMPAS Navigator

An AI-powered coaching agent for nonprofit practitioners that guides users through real-world challenges using the COMPAS framework.

## Overview

COMPAS Navigator is a conversational web application that helps nonprofit organizations solve challenges through a structured approach:

- **C**ontext Discovery: Understanding the current situation
- **O**bjective Definition: Identifying root-cause problems
- **M**ethod Ideation: Proposing solutions
- **P**lan Implementation: Creating actionable steps
- **A**ssessment: Defining success metrics
- **S**caling/Learning: Planning for iteration

## Features

- 🤖 AI-powered conversational interface
- 📄 Document and artifact management
- ✅ Problem statement validation
- 📊 Structured report generation
- 🔒 Enterprise-grade security
- 📥 Multi-format export (Markdown, PDF, DOCX)
- 🎯 Stage-based progress tracking

## Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/compas-navigator.git
cd compas-navigator
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the server:
```bash
node server.js
```

5. Open your browser to `http://localhost:3000`

## Configuration

### Required Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key for GPT-4 access
- `SESSION_SECRET`: Secret key for session encryption
- `ENCRYPTION_KEY`: 32-byte key for data encryption

### Optional Configuration

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)
- `ALLOWED_ORIGINS`: CORS allowed origins
- `MAX_FILE_SIZE`: Maximum file upload size

## Usage

1. **Start a Session**: Open the web interface to automatically create a new session

2. **Describe Your Challenge**: The AI will guide you through clarifying questions

3. **Upload Artifacts**: Add relevant documents, data exports, or other files

4. **Define Objectives**: Work with the AI to identify root problems (not solutions)

5. **Select Methods**: Choose from AI-proposed approaches

6. **Review Plan**: Get a detailed implementation plan with data requirements

7. **Export Report**: Download your COMPAS report in various formats

## Architecture

### Backend Components

- **server.js**: Express server with session management
- **validation.js**: Input validation and problem statement detection
- **security.js**: Encryption, PII redaction, and security features
- **export.js**: Report generation in multiple formats

### Frontend Components

- **index.html**: Main UI structure
- **app.js**: Client-side application logic
- **styles.css**: Responsive design system

### Security Features

- 🔐 End-to-end encryption for sensitive data
- 🛡️ Automatic PII detection and redaction
- 🚫 Content Security Policy enforcement
- ⏱️ Automatic file purging after 24 hours
- 🔑 Secure session management
- 🚦 Rate limiting and input sanitization

## API Endpoints

### Session Management
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:sessionId` - Get session state

### Conversation
- `POST /api/sessions/:sessionId/chat` - Send message to AI

### File Management
- `POST /api/sessions/:sessionId/upload` - Upload artifact

### Reporting
- `GET /api/sessions/:sessionId/report` - Generate report
- `POST /api/sessions/:sessionId/export` - Export report

## Development

### Running Tests
```bash
npm test
```

### Code Structure
```
compas-navigator/
├── server.js           # Main server
├── validation.js       # Input validation
├── security.js        # Security features
├── export.js          # Export functionality
├── agent-prompt.md    # AI agent instructions
├── public/           # Frontend files
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── uploads/          # Temporary file storage
├── secure/           # Encrypted file storage
└── exports/          # Generated reports
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

[Your License Here]

## Support

For issues and questions, please open a GitHub issue or contact support@your-org.com