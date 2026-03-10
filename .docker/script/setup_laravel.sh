#!/bin/bash

# shellcheck disable=SC2162
. /usr/local/bin/core.sh

function install_new_laravel() {
  print_message "$GREEN" "${EMOJI_ARROW} Instalando o Laravel versão 12..."
  composer create-project laravel/laravel=12.* . --prefer-dist

  print_message "$GREEN" "${EMOJI_HOURGLASS} Copiando o arquivo .env para o diretório do Laravel..."
  cp /usr/local/bin/.env /var/www/html/.env

  print_message "$GREEN" "${EMOJI_ARROW} Instalando as dependências do Composer..."
  composer install --no-dev --optimize-autoloader
  composer require aws/aws-sdk-php
  composer require league/flysystem-aws-s3-v3
  composer require predis/predis

  print_message "$GREEN" "${EMOJI_HOURGLASS} Gerando chave de aplicativo..."
  php artisan key:generate

  print_message "$GREEN" "${EMOJI_HOURGLASS} Executando as migrações no banco de dados..."
  php artisan migrate --force

  if php artisan list | grep -q 'install:api'; then
    print_message "$GREEN" "${EMOJI_ARROW} Instalando dependências do API do Laravel..."
    php artisan install:api
  else
    print_message "$RED" "${EMOJI_FAIL} Comando 'install:api' não encontrado. Pulando esta etapa..."
  fi

  print_message "$GREEN" "${EMOJI_ARROW} Definindo permissões corretas para o Laravel..."
  chown -R www-data:www-data /var/www/html
  chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache

  npm install
  npm run build

  print_message "$GREEN" "${EMOJI_OK} Configuração concluída com sucesso!"
}

function clone_existing_project() {
  if [ ! -d "/var/www/html/vendor" ]; then
    read -r -p "$(echo -e "\n${GREEN}${EMOJI_ARROW} Por favor, informe a URL do repositório Git: ${RESET}")" REPO_URL

    if ! [[ "${REPO_URL}" =~ ^(https?|git)://[-.a-zA-Z0-9]+/[-.a-zA-Z0-9]+/[-.a-zA-Z0-9]+(.git)?$ || "${REPO_URL}" =~ ^git@[-.a-zA-Z0-9]+:[-.a-zA-Z0-9]+/[-.a-zA-Z0-9]+(.git)?$ ]]; then
      print_message "$RED" "${EMOJI_FAIL} URL do repositório inválida. Formatos esperados:"
      print_message "$RED" "- HTTPS: https://github.com/user/repo.git"
      print_message "$RED" "- SSH: git@github.com:user/repo.git"
      exit 1
    fi

    print_message "$GREEN" "${EMOJI_HOURGLASS} Clonando o repositório ${REPO_URL}..."
    git clone ${REPO_URL} .

    print_message "$GREEN" "${EMOJI_ARROW} Instalando as dependências do Composer..."
    composer install --no-dev --optimize-autoloader
  else
    print_message "$YELLOW" "${EMOJI_WARNING} Pasta vendor já existe, pulando processo de instalação..."
  fi

  read -r -p "$(echo -e "\n${GREEN}${EMOJI_ARROW} Deseja rodar um novo banco de dados [s/N]: ${RESET}")" MIGRATE

  if [[ "${MIGRATE,,}" == "s" || "${MIGRATE,,}" == "sim" ]]; then
    if [ ! -f "/var/www/html/.env" ]; then
      print_message "$RED" "${EMOJI_FAIL} Arquivo .env não encontrado na raiz do projeto!"
      print_message "$YELLOW" "${EMOJI_WARNING} Por favor, configure o arquivo .env antes de executar as migrations."
      exit 1
    fi

    print_message "$GREEN" "${EMOJI_HOURGLASS} Executando as migrações no banco de dados..."
    php artisan migrate --force
  else
    print_message "$YELLOW" "${EMOJI_WARNING} Migrations não executadas - o banco de dados é de responsabilidade do usuário!"
  fi

  print_message "$GREEN" "${EMOJI_ARROW} Definindo permissões corretas para o Laravel..."
  chown -R www-data:www-data /var/www/html
  chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache

  npm install
  npm run build

  print_message "$GREEN" "${EMOJI_OK} Configuração concluída com sucesso!"
}

set -e

print_message "$BLUE" "Escolha uma opção:"
print_message "$BLUE" "1 - Criar um novo projeto Laravel"
print_message "$BLUE" "2 - Clonar um projeto existente"

read -p "Digite sua escolha (1 ou 2): " choice

case $choice in
  1)
    install_new_laravel
    ;;
  2)
    clone_existing_project
    ;;
  *)
    print_message "$RED" "Opção inválida. Por favor, execute novamente e escolha 1 ou 2."
    exit 1
    ;;
esac

. /usr/local/bin/signature.sh

exec "$@"