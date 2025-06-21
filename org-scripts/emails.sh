#!/bin/bash

DIR_SOURCE=/var/amarki/repository/microEmails/
DIR_TARGET=/var/www/microEmails/

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
sudo -uwww-data rsync --progress -rt --del --exclude-from="/var/amarki/exclude-micro" ${DIR_SOURCE} ${DIR_TARGET}

echo "Setting Users, Groups and Permissions"
chown www-data:www-data -R ${DIR_TARGET}

echo "Database Update"
cd ${DIR_TARGET}
sudo -uwww-data /usr/bin/php8.2 artisan migrate

echo "Starting Workers"
supervisorctl reread
supervisorctl start all
