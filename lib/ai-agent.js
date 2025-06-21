/**
 * AI Agent for PR Analysis using Anthropic Claude
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class AIAgent {
  constructor(apiKey, model = 'claude-3-sonnet-20240229', maxTokens = 4096) {
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.apiUrl = 'api.anthropic.com';
  }

  /**
   * Send a request to Claude API
   */
  async sendRequest(messages, systemPrompt = null) {
    return new Promise((resolve, reject) => {
      const requestBody = {
        model: this.model,
        max_tokens: this.maxTokens,
        messages: messages
      };
      
      // Only add system prompt if it's provided
      if (systemPrompt) {
        requestBody.system = systemPrompt;
      }
      
      const data = JSON.stringify(requestBody);

      const options = {
        hostname: this.apiUrl,
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': data.length
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(responseData);
            if (res.statusCode === 200) {
              resolve(response);
            } else {
              reject(new Error(`API Error: ${response.error?.message || responseData}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Analyze Pull Requests
   */
  async analyzePullRequests(prData, ticketNumber) {
    const systemPrompt = `You are an expert software engineer conducting a thorough code review.
Focus on:
1. Security vulnerabilities
2. Performance issues
3. Code quality and best practices
4. Testing recommendations
5. Architectural concerns

Provide specific, actionable feedback with severity ratings (Critical/High/Medium/Low).
Format your response with clear sections and bullet points.`;

    const userMessage = `Please analyze these pull requests for ticket REN-${ticketNumber}:

${JSON.stringify(prData, null, 2)}

For each service with changes, provide:
1. Overall assessment
2. Potential risks or concerns with severity
3. Specific areas needing review
4. Test case suggestions
5. Architecture/design considerations
6. Security audit findings

End with a summary recommendation: Approve, Request Changes, or Needs Discussion.`;

    try {
      const response = await this.sendRequest([
        { role: 'user', content: userMessage }
      ], systemPrompt);

      return response.content[0].text;
    } catch (error) {
      throw new Error(`AI Analysis failed: ${error.message}`);
    }
  }

  /**
   * Analyze code diff
   */
  async analyzeCodeDiff(diffContent, context) {
    const systemPrompt = `You are reviewing code changes. Focus on:
- Bugs and logic errors
- Security vulnerabilities
- Performance optimizations
- Code style and best practices
- Missing edge cases`;

    const userMessage = `Review this code diff for ${context}:

\`\`\`diff
${diffContent}
\`\`\`

Provide line-by-line feedback where needed.`;

    try {
      const response = await this.sendRequest([
        { role: 'user', content: userMessage }
      ], systemPrompt);

      return response.content[0].text;
    } catch (error) {
      throw new Error(`Code analysis failed: ${error.message}`);
    }
  }

  /**
   * Generate test suggestions
   */
  async suggestTests(prData) {
    const systemPrompt = `You are a QA engineer expert in test design.`;

    const userMessage = `Based on these PR changes:

${JSON.stringify(prData, null, 2)}

Suggest comprehensive test cases including:
1. Unit tests
2. Integration tests
3. Edge cases
4. Error scenarios
5. Performance tests where applicable

Format as actionable test cases with clear steps.`;

    try {
      const response = await this.sendRequest([
        { role: 'user', content: userMessage }
      ], systemPrompt);

      return response.content[0].text;
    } catch (error) {
      throw new Error(`Test suggestion failed: ${error.message}`);
    }
  }

  /**
   * Security audit
   */
  async securityAudit(prData) {
    const systemPrompt = `You are a security expert conducting a security audit.
Focus on OWASP Top 10 and common vulnerabilities.`;

    const userMessage = `Conduct a security audit of these changes:

${JSON.stringify(prData, null, 2)}

Check for:
1. SQL injection vulnerabilities
2. XSS vulnerabilities
3. Authentication/authorization issues
4. Sensitive data exposure
5. Input validation problems
6. Dependency vulnerabilities

Rate each finding: Critical, High, Medium, or Low.`;

    try {
      const response = await this.sendRequest([
        { role: 'user', content: userMessage }
      ], systemPrompt);

      return response.content[0].text;
    } catch (error) {
      throw new Error(`Security audit failed: ${error.message}`);
    }
  }
}

// Load API key from environment
function loadApiKey() {
  // Try .env file first
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/);
    if (match) {
      return match[1].trim();
    }
  }
  
  // Fall back to environment variable
  return process.env.ANTHROPIC_API_KEY;
}

// Get model from environment
function getModel() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/ANTHROPIC_MODEL=(.+)/);
    if (match) {
      return match[1].trim();
    }
  }
  
  return process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229';
}

// Get max tokens from environment
function getMaxTokens() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/ANTHROPIC_MAX_TOKENS=(.+)/);
    if (match) {
      return parseInt(match[1].trim());
    }
  }
  
  return parseInt(process.env.ANTHROPIC_MAX_TOKENS) || 4096;
}

module.exports = {
  AIAgent,
  loadApiKey,
  getModel,
  getMaxTokens
};