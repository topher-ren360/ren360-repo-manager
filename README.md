# REN360 Repository Manager

A Node.js-based tool for managing REN360 microservice repositories. This tool provides functionality to list branches, check current branches, and update repositories across all microservices.

## Features

- 🔍 **List current branches** for all services
- 📋 **List available branches** for all or specific services
- 🔄 **Update branches** for all or specific services
- 📦 **Automatic dependency updates** (composer/npm)
- 🎨 **Color-coded output** for better readability
- 📝 **JSON logging** of update operations
- 🎯 **Interactive mode** for ease of use
- ⚡ **Single service updates** for targeted changes

## Installation

1. Ensure Node.js is installed (v14 or higher):
   ```bash
   node --version
   ```

2. Clone the repository:
   ```bash
   git clone https://github.com/topher-ren360/ren360-repo-manager.git
   cd ren360-repo-manager
   ```

3. Configure your repository root directory:
   ```bash
   # Interactive setup
   node repo-manager.js setup-config
   
   # Or use environment variable
   export REN360_REPO_ROOT="/path/to/your/repos"
   
   # Or command line
   node repo-manager.js --repo-root=/path/to/your/repos list
   ```

4. (Optional) Make the script executable:
   ```bash
   chmod +x repo-manager.js
   ```

## Usage

### Interactive Mode
Simply run the script without arguments to enter interactive mode:
```bash
node ~/ren360/repo-manager.js
```

### Command Line Mode

#### List Current Branches
Shows the current branch for each microservice:
```bash
node ~/ren360/repo-manager.js list
# or
node ~/ren360/repo-manager.js current
```

#### List Available Branches
Shows all available branches (local and remote):
```bash
# For all services
node ~/ren360/repo-manager.js branches

# For a specific service
node ~/ren360/repo-manager.js branches frontend
node ~/ren360/repo-manager.js branches intelligence
```

#### Update Branches
Updates repositories to a specified branch:
```bash
# Update all services to develop branch (requires sudo)
sudo node ~/ren360/repo-manager.js update develop

# Update only frontend to feature branch (requires sudo)
sudo node ~/ren360/repo-manager.js update feature/new-ui frontend

# Update intelligence service to master (requires sudo)
sudo node ~/ren360/repo-manager.js update master intelligence
```

### NPM Scripts
If you're in the ~/ren360 directory:
```bash
npm start          # Interactive mode
npm run list       # List current branches
npm run branches   # List available branches
npm run help       # Show help
```

## Services Supported

The tool manages the following microservices:

- **ads** - Advertisement management
- **emails** - Email service
- **frontend** - Main web application
- **images** - Image processing
- **integrations** - Third-party integrations
- **intelligence** - AI/ML service
- **sms** - SMS messaging
- **social** - Social media integration
- **templates** - Template management
- **users** - Authentication and user management

## Output Examples

### List Current Branches
```
=== Current Branches for All Services ===

ads          | develop
contacts     | master
emails       | master
frontend     | feature/new-dashboard
intelligence | develop
...
```

### List Available Branches
```
=== Available Branches ===

frontend:
  - master
  - develop
  - feature/new-dashboard
  - feature/vue3-upgrade
  - hotfix/login-bug
```

### Update Services
```
=== Updating Services to Branch: develop ===

Updating frontend to branch: develop
Current branch: master
Fetching latest changes...
Checking out branch develop...
Pulling latest changes...
Running composer install...
Success: frontend updated to develop
Latest commit: a1b2c3d - Add new dashboard layout (2 hours ago)
----------------------------------------

=== Update Summary ===

Successfully updated: 9 service(s)
  ✓ ads -> develop
  ✓ emails -> develop
  ✓ frontend -> develop
  ...

Failed to update: 1 service(s)
  ✗ intelligence: Branch 'develop' does not exist in remote

Log saved to: /home/cmckenna/ren360/update-log-2025-06-20T15-45-23.json
```

## Configuration

### Repository Root Directory

The tool needs to know where your microservice repositories are located. The default is `/var/amarki/repository`, but you can configure a custom location.

#### Configuration Methods (in order of precedence):

1. **Command Line Flag**:
   ```bash
   node repo-manager.js --repo-root=/custom/path list
   # or short form
   node repo-manager.js -r /custom/path list
   ```

2. **Environment Variable**:
   ```bash
   export REN360_REPO_ROOT="/custom/path"
   node repo-manager.js list
   ```

3. **Configuration File**:
   Create a `.ren360rc` file in your current directory or home directory:
   ```json
   {
     "repoRoot": "/custom/path",
     "version": "1.0"
   }
   ```

4. **.env File**:
   Add to your `.env` file:
   ```
   REPO_ROOT=/custom/path
   ```

#### Setup Wizard

The easiest way to configure the repository root is using the setup wizard:
```bash
node repo-manager.js setup-config
```

This will:
- Ask for your repository root directory
- Create the directory if it doesn't exist
- Save the configuration to your preferred location
- Test that services can be found

### Expected Directory Structure

Your repositories should be organized as:
```
/your/repo/root/
├── microAds/
├── microEmails/
├── microFrontend/
├── microImages/
├── microIntegrations/
├── microIntelligence/
├── microSms/
├── microSocial/
├── microTemplates/
└── microUsers/
```

## Features in Detail

### Automatic Stashing
If uncommitted changes are detected, they are automatically stashed before switching branches with a timestamped message.

### Dependency Management
The tool automatically runs:
- `composer install` for PHP services
- `npm install` for the intelligence service (Node.js)
- Uses the correct PHP/composer versions for each service

### Error Handling
- Validates branch existence before attempting to switch
- Checks directory existence
- Provides clear error messages
- Continues with other services if one fails

### Logging
Update operations create JSON log files in `~/ren360/` containing:
- Service name
- Success/failure status
- Target branch
- Error messages (if any)
- Latest commit information

## Requirements

- **Node.js**: Version 14 or higher
- **Root access**: Required for update operations (use sudo)
- **Git**: All repositories must be valid git repositories
- **Permissions**: www-data user must have git access

## Troubleshooting

### Permission Denied
Update operations require root access:
```bash
sudo node ~/ren360/repo-manager.js update develop
```

### Branch Not Found
Ensure the branch exists in the remote repository. List available branches first:
```bash
node ~/ren360/repo-manager.js branches frontend
```

### Service Not Found
Check the service name is correct. Valid services are:
ads, emails, frontend, images, integrations, intelligence, sms, social, templates, users

### Git Authentication Issues
Ensure the www-data user has proper git credentials configured.

## Advanced Usage

### Scripting
The tool can be used in scripts for automation:
```bash
#!/bin/bash
# Update all services to develop and check for failures
if sudo node ~/ren360/repo-manager.js update develop; then
    echo "All services updated successfully"
else
    echo "Some services failed to update"
    exit 1
fi
```

### JSON Output Processing
Log files can be processed for automation:
```bash
# Get the latest log file
latest_log=$(ls -t ~/ren360/update-log-*.json | head -1)

# Process with jq
jq '.[] | select(.success == false) | .service' "$latest_log"
```

## Notes

- The tool follows the same patterns as the original bash deployment scripts
- All git operations are performed as the `www-data` user
- This tool only updates repository branches, it does not deploy to production
- For actual deployment, use the individual service scripts (e.g., `./frontend.sh`)