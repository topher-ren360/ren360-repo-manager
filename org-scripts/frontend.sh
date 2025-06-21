#!/bin/bash

DIR_SOURCE=/var/amarki/repository/microFrontend/
DIR_TARGET=/var/www/microFrontend/

if [[ $EUID -ne 0 ]]; then
   echo "this script must be run as root"
   exit 1
fi

echo "Stopping Workers"
supervisorctl stop all

cd ${DIR_SOURCE}
echo "Pulling Last Master Branch"
sudo -u www-data git fetch
sudo -u www-data git checkout "master"
sudo -u www-data git pull

echo "Updating Composer Packages"
sudo -uwww-data /usr/bin/php8.2 /usr/local/bin/composer26 install

cd ${DIR_TARGET}
echo "Syncing Files"
sudo -uwww-data rsync --progress -rt --del --exclude-from="/var/amarki/exclude" ${DIR_SOURCE} ${DIR_TARGET}

# TODO add production asset building here

echo "Setting Users, Groups and Permissions"
chown www-data:www-data -R ${DIR_TARGET}

# note, frontend does not have database/migration, but we can still clear optimize cache
sudo -uwww-data /usr/bin/php8.2 artisan optimize:clear

echo "Starting Workers"
supervisorctl reread
supervisorctl start all
