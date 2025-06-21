# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the REN360 Repository Manager - a Node.js CLI tool for managing git branches across multiple microservice repositories. The tool provides functionality to list, check, and update branches for REN360's microservices infrastructure.

## Common Development Commands

### Running the Tool
```bash
# Interactive mode
node repo-manager.js

# List current branches
node repo-manager.js list

# List available branches
node repo-manager.js branches [service]

# Update branches (requires sudo)
sudo node repo-manager.js update <branch> [service]

# Get help
node repo-manager.js help
```

### NPM Scripts
```bash
npm start          # Interactive mode
npm run list       # List current branches
npm run branches   # List available branches
npm run help       # Show help
```

## Architecture and Key Components

### Service Definitions (repo-manager.js:20-32)
The tool manages 10 microservices, each with a fixed repository path under `/var/amarki/repository/`:
- ads, emails, frontend, images, integrations, intelligence, sms, social, templates, users

### Core Functions

1. **getCurrentBranch** (repo-manager.js:61-72): Gets the current git branch for a service
2. **getAllBranches** (repo-manager.js:74-108): Lists all available branches (local and remote) for a service
3. **updateServiceBranch** (repo-manager.js:110-161): Updates a service to a target branch with:
   - Uncommitted changes stashing
   - Branch validation
   - Dependency updates (composer/npm)
   - Commit info retrieval

4. **updateDependencies** (repo-manager.js:163-194): Handles composer and npm installs with service-specific configurations:
   - PHP 7.4: users, images
   - PHP 8.2 with Composer 2.6: frontend, intelligence
   - PHP 8.1 with default composer: ads, emails, integrations, sms, social, templates
   - Only Intelligence service runs npm install

### CLI Entry Points

- **interactiveMode** (repo-manager.js:320-382): Menu-driven interface for all operations
- **main** (repo-manager.js:385-446): Handles command-line arguments and routes to appropriate functions

### Key Implementation Details

1. **Git Operations**: All git commands run as `www-data` user via sudo (repo-manager.js:56-58)
2. **Root Requirement**: Update operations require root privileges (repo-manager.js:47-54)
3. **Error Handling**: Continues with other services if one fails, provides detailed error messages
4. **Logging**: Saves JSON logs to `/home/cmckenna/ren360/` for update operations (repo-manager.js:296-318)
5. **Color Output**: Uses ANSI color codes for better readability in terminal

### Security Considerations

- Requires sudo for branch updates to maintain proper file permissions
- All git operations executed as www-data user
- No credentials or sensitive data stored in code
- Log files saved to user's home directory, not system directories

## Testing

This project currently does not have automated tests. When adding tests:
- Use a Node.js testing framework like Jest or Mocha
- Mock the execSync calls to avoid actual git operations
- Test each core function independently
- Ensure tests cover error scenarios

## Additional Files

- **config/branches.conf.example**: Example configuration for service branch mappings (not currently used by the tool)
- **scripts/**: Contains legacy bash scripts for repository updates