#!/bin/bash

# Script to update all microservice repositories to specified branches
# Usage: ./update-all-repos.sh [branch]
# If no branch is specified, it will use 'master' as default

# Get branch name from command line argument, default to 'master'
DEFAULT_BRANCH=${1:-master}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root"
   exit 1
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

echo "=========================================="
echo "REN360 Repository Branch Update Script"
echo "Default branch: $DEFAULT_BRANCH"
echo "=========================================="
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

# Main update loop
for service in "${!SERVICES[@]}"; do
    repo_path="${SERVICES[$service]}"
    
    # You can customize branches per service here if needed
    # For now, all services use the same branch
    branch="$DEFAULT_BRANCH"
    
    if update_repo "$service" "$repo_path" "$branch"; then
        SUCCESS_SERVICES+=("$service")
    else
        FAILED_SERVICES+=("$service")
    fi
    
    echo "----------------------------------------"
done

# Summary
echo ""
echo "=========================================="
echo "Update Summary"
echo "=========================================="

if [ ${#SUCCESS_SERVICES[@]} -gt 0 ]; then
    echo -e "${GREEN}Successfully updated (${#SUCCESS_SERVICES[@]}):${NC}"
    printf '%s\n' "${SUCCESS_SERVICES[@]}" | sort
fi

if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed to update (${#FAILED_SERVICES[@]}):${NC}"
    printf '%s\n' "${FAILED_SERVICES[@]}" | sort
    echo ""
    echo -e "${YELLOW}Note: Failed services may need manual intervention${NC}"
fi

echo ""
echo "=========================================="
echo "Repository update complete!"
echo "=========================================="

# Exit with error if any services failed
if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    exit 1
fi

exit 0