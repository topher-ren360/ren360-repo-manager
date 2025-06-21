#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

// Service definitions
const services = {
  ads: '/var/amarki/repository/microAds/',
  emails: '/var/amarki/repository/microEmails/',
  frontend: '/var/amarki/repository/microFrontend/',
  images: '/var/amarki/repository/microImages/',
  integrations: '/var/amarki/repository/microIntegrations/',
  intelligence: '/var/amarki/repository/microIntelligence/',
  sms: '/var/amarki/repository/microSms/',
  social: '/var/amarki/repository/microSocial/',
  templates: '/var/amarki/repository/microTemplates/',
  users: '/var/amarki/repository/microUsers/'
};

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
      const prListCommand = `gh pr list --search "${searchPattern}" --state all --json number,title,state,url,isDraft,createdAt,author,headRefName`;
      const prsJson = execCommand(prListCommand, { cwd: path });
      
      if (prsJson && prsJson.trim() !== '[]') {
        const prs = JSON.parse(prsJson);
        
        for (const pr of prs) {
          // Get PR details including files changed
          const prDetailsCommand = `gh pr view ${pr.number} --json files,additions,deletions,body,reviews,comments`;
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
      // Collect all PR information for analysis
      const prSummary = allPRs.map(pr => ({
        service: pr.service,
        title: pr.title,
        files: pr.filesChanged,
        additions: pr.additions,
        deletions: pr.deletions,
        description: pr.body || 'No description'
      }));
      
      // Create analysis prompt
      const analysisPrompt = `Analyze these pull requests for ticket ${searchPattern}:

${JSON.stringify(prSummary, null, 2)}

Please provide:
1. Overall assessment of the changes
2. Potential risks or concerns
3. Key areas that need careful review
4. Suggestions for testing
5. Any architectural or design considerations`;

      // Save analysis request to a file for the AI to process
      const analysisFile = `/tmp/pr-analysis-${ticketNumber}.txt`;
      fs.writeFileSync(analysisFile, analysisPrompt);
      
      log(`\nAI analysis prompt saved to: ${analysisFile}`, 'blue', true);
      log(`To get AI analysis, run:`, 'reset', true);
      log(`  cat ${analysisFile} | <your-ai-tool>`, 'reset', true);
      
    } catch (error) {
      log(`Error preparing AI analysis: ${error.message}`, 'red', true);
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
    console.log('8. Exit');
    
    const choice = await question('\nSelect an option (1-8): ');
    
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
  node repo-manager.js sync [service]         # Pull latest changes on current branches
  node repo-manager.js search <pattern> [service] [--include=glob]  # Search across repos
  node repo-manager.js recent [service] [--days=N] [--count=N]  # Show recent commits
  node repo-manager.js stash [save|pop|list] ["message"]  # Manage stashes
  node repo-manager.js pr [service] --title="title" [options]  # Create PR
  node repo-manager.js review <ticket-number> [--analyze]  # Review PRs by ticket
  node repo-manager.js update <branch> [service] [options]  # Update to branch
  node repo-manager.js create <ticket> [service]  # Create REN-<ticket> branch from dev

Options:
  --verbose, -v      # Show detailed output during operations
  --composer-update  # Use composer update instead of install
  --skip-deps        # Skip composer/npm install entirely

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
  node repo-manager.js sync                  # Pull latest for all repos
  node repo-manager.js sync frontend         # Pull latest for specific repo
  node repo-manager.js search "TODO"         # Find TODOs in all repos
  node repo-manager.js search "getUserData" frontend --include="*.js"
  node repo-manager.js recent --days=7       # Commits from last 7 days
  node repo-manager.js stash save "work in progress"  # Save stash
  node repo-manager.js stash pop            # Restore stash
  node repo-manager.js pr --title="Fix auth bug" --body="Fixed issue with..."
  node repo-manager.js pr frontend --title="Update UI" --draft
  node repo-manager.js review 1234           # Find all PRs for REN-1234
  node repo-manager.js review 1234 --analyze # With AI analysis prompt

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