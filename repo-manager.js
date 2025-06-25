#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// Import AI Agent if available
let AIAgent, loadApiKey, getModel, getMaxTokens;
try {
  const aiModule = require('./lib/ai-agent');
  AIAgent = aiModule.AIAgent;
  loadApiKey = aiModule.loadApiKey;
  getModel = aiModule.getModel;
  getMaxTokens = aiModule.getMaxTokens;
} catch (error) {
  // AI module not available
}

// Load environment variables including GH_TOKEN
function loadEnvVar(varName) {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(new RegExp(`${varName}=(.+)`));
    if (match) {
      return match[1].trim();
    }
  }
  return process.env[varName];
}

// Set GH_TOKEN if available
const ghToken = loadEnvVar('GH_TOKEN');
if (ghToken) {
  process.env.GH_TOKEN = ghToken;
}

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// Configuration
const DEFAULT_REPO_ROOT = '/var/amarki/repository';
let REPO_ROOT = DEFAULT_REPO_ROOT;

// Check for custom repository root from environment or config file
function getRepoRoot() {
  // 1. Check environment variable
  if (process.env.REN360_REPO_ROOT) {
    return process.env.REN360_REPO_ROOT;
  }
  
  // 2. Check .ren360rc config file in current directory
  const localConfig = path.join(process.cwd(), '.ren360rc');
  if (fs.existsSync(localConfig)) {
    try {
      const config = JSON.parse(fs.readFileSync(localConfig, 'utf8'));
      if (config.repoRoot) {
        return config.repoRoot;
      }
    } catch (error) {
      console.error(`Error reading ${localConfig}: ${error.message}`);
    }
  }
  
  // 3. Check .ren360rc config file in home directory
  const homeConfig = path.join(require('os').homedir(), '.ren360rc');
  if (fs.existsSync(homeConfig)) {
    try {
      const config = JSON.parse(fs.readFileSync(homeConfig, 'utf8'));
      if (config.repoRoot) {
        return config.repoRoot;
      }
    } catch (error) {
      console.error(`Error reading ${homeConfig}: ${error.message}`);
    }
  }
  
  // 4. Check .env file for REPO_ROOT
  const repoRootFromEnv = loadEnvVar('REPO_ROOT');
  if (repoRootFromEnv) {
    return repoRootFromEnv;
  }
  
  return DEFAULT_REPO_ROOT;
}

// Service definitions (will be populated based on REPO_ROOT)
let services = {};

function initializeServices() {
  services = {
    ads: path.join(REPO_ROOT, 'microAds/'),
    emails: path.join(REPO_ROOT, 'microEmails/'),
    frontend: path.join(REPO_ROOT, 'microFrontend/'),
    images: path.join(REPO_ROOT, 'microImages/'),
    integrations: path.join(REPO_ROOT, 'microIntegrations/'),
    intelligence: path.join(REPO_ROOT, 'microIntelligence/'),
    sms: path.join(REPO_ROOT, 'microSms/'),
    social: path.join(REPO_ROOT, 'microSocial/'),
    templates: path.join(REPO_ROOT, 'microTemplates/'),
    users: path.join(REPO_ROOT, 'microUsers/')
  };
}

// Global verbose flag
let VERBOSE = false;

// Utility functions
function log(message, color = 'reset', forceShow = false) {
  if (VERBOSE || forceShow) {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }
}

function execCommand(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', ...options }).trim();
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

function checkRoot() {
  try {
    const uid = execCommand('id -u');
    return uid === '0';
  } catch {
    return false;
  }
}

function gitCommand(repoPath, command) {
  return execCommand(`sudo -u www-data git ${command}`, { cwd: repoPath });
}

// Core functions
function getCurrentBranch(serviceName, repoPath) {
  try {
    if (!fs.existsSync(repoPath)) {
      return { service: serviceName, branch: 'N/A', error: 'Directory not found' };
    }
    
    const branch = gitCommand(repoPath, 'rev-parse --abbrev-ref HEAD');
    return { service: serviceName, branch, error: null };
  } catch (error) {
    return { service: serviceName, branch: 'N/A', error: error.message };
  }
}

function getAllBranches(serviceName, repoPath) {
  try {
    if (!fs.existsSync(repoPath)) {
      return { service: serviceName, branches: [], error: 'Directory not found' };
    }
    
    // Fetch latest to ensure we have all remote branches
    try {
      gitCommand(repoPath, 'fetch --all --quiet');
    } catch (e) {
      // Continue even if fetch fails
    }
    
    // Get all branches (local and remote)
    const output = gitCommand(repoPath, 'branch -a');
    const branches = output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Remove markers like * and remotes/origin/
        line = line.replace(/^\*\s*/, '');
        line = line.replace(/^remotes\/origin\//, '');
        return line;
      })
      .filter((branch, index, self) => {
        // Remove duplicates and HEAD reference
        return branch !== 'HEAD' && self.indexOf(branch) === index;
      });
    
    return { service: serviceName, branches, error: null };
  } catch (error) {
    return { service: serviceName, branches: [], error: error.message };
  }
}

function updateServiceBranch(serviceName, repoPath, targetBranch, useComposerUpdate = false, skipDeps = false) {
  try {
    if (!fs.existsSync(repoPath)) {
      return { service: serviceName, success: false, error: 'Directory not found' };
    }
    
    if (!VERBOSE) {
      process.stdout.write(`${colors.yellow}${serviceName}${colors.reset}... `);
    } else {
      log(`\nUpdating ${serviceName} to branch: ${targetBranch}`, 'yellow');
    }
    
    // Get current branch
    const currentBranch = gitCommand(repoPath, 'rev-parse --abbrev-ref HEAD');
    log(`Current branch: ${currentBranch}`);
    
    // Check for uncommitted changes
    try {
      gitCommand(repoPath, 'diff-index --quiet HEAD --');
    } catch {
      log('Warning: Uncommitted changes detected, stashing...', 'yellow');
      gitCommand(repoPath, `stash push -m "Auto-stash before branch update ${new Date().toISOString()}"`);
    }
    
    // Fetch latest
    log('Fetching latest changes...');
    gitCommand(repoPath, 'fetch');
    
    // Check if branch exists
    try {
      gitCommand(repoPath, `rev-parse --verify origin/${targetBranch}`);
    } catch {
      throw new Error(`Branch '${targetBranch}' does not exist in remote`);
    }
    
    // Checkout and pull
    log(`Checking out branch ${targetBranch}...`);
    gitCommand(repoPath, `checkout ${targetBranch}`);
    
    log('Pulling latest changes...');
    gitCommand(repoPath, 'pull');
    
    // Update dependencies
    if (!skipDeps) {
      updateDependencies(serviceName, repoPath, useComposerUpdate);
    } else {
      log('Skipping dependency installation', 'yellow');
    }
    
    // Get latest commit
    const latestCommit = gitCommand(repoPath, 'log -1 --pretty=format:"%h - %s (%cr)"');
    
    if (!VERBOSE) {
      console.log(`${colors.green}✓${colors.reset}`);
    } else {
      log(`Success: ${serviceName} updated to ${targetBranch}`, 'green');
      log(`Latest commit: ${latestCommit}`);
    }
    
    return { service: serviceName, success: true, branch: targetBranch, commit: latestCommit };
  } catch (error) {
    if (!VERBOSE) {
      console.log(`${colors.red}✗${colors.reset}`);
    } else {
      log(`Error updating ${serviceName}: ${error.message}`, 'red');
    }
    return { service: serviceName, success: false, error: error.message };
  }
}

function updateDependencies(serviceName, repoPath, useUpdate = false) {
  try {
    // Check for composer.json
    if (fs.existsSync(path.join(repoPath, 'composer.json'))) {
      const command = useUpdate ? 'update' : 'install';
      log(`Running composer ${command}...`);
      
      // Services that use default composer (based on shell scripts)
      const defaultComposerServices = ['users', 'images'];
      
      // Services that use PHP 8.2 with Composer 2.6 (based on shell scripts)
      const php82Services = ['emails', 'frontend', 'integrations', 'sms', 'templates'];
      
      // Services that use PHP 8.1 with Composer 2.6 (based on shell scripts)
      const php81Services = ['ads', 'social'];
      
      if (defaultComposerServices.includes(serviceName)) {
        // users.sh and images.sh just use 'composer install' without full path
        execCommand(`sudo -u www-data composer ${command} --no-interaction`, { cwd: repoPath });
      } else if (php82Services.includes(serviceName)) {
        // Uses full paths: /usr/bin/php8.2 /usr/local/bin/composer26
        execCommand(`sudo -u www-data /usr/bin/php8.2 /usr/local/bin/composer26 ${command} --no-interaction`, { cwd: repoPath });
      } else if (php81Services.includes(serviceName)) {
        // Uses full paths: /usr/bin/php8.1 /usr/local/bin/composer26
        execCommand(`sudo -u www-data /usr/bin/php8.1 /usr/local/bin/composer26 ${command} --no-interaction`, { cwd: repoPath });
      } else {
        // Default fallback
        execCommand(`sudo -u www-data composer ${command} --no-interaction`, { cwd: repoPath });
      }
    }
    
    // Check for package.json (mainly for intelligence service)
    if (fs.existsSync(path.join(repoPath, 'package.json')) && serviceName === 'intelligence') {
      log('Running npm install...');
      execCommand('sudo -u www-data npm install', { cwd: repoPath });
    }
  } catch (error) {
    log(`Warning: Failed to update dependencies: ${error.message}`, 'yellow');
  }
}

// Command implementations
async function listCurrentBranches() {
  log('\n=== Current Branches for All Services ===\n', 'cyan', true);
  
  const results = [];
  for (const [name, path] of Object.entries(services)) {
    const result = getCurrentBranch(name, path);
    results.push(result);
  }
  
  // Display results in a table format
  const maxServiceLength = Math.max(...results.map(r => r.service.length));
  const maxBranchLength = Math.max(...results.map(r => r.branch.length));
  
  results.forEach(result => {
    const service = result.service.padEnd(maxServiceLength);
    const branch = result.branch.padEnd(maxBranchLength);
    
    if (result.error) {
      log(`${service} | ${branch} | ${colors.red}${result.error}${colors.reset}`, 'reset', true);
    } else {
      log(`${service} | ${colors.green}${branch}${colors.reset}`, 'reset', true);
    }
  });
  
  return results;
}

async function listAvailableBranches(serviceName = null) {
  log('\n=== Available Branches ===\n', 'cyan', true);
  
  const servicesToCheck = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
  
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  for (const [name, path] of Object.entries(servicesToCheck)) {
    const result = getAllBranches(name, path);
    
    log(`\n${colors.yellow}${name}:${colors.reset}`, 'reset', true);
    
    if (result.error) {
      log(`  Error: ${result.error}`, 'red', true);
    } else if (result.branches.length === 0) {
      log('  No branches found', 'yellow', true);
    } else {
      result.branches.forEach(branch => {
        log(`  - ${branch}`, 'reset', true);
      });
    }
  }
}

function getRepositoryStatus(serviceName, repoPath) {
  try {
    if (!fs.existsSync(repoPath)) {
      return { service: serviceName, error: 'Directory not found' };
    }
    
    // Get current branch
    const currentBranch = gitCommand(repoPath, 'rev-parse --abbrev-ref HEAD');
    
    // Check for uncommitted changes
    let uncommittedFiles = 0;
    let hasUnstagedChanges = false;
    let hasStagedChanges = false;
    
    try {
      // Check for unstaged changes
      gitCommand(repoPath, 'diff-index --quiet HEAD --');
    } catch {
      hasUnstagedChanges = true;
    }
    
    try {
      // Check for staged changes
      const stagedOutput = gitCommand(repoPath, 'diff --cached --numstat');
      if (stagedOutput) {
        hasStagedChanges = true;
      }
    } catch {}
    
    try {
      // Count modified files
      const modifiedFiles = gitCommand(repoPath, 'status --porcelain');
      if (modifiedFiles) {
        uncommittedFiles = modifiedFiles.split('\n').filter(line => line.trim()).length;
      }
    } catch {}
    
    // Check commits ahead/behind
    let commitsAhead = 0;
    let commitsBehind = 0;
    
    try {
      // Fetch to ensure we have latest remote info (but don't pull)
      gitCommand(repoPath, 'fetch --quiet');
      
      // Get ahead/behind counts
      const revList = gitCommand(repoPath, `rev-list --left-right --count ${currentBranch}...origin/${currentBranch}`);
      const [ahead, behind] = revList.split('\t').map(n => parseInt(n));
      commitsAhead = ahead || 0;
      commitsBehind = behind || 0;
    } catch {
      // Branch might not have upstream
    }
    
    return {
      service: serviceName,
      branch: currentBranch,
      uncommittedFiles,
      hasUnstagedChanges,
      hasStagedChanges,
      commitsAhead,
      commitsBehind,
      isClean: uncommittedFiles === 0 && commitsAhead === 0 && commitsBehind === 0
    };
  } catch (error) {
    return { service: serviceName, error: error.message };
  }
}

async function showRepositoryStatus(serviceName = null) {
  log('\n=== Repository Status Overview ===\n', 'cyan', true);
  
  const servicesToCheck = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
    
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  const results = [];
  
  // Collect all statuses
  for (const [name, path] of Object.entries(servicesToCheck)) {
    const status = getRepositoryStatus(name, path);
    results.push(status);
  }
  
  // Find max lengths for formatting
  const maxServiceLength = Math.max(...results.map(r => r.service.length));
  const maxBranchLength = Math.max(...results.filter(r => r.branch).map(r => r.branch.length), 10);
  
  // Display results
  results.forEach(status => {
    const service = status.service.padEnd(maxServiceLength);
    
    if (status.error) {
      log(`${service}  ${colors.red}Error: ${status.error}${colors.reset}`, 'reset', true);
      return;
    }
    
    const branch = (status.branch || 'unknown').padEnd(maxBranchLength);
    let statusText = '';
    let statusColor = 'green';
    
    if (status.isClean) {
      statusText = '✓ clean';
      statusColor = 'green';
    } else {
      const parts = [];
      
      if (status.uncommittedFiles > 0) {
        parts.push(`${status.uncommittedFiles} uncommitted`);
        statusColor = 'yellow';
      }
      
      if (status.commitsAhead > 0) {
        parts.push(`${status.commitsAhead} ahead`);
        statusColor = 'yellow';
      }
      
      if (status.commitsBehind > 0) {
        parts.push(`${status.commitsBehind} behind`);
        statusColor = 'red';
      }
      
      statusText = '⚠ ' + parts.join(', ');
    }
    
    log(`${service}  ${branch}  ${colors[statusColor]}${statusText}${colors.reset}`, 'reset', true);
  });
  
  // Summary
  const clean = results.filter(r => r.isClean).length;
  const withIssues = results.filter(r => !r.isClean && !r.error).length;
  const withErrors = results.filter(r => r.error).length;
  
  log('', 'reset', true);
  log(`Summary: ${colors.green}${clean} clean${colors.reset}, ${colors.yellow}${withIssues} need attention${colors.reset}${withErrors > 0 ? `, ${colors.red}${withErrors} errors${colors.reset}` : ''}`, 'reset', true);
}

async function showUncommittedChanges(serviceName = null) {
  log('\n=== Uncommitted Changes ===\n', 'cyan', true);
  
  const servicesToCheck = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
    
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  let totalChangedFiles = 0;
  let servicesWithChanges = 0;
  
  for (const [name, path] of Object.entries(servicesToCheck)) {
    try {
      if (!fs.existsSync(path)) {
        continue;
      }
      
      // Get git status
      const statusOutput = gitCommand(path, 'status --porcelain');
      
      if (statusOutput) {
        servicesWithChanges++;
        const changes = statusOutput.split('\n').filter(line => line.trim());
        totalChangedFiles += changes.length;
        
        log(`\n${colors.yellow}${name}:${colors.reset} ${changes.length} file(s) with changes`, 'reset', true);
        
        // Show file details
        changes.forEach(change => {
          const [status, ...fileParts] = change.trim().split(' ');
          const fileName = fileParts.join(' ');
          
          let statusText = '';
          let statusColor = 'reset';
          
          if (status.includes('M')) {
            statusText = 'modified';
            statusColor = 'yellow';
          } else if (status.includes('A')) {
            statusText = 'added';
            statusColor = 'green';
          } else if (status.includes('D')) {
            statusText = 'deleted';
            statusColor = 'red';
          } else if (status === '??') {
            statusText = 'untracked';
            statusColor = 'magenta';
          } else if (status.includes('R')) {
            statusText = 'renamed';
            statusColor = 'blue';
          } else {
            statusText = status;
          }
          
          log(`  ${colors[statusColor]}${statusText.padEnd(10)}${colors.reset} ${fileName}`, 'reset', true);
        });
        
        // Show diff stats if verbose
        if (VERBOSE) {
          try {
            const diffStat = gitCommand(path, 'diff --stat');
            if (diffStat) {
              log('\n  Diff statistics:', 'reset', true);
              diffStat.split('\n').forEach(line => {
                if (line.trim()) {
                  log(`    ${line}`, 'reset', true);
                }
              });
            }
          } catch {}
        }
      }
    } catch (error) {
      log(`${name}: ${colors.red}Error - ${error.message}${colors.reset}`, 'reset', true);
    }
  }
  
  // Summary
  log('\n' + '='.repeat(50), 'reset', true);
  
  if (servicesWithChanges === 0) {
    log('No uncommitted changes found in any service.', 'green', true);
  } else {
    log(`Found ${colors.yellow}${totalChangedFiles} uncommitted file(s)${colors.reset} across ${colors.yellow}${servicesWithChanges} service(s)${colors.reset}`, 'reset', true);
    
    if (!VERBOSE) {
      log('\nUse --verbose to see diff statistics', 'reset', true);
    }
    
    log('\nTo save changes across all services:', 'reset', true);
    log('  node repo-manager.js stash save "work in progress"', 'green', true);
  }
}

async function updateBranches(targetBranch, serviceName = null, useComposerUpdate = false, skipDeps = false) {
  if (!checkRoot()) {
    log('Error: This script must be run as root (use sudo)', 'red', true);
    process.exit(1);
  }
  
  log(`\n=== Updating Services to Branch: ${targetBranch} ===\n`, 'cyan', true);
  
  const servicesToUpdate = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
  
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red');
    return;
  }
  
  const results = [];
  
  for (const [name, path] of Object.entries(servicesToUpdate)) {
    const result = updateServiceBranch(name, path, targetBranch, useComposerUpdate, skipDeps);
    results.push(result);
    if (VERBOSE) {
      log('----------------------------------------');
    }
  }
  
  // Summary
  log('\n=== Update Summary ===\n', 'cyan', true);
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    log(`Successfully updated: ${successful.length} service(s)`, 'green', true);
    successful.forEach(r => log(`  ✓ ${r.service} -> ${r.branch}`, 'green', true));
  }
  
  if (failed.length > 0) {
    log(`\nFailed to update: ${failed.length} service(s)`, 'red', true);
    failed.forEach(r => log(`  ✗ ${r.service}: ${r.error}`, 'red', true));
  }
  
  // Save log
  // Use a fixed path instead of HOME since we run with sudo
  const logDir = '/home/cmckenna/ren360';
  
  // Ensure log directory exists
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (e) {
    log(`\nWarning: Could not create log directory: ${e.message}`, 'yellow');
  }
  
  const logFile = path.join(
    logDir,
    `update-log-${new Date().toISOString().replace(/:/g, '-')}.json`
  );
  
  try {
    fs.writeFileSync(logFile, JSON.stringify(results, null, 2));
    log(`\nLog saved to: ${logFile}`, 'blue');
  } catch (e) {
    log(`\nFailed to save log: ${e.message}`, 'yellow');
  }
}

async function syncRepositories(serviceName = null) {
  log(`\n=== Syncing Repositories ===\n`, 'cyan', true);
  
  const servicesToSync = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
    
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  const results = [];
  
  for (const [name, path] of Object.entries(servicesToSync)) {
    if (!VERBOSE) {
      process.stdout.write(`${colors.yellow}${name}${colors.reset}... `);
    } else {
      log(`\nSyncing ${name}...`, 'yellow');
    }
    
    try {
      if (!fs.existsSync(path)) {
        results.push({ service: name, success: false, error: 'Directory not found' });
        if (!VERBOSE) console.log(`${colors.red}✗${colors.reset}`);
        continue;
      }
      
      // Get current branch
      const currentBranch = gitCommand(path, 'rev-parse --abbrev-ref HEAD');
      log(`Current branch: ${currentBranch}`);
      
      // Check for uncommitted changes
      try {
        gitCommand(path, 'diff-index --quiet HEAD --');
      } catch {
        results.push({ service: name, success: false, error: 'Has uncommitted changes' });
        if (!VERBOSE) {
          console.log(`${colors.red}✗ (uncommitted changes)${colors.reset}`);
        } else {
          log('Error: Has uncommitted changes', 'red');
        }
        continue;
      }
      
      // Fetch and pull
      log('Fetching latest changes...');
      gitCommand(path, 'fetch');
      
      log('Pulling latest changes...');
      const pullOutput = gitCommand(path, 'pull');
      
      if (!VERBOSE) {
        console.log(`${colors.green}✓${colors.reset}`);
      } else {
        log(`Success: ${name} synced`, 'green');
        if (pullOutput.includes('Already up to date')) {
          log('Already up to date');
        } else {
          log(pullOutput);
        }
      }
      
      results.push({ service: name, success: true, branch: currentBranch });
      
    } catch (error) {
      results.push({ service: name, success: false, error: error.message });
      if (!VERBOSE) {
        console.log(`${colors.red}✗${colors.reset}`);
      } else {
        log(`Error: ${error.message}`, 'red');
      }
    }
    
    if (VERBOSE) {
      log('----------------------------------------');
    }
  }
  
  // Summary
  log('\n=== Sync Summary ===\n', 'cyan', true);
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    log(`Successfully synced: ${successful.length} service(s)`, 'green', true);
    successful.forEach(r => log(`  ✓ ${r.service} (${r.branch})`, 'green', true));
  }
  
  if (failed.length > 0) {
    log(`\nFailed to sync: ${failed.length} service(s)`, 'red', true);
    failed.forEach(r => log(`  ✗ ${r.service}: ${r.error}`, 'red', true));
  }
}

async function searchInRepositories(searchPattern, options = {}) {
  const { service: serviceName, include } = options;
  
  log(`\n=== Searching for: "${searchPattern}" ===\n`, 'cyan', true);
  
  const servicesToSearch = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
    
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  let totalMatches = 0;
  const results = [];
  
  for (const [name, path] of Object.entries(servicesToSearch)) {
    try {
      if (!fs.existsSync(path)) {
        continue;
      }
      
      // Build ripgrep command
      let rgCommand = `rg "${searchPattern}" --count --color never`;
      if (include) {
        rgCommand += ` --glob "${include}"`;
      }
      
      const output = execCommand(rgCommand, { cwd: path });
      
      if (output) {
        const matches = output.split('\n').filter(line => line.trim());
        const serviceMatches = matches.reduce((sum, line) => {
          const count = parseInt(line.split(':').pop());
          return sum + (isNaN(count) ? 0 : count);
        }, 0);
        
        if (serviceMatches > 0) {
          totalMatches += serviceMatches;
          results.push({
            service: name,
            matches: serviceMatches,
            files: matches.length
          });
          
          // Show details
          log(`\n${colors.yellow}${name}:${colors.reset} ${serviceMatches} matches in ${matches.length} files`, 'reset', true);
          
          if (VERBOSE) {
            // Show actual matches with context
            const detailCommand = `rg "${searchPattern}" -n --color never -m 3`;
            const details = execCommand(detailCommand + (include ? ` --glob "${include}"` : ''), { cwd: path });
            const lines = details.split('\n').slice(0, 10); // Show first 10 matches
            lines.forEach(line => {
              if (line.trim()) {
                log(`  ${line}`, 'reset', true);
              }
            });
            if (details.split('\n').length > 10) {
              log(`  ... and ${details.split('\n').length - 10} more matches`, 'reset', true);
            }
          }
        }
      }
    } catch (error) {
      // No matches found or rg not available
    }
  }
  
  // Summary
  log('\n' + '='.repeat(50), 'reset', true);
  if (totalMatches > 0) {
    log(`Total: ${colors.green}${totalMatches} matches${colors.reset} across ${results.length} services`, 'reset', true);
    
    if (!VERBOSE) {
      log('\nUse --verbose to see match details', 'reset', true);
    }
  } else {
    log(`No matches found for "${searchPattern}"`, 'yellow', true);
  }
}

async function showRecentActivity(options = {}) {
  const { service: serviceName, days = 7, count = 5 } = options;
  
  log(`\n=== Recent Activity (Last ${days} days) ===\n`, 'cyan', true);
  
  const servicesToCheck = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
    
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  
  let totalCommits = 0;
  
  for (const [name, path] of Object.entries(servicesToCheck)) {
    try {
      if (!fs.existsSync(path)) {
        continue;
      }
      
      // Get recent commits
      const logCommand = `git log --since="${sinceStr}" --pretty=format:"%h|%an|%cr|%s" -n ${count}`;
      const commits = gitCommand(path, logCommand);
      
      if (commits) {
        const commitLines = commits.split('\n').filter(line => line.trim());
        if (commitLines.length > 0) {
          totalCommits += commitLines.length;
          
          log(`\n${colors.yellow}${name}:${colors.reset}`, 'reset', true);
          
          commitLines.forEach(line => {
            const [hash, author, when, message] = line.split('|');
            log(`  ${colors.blue}${hash}${colors.reset} - ${message} ${colors.green}(${when})${colors.reset} by ${author}`, 'reset', true);
          });
          
          // Check if there are more commits
          const totalCount = gitCommand(path, `git rev-list --count --since="${sinceStr}" HEAD`);
          if (parseInt(totalCount) > count) {
            log(`  ... and ${parseInt(totalCount) - count} more commits`, 'reset', true);
          }
        }
      }
    } catch (error) {
      // No commits or error
    }
  }
  
  // Summary
  log('\n' + '='.repeat(50), 'reset', true);
  if (totalCommits > 0) {
    log(`Total: ${colors.green}${totalCommits} recent commits${colors.reset} shown`, 'reset', true);
  } else {
    log(`No commits found in the last ${days} days`, 'yellow', true);
  }
}

async function manageStash(action, message = '') {
  if (!['save', 'pop', 'list'].includes(action)) {
    log('Error: Invalid stash action. Use save, pop, or list', 'red', true);
    return;
  }
  
  log(`\n=== Stash ${action.charAt(0).toUpperCase() + action.slice(1)} ===\n`, 'cyan', true);
  
  const results = [];
  
  for (const [name, path] of Object.entries(services)) {
    try {
      if (!fs.existsSync(path)) {
        continue;
      }
      
      let result = '';
      
      switch (action) {
        case 'save':
          // Check if there are changes to stash
          try {
            gitCommand(path, 'diff-index --quiet HEAD --');
            results.push({ service: name, action, status: 'no changes' });
          } catch {
            // Has changes, stash them
            const stashMessage = message || `repo-manager stash ${new Date().toISOString()}`;
            result = gitCommand(path, `stash push -m "${stashMessage}"`);
            results.push({ service: name, action, status: 'saved', message: stashMessage });
          }
          break;
          
        case 'pop':
          try {
            result = gitCommand(path, 'stash pop');
            results.push({ service: name, action, status: 'popped' });
          } catch (error) {
            if (error.message.includes('No stash entries')) {
              results.push({ service: name, action, status: 'no stash' });
            } else {
              results.push({ service: name, action, status: 'error', error: error.message });
            }
          }
          break;
          
        case 'list':
          try {
            result = gitCommand(path, 'stash list');
            const stashCount = result ? result.split('\n').filter(l => l.trim()).length : 0;
            results.push({ service: name, action, status: 'list', count: stashCount, list: result });
          } catch {
            results.push({ service: name, action, status: 'list', count: 0 });
          }
          break;
      }
      
      // Display result
      if (action === 'list') {
        if (results[results.length - 1].count > 0) {
          log(`\n${colors.yellow}${name}:${colors.reset} ${results[results.length - 1].count} stashes`, 'reset', true);
          if (VERBOSE && result) {
            result.split('\n').forEach(line => {
              if (line.trim()) {
                log(`  ${line}`, 'reset', true);
              }
            });
          }
        }
      } else {
        const lastResult = results[results.length - 1];
        const statusColor = lastResult.status === 'error' ? 'red' : 
                          lastResult.status === 'no changes' || lastResult.status === 'no stash' ? 'yellow' : 
                          'green';
        log(`${name}: ${colors[statusColor]}${lastResult.status}${colors.reset}`, 'reset', true);
      }
      
    } catch (error) {
      results.push({ service: name, action, status: 'error', error: error.message });
      log(`${name}: ${colors.red}error - ${error.message}${colors.reset}`, 'reset', true);
    }
  }
  
  // Summary
  log('\n' + '='.repeat(50), 'reset', true);
  
  if (action === 'save') {
    const saved = results.filter(r => r.status === 'saved').length;
    const noChanges = results.filter(r => r.status === 'no changes').length;
    log(`Stashed changes in ${colors.green}${saved} services${colors.reset}, ${colors.yellow}${noChanges} had no changes${colors.reset}`, 'reset', true);
  } else if (action === 'pop') {
    const popped = results.filter(r => r.status === 'popped').length;
    const noStash = results.filter(r => r.status === 'no stash').length;
    log(`Popped stash in ${colors.green}${popped} services${colors.reset}, ${colors.yellow}${noStash} had no stash${colors.reset}`, 'reset', true);
  } else if (action === 'list') {
    const withStashes = results.filter(r => r.count > 0).length;
    const totalStashes = results.reduce((sum, r) => sum + (r.count || 0), 0);
    log(`Found ${colors.green}${totalStashes} total stashes${colors.reset} across ${withStashes} services`, 'reset', true);
    if (!VERBOSE && totalStashes > 0) {
      log('Use --verbose to see stash details', 'reset', true);
    }
  }
}

async function dropUncommittedChanges(serviceName = null, force = false) {
  log(`\n=== Drop Uncommitted Changes ===\n`, 'cyan', true);
  
  const servicesToProcess = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
    
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  // Check if we need confirmation
  if (!force) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (query) => new Promise((resolve) => rl.question(query, resolve));
    
    try {
      log(`${colors.yellow}WARNING: This will permanently delete all uncommitted changes!${colors.reset}`, 'reset', true);
      log('This includes:', 'reset', true);
      log('  - Modified files', 'reset', true);
      log('  - Staged changes', 'reset', true);
      log('  - Untracked files', 'reset', true);
      
      const confirm = await question(`\nAre you sure you want to drop all uncommitted changes${serviceName ? ` in ${serviceName}` : ' in ALL services'}? (yes/N): `);
      rl.close();
      
      if (confirm.toLowerCase() !== 'yes') {
        log('\nOperation cancelled.', 'yellow', true);
        return;
      }
    } catch (error) {
      rl.close();
      throw error;
    }
  }
  
  const results = [];
  
  for (const [name, path] of Object.entries(servicesToProcess)) {
    if (!VERBOSE) {
      process.stdout.write(`${colors.yellow}${name}${colors.reset}... `);
    } else {
      log(`\nDropping changes in ${name}...`, 'yellow');
    }
    
    try {
      if (!fs.existsSync(path)) {
        results.push({ service: name, success: false, error: 'Directory not found' });
        if (!VERBOSE) console.log(`${colors.red}✗${colors.reset}`);
        continue;
      }
      
      // Check if there are changes
      let hasChanges = false;
      try {
        gitCommand(path, 'diff-index --quiet HEAD --');
      } catch {
        hasChanges = true;
      }
      
      // Check for untracked files
      const untrackedFiles = gitCommand(path, 'ls-files --others --exclude-standard');
      if (untrackedFiles) {
        hasChanges = true;
      }
      
      if (!hasChanges) {
        results.push({ service: name, success: true, status: 'no changes' });
        if (!VERBOSE) {
          console.log(`${colors.green}✓ (no changes)${colors.reset}`);
        } else {
          log('No changes to drop', 'green');
        }
        continue;
      }
      
      // Reset all tracked files to HEAD
      log('Resetting tracked files...');
      gitCommand(path, 'reset --hard HEAD');
      
      // Remove all untracked files and directories
      log('Removing untracked files and directories...');
      gitCommand(path, 'clean -fd');
      
      // Get the current branch for logging
      const currentBranch = gitCommand(path, 'rev-parse --abbrev-ref HEAD');
      
      results.push({ 
        service: name, 
        success: true, 
        status: 'changes dropped',
        branch: currentBranch
      });
      
      if (!VERBOSE) {
        console.log(`${colors.green}✓${colors.reset}`);
      } else {
        log(`Success: All changes dropped in ${name} (${currentBranch})`, 'green');
      }
      
    } catch (error) {
      results.push({ service: name, success: false, error: error.message });
      if (!VERBOSE) {
        console.log(`${colors.red}✗${colors.reset}`);
      } else {
        log(`Error: ${error.message}`, 'red');
      }
    }
    
    if (VERBOSE) {
      log('----------------------------------------');
    }
  }
  
  // Summary
  log('\n' + '='.repeat(50), 'reset', true);
  
  const successful = results.filter(r => r.success);
  const withChanges = successful.filter(r => r.status === 'changes dropped');
  const noChanges = successful.filter(r => r.status === 'no changes');
  const failed = results.filter(r => !r.success);
  
  if (withChanges.length > 0) {
    log(`${colors.green}Dropped changes in ${withChanges.length} service(s)${colors.reset}`, 'reset', true);
    withChanges.forEach(r => log(`  ✓ ${r.service} (${r.branch})`, 'green', true));
  }
  
  if (noChanges.length > 0) {
    log(`\n${colors.yellow}No changes to drop in ${noChanges.length} service(s)${colors.reset}`, 'reset', true);
    noChanges.forEach(r => log(`  - ${r.service}`, 'yellow', true));
  }
  
  if (failed.length > 0) {
    log(`\n${colors.red}Failed to process ${failed.length} service(s)${colors.reset}`, 'reset', true);
    failed.forEach(r => log(`  ✗ ${r.service}: ${r.error}`, 'red', true));
  }
}

async function createPullRequest(options = {}) {
  const { title, body, draft = false, service: serviceName } = options;
  
  if (!title) {
    log('Error: PR title is required', 'red', true);
    return;
  }
  
  log(`\n=== Creating Pull Request ===\n`, 'cyan', true);
  
  const servicesToProcess = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
    
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red', true);
    return;
  }
  
  const results = [];
  
  for (const [name, path] of Object.entries(servicesToProcess)) {
    try {
      if (!fs.existsSync(path)) {
        continue;
      }
      
      // Get current branch
      const currentBranch = gitCommand(path, 'rev-parse --abbrev-ref HEAD');
      
      if (currentBranch === 'master' || currentBranch === 'main') {
        results.push({ 
          service: name, 
          success: false, 
          error: 'Cannot create PR from master/main branch' 
        });
        log(`${name}: ${colors.red}✗ Cannot create PR from ${currentBranch}${colors.reset}`, 'reset', true);
        continue;
      }
      
      // Check if branch has upstream
      try {
        gitCommand(path, `rev-parse --abbrev-ref ${currentBranch}@{upstream}`);
      } catch {
        // Push branch to origin first
        log(`${name}: Pushing branch to origin...`);
        gitCommand(path, `push -u origin ${currentBranch}`);
      }
      
      // Create PR using GitHub CLI
      let ghCommand = `gh pr create --title "${title}"`;
      
      if (body) {
        ghCommand += ` --body "${body}"`;
      } else {
        ghCommand += ` --body "Auto-generated PR for ${currentBranch}"`;
      }
      
      if (draft) {
        ghCommand += ' --draft';
      }
      
      // Add base branch (usually main or master)
      const defaultBranch = gitCommand(path, 'symbolic-ref refs/remotes/origin/HEAD | sed "s@^refs/remotes/origin/@@"');
      ghCommand += ` --base ${defaultBranch}`;
      
      const prUrl = execCommand(ghCommand, { cwd: path });
      
      results.push({ 
        service: name, 
        success: true, 
        branch: currentBranch,
        prUrl: prUrl.trim()
      });
      
      log(`${name}: ${colors.green}✓ PR created${colors.reset}`, 'reset', true);
      log(`  ${colors.blue}${prUrl.trim()}${colors.reset}`, 'reset', true);
      
    } catch (error) {
      results.push({ 
        service: name, 
        success: false, 
        error: error.message 
      });
      log(`${name}: ${colors.red}✗ ${error.message}${colors.reset}`, 'reset', true);
    }
  }
  
  // Summary
  log('\n' + '='.repeat(50), 'reset', true);
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    log(`${colors.green}Successfully created ${successful.length} PR(s)${colors.reset}`, 'reset', true);
    successful.forEach(r => {
      log(`  ${r.service}: ${colors.blue}${r.prUrl}${colors.reset}`, 'reset', true);
    });
  }
  
  if (failed.length > 0) {
    log(`\n${colors.red}Failed to create ${failed.length} PR(s)${colors.reset}`, 'reset', true);
    failed.forEach(r => {
      log(`  ${r.service}: ${r.error}`, 'reset', true);
    });
  }
}

async function reviewPullRequests(ticketNumber, options = {}) {
  const { analyze = false } = options;
  const searchPattern = `REN-${ticketNumber}`;
  
  log(`\n=== Searching for PRs: ${searchPattern} ===\n`, 'cyan', true);
  
  const allPRs = [];
  let totalFiles = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  
  for (const [name, path] of Object.entries(services)) {
    try {
      if (!fs.existsSync(path)) {
        continue;
      }
      
      // Use GitHub CLI to find PRs with the ticket number
      // Run gh as www-data user to avoid ownership issues
      const ghEnv = ghToken ? `GH_TOKEN=${ghToken} ` : '';
      const prListCommand = checkRoot()
        ? `sudo -u www-data ${ghEnv}gh pr list --search "${searchPattern}" --state all --json number,title,state,url,isDraft,createdAt,author,headRefName`
        : `${ghEnv}gh pr list --search "${searchPattern}" --state all --json number,title,state,url,isDraft,createdAt,author,headRefName`;
      const prsJson = execCommand(prListCommand, { cwd: path });
      
      if (prsJson && prsJson.trim() !== '[]') {
        const prs = JSON.parse(prsJson);
        
        for (const pr of prs) {
          // Get PR details including files changed
          const prDetailsCommand = checkRoot()
            ? `sudo -u www-data ${ghEnv}gh pr view ${pr.number} --json files,additions,deletions,body,reviews,comments`
            : `${ghEnv}gh pr view ${pr.number} --json files,additions,deletions,body,reviews,comments`;
          const prDetails = JSON.parse(execCommand(prDetailsCommand, { cwd: path }));
          
          const prInfo = {
            service: name,
            ...pr,
            ...prDetails,
            filesChanged: prDetails.files ? prDetails.files.length : 0
          };
          
          allPRs.push(prInfo);
          totalFiles += prInfo.filesChanged;
          totalAdditions += prDetails.additions || 0;
          totalDeletions += prDetails.deletions || 0;
          
          // Display PR info
          log(`\n${colors.yellow}${name}:${colors.reset}`, 'reset', true);
          log(`  PR #${pr.number}: ${pr.title}`, 'reset', true);
          log(`  ${colors.blue}${pr.url}${colors.reset}`, 'reset', true);
          log(`  Status: ${pr.state === 'OPEN' ? colors.green : colors.red}${pr.state}${colors.reset}${pr.isDraft ? ' (Draft)' : ''}`, 'reset', true);
          log(`  Author: ${pr.author.login} | Created: ${new Date(pr.createdAt).toLocaleDateString()}`, 'reset', true);
          log(`  Changes: +${prDetails.additions || 0} -${prDetails.deletions || 0} in ${prInfo.filesChanged} files`, 'reset', true);
          
          if (prDetails.reviews && prDetails.reviews.length > 0) {
            const approvals = prDetails.reviews.filter(r => r.state === 'APPROVED').length;
            const changes = prDetails.reviews.filter(r => r.state === 'CHANGES_REQUESTED').length;
            log(`  Reviews: ${colors.green}${approvals} approved${colors.reset}, ${colors.red}${changes} changes requested${colors.reset}`, 'reset', true);
          }
        }
      }
    } catch (error) {
      // No PRs found or error
    }
  }
  
  // Summary
  log('\n' + '='.repeat(60), 'reset', true);
  
  if (allPRs.length === 0) {
    log(`No PRs found for ticket ${searchPattern}`, 'yellow', true);
    return;
  }
  
  log(`\n${colors.cyan}=== Summary for ${searchPattern} ===${colors.reset}`, 'reset', true);
  log(`Total PRs: ${colors.green}${allPRs.length}${colors.reset} across ${new Set(allPRs.map(pr => pr.service)).size} services`, 'reset', true);
  log(`Total changes: ${colors.green}+${totalAdditions}${colors.reset} ${colors.red}-${totalDeletions}${colors.reset} in ${totalFiles} files`, 'reset', true);
  
  // Group by status
  const openPRs = allPRs.filter(pr => pr.state === 'OPEN');
  const mergedPRs = allPRs.filter(pr => pr.state === 'MERGED');
  const closedPRs = allPRs.filter(pr => pr.state === 'CLOSED' && pr.state !== 'MERGED');
  
  log(`\nStatus breakdown:`, 'reset', true);
  if (openPRs.length > 0) log(`  ${colors.green}Open: ${openPRs.length}${colors.reset}`, 'reset', true);
  if (mergedPRs.length > 0) log(`  ${colors.blue}Merged: ${mergedPRs.length}${colors.reset}`, 'reset', true);
  if (closedPRs.length > 0) log(`  ${colors.red}Closed: ${closedPRs.length}${colors.reset}`, 'reset', true);
  
  // AI Analysis
  if (analyze && allPRs.length > 0) {
    log(`\n${colors.cyan}=== AI Analysis ===${colors.reset}`, 'reset', true);
    
    try {
      // Check if AI is configured
      const apiKey = loadApiKey && loadApiKey();
      
      if (apiKey && AIAgent) {
        log('Running automated AI analysis...', 'yellow', true);
        
        // Collect all PR information for analysis
        const prSummary = allPRs.map(pr => ({
          service: pr.service,
          title: pr.title,
          files: pr.filesChanged,
          additions: pr.additions,
          deletions: pr.deletions,
          description: pr.body || 'No description',
          state: pr.state,
          author: pr.author.login
        }));
        
        // Initialize AI agent
        const agent = new AIAgent(apiKey, getModel(), getMaxTokens());
        
        // Get AI analysis
        const analysis = await agent.analyzePullRequests(prSummary, ticketNumber);
        
        log('\n' + '='.repeat(60), 'reset', true);
        log(`\n${colors.green}AI Analysis Complete:${colors.reset}`, 'reset', true);
        log('\n' + analysis, 'reset', true);
        
        // Save analysis to file
        const analysisFile = `/tmp/pr-ai-analysis-${ticketNumber}.md`;
        fs.writeFileSync(analysisFile, `# AI Analysis for ${searchPattern}\n\n${analysis}`);
        log(`\n${colors.blue}Analysis saved to: ${analysisFile}${colors.reset}`, 'reset', true);
        
        // Offer additional analysis options
        if (openPRs.length > 0) {
          log(`\n${colors.cyan}Additional AI Analysis Options:${colors.reset}`, 'reset', true);
          log('  --security   : Deep security audit', 'reset', true);
          log('  --tests      : Generate test suggestions', 'reset', true);
          log('  --diff       : Analyze specific code diffs', 'reset', true);
        }
        
      } else {
        // No API key configured, fall back to manual process
        log('\nAI Agent not configured. To enable automated analysis:', 'yellow', true);
        log('1. Copy .env.example to .env', 'reset', true);
        log('2. Add your Anthropic API key', 'reset', true);
        log('3. Run the review command again with --analyze', 'reset', true);
        
        // Still save the prompt for manual use
        const prSummary = allPRs.map(pr => ({
          service: pr.service,
          title: pr.title,
          files: pr.filesChanged,
          additions: pr.additions,
          deletions: pr.deletions,
          description: pr.body || 'No description'
        }));
        
        const analysisPrompt = `Analyze these pull requests for ticket ${searchPattern}:

${JSON.stringify(prSummary, null, 2)}

Please provide:
1. Overall assessment of the changes
2. Potential risks or concerns
3. Key areas that need careful review
4. Suggestions for testing
5. Any architectural or design considerations`;

        const analysisFile = `/tmp/pr-analysis-${ticketNumber}.txt`;
        fs.writeFileSync(analysisFile, analysisPrompt);
        
        log(`\nManual analysis prompt saved to: ${analysisFile}`, 'blue', true);
        log(`To get AI analysis manually:`, 'reset', true);
        log(`  cat ${analysisFile} | <your-ai-tool>`, 'reset', true);
      }
      
    } catch (error) {
      log(`Error in AI analysis: ${error.message}`, 'red', true);
    }
  }
  
  // Quick links
  log(`\n${colors.cyan}=== Quick Actions ===${colors.reset}`, 'reset', true);
  openPRs.forEach(pr => {
    log(`\nReview ${pr.service} PR:`, 'reset', true);
    log(`  gh pr review ${pr.number} --repo ${pr.url.split('/').slice(3, 5).join('/')}`, 'reset', true);
    log(`  gh pr checkout ${pr.number} --repo ${pr.url.split('/').slice(3, 5).join('/')}`, 'reset', true);
  });
}

async function listAllPullRequests(options = {}) {
  const { state = 'open' } = options;
  
  log(`\n=== Listing ${state === 'all' ? 'All' : state.charAt(0).toUpperCase() + state.slice(1)} Pull Requests ===\n`, 'cyan', true);
  
  const allPRs = [];
  const prsByTicket = {};
  
  for (const [name, path] of Object.entries(services)) {
    try {
      if (!fs.existsSync(path)) {
        continue;
      }
      
      // List PRs for this service
      // Run gh as www-data user to avoid ownership issues
      const ghEnv = ghToken ? `GH_TOKEN=${ghToken} ` : '';
      const prListCommand = checkRoot() 
        ? `sudo -u www-data ${ghEnv}gh pr list --state ${state} --json number,title,state,url,isDraft,createdAt,author,headRefName --limit 50`
        : `${ghEnv}gh pr list --state ${state} --json number,title,state,url,isDraft,createdAt,author,headRefName --limit 50`;
      const prsJson = execCommand(prListCommand, { cwd: path });
      
      if (prsJson && prsJson.trim() !== '[]') {
        const prs = JSON.parse(prsJson);
        
        for (const pr of prs) {
          const prInfo = {
            service: name,
            ...pr
          };
          
          allPRs.push(prInfo);
          
          // Extract ticket number if present
          const ticketMatch = pr.title.match(/REN-(\d+)/i) || pr.headRefName.match(/REN-(\d+)/i);
          if (ticketMatch) {
            const ticket = ticketMatch[0].toUpperCase();
            if (!prsByTicket[ticket]) {
              prsByTicket[ticket] = [];
            }
            prsByTicket[ticket].push(prInfo);
          }
        }
      }
    } catch (error) {
      // Service might not have gh configured
    }
  }
  
  if (allPRs.length === 0) {
    log(`No ${state} PRs found across any services.`, 'yellow', true);
    return;
  }
  
  // Sort by creation date
  allPRs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Display PRs grouped by ticket
  log(`${colors.green}Found ${allPRs.length} PR(s)${colors.reset}`, 'reset', true);
  
  // First show PRs with ticket numbers
  if (Object.keys(prsByTicket).length > 0) {
    log(`\n${colors.cyan}=== PRs by Ticket ===${colors.reset}`, 'reset', true);
    
    for (const [ticket, prs] of Object.entries(prsByTicket)) {
      log(`\n${colors.yellow}${ticket}:${colors.reset} (${prs.length} PR${prs.length > 1 ? 's' : ''})`, 'reset', true);
      
      for (const pr of prs) {
        const statusColor = pr.state === 'OPEN' ? 'green' : 'red';
        const draftText = pr.isDraft ? ' [DRAFT]' : '';
        log(`  ${colors.blue}${pr.service}${colors.reset}: ${pr.title}${draftText}`, 'reset', true);
        log(`    ${colors[statusColor]}#${pr.number}${colors.reset} by ${pr.author.login} - ${new Date(pr.createdAt).toLocaleDateString()}`, 'reset', true);
        log(`    ${pr.url}`, 'reset', true);
      }
    }
  }
  
  // Then show PRs without ticket numbers
  const prsWithoutTickets = allPRs.filter(pr => {
    const hasTicket = pr.title.match(/REN-\d+/i) || pr.headRefName.match(/REN-\d+/i);
    return !hasTicket;
  });
  
  if (prsWithoutTickets.length > 0) {
    log(`\n${colors.cyan}=== Other PRs ===${colors.reset}`, 'reset', true);
    
    for (const pr of prsWithoutTickets) {
      const statusColor = pr.state === 'OPEN' ? 'green' : 'red';
      const draftText = pr.isDraft ? ' [DRAFT]' : '';
      log(`\n${colors.blue}${pr.service}${colors.reset}: ${pr.title}${draftText}`, 'reset', true);
      log(`  ${colors[statusColor]}#${pr.number}${colors.reset} by ${pr.author.login} - ${new Date(pr.createdAt).toLocaleDateString()}`, 'reset', true);
      log(`  ${pr.url}`, 'reset', true);
    }
  }
  
  // Show quick review commands
  log(`\n${colors.cyan}=== Quick Review Commands ===${colors.reset}`, 'reset', true);
  
  // Group tickets that have multiple PRs
  const multiServiceTickets = Object.entries(prsByTicket).filter(([_, prs]) => prs.length > 1);
  
  if (multiServiceTickets.length > 0) {
    log(`\nMulti-service tickets (use AI review):`, 'reset', true);
    multiServiceTickets.forEach(([ticket, prs]) => {
      const ticketNum = ticket.replace('REN-', '');
      log(`  node repo-manager.js review ${ticketNum} --analyze    # Review all ${prs.length} PRs for ${ticket}`, 'reset', true);
    });
  }
  
  return { allPRs, prsByTicket };
}

async function createBranch(ticketNumber, serviceName = null) {
  if (!checkRoot()) {
    log('Error: This script must be run as root (use sudo)', 'red');
    process.exit(1);
  }
  
  const branchName = `REN-${ticketNumber}`;
  log(`\n=== Creating Branch: ${branchName} from dev ===\n`, 'cyan');
  
  const servicesToUpdate = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
  
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red');
    return;
  }
  
  const results = [];
  
  for (const [name, path] of Object.entries(servicesToUpdate)) {
    log(`\n${colors.yellow}Creating branch for ${name}...${colors.reset}`);
    
    try {
      // Check if directory exists
      if (!fs.existsSync(path)) {
        results.push({ service: name, success: false, error: 'Directory not found' });
        continue;
      }
      
      // Get current branch
      const currentBranch = gitCommand(path, 'rev-parse --abbrev-ref HEAD');
      log(`Current branch: ${currentBranch}`);
      
      // Fetch latest changes
      log('Fetching latest changes...');
      gitCommand(path, 'fetch');
      
      // Checkout dev branch first
      log('Checking out dev branch...');
      gitCommand(path, 'checkout dev');
      
      // Pull latest dev changes
      log('Pulling latest dev changes...');
      gitCommand(path, 'pull');
      
      // Create and checkout new branch
      log(`Creating branch ${branchName}...`);
      try {
        gitCommand(path, `checkout -b ${branchName}`);
        log(`${colors.green}Success: ${name} - created branch ${branchName}${colors.reset}`);
        results.push({ service: name, success: true, branch: branchName });
      } catch (error) {
        // Branch might already exist
        if (error.message.includes('already exists')) {
          log(`Branch ${branchName} already exists, checking it out...`, 'yellow');
          gitCommand(path, `checkout ${branchName}`);
          results.push({ service: name, success: true, branch: branchName, existing: true });
        } else {
          throw error;
        }
      }
      
    } catch (error) {
      log(`${colors.red}Error: ${error.message}${colors.reset}`);
      results.push({ service: name, success: false, error: error.message });
    }
    
    log('----------------------------------------');
  }
  
  // Summary
  log('\n=== Branch Creation Summary ===\n', 'cyan');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    log(`Successfully created/checked out: ${successful.length} service(s)`, 'green');
    successful.forEach(r => {
      const status = r.existing ? '(existing)' : '(new)';
      log(`  ✓ ${r.service} -> ${r.branch} ${status}`, 'green');
    });
  }
  
  if (failed.length > 0) {
    log(`\nFailed to create branch: ${failed.length} service(s)`, 'red');
    failed.forEach(r => log(`  ✗ ${r.service}: ${r.error}`, 'red'));
  }
  
  return results;
}

async function setupRepoConfig() {
  log('\n=== Repository Configuration Setup ===\n', 'cyan', true);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (query) => new Promise((resolve) => rl.question(query, resolve));
  
  try {
    log('This tool will help you configure the repository root directory.', 'reset', true);
    log(`Current repository root: ${REPO_ROOT}`, 'yellow', true);
    
    const newRoot = await question('\nEnter new repository root (or press Enter to keep current): ');
    
    if (!newRoot || newRoot.trim() === '') {
      log('\nKeeping current configuration.', 'yellow', true);
      rl.close();
      return;
    }
    
    const rootPath = path.resolve(newRoot.trim());
    
    // Verify the path exists
    if (!fs.existsSync(rootPath)) {
      const create = await question(`\nDirectory ${rootPath} does not exist. Create it? (y/N): `);
      if (create.toLowerCase() === 'y') {
        try {
          fs.mkdirSync(rootPath, { recursive: true });
          log('✓ Directory created', 'green', true);
        } catch (error) {
          log(`✗ Failed to create directory: ${error.message}`, 'red', true);
          rl.close();
          return;
        }
      } else {
        log('\nConfiguration cancelled.', 'yellow', true);
        rl.close();
        return;
      }
    }
    
    // Ask where to save the config
    log('\nWhere would you like to save the configuration?', 'reset', true);
    log('1. Current directory (.ren360rc)', 'reset', true);
    log('2. Home directory (~/.ren360rc)', 'reset', true);
    log('3. Environment variable (show command)', 'reset', true);
    
    const location = await question('\nSelect location (1-3, default: 1): ') || '1';
    
    const config = {
      repoRoot: rootPath,
      created: new Date().toISOString(),
      version: '1.0'
    };
    
    switch (location) {
      case '1':
        const localPath = path.join(process.cwd(), '.ren360rc');
        fs.writeFileSync(localPath, JSON.stringify(config, null, 2));
        log(`\n✓ Configuration saved to ${localPath}`, 'green', true);
        break;
        
      case '2':
        const homePath = path.join(require('os').homedir(), '.ren360rc');
        fs.writeFileSync(homePath, JSON.stringify(config, null, 2));
        log(`\n✓ Configuration saved to ${homePath}`, 'green', true);
        break;
        
      case '3':
        log('\nTo use environment variable, add this to your shell profile:', 'reset', true);
        log(`export REN360_REPO_ROOT="${rootPath}"`, 'green', true);
        log('\nOr run this command:', 'reset', true);
        log(`REN360_REPO_ROOT="${rootPath}" node repo-manager.js`, 'green', true);
        break;
        
      default:
        log('\nInvalid option. Configuration cancelled.', 'yellow', true);
        rl.close();
        return;
    }
    
    // Test the configuration
    log('\nTesting configuration...', 'yellow', true);
    REPO_ROOT = rootPath;
    initializeServices();
    
    let foundServices = 0;
    for (const [name, servicePath] of Object.entries(services)) {
      if (fs.existsSync(servicePath)) {
        foundServices++;
      }
    }
    
    if (foundServices > 0) {
      log(`✓ Found ${foundServices} service(s) at the configured location`, 'green', true);
    } else {
      log('⚠ No services found at the configured location', 'yellow', true);
      log('  Services are expected to be in subdirectories like:', 'reset', true);
      log(`  ${path.join(rootPath, 'microAds/')}`, 'reset', true);
      log(`  ${path.join(rootPath, 'microEmails/')}`, 'reset', true);
      log('  etc.', 'reset', true);
    }
    
  } catch (error) {
    log(`\nSetup error: ${error.message}`, 'red', true);
  } finally {
    rl.close();
  }
}

async function setupGitHubToken() {
  log('\n=== GitHub Token Setup ===\n', 'cyan', true);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (query) => new Promise((resolve) => rl.question(query, resolve));
  
  try {
    log('To use GitHub PR features, you need a GitHub Personal Access Token.', 'reset', true);
    log('Get your token from: https://github.com/settings/tokens', 'blue', true);
    log('\nRequired permissions:', 'reset', true);
    log('  - repo (for private repositories)', 'reset', true);
    log('  - read:org (optional, for organization repos)', 'reset', true);
    
    const token = await question('\nEnter your GitHub token: ');
    
    if (!token || token.trim().length < 10) {
      log('Invalid token. Setup cancelled.', 'red', true);
      rl.close();
      return;
    }
    
    // Update or create .env file
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      // Remove existing GH_TOKEN if present
      envContent = envContent.replace(/GH_TOKEN=.*/g, '');
      // Ensure it ends with newline
      if (!envContent.endsWith('\n')) {
        envContent += '\n';
      }
    }
    
    // Add the new token
    envContent += `\n# GitHub API Token\nGH_TOKEN=${token.trim()}\n`;
    
    fs.writeFileSync(envPath, envContent);
    log('\n✓ GitHub token saved to .env', 'green', true);
    
    // Set it for current process
    process.env.GH_TOKEN = token.trim();
    
    // Test the token
    log('\nTesting GitHub token...', 'yellow', true);
    
    try {
      // Try to list user repos as a test
      execCommand('gh api user', { encoding: 'utf8' });
      log('✓ GitHub token configured successfully!', 'green', true);
      
      log('\nYou can now use:', 'reset', true);
      log('  node repo-manager.js prs              # List all PRs', 'green', true);
      log('  node repo-manager.js review <ticket>  # Review PRs by ticket', 'green', true);
      
    } catch (error) {
      log(`✗ Token test failed: ${error.message}`, 'red', true);
      log('Please check your token and permissions.', 'yellow', true);
    }
    
  } catch (error) {
    log(`Setup error: ${error.message}`, 'red', true);
  } finally {
    rl.close();
  }
}

async function setupAIConfiguration() {
  log('\n=== AI Configuration Setup ===\n', 'cyan', true);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (query) => new Promise((resolve) => rl.question(query, resolve));
  
  try {
    // Check if .env already exists
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const overwrite = await question('A .env file already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        log('Setup cancelled.', 'yellow', true);
        rl.close();
        return;
      }
    }
    
    log('\nTo use the AI agent, you need an Anthropic API key.', 'reset', true);
    log('Get your API key from: https://console.anthropic.com/settings/keys', 'blue', true);
    
    const apiKey = await question('\nEnter your Anthropic API key: ');
    
    if (!apiKey || apiKey.trim().length < 10) {
      log('Invalid API key. Setup cancelled.', 'red', true);
      rl.close();
      return;
    }
    
    // Ask for model preference
    log('\nAvailable models:', 'reset', true);
    log('1. claude-3-opus-20240229    (Most capable, higher cost)', 'reset', true);
    log('2. claude-3-sonnet-20240229  (Balanced performance/cost) [default]', 'reset', true);
    log('3. claude-3-haiku-20240307   (Fastest, lower cost)', 'reset', true);
    
    const modelChoice = await question('\nSelect model (1-3, default: 2): ') || '2';
    
    let model = 'claude-3-sonnet-20240229';
    switch (modelChoice) {
      case '1':
        model = 'claude-3-opus-20240229';
        break;
      case '3':
        model = 'claude-3-haiku-20240307';
        break;
    }
    
    // Create .env file
    const envContent = `# Anthropic API Configuration
ANTHROPIC_API_KEY=${apiKey.trim()}

# Model selection
ANTHROPIC_MODEL=${model}

# Max tokens for responses
ANTHROPIC_MAX_TOKENS=4096
`;
    
    fs.writeFileSync(envPath, envContent);
    log('\n✓ Configuration saved to .env', 'green', true);
    
    // Test the configuration
    log('\nTesting AI configuration...', 'yellow', true);
    
    try {
      // Re-require the AI module to ensure it's loaded
      const { AIAgent: TestAIAgent } = require('./lib/ai-agent');
      const testAgent = new TestAIAgent(apiKey.trim(), model, 1000);
      const testResponse = await testAgent.sendRequest([
        { role: 'user', content: 'Say "Configuration successful!" in 5 words or less.' }
      ]);
      
      log('✓ AI Agent configured successfully!', 'green', true);
      log(`Response: ${testResponse.content[0].text}`, 'reset', true);
      
      log('\nYou can now use AI analysis with:', 'reset', true);
      log('  node repo-manager.js review <ticket-number> --analyze', 'green', true);
      
    } catch (error) {
      log(`✗ Configuration test failed: ${error.message}`, 'red', true);
      log('Please check your API key and try again.', 'yellow', true);
    }
    
  } catch (error) {
    log(`Setup error: ${error.message}`, 'red', true);
  } finally {
    rl.close();
  }
}

async function interactiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (query) => new Promise((resolve) => rl.question(query, resolve));
  
  while (true) {
    console.log('\n=== REN360 Repository Manager ===');
    console.log('1. List current branches');
    console.log('2. List available branches (all services)');
    console.log('3. List available branches (single service)');
    console.log('4. Update all services to a branch');
    console.log('5. Update single service to a branch');
    console.log('6. Create new branch from dev (REN-<ticket>)');
    console.log('7. Show repository status');
    console.log('8. Show uncommitted changes');
    console.log('9. Drop uncommitted changes');
    console.log('10. Exit');
    
    const choice = await question('\nSelect an option (1-10): ');
    
    switch (choice) {
      case '1':
        await listCurrentBranches();
        break;
        
      case '2':
        await listAvailableBranches();
        break;
        
      case '3':
        const serviceForBranches = await question('Enter service name: ');
        await listAvailableBranches(serviceForBranches);
        break;
        
      case '4':
        if (!checkRoot()) {
          log('Error: Branch updates require root privileges. Please run with sudo.', 'red');
          break;
        }
        const branchAll = await question('Enter target branch: ');
        await updateBranches(branchAll);
        break;
        
      case '5':
        if (!checkRoot()) {
          log('Error: Branch updates require root privileges. Please run with sudo.', 'red');
          break;
        }
        const serviceName = await question('Enter service name: ');
        const branchSingle = await question('Enter target branch: ');
        await updateBranches(branchSingle, serviceName);
        break;
        
      case '6':
        if (!checkRoot()) {
          log('Error: Branch creation requires root privileges. Please run with sudo.', 'red');
          break;
        }
        const ticketNumber = await question('Enter ticket number (e.g., 1234 for REN-1234): ');
        const serviceForCreate = await question('Enter service name (or press Enter for all services): ');
        await createBranch(ticketNumber, serviceForCreate || null);
        break;
        
      case '7':
        const serviceForStatus = await question('Enter service name (or press Enter for all services): ');
        await showRepositoryStatus(serviceForStatus || null);
        break;
        
      case '8':
        const serviceForChanges = await question('Enter service name (or press Enter for all services): ');
        await showUncommittedChanges(serviceForChanges || null);
        break;
        
      case '9':
        const serviceForDrop = await question('Enter service name (or press Enter for all services): ');
        await dropUncommittedChanges(serviceForDrop || null, false);
        break;
        
      case '10':
        rl.close();
        process.exit(0);
        
      default:
        log('Invalid option', 'red');
    }
    
    await question('\nPress Enter to continue...');
  }
}

// CLI argument parsing
async function main() {
  const args = process.argv.slice(2);
  
  // Check for repo-root flag
  const repoRootIndex = args.findIndex(arg => arg.startsWith('--repo-root='));
  if (repoRootIndex !== -1) {
    REPO_ROOT = args[repoRootIndex].split('=')[1];
    args.splice(repoRootIndex, 1);
  } else {
    // Check for -r flag
    const rIndex = args.indexOf('-r');
    if (rIndex !== -1 && args[rIndex + 1]) {
      REPO_ROOT = args[rIndex + 1];
      args.splice(rIndex, 2);
    } else {
      // Use configured repo root
      REPO_ROOT = getRepoRoot();
    }
  }
  
  // Initialize services with the configured REPO_ROOT
  initializeServices();
  
  // Show repo root if verbose or if custom root is used
  if (REPO_ROOT !== DEFAULT_REPO_ROOT) {
    console.log(`${colors.cyan}Using repository root: ${REPO_ROOT}${colors.reset}`);
  }
  
  // Check for verbose flag
  if (args.includes('--verbose') || args.includes('-v')) {
    VERBOSE = true;
    // Remove verbose flag from args
    const index = args.indexOf('--verbose');
    if (index > -1) args.splice(index, 1);
    const vIndex = args.indexOf('-v');
    if (vIndex > -1) args.splice(vIndex, 1);
  }
  
  if (args.length === 0) {
    await interactiveMode();
    return;
  }
  
  const command = args[0];
  
  switch (command) {
    case 'list':
    case 'current':
      await listCurrentBranches();
      break;
      
    case 'branches':
      const service = args[1];
      await listAvailableBranches(service);
      break;
      
    case 'update':
      if (args.length < 2) {
        log('Error: Please specify a branch name', 'red', true);
        log('Usage: repo-manager.js update <branch> [service] [--composer-update] [--skip-deps]', 'reset', true);
        process.exit(1);
      }
      const branch = args[1];
      const targetService = args[2] && !args[2].startsWith('--') ? args[2] : undefined;
      const useComposerUpdate = args.includes('--composer-update');
      const skipDeps = args.includes('--skip-deps');
      await updateBranches(branch, targetService, useComposerUpdate, skipDeps);
      break;
      
    case 'create':
    case 'create-branch':
      if (args.length < 2) {
        log('Error: Please specify a ticket number', 'red', true);
        log('Usage: repo-manager.js create <ticket-number> [service]', 'reset', true);
        process.exit(1);
      }
      const ticketNum = args[1];
      const createService = args[2];
      await createBranch(ticketNum, createService);
      break;
      
    case 'status':
      const statusService = args[1];
      await showRepositoryStatus(statusService);
      break;
      
    case 'changes':
    case 'uncommitted':
      const changesService = args[1];
      await showUncommittedChanges(changesService);
      break;
      
    case 'sync':
    case 'pull':
      const syncService = args[1];
      await syncRepositories(syncService);
      break;
      
    case 'search':
      if (args.length < 2) {
        log('Error: Please specify a search pattern', 'red', true);
        log('Usage: repo-manager.js search <pattern> [service] [--include=pattern]', 'reset', true);
        process.exit(1);
      }
      const searchPattern = args[1];
      const searchService = args[2] && !args[2].startsWith('--') ? args[2] : undefined;
      const includeArg = args.find(arg => arg.startsWith('--include='));
      const includePattern = includeArg ? includeArg.split('=')[1] : undefined;
      await searchInRepositories(searchPattern, { 
        service: searchService, 
        include: includePattern 
      });
      break;
      
    case 'recent':
    case 'activity':
      const recentService = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
      const daysArg = args.find(arg => arg.startsWith('--days='));
      const countArg = args.find(arg => arg.startsWith('--count='));
      const days = daysArg ? parseInt(daysArg.split('=')[1]) : 7;
      const count = countArg ? parseInt(countArg.split('=')[1]) : 5;
      await showRecentActivity({ 
        service: recentService,
        days,
        count
      });
      break;
      
    case 'stash':
      const stashAction = args[1] || 'list';
      if (!['save', 'pop', 'list'].includes(stashAction)) {
        log('Error: Invalid stash action', 'red', true);
        log('Usage: repo-manager.js stash [save|pop|list] ["message"]', 'reset', true);
        process.exit(1);
      }
      const stashMessage = stashAction === 'save' && args[2] ? args.slice(2).join(' ') : '';
      await manageStash(stashAction, stashMessage);
      break;
      
    case 'drop':
    case 'drop-changes':
      const dropService = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
      const dropForce = args.includes('--force') || args.includes('-f');
      await dropUncommittedChanges(dropService, dropForce);
      break;
      
    case 'pr':
      const prTitle = args.find(arg => arg.startsWith('--title='));
      const prBody = args.find(arg => arg.startsWith('--body='));
      const prDraft = args.includes('--draft');
      const prService = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
      
      if (!prTitle) {
        log('Error: PR title is required', 'red', true);
        log('Usage: repo-manager.js pr [service] --title="PR title" [--body="description"] [--draft]', 'reset', true);
        process.exit(1);
      }
      
      await createPullRequest({
        title: prTitle.split('=').slice(1).join('='),
        body: prBody ? prBody.split('=').slice(1).join('=') : undefined,
        draft: prDraft,
        service: prService
      });
      break;
      
    case 'review':
      if (args.length < 2) {
        log('Error: Please specify a ticket number', 'red', true);
        log('Usage: repo-manager.js review <ticket-number> [--analyze]', 'reset', true);
        process.exit(1);
      }
      const reviewTicket = args[1];
      const shouldAnalyze = args.includes('--analyze');
      await reviewPullRequests(reviewTicket, { analyze: shouldAnalyze });
      break;
      
    case 'prs':
    case 'list-prs':
      const prState = args.find(arg => arg.startsWith('--state='))?.split('=')[1] || 'open';
      await listAllPullRequests({ state: prState });
      break;
      
    case 'setup-ai':
      await setupAIConfiguration();
      break;
      
    case 'setup-github':
    case 'setup-gh':
      await setupGitHubToken();
      break;
      
    case 'setup-config':
    case 'config':
      await setupRepoConfig();
      break;
      
    case 'help':
    case '--help':
    case '-h':
      console.log(`
REN360 Repository Manager

Usage:
  node repo-manager.js                       # Interactive mode
  node repo-manager.js list                  # List current branches
  node repo-manager.js branches [service]    # List available branches
  node repo-manager.js status [service]       # Show repository status
  node repo-manager.js changes [service]      # Show uncommitted changes
  node repo-manager.js drop [service] [--force]  # Drop uncommitted changes
  node repo-manager.js sync [service]         # Pull latest changes on current branches
  node repo-manager.js search <pattern> [service] [--include=glob]  # Search across repos
  node repo-manager.js recent [service] [--days=N] [--count=N]  # Show recent commits
  node repo-manager.js stash [save|pop|list] ["message"]  # Manage stashes
  node repo-manager.js pr [service] --title="title" [options]  # Create PR
  node repo-manager.js prs [--state=open|closed|all]       # List all PRs
  node repo-manager.js review <ticket-number> [--analyze]  # Review PRs by ticket
  node repo-manager.js setup-config                        # Configure repository root
  node repo-manager.js setup-ai                            # Configure AI agent
  node repo-manager.js setup-github                        # Configure GitHub token
  node repo-manager.js update <branch> [service] [options]  # Update to branch
  node repo-manager.js create <ticket> [service]  # Create REN-<ticket> branch from dev

Options:
  --repo-root=PATH   # Set custom repository root directory
  -r PATH            # Set custom repository root directory (short form)
  --verbose, -v      # Show detailed output during operations
  --composer-update  # Use composer update instead of install
  --skip-deps        # Skip composer/npm install entirely
  --force, -f        # Skip confirmation prompts (use with caution!)

Configuration:
  Repository root can be configured in multiple ways (in order of precedence):
  1. Command line: --repo-root=/path/to/repos or -r /path/to/repos
  2. Environment variable: REN360_REPO_ROOT=/path/to/repos
  3. Config file (.ren360rc) in current directory or home directory
  4. .env file: REPO_ROOT=/path/to/repos
  5. Default: ${DEFAULT_REPO_ROOT}

Examples:
  node repo-manager.js list
  node repo-manager.js branches frontend
  node repo-manager.js branches              # All services
  sudo node repo-manager.js update develop   # Update all to develop
  sudo node repo-manager.js update master frontend  # Update only frontend
  sudo node repo-manager.js update dev --composer-update  # Update with composer update
  sudo node repo-manager.js update dev --skip-deps  # Update without installing dependencies
  sudo node repo-manager.js update dev --verbose    # Update with detailed output
  sudo node repo-manager.js create 1234      # Create REN-1234 branch from dev
  sudo node repo-manager.js create 1234 frontend  # Create REN-1234 only for frontend
  node repo-manager.js status                # Show status of all repos
  node repo-manager.js status frontend       # Show status of specific repo
  node repo-manager.js changes               # Show uncommitted changes in all repos
  node repo-manager.js changes frontend      # Show uncommitted changes in specific repo
  node repo-manager.js drop                  # Drop all uncommitted changes (with confirmation)
  node repo-manager.js drop frontend         # Drop changes in specific repo
  node repo-manager.js drop --force          # Drop changes without confirmation
  node repo-manager.js sync                  # Pull latest for all repos
  node repo-manager.js sync frontend         # Pull latest for specific repo
  node repo-manager.js search "TODO"         # Find TODOs in all repos
  node repo-manager.js search "getUserData" frontend --include="*.js"
  node repo-manager.js recent --days=7       # Commits from last 7 days
  node repo-manager.js stash save "work in progress"  # Save stash
  node repo-manager.js stash pop            # Restore stash
  node repo-manager.js pr --title="Fix auth bug" --body="Fixed issue with..."
  node repo-manager.js pr frontend --title="Update UI" --draft
  node repo-manager.js prs                   # List all open PRs
  node repo-manager.js prs --state=all       # List all PRs (open, closed, merged)
  node repo-manager.js review 1234           # Find all PRs for REN-1234
  node repo-manager.js review 1234 --analyze # With AI analysis

Services:
  ${Object.keys(services).join(', ')}
      `);
      break;
      
    default:
      log(`Unknown command: ${command}`, 'red');
      log('Use "node repo-manager.js help" for usage information');
      process.exit(1);
  }
}

// Run the script
main().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  process.exit(1);
});