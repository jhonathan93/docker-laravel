
#!/bin/bash
cd /home/jhonathan/projetos/docker-laravel/src

echo "Puxando atualizações..."
sudo -u jhonathan git pull origin main

echo "Instalando dependências do Composer..."
docker exec docker-laravel-app-1 bash -c "composer install --no-dev --optimize-autoloader"

echo "Rodando migrations..."
docker exec docker-laravel-app-1 bash -c "php artisan migrate --force"

echo "Compilando assets..."
docker exec docker-laravel-app-1 bash -c "npm install && npm run build"

echo "Limpando e otimizando cache..."
docker exec docker-laravel-app-1 bash -c "cache_laravel.sh"

echo "Ajustando permissões..."
docker exec docker-laravel-app-1 bash -c "chown -R www-data:www-data /var/www/html && chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache"

echo "Deploy concluído!"