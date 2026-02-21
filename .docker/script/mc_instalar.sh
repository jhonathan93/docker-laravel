#!/bin/bash

# shellcheck disable=SC2162
. /usr/local/bin/core.sh

set -e

MC_INSTALL_PATH="/usr/local/bin/mc"

function detect_architecture() {
  ARCH=$(uname -m)

  case "$ARCH" in
    x86_64)
      MC_URL="https://dl.min.io/client/mc/release/linux-amd64/mc"
      ;;
    aarch64|arm64)
      MC_URL="https://dl.min.io/client/mc/release/linux-arm64/mc"
      ;;
    *)
      print_message "$RED" "${EMOJI_FAIL} Arquitetura não suportada: $ARCH"
      exit 1
      ;;
  esac
}

function install_mc() {

  if command -v mc >/dev/null 2>&1; then
    print_message "$YELLOW" "${EMOJI_WARNING} MinIO Client já está instalado. Pulando instalação..."
    mc --version
    return
  fi

  print_message "$GREEN" "${EMOJI_ARROW} Detectando arquitetura do sistema..."
  detect_architecture

  print_message "$GREEN" "${EMOJI_HOURGLASS} Baixando MinIO Client..."
  curl -fsSL "$MC_URL" -o mc

  print_message "$GREEN" "${EMOJI_ARROW} Aplicando permissão de execução..."
  chmod +x mc

  print_message "$GREEN" "${EMOJI_ARROW} Movendo binário para ${MC_INSTALL_PATH}..."
  sudo mv mc "$MC_INSTALL_PATH"

  print_message "$GREEN" "${EMOJI_OK} MinIO Client instalado com sucesso!"
  mc --version
}

function configure_alias() {

  read -p "$(echo -e "\n${GREEN}${EMOJI_ARROW} Deseja configurar um alias agora? [s/N]: ${RESET}")" CONFIG_ALIAS

  if [[ "${CONFIG_ALIAS,,}" != "s" && "${CONFIG_ALIAS,,}" != "sim" ]]; then
    print_message "$YELLOW" "${EMOJI_WARNING} Configuração de alias ignorada."
    return
  fi

  read -p "$(echo -e "\n${GREEN}${EMOJI_ARROW} Nome do alias (ex: local): ${RESET}")" ALIAS_NAME
  read -p "$(echo -e "${GREEN}${EMOJI_ARROW} Endpoint (ex: http://localhost:9000): ${RESET}")" ENDPOINT
  read -p "$(echo -e "${GREEN}${EMOJI_ARROW} Access Key: ${RESET}")" ACCESS_KEY
  read -p "$(echo -e "${GREEN}${EMOJI_ARROW} Secret Key: ${RESET}")" SECRET_KEY

  print_message "$GREEN" "${EMOJI_HOURGLASS} Configurando alias ${ALIAS_NAME}..."
  mc alias set "$ALIAS_NAME" "$ENDPOINT" "$ACCESS_KEY" "$SECRET_KEY"

  print_message "$GREEN" "${EMOJI_OK} Alias configurado com sucesso!"
  mc alias list
}

function create_bucket() {

  read -p "$(echo -e "\n${GREEN}${EMOJI_ARROW} Deseja criar um bucket agora? [s/N]: ${RESET}")" CREATE_BUCKET

  if [[ "${CREATE_BUCKET,,}" != "s" && "${CREATE_BUCKET,,}" != "sim" ]]; then
    print_message "$YELLOW" "${EMOJI_WARNING} Criação de bucket ignorada."
    return
  fi

  read -p "$(echo -e "${GREEN}${EMOJI_ARROW} Informe o alias configurado: ${RESET}")" ALIAS_NAME
  read -p "$(echo -e "${GREEN}${EMOJI_ARROW} Nome do bucket: ${RESET}")" BUCKET_NAME

  if mc ls "${ALIAS_NAME}/${BUCKET_NAME}" >/dev/null 2>&1; then
    print_message "$YELLOW" "${EMOJI_WARNING} Bucket já existe. Pulando criação..."
  else
    print_message "$GREEN" "${EMOJI_HOURGLASS} Criando bucket ${BUCKET_NAME}..."
    mc mb "${ALIAS_NAME}/${BUCKET_NAME}"
    print_message "$GREEN" "${EMOJI_OK} Bucket criado com sucesso!"
  fi

  read -p "$(echo -e "${GREEN}${EMOJI_ARROW} Deseja tornar o bucket público? [s/N]: ${RESET}")" MAKE_PUBLIC

  if [[ "${MAKE_PUBLIC,,}" == "s" || "${MAKE_PUBLIC,,}" == "sim" ]]; then
    print_message "$GREEN" "${EMOJI_HOURGLASS} Aplicando política pública..."
    mc anonymous set public "${ALIAS_NAME}/${BUCKET_NAME}"
    print_message "$GREEN" "${EMOJI_OK} Bucket agora é público!"
  fi
}

print_message "$BLUE" "Instalador do MinIO Client (mc)"
print_message "$BLUE" "----------------------------------"

install_mc
configure_alias
create_bucket

print_message "$GREEN" "${EMOJI_OK} Processo concluído com sucesso!"

. /usr/local/bin/signature.sh

exec "$@"