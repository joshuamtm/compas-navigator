class COMPASNavigator {
    constructor() {
        this.sessionId = null;
        this.currentStage = 'context_discovery';
        this.artifacts = [];
        this.initializeApp();
    }

    async initializeApp() {
        // Show welcome modal
        this.showWelcomeModal();
        
        // Create new session
        await this.createSession();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Initialize UI
        this.updateProgressBar();
    }

    showWelcomeModal() {
        document.getElementById('welcomeModal').style.display = 'block';
    }

    async createSession() {
        try {
            const response = await fetch('/.netlify/functions/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json();
            this.sessionId = data.sessionId;
            this.currentStage = data.stage;
        } catch (error) {
            console.error('Failed to create session:', error);
            this.showError('Failed to initialize session. Please refresh the page.');
        }
    }

    setupEventListeners() {
        // Send message
        const sendButton = document.getElementById('sendButton');
        const messageInput = document.getElementById('messageInput');
        
        sendButton.addEventListener('click', () => this.sendMessage());
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // File upload
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Generate report
        const generateReportBtn = document.getElementById('generateReportBtn');
        generateReportBtn.addEventListener('click', () => this.generateReport());

        // Export
        const exportBtn = document.getElementById('exportBtn');
        exportBtn.addEventListener('click', () => this.showExportModal());

        // Export options
        document.querySelectorAll('.export-option').forEach(btn => {
            btn.addEventListener('click', (e) => this.exportReport(e.target.dataset.format));
        });

        // Modal close
        document.querySelector('.close').addEventListener('click', () => {
            document.getElementById('exportModal').style.display = 'none';
        });
    }

    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        
        if (!message) return;
        
        // Disable input while processing
        messageInput.disabled = true;
        document.getElementById('sendButton').disabled = true;
        
        // Add user message to chat
        this.addMessage('user', message);
        
        // Clear input
        messageInput.value = '';
        
        try {
            // Show typing indicator
            const typingId = this.showTypingIndicator();
            
            const response = await fetch(`/.netlify/functions/api/sessions/${this.sessionId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
            
            const data = await response.json();
            
            // Remove typing indicator
            this.removeTypingIndicator(typingId);
            
            // Add assistant response
            this.addMessage('assistant', data.message);
            
            // Update stage if changed
            if (data.stage !== this.currentStage) {
                this.currentStage = data.stage;
                this.updateProgressBar();
                this.showMilestone(data.stage);
                
                // Show artifact basket when needed
                if (data.stage === 'context_discovery' || data.stage === 'objective_definition') {
                    document.getElementById('artifactBasket').style.display = 'block';
                }
                
                // Enable report generation if complete
                if (data.stage === 'complete') {
                    document.getElementById('generateReportBtn').disabled = false;
                }
            }
            
            // Update artifacts if any
            if (data.sessionState && data.sessionState.artifacts) {
                this.updateArtifactsDisplay(data.sessionState.artifacts);
            }
            
        } catch (error) {
            console.error('Failed to send message:', error);
            this.showError('Failed to send message. Please try again.');
        } finally {
            // Re-enable input
            messageInput.disabled = false;
            document.getElementById('sendButton').disabled = false;
            messageInput.focus();
        }
    }

    addMessage(role, content) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = content;
        
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    showTypingIndicator() {
        const id = `typing-${Date.now()}`;
        const chatMessages = document.getElementById('chatMessages');
        const typingDiv = document.createElement('div');
        typingDiv.id = id;
        typingDiv.className = 'message assistant';
        typingDiv.innerHTML = '<div class="message-content"><div class="loading"></div></div>';
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return id;
    }

    removeTypingIndicator(id) {
        const element = document.getElementById(id);
        if (element) element.remove();
    }

    updateProgressBar() {
        const stages = ['context_discovery', 'objective_definition', 'method_ideation', 'method_selection', 'implementation_plan', 'complete'];
        const currentIndex = stages.indexOf(this.currentStage);
        
        document.querySelectorAll('.progress-step').forEach((step, index) => {
            const statusElement = step.querySelector('.step-status');
            
            if (index < currentIndex) {
                step.classList.add('completed');
                step.classList.remove('active');
                if (statusElement) statusElement.textContent = 'Completed ✓';
            } else if (index === currentIndex) {
                step.classList.add('active');
                step.classList.remove('completed');
                if (statusElement) statusElement.textContent = 'In Progress';
            } else {
                step.classList.remove('active', 'completed');
                if (statusElement) statusElement.textContent = 'Pending';
            }
        });
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        // Get additional metadata
        const owner = prompt('Who owns this file?', 'Unknown');
        const sensitivity = prompt('What is the sensitivity level? (normal/high)', 'normal');
        const source = prompt('What is the source of this file?', 'Manual upload');
        
        formData.append('owner', owner || 'Unknown');
        formData.append('sensitivity', sensitivity || 'normal');
        formData.append('source', source || 'Manual upload');
        
        try {
            const response = await fetch(`/.netlify/functions/api/sessions/${this.sessionId}/upload`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.artifact) {
                this.artifacts.push(data.artifact);
                this.updateArtifactsDisplay(this.artifacts);
                this.addMessage('assistant', `File "${file.name}" has been successfully uploaded and added to the artifact basket.`);
            }
        } catch (error) {
            console.error('Failed to upload file:', error);
            this.showError('Failed to upload file. Please try again.');
        }
        
        // Reset file input
        event.target.value = '';
    }

    updateArtifactsDisplay(artifacts) {
        this.artifacts = artifacts;
        const artifactList = document.getElementById('artifactList');
        
        if (artifacts.length === 0) {
            artifactList.innerHTML = '<p class="empty-state">No artifacts added yet</p>';
            return;
        }
        
        artifactList.innerHTML = artifacts.map(artifact => `
            <div class="artifact-item">
                <div class="artifact-info">
                    <div class="artifact-name">${artifact.filename}</div>
                    <div class="artifact-meta">
                        ${artifact.owner} • ${artifact.sensitivity} • ${this.formatFileSize(artifact.size)}
                    </div>
                </div>
                <button class="remove-artifact" onclick="navigator.removeArtifact('${artifact.id}')">×</button>
            </div>
        `).join('');
    }

    removeArtifact(artifactId) {
        this.artifacts = this.artifacts.filter(a => a.id !== artifactId);
        this.updateArtifactsDisplay(this.artifacts);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async generateReport() {
        try {
            const response = await fetch(`/.netlify/functions/api/sessions/${this.sessionId}/report`);
            const data = await response.json();
            
            if (data.report) {
                // Display report in a new message
                this.addMessage('assistant', 'Here is your COMPAS report:\n\n' + data.report);
                
                // Enable export button
                document.getElementById('exportBtn').disabled = false;
                
                // Store report for export
                this.currentReport = data.report;
            }
        } catch (error) {
            console.error('Failed to generate report:', error);
            this.showError('Failed to generate report. Please try again.');
        }
    }

    showExportModal() {
        document.getElementById('exportModal').style.display = 'block';
    }

    exportReport(format) {
        if (!this.currentReport) {
            this.showError('No report available to export.');
            return;
        }
        
        switch (format) {
            case 'markdown':
                this.downloadFile('compas-report.md', this.currentReport, 'text/markdown');
                break;
            case 'pdf':
                // In a real implementation, you would convert to PDF server-side
                alert('PDF export would be implemented server-side');
                break;
            case 'docx':
                // In a real implementation, you would convert to DOCX server-side
                alert('DOCX export would be implemented server-side');
                break;
        }
        
        // Close modal
        document.getElementById('exportModal').style.display = 'none';
    }

    downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    showMilestone(stage) {
        const stageMessages = {
            'objective_definition': 'Great work! You\'ve completed the Context Discovery phase. You\'re 20% through your COMPAS journey.',
            'method_ideation': 'Excellent! Problem defined. You\'re 40% through your COMPAS journey.',
            'method_selection': 'Progress! Methods identified. You\'re 60% through your COMPAS journey.',
            'implementation_plan': 'Almost there! Method selected. You\'re 80% through your COMPAS journey.',
            'complete': '🎉 Congratulations! You\'ve completed your COMPAS journey. Your action plan is ready!'
        };
        
        if (stageMessages[stage]) {
            this.showNotification(stageMessages[stage], 'success');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    showError(message) {
        this.showNotification(message, 'error');
    }
}

// Global functions
function closeWelcomeModal() {
    document.getElementById('welcomeModal').style.display = 'none';
}

// Initialize app when DOM is ready
let navigator;
document.addEventListener('DOMContentLoaded', () => {
    navigator = new COMPASNavigator();
});