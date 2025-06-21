#!/bin/bash

if [[ $EUID -ne 0 ]]; then
   echo "this script must be run as root"
   exit 1
fi

echo "Stopping Workers"
supervisorctl stop all

echo "microUsers"
cd /var/www/microUsers/
sudo -u www-data php artisan migrate:fresh --seed
sudo -u www-data php artisan passport:install --force
cd /var/www/microUsers/storage/
sudo -uwww-data cp oauth-public.key ../../microAds/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microAds/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microContacts/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microContacts/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microEmails/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microEmails/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microFrontend/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microFrontend/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microImages/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microImages/storage/oauth-private.key
sudo -uwww-data cp oauth-private.key ../../microPayments/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microPayments/storage/oauth-public.key
sudo -uwww-data cp oauth-public.key ../../microProducts/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microProducts/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microSms/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microSms/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microSocial/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microSocial/storage/oauth-private.key
sudo -uwww-data cp oauth-public.key ../../microTemplates/storage/oauth-public.key
sudo -uwww-data cp oauth-private.key ../../microTemplates/storage/oauth-private.key

echo "microAds"
cd /var/www/microAds/
sudo -u www-data php artisan migrate:fresh --seed

echo "microContacts"
cd /var/www/microAds/
sudo -u www-data php artisan migrate:fresh --seed

echo "microEmails"
cd /var/www/microEmails/
sudo -u www-data php artisan migrate:fresh --seed

echo "microImages"
cd /var/www/microImages/
sudo -u www-data php artisan migrate:fresh --seed

echo "microPayments"
cd /var/www/microPayments/
sudo -u www-data php artisan migrate:fresh --seed

echo "microProducts"
cd /var/www/microProducts/
sudo -u www-data php artisan migrate:fresh --seed

echo "microSms"
cd /var/www/microSms/
sudo -u www-data php artisan migrate:fresh --seed

echo "microSocial"
cd /var/www/microSocial/
sudo -u www-data php artisan migrate:fresh --seed

echo "microTemplates"
cd /var/www/microTemplates/
sudo -u www-data php artisan migrate:fresh --seed

echo "Starting Workers"
supervisorctl reread
supervisorctl start all
