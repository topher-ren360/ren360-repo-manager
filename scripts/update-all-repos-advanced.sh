#!/bin/bash

# Advanced script to update all microservice repositories with per-service branch support
# Usage: 
#   ./update-all-repos-advanced.sh                    # Updates all to master
#   ./update-all-repos-advanced.sh develop           # Updates all to develop
#   ./update-all-repos-advanced.sh --config branches.conf  # Uses config file for per-service branches

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root"
   exit 1
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default branch
DEFAULT_BRANCH="master"

# Parse command line arguments
CONFIG_FILE=""
if [ "$1" == "--config" ] && [ -n "$2" ]; then
    CONFIG_FILE="$2"
elif [ -n "$1" ] && [ "$1" != "--config" ]; then
    DEFAULT_BRANCH="$1"
fi

# Define all microservices and their source directories
declare -A SERVICES=(
    ["ads"]="/var/amarki/repository/microAds/"
    ["emails"]="/var/amarki/repository/microEmails/"
    ["frontend"]="/var/amarki/repository/microFrontend/"
    ["images"]="/var/amarki/repository/microImages/"
    ["integrations"]="/var/amarki/repository/microIntegrations/"
    ["intelligence"]="/var/amarki/repository/microIntelligence/"
    ["sms"]="/var/amarki/repository/microSms/"
    ["social"]="/var/amarki/repository/microSocial/"
    ["templates"]="/var/amarki/repository/microTemplates/"
    ["users"]="/var/amarki/repository/microUsers/"
)

# Store per-service branches
declare -A SERVICE_BRANCHES=()

# Load branches from config file if provided
load_config() {
    if [ -n "$CONFIG_FILE" ] && [ -f "$CONFIG_FILE" ]; then
        echo -e "${BLUE}Loading branch configuration from: $CONFIG_FILE${NC}"
        while IFS='=' read -r service branch; do
            # Skip comments and empty lines
            [[ "$service" =~ ^#.*$ ]] && continue
            [ -z "$service" ] && continue
            
            # Trim whitespace
            service=$(echo "$service" | xargs)
            branch=$(echo "$branch" | xargs)
            
            if [ -n "$service" ] && [ -n "$branch" ]; then
                SERVICE_BRANCHES["$service"]="$branch"
                echo "  $service -> $branch"
            fi
        done < "$CONFIG_FILE"
        echo ""
    fi
}

# Get branch for a specific service
get_branch_for_service() {
    local service=$1
    if [ -n "${SERVICE_BRANCHES[$service]}" ]; then
        echo "${SERVICE_BRANCHES[$service]}"
    else
        echo "$DEFAULT_BRANCH"
    fi
}

echo "=========================================="
echo "REN360 Repository Branch Update Script"
echo "=========================================="

# Load configuration if provided
load_config

echo "Default branch: $DEFAULT_BRANCH"
echo ""

# Function to update a single repository
update_repo() {
    local service_name=$1
    local repo_path=$2
    local branch=$3
    
    echo -e "${YELLOW}Updating $service_name to branch: $branch${NC}"
    
    if [ ! -d "$repo_path" ]; then
        echo -e "${RED}Error: Directory $repo_path does not exist${NC}"
        return 1
    fi
    
    cd "$repo_path" || return 1
    
    # Get current branch
    current_branch=$(sudo -u www-data git rev-parse --abbrev-ref HEAD 2>/dev/null)
    
    echo "Current branch: $current_branch"
    
    # Check for uncommitted changes
    if ! sudo -u www-data git diff-index --quiet HEAD -- 2>/dev/null; then
        echo -e "${RED}Warning: Uncommitted changes detected in $service_name${NC}"
        echo "Stashing changes..."
        sudo -u www-data git stash push -m "Auto-stash before branch update $(date +%Y%m%d_%H%M%S)"
    fi
    
    # Fetch latest changes
    echo "Fetching latest changes..."
    if ! sudo -u www-data git fetch; then
        echo -e "${RED}Error: Failed to fetch for $service_name${NC}"
        return 1
    fi
    
    # Check if branch exists
    if ! sudo -u www-data git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
        echo -e "${RED}Error: Branch '$branch' does not exist in remote for $service_name${NC}"
        return 1
    fi
    
    # Checkout and pull the branch
    echo "Checking out branch $branch..."
    if ! sudo -u www-data git checkout "$branch"; then
        echo -e "${RED}Error: Failed to checkout branch $branch for $service_name${NC}"
        return 1
    fi
    
    echo "Pulling latest changes..."
    if ! sudo -u www-data git pull; then
        echo -e "${RED}Error: Failed to pull for $service_name${NC}"
        return 1
    fi
    
    # Update dependencies based on service type
    echo "Checking for dependency updates..."
    if [ -f "composer.json" ]; then
        echo "Running composer install..."
        if [ "$service_name" == "frontend" ] || [ "$service_name" == "intelligence" ]; then
            sudo -u www-data /usr/bin/php8.2 /usr/local/bin/composer26 install --no-interaction
        else
            sudo -u www-data composer install --no-interaction
        fi
    fi
    
    if [ -f "package.json" ] && [ "$service_name" == "intelligence" ]; then
        echo "Running npm install..."
        sudo -u www-data npm install
    fi
    
    # Get the latest commit info
    latest_commit=$(sudo -u www-data git log -1 --pretty=format:"%h - %s (%cr)")
    echo -e "${GREEN}Success: $service_name updated to $branch${NC}"
    echo "Latest commit: $latest_commit"
    echo ""
    
    return 0
}

# Track successes and failures
declare -a FAILED_SERVICES=()
declare -a SUCCESS_SERVICES=()
declare -A UPDATE_SUMMARY=()

# Create a timestamp for the update
UPDATE_TIME=$(date +"%Y-%m-%d %H:%M:%S")

# Main update loop
for service in "${!SERVICES[@]}"; do
    repo_path="${SERVICES[$service]}"
    branch=$(get_branch_for_service "$service")
    
    if update_repo "$service" "$repo_path" "$branch"; then
        SUCCESS_SERVICES+=("$service")
        UPDATE_SUMMARY["$service"]="$branch (success)"
    else
        FAILED_SERVICES+=("$service")
        UPDATE_SUMMARY["$service"]="$branch (failed)"
    fi
    
    echo "----------------------------------------"
done

# Summary
echo ""
echo "=========================================="
echo "Update Summary - $UPDATE_TIME"
echo "=========================================="

echo -e "${BLUE}Service Branch Status:${NC}"
for service in $(printf '%s\n' "${!UPDATE_SUMMARY[@]}" | sort); do
    status="${UPDATE_SUMMARY[$service]}"
    if [[ "$status" == *"success"* ]]; then
        echo -e "  ${GREEN}✓${NC} $service: $status"
    else
        echo -e "  ${RED}✗${NC} $service: $status"
    fi
done

echo ""
if [ ${#SUCCESS_SERVICES[@]} -gt 0 ]; then
    echo -e "${GREEN}Successfully updated: ${#SUCCESS_SERVICES[@]} services${NC}"
fi

if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    echo -e "${RED}Failed to update: ${#FAILED_SERVICES[@]} services${NC}"
    echo -e "${YELLOW}Note: Failed services may need manual intervention${NC}"
fi

# Write summary to log file
# Use fixed path since script runs as root
LOG_DIR="/home/cmckenna/ren360"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/update-repos-$(date +%Y%m%d_%H%M%S).log"
{
    echo "REN360 Repository Update Log"
    echo "Time: $UPDATE_TIME"
    echo "Default Branch: $DEFAULT_BRANCH"
    echo ""
    echo "Results:"
    for service in $(printf '%s\n' "${!UPDATE_SUMMARY[@]}" | sort); do
        echo "  $service: ${UPDATE_SUMMARY[$service]}"
    done
} > "$LOG_FILE"

# Set proper ownership for the log file
chown cmckenna:cmckenna "$LOG_FILE"

echo ""
echo "Log file created: $LOG_FILE"
echo ""
echo "=========================================="
echo "Repository update complete!"
echo "=========================================="

# Exit with error if any services failed
if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    exit 1
fi

exit 0