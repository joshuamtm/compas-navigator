const crypto = require('crypto');
const CryptoJS = require('crypto-js');
const fs = require('fs').promises;
const path = require('path');

class SecurityService {
    constructor() {
        this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateKey();
        this.initializeSecurityFeatures();
    }

    generateKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    async initializeSecurityFeatures() {
        // Ensure secure directories exist
        const secureDir = path.join(__dirname, 'secure');
        try {
            await fs.mkdir(secureDir, { recursive: true, mode: 0o700 });
        } catch (error) {
            console.error('Failed to create secure directory:', error);
        }
    }

    // Encrypt sensitive data
    encryptData(data) {
        const dataString = typeof data === 'string' ? data : JSON.stringify(data);
        return CryptoJS.AES.encrypt(dataString, this.encryptionKey).toString();
    }

    // Decrypt sensitive data
    decryptData(encryptedData) {
        try {
            const bytes = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
            return bytes.toString(CryptoJS.enc.Utf8);
        } catch (error) {
            console.error('Decryption failed:', error);
            return null;
        }
    }

    // Redact PII from text
    redactPII(text) {
        const patterns = {
            ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
            email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            phone: /\b\d{3}-\d{3}-\d{4}\b/g,
            creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
            ipAddress: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g
        };

        let redactedText = text;
        
        // Replace patterns with redacted versions
        redactedText = redactedText.replace(patterns.ssn, '[SSN REDACTED]');
        redactedText = redactedText.replace(patterns.email, '[EMAIL REDACTED]');
        redactedText = redactedText.replace(patterns.phone, '[PHONE REDACTED]');
        redactedText = redactedText.replace(patterns.creditCard, '[CC REDACTED]');
        redactedText = redactedText.replace(patterns.ipAddress, '[IP REDACTED]');
        
        return redactedText;
    }

    // Generate secure file path
    generateSecureFilePath(filename) {
        const sanitizedFilename = filename.replace(/[^a-z0-9.-]/gi, '_');
        const uniqueId = crypto.randomBytes(16).toString('hex');
        return path.join('secure', `${uniqueId}-${sanitizedFilename}`);
    }

    // Secure file storage
    async storeFileSecurely(filePath, content, metadata = {}) {
        const secureFilePath = this.generateSecureFilePath(path.basename(filePath));
        
        // Encrypt file content
        const encryptedContent = this.encryptData(content);
        
        // Store encrypted file
        await fs.writeFile(path.join(__dirname, secureFilePath), encryptedContent, {
            mode: 0o600 // Read/write for owner only
        });
        
        // Store metadata separately
        const metadataPath = `${secureFilePath}.meta`;
        const encryptedMetadata = this.encryptData({
            ...metadata,
            originalPath: filePath,
            storedAt: new Date().toISOString(),
            checksum: this.generateChecksum(content)
        });
        
        await fs.writeFile(path.join(__dirname, metadataPath), encryptedMetadata, {
            mode: 0o600
        });
        
        return {
            securePath: secureFilePath,
            metadataPath
        };
    }

    // Retrieve secure file
    async retrieveSecureFile(securePath) {
        try {
            const encryptedContent = await fs.readFile(path.join(__dirname, securePath), 'utf8');
            const content = this.decryptData(encryptedContent);
            
            // Load metadata
            const metadataPath = `${securePath}.meta`;
            const encryptedMetadata = await fs.readFile(path.join(__dirname, metadataPath), 'utf8');
            const metadata = JSON.parse(this.decryptData(encryptedMetadata));
            
            // Verify checksum
            if (this.generateChecksum(content) !== metadata.checksum) {
                throw new Error('File integrity check failed');
            }
            
            return {
                content,
                metadata
            };
        } catch (error) {
            console.error('Failed to retrieve secure file:', error);
            return null;
        }
    }

    // Generate file checksum
    generateChecksum(data) {
        return crypto
            .createHash('sha256')
            .update(data)
            .digest('hex');
    }

    // Auto-purge old files
    async purgeOldFiles(maxAgeHours = 24) {
        const secureDir = path.join(__dirname, 'secure');
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000;
        
        try {
            const files = await fs.readdir(secureDir);
            
            for (const file of files) {
                const filePath = path.join(secureDir, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filePath);
                    console.log(`Purged old file: ${file}`);
                }
            }
        } catch (error) {
            console.error('Failed to purge old files:', error);
        }
    }

    // Session security
    createSecureSession(sessionData) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        const encryptedData = this.encryptData(sessionData);
        
        return {
            sessionId,
            encryptedData,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
        };
    }

    // Validate session
    validateSession(session) {
        if (!session || !session.expiresAt) {
            return false;
        }
        
        const now = new Date();
        const expiresAt = new Date(session.expiresAt);
        
        return now < expiresAt;
    }

    // Content Security Policy
    getCSPHeaders() {
        return {
            'Content-Security-Policy': [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: https:",
                "font-src 'self'",
                "connect-src 'self'",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self'"
            ].join('; ')
        };
    }

    // Input sanitization
    sanitizeInput(input) {
        if (typeof input !== 'string') {
            return input;
        }
        
        // Remove potential XSS vectors
        return input
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    // Rate limiting per user/IP
    createUserRateLimiter() {
        const attempts = new Map();
        
        return (identifier, maxAttempts = 5, windowMs = 60000) => {
            const now = Date.now();
            const userAttempts = attempts.get(identifier) || [];
            
            // Clean old attempts
            const recentAttempts = userAttempts.filter(
                timestamp => now - timestamp < windowMs
            );
            
            if (recentAttempts.length >= maxAttempts) {
                return {
                    allowed: false,
                    retryAfter: windowMs - (now - recentAttempts[0])
                };
            }
            
            recentAttempts.push(now);
            attempts.set(identifier, recentAttempts);
            
            return { allowed: true };
        };
    }
}

// Security middleware factory
function createSecurityMiddleware(securityService) {
    return {
        // Encrypt response data
        encryptResponse: (req, res, next) => {
            const originalJson = res.json;
            
            res.json = function(data) {
                if (req.headers['x-encrypt-response'] === 'true') {
                    const encryptedData = securityService.encryptData(data);
                    return originalJson.call(this, { encrypted: true, data: encryptedData });
                }
                return originalJson.call(this, data);
            };
            
            next();
        },
        
        // Validate and sanitize input
        sanitizeInput: (req, res, next) => {
            // Sanitize body
            if (req.body) {
                Object.keys(req.body).forEach(key => {
                    req.body[key] = securityService.sanitizeInput(req.body[key]);
                });
            }
            
            // Sanitize query params
            if (req.query) {
                Object.keys(req.query).forEach(key => {
                    req.query[key] = securityService.sanitizeInput(req.query[key]);
                });
            }
            
            next();
        },
        
        // Apply security headers
        securityHeaders: (req, res, next) => {
            const cspHeaders = securityService.getCSPHeaders();
            Object.keys(cspHeaders).forEach(header => {
                res.setHeader(header, cspHeaders[header]);
            });
            
            // Additional security headers
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
            
            next();
        },
        
        // Session validation
        validateSession: (req, res, next) => {
            const session = req.session;
            
            if (!securityService.validateSession(session)) {
                return res.status(401).json({ error: 'Invalid or expired session' });
            }
            
            next();
        }
    };
}

// Scheduled tasks
function startSecurityTasks(securityService) {
    // Auto-purge old files every hour
    setInterval(() => {
        securityService.purgeOldFiles();
    }, 60 * 60 * 1000);
    
    // Initial purge
    securityService.purgeOldFiles();
}

module.exports = {
    SecurityService,
    createSecurityMiddleware,
    startSecurityTasks
};