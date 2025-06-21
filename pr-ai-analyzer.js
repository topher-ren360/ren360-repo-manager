#!/usr/bin/env node

/**
 * PR AI Analyzer - Advanced AI analysis for pull requests
 * 
 * This script provides deep analysis of PRs using AI to:
 * - Identify potential bugs and security issues
 * - Check code quality and best practices
 * - Suggest test cases
 * - Review architectural impacts
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get ticket number from command line
const ticketNumber = process.argv[2];
if (!ticketNumber) {
  console.error('Usage: node pr-ai-analyzer.js <ticket-number>');
  process.exit(1);
}

// Run the review command to get PR data
console.log(`Analyzing PRs for REN-${ticketNumber}...\n`);

try {
  // Get PR data using repo-manager
  const prData = execSync(`node repo-manager.js review ${ticketNumber} --analyze`, {
    encoding: 'utf8',
    cwd: __dirname
  });
  
  // Read the generated analysis file
  const analysisFile = `/tmp/pr-analysis-${ticketNumber}.txt`;
  if (!fs.existsSync(analysisFile)) {
    console.error('No analysis file found. Make sure PRs exist for this ticket.');
    process.exit(1);
  }
  
  const analysisPrompt = fs.readFileSync(analysisFile, 'utf8');
  
  // Enhanced prompt with specific review criteria
  const enhancedPrompt = `
You are a senior software engineer reviewing pull requests for ticket REN-${ticketNumber}.
Please provide a comprehensive code review focusing on:

${analysisPrompt}

Additionally, please analyze:

CODE QUALITY:
- Are there any code smells or anti-patterns?
- Is the code DRY (Don't Repeat Yourself)?
- Are functions/methods appropriately sized?
- Is error handling comprehensive?

SECURITY:
- Are there any potential security vulnerabilities?
- Is user input properly validated?
- Are there any exposed credentials or sensitive data?
- Are SQL queries parameterized?

PERFORMANCE:
- Are there any potential performance bottlenecks?
- Are database queries optimized?
- Is caching used appropriately?

TESTING:
- What test cases should be added?
- Are edge cases covered?
- Is the code testable?

ARCHITECTURE:
- Does this follow the existing architectural patterns?
- Are there any breaking changes?
- Is the code properly decoupled?

Please provide:
1. A severity rating (Critical/High/Medium/Low) for any issues found
2. Specific line-by-line feedback where applicable
3. Concrete suggestions for improvement
4. A final recommendation (Approve/Request Changes/Needs Discussion)

Format your response with clear sections and bullet points for readability.
`;
  
  // Save enhanced prompt
  const enhancedFile = `/tmp/pr-analysis-enhanced-${ticketNumber}.txt`;
  fs.writeFileSync(enhancedFile, enhancedPrompt);
  
  console.log(`Enhanced AI analysis prompt saved to: ${enhancedFile}`);
  console.log('\nTo get AI analysis, you can use:');
  console.log(`1. Claude: cat ${enhancedFile} | claude`);
  console.log(`2. ChatGPT: Copy contents and paste into ChatGPT`);
  console.log(`3. GitHub Copilot: gh copilot explain < ${enhancedFile}`);
  
  // If gh copilot is available, offer to run it
  try {
    execSync('gh copilot --version', { stdio: 'ignore' });
    console.log('\nGitHub Copilot detected! Run analysis now? (y/n)');
    
    // Note: In a real implementation, you'd handle user input here
    console.log(`Run: gh copilot explain < ${enhancedFile}`);
  } catch {
    // gh copilot not available
  }
  
  // Generate a quick summary without AI
  console.log('\n=== Quick Analysis Summary ===');
  
  // Parse the basic PR data
  const prDataLines = prData.split('\n');
  let totalChanges = 0;
  let services = new Set();
  
  prDataLines.forEach(line => {
    if (line.includes('Changes:')) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match) {
        totalChanges += parseInt(match[1]) + parseInt(match[2]);
      }
    }
    if (line.includes(':') && !line.includes('===')) {
      const service = line.trim().split(':')[0];
      if (service && !service.includes(' ')) {
        services.add(service);
      }
    }
  });
  
  console.log(`\nScope: ${services.size} services affected`);
  console.log(`Size: ${totalChanges} total lines changed`);
  
  if (totalChanges > 500) {
    console.log('⚠️  Large PR - consider breaking into smaller PRs');
  }
  
  if (services.size > 3) {
    console.log('⚠️  Multiple services affected - ensure coordinated deployment');
  }
  
  console.log('\n=== Checklist ===');
  console.log('[ ] Code follows project style guidelines');
  console.log('[ ] Self-review completed');
  console.log('[ ] Tests added/updated');
  console.log('[ ] Documentation updated');
  console.log('[ ] No console.log or debug code');
  console.log('[ ] Security considerations addressed');
  console.log('[ ] Performance impact assessed');
  console.log('[ ] Breaking changes documented');
  
} catch (error) {
  console.error('Error analyzing PRs:', error.message);
  process.exit(1);
}