#!/bin/bash

DIR_SOURCE=/var/amarki/repository/microIntelligence/
DIR_TARGET=/var/www/microIntelligence/

if [[ $EUID -ne 0 ]]; then
	   echo "This script must be run as root"
	      exit 1
fi

# Navigate to the source directory
cd ${DIR_SOURCE}
echo "Pulling Latest Master Branch"

# Stash any local changes to avoid conflicts
sudo -u www-data git restore package-lock.json

# Fetch and pull the latest changes from the master branch
sudo -u www-data git fetch
sudo -u www-data git checkout "master"
sudo -u www-data git pull

# Install Node.js dependencies
echo "Installing Node.js Packages"
sudo -u www-data npm install

# Sync files to the target directory
echo "Syncing Files"
sudo -u www-data rsync --progress -rt --del --exclude-from="/var/amarki/exclude-micro" ${DIR_SOURCE} ${DIR_TARGET}

# Set correct users, groups, and permissions
echo "Setting Users, Groups, and Permissions"
chown www-data:www-data -R ${DIR_TARGET}

# If you have any database migrations or other setup tasks, include them here
# Example: Database migrations
echo "Running Database Migrations"
sudo -u www-data npx sequelize db:migrate --env production


# Restart the Node.js application using pm2
echo "MAKE SURE YOU RESTART THE APPLICATION WITH PM2"
#sudo -u www-data pm2 restart "micro-intelligence"

# If pm2 isn't used to start the app, you can simply use npm start
# echo "Starting Application"
# sudo -u www-data npm start &

echo "Deployment Completed Successfully"

