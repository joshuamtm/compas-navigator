const puppeteer = require('puppeteer');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel } = require('docx');
const fs = require('fs').promises;
const path = require('path');

class ExportService {
    constructor() {
        this.exportDir = path.join(__dirname, 'exports');
        this.ensureExportDir();
    }

    async ensureExportDir() {
        try {
            await fs.mkdir(this.exportDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create export directory:', error);
        }
    }

    // Export to Markdown
    async exportToMarkdown(sessionData) {
        const report = this.generateMarkdownReport(sessionData);
        const filename = `compas-report-${sessionData.sessionId}-${Date.now()}.md`;
        const filepath = path.join(this.exportDir, filename);
        
        await fs.writeFile(filepath, report, 'utf8');
        
        return {
            filename,
            filepath,
            content: report
        };
    }

    // Export to PDF using Puppeteer
    async exportToPDF(sessionData) {
        const markdownContent = this.generateMarkdownReport(sessionData);
        const htmlContent = this.convertMarkdownToHTML(markdownContent);
        
        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        
        // Set content with styling
        await page.setContent(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 40px 20px;
                    }
                    h1, h2, h3 {
                        color: #2563eb;
                        margin-top: 24px;
                        margin-bottom: 16px;
                    }
                    h1 { font-size: 2em; }
                    h2 { font-size: 1.5em; }
                    h3 { font-size: 1.2em; }
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 12px;
                        text-align: left;
                    }
                    th {
                        background-color: #f8f9fa;
                        font-weight: 600;
                    }
                    ul {
                        margin: 10px 0;
                        padding-left: 30px;
                    }
                    li {
                        margin: 5px 0;
                    }
                    .metadata {
                        font-size: 0.9em;
                        color: #666;
                        margin-bottom: 30px;
                    }
                </style>
            </head>
            <body>
                ${htmlContent}
                <div class="metadata">
                    <p>Generated on: ${new Date().toLocaleString()}</p>
                    <p>Session ID: ${sessionData.sessionId}</p>
                </div>
            </body>
            </html>
        `);
        
        const filename = `compas-report-${sessionData.sessionId}-${Date.now()}.pdf`;
        const filepath = path.join(this.exportDir, filename);
        
        await page.pdf({
            path: filepath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });
        
        await browser.close();
        
        return {
            filename,
            filepath
        };
    }

    // Export to DOCX
    async exportToDocx(sessionData) {
        const doc = new Document({
            sections: [{
                properties: {},
                children: this.generateDocxContent(sessionData)
            }]
        });
        
        const filename = `compas-report-${sessionData.sessionId}-${Date.now()}.docx`;
        const filepath = path.join(this.exportDir, filename);
        
        const buffer = await Packer.toBuffer(doc);
        await fs.writeFile(filepath, buffer);
        
        return {
            filename,
            filepath
        };
    }

    // Generate markdown report
    generateMarkdownReport(sessionData) {
        const challengeTitle = sessionData.objective || 'Nonprofit Challenge';
        
        let report = `# COMPAS Report – ${challengeTitle}\n\n`;
        report += `**Generated:** ${new Date().toLocaleString()}\n`;
        report += `**Session ID:** ${sessionData.sessionId}\n\n`;
        
        // Data/Context section
        report += `## 0. Data / Context to Supply AI\n\n`;
        report += `| Artifact | Current format | Owner | Prep needed | Upload method |\n`;
        report += `|----------|----------------|-------|-------------|---------------|\n`;
        
        if (sessionData.context && sessionData.context.artifacts) {
            sessionData.context.artifacts.forEach(artifact => {
                const prepNeeded = artifact.sensitivity === 'high' ? 'Redact PII' : 'None';
                report += `| ${artifact.filename} | ${artifact.mimetype} | ${artifact.owner} | ${prepNeeded} | ${artifact.source} |\n`;
            });
        }
        
        // Context summary
        report += `\n## 1. Context (summary)\n\n`;
        if (sessionData.context && sessionData.context.facts) {
            sessionData.context.facts.forEach(fact => {
                report += `- ${fact}\n`;
            });
        } else {
            report += `- Context to be gathered\n`;
        }
        
        // Objective
        report += `\n## 2. Objective (root problem)\n\n`;
        report += `- ${sessionData.objective || 'To be defined'}\n`;
        
        // Chosen method
        report += `\n## 3. Chosen Method(s)\n\n`;
        report += `- ${sessionData.chosenMethod || 'To be selected'}\n`;
        
        // Implementation plan
        report += `\n## 4. Implementation Plan\n\n`;
        if (sessionData.implementationPlan && sessionData.implementationPlan.steps) {
            report += `| Step | Owner | When | Notes |\n`;
            report += `|------|-------|------|-------|\n`;
            sessionData.implementationPlan.steps.forEach(step => {
                report += `| ${step.description} | ${step.owner} | ${step.timeline} | ${step.notes || '-'} |\n`;
            });
        } else {
            report += `Implementation plan to be developed\n`;
        }
        
        // Performance measures
        report += `\n## 5. Performance Measures\n\n`;
        if (sessionData.performanceMeasures && sessionData.performanceMeasures.length > 0) {
            sessionData.performanceMeasures.forEach(measure => {
                report += `- ${measure.metric} • ${measure.target} • ${measure.collection}\n`;
            });
        } else {
            report += `- Measures to be defined\n`;
        }
        
        // Learning questions
        report += `\n## 6. Learning Questions\n\n`;
        if (sessionData.learningQuestions && sessionData.learningQuestions.length > 0) {
            sessionData.learningQuestions.forEach(question => {
                report += `- ${question}\n`;
            });
        } else {
            report += `- Questions to be identified\n`;
        }
        
        return report;
    }

    // Convert markdown to HTML
    convertMarkdownToHTML(markdown) {
        // Simple markdown to HTML conversion
        let html = markdown
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/^\- (.*$)/gim, '<li>$1</li>')
            .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
        
        // Convert markdown tables to HTML
        html = html.replace(/\|(.+)\|[\s\S]*?\|(.+)\|/g, (match) => {
            const lines = match.trim().split('\n');
            let table = '<table>';
            
            lines.forEach((line, index) => {
                if (index === 1) return; // Skip separator line
                
                const cells = line.split('|').filter(cell => cell.trim());
                const tag = index === 0 ? 'th' : 'td';
                
                table += '<tr>';
                cells.forEach(cell => {
                    table += `<${tag}>${cell.trim()}</${tag}>`;
                });
                table += '</tr>';
            });
            
            table += '</table>';
            return table;
        });
        
        // Wrap lists
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        
        return `<p>${html}</p>`;
    }

    // Generate DOCX content
    generateDocxContent(sessionData) {
        const content = [];
        const challengeTitle = sessionData.objective || 'Nonprofit Challenge';
        
        // Title
        content.push(
            new Paragraph({
                text: `COMPAS Report – ${challengeTitle}`,
                heading: HeadingLevel.HEADING_1
            })
        );
        
        // Metadata
        content.push(
            new Paragraph({
                children: [
                    new TextRun({ text: 'Generated: ', bold: true }),
                    new TextRun(new Date().toLocaleString())
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: 'Session ID: ', bold: true }),
                    new TextRun(sessionData.sessionId)
                ]
            }),
            new Paragraph({ text: '' }) // Empty line
        );
        
        // Data/Context section
        content.push(
            new Paragraph({
                text: '0. Data / Context to Supply AI',
                heading: HeadingLevel.HEADING_2
            })
        );
        
        if (sessionData.context && sessionData.context.artifacts && sessionData.context.artifacts.length > 0) {
            // Create table for artifacts
            const table = new Table({
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({ children: [new Paragraph('Artifact')] }),
                            new TableCell({ children: [new Paragraph('Current format')] }),
                            new TableCell({ children: [new Paragraph('Owner')] }),
                            new TableCell({ children: [new Paragraph('Prep needed')] }),
                            new TableCell({ children: [new Paragraph('Upload method')] })
                        ]
                    }),
                    ...sessionData.context.artifacts.map(artifact => 
                        new TableRow({
                            children: [
                                new TableCell({ children: [new Paragraph(artifact.filename)] }),
                                new TableCell({ children: [new Paragraph(artifact.mimetype)] }),
                                new TableCell({ children: [new Paragraph(artifact.owner)] }),
                                new TableCell({ children: [new Paragraph(artifact.sensitivity === 'high' ? 'Redact PII' : 'None')] }),
                                new TableCell({ children: [new Paragraph(artifact.source)] })
                            ]
                        })
                    )
                ]
            });
            content.push(table);
        }
        
        // Continue with other sections...
        // (Similar pattern for other sections)
        
        return content;
    }
}

// Express route handlers
function createExportRoutes(app) {
    const exportService = new ExportService();
    
    // Export endpoint
    app.post('/api/sessions/:sessionId/export', async (req, res) => {
        const { format } = req.body;
        const sessionId = req.params.sessionId;
        
        // Get session data
        const session = req.app.locals.sessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        try {
            let result;
            
            switch (format) {
                case 'markdown':
                    result = await exportService.exportToMarkdown(session);
                    res.download(result.filepath, result.filename);
                    break;
                    
                case 'pdf':
                    result = await exportService.exportToPDF(session);
                    res.download(result.filepath, result.filename);
                    break;
                    
                case 'docx':
                    result = await exportService.exportToDocx(session);
                    res.download(result.filepath, result.filename);
                    break;
                    
                default:
                    return res.status(400).json({ error: 'Invalid export format' });
            }
            
            // Clean up file after download
            setTimeout(async () => {
                try {
                    await fs.unlink(result.filepath);
                } catch (error) {
                    console.error('Failed to clean up export file:', error);
                }
            }, 60000); // Delete after 1 minute
            
        } catch (error) {
            console.error('Export failed:', error);
            res.status(500).json({ error: 'Export failed' });
        }
    });
}

module.exports = {
    ExportService,
    createExportRoutes
};