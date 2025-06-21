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

// Utility functions
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
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

function updateServiceBranch(serviceName, repoPath, targetBranch) {
  try {
    if (!fs.existsSync(repoPath)) {
      return { service: serviceName, success: false, error: 'Directory not found' };
    }
    
    log(`\nUpdating ${serviceName} to branch: ${targetBranch}`, 'yellow');
    
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
    updateDependencies(serviceName, repoPath);
    
    // Get latest commit
    const latestCommit = gitCommand(repoPath, 'log -1 --pretty=format:"%h - %s (%cr)"');
    log(`Success: ${serviceName} updated to ${targetBranch}`, 'green');
    log(`Latest commit: ${latestCommit}`);
    
    return { service: serviceName, success: true, branch: targetBranch, commit: latestCommit };
  } catch (error) {
    log(`Error updating ${serviceName}: ${error.message}`, 'red');
    return { service: serviceName, success: false, error: error.message };
  }
}

function updateDependencies(serviceName, repoPath) {
  try {
    // Check for composer.json
    if (fs.existsSync(path.join(repoPath, 'composer.json'))) {
      log('Running composer install...');
      
      // Services that use PHP 7.4
      const php74Services = ['users', 'images'];
      
      // Services that use PHP 8.2 with Composer 2.6
      const php82Services = ['frontend', 'intelligence'];
      
      // All other services use PHP 8.1
      if (php74Services.includes(serviceName)) {
        execCommand('sudo -u www-data composer install --no-interaction', { cwd: repoPath });
      } else if (php82Services.includes(serviceName)) {
        execCommand('sudo -u www-data /usr/bin/php8.2 /usr/local/bin/composer26 install --no-interaction', { cwd: repoPath });
      } else {
        // Use PHP 8.1 for ads, emails, integrations, sms, social, templates
        execCommand('sudo -u www-data /usr/bin/php8.1 /usr/local/bin/composer install --no-interaction', { cwd: repoPath });
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
  log('\n=== Current Branches for All Services ===\n', 'cyan');
  
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
      log(`${service} | ${branch} | ${colors.red}${result.error}${colors.reset}`);
    } else {
      log(`${service} | ${colors.green}${branch}${colors.reset}`);
    }
  });
  
  return results;
}

async function listAvailableBranches(serviceName = null) {
  log('\n=== Available Branches ===\n', 'cyan');
  
  const servicesToCheck = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
  
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red');
    return;
  }
  
  for (const [name, path] of Object.entries(servicesToCheck)) {
    const result = getAllBranches(name, path);
    
    log(`\n${colors.yellow}${name}:${colors.reset}`);
    
    if (result.error) {
      log(`  Error: ${result.error}`, 'red');
    } else if (result.branches.length === 0) {
      log('  No branches found', 'yellow');
    } else {
      result.branches.forEach(branch => {
        log(`  - ${branch}`);
      });
    }
  }
}

async function updateBranches(targetBranch, serviceName = null) {
  if (!checkRoot()) {
    log('Error: This script must be run as root (use sudo)', 'red');
    process.exit(1);
  }
  
  log(`\n=== Updating Services to Branch: ${targetBranch} ===\n`, 'cyan');
  
  const servicesToUpdate = serviceName 
    ? { [serviceName]: services[serviceName] }
    : services;
  
  if (serviceName && !services[serviceName]) {
    log(`Error: Service '${serviceName}' not found`, 'red');
    return;
  }
  
  const results = [];
  
  for (const [name, path] of Object.entries(servicesToUpdate)) {
    const result = updateServiceBranch(name, path, targetBranch);
    results.push(result);
    log('----------------------------------------');
  }
  
  // Summary
  log('\n=== Update Summary ===\n', 'cyan');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    log(`Successfully updated: ${successful.length} service(s)`, 'green');
    successful.forEach(r => log(`  ✓ ${r.service} -> ${r.branch}`, 'green'));
  }
  
  if (failed.length > 0) {
    log(`\nFailed to update: ${failed.length} service(s)`, 'red');
    failed.forEach(r => log(`  ✗ ${r.service}: ${r.error}`, 'red'));
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
    console.log('6. Exit');
    
    const choice = await question('\nSelect an option (1-6): ');
    
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
        log('Error: Please specify a branch name', 'red');
        log('Usage: repo-manager.js update <branch> [service]');
        process.exit(1);
      }
      const branch = args[1];
      const targetService = args[2];
      await updateBranches(branch, targetService);
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
  node repo-manager.js update <branch> [service]  # Update to branch

Examples:
  node repo-manager.js list
  node repo-manager.js branches frontend
  node repo-manager.js branches              # All services
  sudo node repo-manager.js update develop   # Update all to develop
  sudo node repo-manager.js update master frontend  # Update only frontend

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