// Validation module for COMPAS Navigator

const validationPatterns = {
    // Solution-oriented statements that should be rejected
    solutionStatements: [
        /we need (a|an|to)/i,
        /implement/i,
        /build/i,
        /create/i,
        /develop/i,
        /use (gpt|claude|ai|chatbot)/i,
        /deploy/i,
        /install/i
    ],
    
    // Problem-oriented keywords that indicate good problem statements
    problemKeywords: [
        /lose \d+ (hours?|hrs?)/i,
        /waste/i,
        /struggle/i,
        /can't/i,
        /unable/i,
        /difficult/i,
        /challenge/i,
        /issue/i,
        /problem/i,
        /lacking/i,
        /missing/i,
        /inefficient/i
    ]
};

// Validate if a statement is a solution vs problem
function validateObjectiveStatement(statement) {
    const lowerStatement = statement.toLowerCase();
    
    // Check for solution-oriented language
    const isSolution = validationPatterns.solutionStatements.some(pattern => 
        pattern.test(lowerStatement)
    );
    
    // Check for problem-oriented language
    const isProblem = validationPatterns.problemKeywords.some(pattern => 
        pattern.test(lowerStatement)
    );
    
    return {
        isValid: !isSolution && isProblem,
        isSolution,
        isProblem,
        suggestions: generateSuggestions(statement, isSolution, isProblem)
    };
}

// Generate helpful suggestions for rephrasing
function generateSuggestions(statement, isSolution, isProblem) {
    const suggestions = [];
    
    if (isSolution) {
        suggestions.push("Try rephrasing as a problem rather than a solution.");
        suggestions.push("Focus on what challenge or pain point this would address.");
        suggestions.push("Example: Instead of 'We need a chatbot', try 'We spend 20 hours/week answering repetitive questions'");
    }
    
    if (!isProblem) {
        suggestions.push("Include specific pain points or challenges.");
        suggestions.push("Quantify the impact if possible (time lost, resources wasted, etc.)");
        suggestions.push("Use problem-oriented language (struggle, can't, waste, etc.)");
    }
    
    return suggestions;
}

// Validate file uploads
function validateFileUpload(file) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['application/pdf', 'text/csv', 'application/json', 'text/plain'];
    
    const errors = [];
    
    if (file.size > maxSize) {
        errors.push(`File size (${formatFileSize(file.size)}) exceeds maximum allowed size (10MB)`);
    }
    
    if (!allowedTypes.includes(file.type)) {
        errors.push(`File type (${file.type}) is not supported. Allowed types: PDF, CSV, JSON, TXT`);
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

// Validate sensitivity classification
function validateSensitivity(sensitivity, fileContent) {
    const sensitivePatterns = [
        /\b\d{3}-\d{2}-\d{4}\b/, // SSN
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
        /\b\d{16}\b/, // Credit card
        /\b\d{3}-\d{3}-\d{4}\b/, // Phone
        /\b\d{5}(-\d{4})?\b/ // ZIP code
    ];
    
    const hasSensitiveData = sensitivePatterns.some(pattern => 
        pattern.test(fileContent)
    );
    
    return {
        suggestedLevel: hasSensitiveData ? 'high' : 'normal',
        hasSensitiveData,
        requiresRedaction: hasSensitiveData && sensitivity !== 'high'
    };
}

// Format file size for display
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Integration with Express middleware
function createValidationMiddleware() {
    return {
        validateObjective: (req, res, next) => {
            const { message } = req.body;
            const session = req.session;
            
            // Only validate during objective definition stage
            if (session && session.stage === 'objective_definition') {
                const validation = validateObjectiveStatement(message);
                
                if (!validation.isValid && validation.isSolution) {
                    return res.status(400).json({
                        error: 'Solution statement detected',
                        suggestions: validation.suggestions,
                        needsRephrase: true
                    });
                }
            }
            
            next();
        },
        
        validateUpload: (req, res, next) => {
            if (!req.file) {
                return next();
            }
            
            const validation = validateFileUpload(req.file);
            
            if (!validation.isValid) {
                return res.status(400).json({
                    error: 'File validation failed',
                    errors: validation.errors
                });
            }
            
            next();
        }
    };
}

module.exports = {
    validateObjectiveStatement,
    validateFileUpload,
    validateSensitivity,
    createValidationMiddleware
};