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
            const response = await fetch('/.netlify/functions/simple-api/sessions', {
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
        const sendButton = document.getElementById('sendButton');
        sendButton.disabled = true;
        sendButton.classList.add('processing');
        
        // Add user message to chat
        this.addMessage('user', message);
        
        // Clear input
        messageInput.value = '';
        
        try {
            // Show typing indicator
            const typingId = this.showTypingIndicator();
            
            const response = await fetch(`/.netlify/functions/simple-api/sessions/${this.sessionId}/chat`, {
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
                const oldStage = this.currentStage;
                this.currentStage = data.stage;
                this.updateProgressBar();
                this.showMilestone(data.stage, oldStage);
                
                // Show artifact basket when needed
                if (data.stage === 'context_discovery' || data.stage === 'objective_definition') {
                    document.getElementById('artifactBasket').style.display = 'block';
                }
                
                // Enable report generation if complete
                if (data.stage === 'complete') {
                    document.getElementById('generateReportBtn').disabled = false;
                }
            }
            
            // Display stage progress information
            if (data.stageAnalysis) {
                this.displayStageProgress(data.stageAnalysis);
            }
            
            // Update outcome preview with session state
            if (data.sessionState) {
                this.updateOutcomePreview(data.sessionState);
            }

            // Update stage data display
            if (data.sessionState) {
                this.updateStageDataDisplay(data.sessionState);
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
            const sendButton = document.getElementById('sendButton');
            sendButton.disabled = false;
            sendButton.classList.remove('processing');
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
        typingDiv.innerHTML = `
            <div class="typing-indicator">
                <span>COMPAS Navigator is thinking</span>
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
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
            const response = await fetch(`/.netlify/functions/simple-api/sessions/${this.sessionId}/upload`, {
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
            const response = await fetch(`/.netlify/functions/simple-api/sessions/${this.sessionId}/report`);
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

    async exportReport(format) {
        if (!this.currentReport) {
            this.showError('No report available to export.');
            return;
        }
        
        try {
            switch (format) {
                case 'markdown':
                    this.downloadFile('compas-report.md', this.currentReport, 'text/markdown');
                    break;
                case 'pdf':
                    await this.exportServerSide('pdf');
                    break;
                case 'docx':
                    await this.exportServerSide('docx');
                    break;
            }
        } catch (error) {
            console.error('Export error:', error);
            this.showError('Failed to export report. Please try again.');
        }
        
        // Close modal
        document.getElementById('exportModal').style.display = 'none';
    }

    async exportServerSide(format) {
        const response = await fetch(`/.netlify/functions/simple-api/sessions/${this.sessionId}/export/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Export failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compas-report.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        this.showNotification(`Report exported as ${format.toUpperCase()} successfully!`, 'success');
    }

    displayStageProgress(analysis) {
        // Create or update a progress indicator
        let progressIndicator = document.getElementById('stageProgressIndicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.id = 'stageProgressIndicator';
            progressIndicator.className = 'stage-progress-indicator';
            
            // Insert after the progress bar
            const progressBar = document.querySelector('.progress-bar');
            progressBar.parentNode.insertBefore(progressIndicator, progressBar.nextSibling);
        }

        const completionPercentage = analysis.completionPercentage || 0;
        const missingInfo = analysis.missingInformation || [];

        progressIndicator.innerHTML = `
            <div class="stage-progress-content">
                <div class="progress-header">
                    <h4>Current Stage Progress</h4>
                    <span class="progress-percentage">${completionPercentage}%</span>
                </div>
                <div class="progress-bar-fill">
                    <div class="progress-fill" style="width: ${completionPercentage}%"></div>
                </div>
                ${missingInfo.length > 0 ? `
                    <div class="missing-info">
                        <h5>Still Needed:</h5>
                        <ul>${missingInfo.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                ` : '<div class="completion-message">Stage requirements met! 🎯</div>'}
            </div>
        `;

        // Auto-hide after stage completion
        if (completionPercentage >= 100) {
            setTimeout(() => {
                progressIndicator.style.display = 'none';
            }, 3000);
        }
    }

    updateStageDataDisplay(sessionState) {
        // Update the outcome preview with actual data
        const outcomePreview = document.querySelector('.outcome-preview');
        if (outcomePreview && sessionState.allStageData) {
            this.updateOutcomePreview(sessionState.allStageData);
        }
    }

    updateOutcomePreview(stageData) {
        const contextData = stageData.context_discovery || {};
        const objectiveData = stageData.objective_definition || {};
        const planData = stageData.implementation_plan || {};

        const outcomeList = document.querySelector('.outcome-list');
        if (outcomeList) {
            const items = [
                {
                    icon: '📋',
                    text: contextData.problemStatement || objectiveData.problemStatement ? 
                        'Clear problem statement ✓' : 'Clear problem statement',
                    completed: !!(contextData.problemStatement || objectiveData.problemStatement)
                },
                {
                    icon: '🎯',
                    text: stageData.method_selection?.chosenMethod ? 
                        'Specific solution recommendations ✓' : 'Specific solution recommendations',
                    completed: !!stageData.method_selection?.chosenMethod
                },
                {
                    icon: '📅',
                    text: planData.implementationSteps?.length > 0 ? 
                        'Step-by-step implementation plan ✓' : 'Step-by-step implementation plan',
                    completed: planData.implementationSteps?.length > 0
                },
                {
                    icon: '📊',
                    text: planData.performanceMeasures?.length > 0 ? 
                        'Success metrics and timelines ✓' : 'Success metrics and timelines',
                    completed: planData.performanceMeasures?.length > 0
                },
                {
                    icon: '💾',
                    text: 'Exportable action plan (PDF/DOCX)',
                    completed: this.currentStage === 'complete'
                }
            ];

            outcomeList.innerHTML = items.map(item => `
                <li class="${item.completed ? 'completed' : ''}">
                    <span class="outcome-icon">${item.icon}</span> 
                    ${item.text}
                </li>
            `).join('');
        }
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

    showMilestone(stage, oldStage) {
        const stageMessages = {
            'objective_definition': {
                title: '✅ Context Discovery Complete!',
                message: 'You\'ve clearly defined your challenge.',
                nextStep: '🎯 Next: We\'ll identify the root problem to solve (3-5 minutes)',
                progress: '20%'
            },
            'method_ideation': {
                title: '✅ Objective Definition Complete!',
                message: 'We\'ve identified your core problem.',
                nextStep: '⚡ Next: I\'ll propose 3 solution approaches (2-3 minutes)',
                progress: '40%'
            },
            'method_selection': {
                title: '✅ Methods Identified!',
                message: 'We have solution approaches to choose from.',
                nextStep: '🎯 Next: Select your preferred method (2-3 minutes)',
                progress: '60%'
            },
            'implementation_plan': {
                title: '✅ Method Selected!',
                message: 'We\'re ready to create your action plan.',
                nextStep: '📋 Next: Build detailed implementation steps (5-7 minutes)',
                progress: '80%'
            },
            'complete': {
                title: '🎉 COMPAS Journey Complete!',
                message: 'Your professional action plan is ready for export.',
                nextStep: '📥 Download your PDF or DOCX report below',
                progress: '100%'
            }
        };
        
        if (stageMessages[stage] && oldStage !== stage) {
            const msg = stageMessages[stage];
            this.showNotification(`${msg.title}\n${msg.message}\n${msg.nextStep}\nProgress: ${msg.progress}`, 'milestone');
        }
    }

    displayStageProgress(analysis) {
        if (!analysis) return;
        
        const progressElement = document.querySelector('.stage-progress');
        if (!progressElement) {
            // Create progress display if it doesn't exist
            const progressDiv = document.createElement('div');
            progressDiv.className = 'stage-progress';
            progressDiv.innerHTML = `
                <div class="progress-header">
                    <h4>Current Progress</h4>
                    <span class="progress-percentage">${analysis.completionPercentage || 0}%</span>
                </div>
                <div class="progress-bar-fill">
                    <div class="progress-fill" style="width: ${analysis.completionPercentage || 0}%"></div>
                </div>
                <div class="missing-info"></div>
            `;
            
            // Insert before chat container
            const chatContainer = document.querySelector('.chat-container');
            chatContainer.parentNode.insertBefore(progressDiv, chatContainer);
        }
        
        // Update progress information
        document.querySelector('.progress-percentage').textContent = `${analysis.completionPercentage || 0}%`;
        document.querySelector('.progress-fill').style.width = `${analysis.completionPercentage || 0}%`;
        
        // Show missing information if any
        const missingInfoDiv = document.querySelector('.missing-info');
        if (analysis.missingInformation && analysis.missingInformation.length > 0) {
            missingInfoDiv.innerHTML = `
                <div class="missing-info-content">
                    <strong>Still needed:</strong>
                    <ul>${analysis.missingInformation.map(item => `<li>${item}</li>`).join('')}</ul>
                </div>
            `;
        } else {
            missingInfoDiv.innerHTML = '';
        }
    }

    updateOutcomePreview(sessionState) {
        const outcomeList = document.querySelector('.outcome-list');
        if (!outcomeList) return;
        
        const items = [
            { text: 'Clear problem statement', completed: sessionState.allStageData?.objective_definition?.completed },
            { text: 'Specific solution recommendations', completed: sessionState.allStageData?.method_ideation?.completed },
            { text: 'Step-by-step implementation plan', completed: sessionState.allStageData?.implementation_plan?.completed },
            { text: 'Success metrics and timelines', completed: sessionState.allStageData?.implementation_plan?.performanceMeasures?.length > 0 },
            { text: 'Exportable action plan (PDF/DOCX)', completed: this.currentStage === 'complete' }
        ];
        
        outcomeList.innerHTML = items.map(item => `
            <li class="${item.completed ? 'completed' : ''}">
                <span class="outcome-icon">${item.completed ? '✅' : '📋'}</span>
                ${item.text}
            </li>
        `).join('');
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