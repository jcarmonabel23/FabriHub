#!/bin/sh
# =====================================================================
#  FabriHub · preparación del servidor (Oracle Cloud, Ubuntu 24.04 ARM). Se corre UNA vez:
#    curl -fsSL https://raw.githubusercontent.com/jcarmonabel23/FabriHub/JCA/initial_dev/scripts/deploy/setup-server.sh | sh
#  o, si ya clonó el repositorio:   sh scripts/deploy/setup-server.sh
#
#  1. Actualiza el sistema e instala Docker (repositorio oficial) y git.
#  2. Abre 80/443 en el firewall de Ubuntu: las imágenes de Oracle traen iptables que rechazan todo
#     menos el SSH (además hay que abrirlos en la Security List de la consola de Oracle).
#  3. Clona el repositorio en ~/FabriHub.
# =====================================================================
set -e

REPO="https://github.com/jcarmonabel23/FabriHub.git"
BRANCH="${BRANCH:-JCA/initial_dev}"
DIR="$HOME/FabriHub"

echo "▶ Actualizando el sistema…"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo apt-get install -y git curl ca-certificates iptables-persistent

if ! command -v docker >/dev/null 2>&1; then
  echo "▶ Instalando Docker…"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

echo "▶ Abriendo 80/443 en iptables…"
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  # shellcheck disable=SC2086
  sudo iptables -C INPUT $rule -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 $rule -j ACCEPT
done
sudo netfilter-persistent save

if [ ! -d "$DIR/.git" ]; then
  echo "▶ Clonando $REPO ($BRANCH)…"
  git clone --branch "$BRANCH" "$REPO" "$DIR"
fi

echo
echo "✔ Servidor listo. Siguiente paso:"
echo "   1. Cierre la sesión SSH y vuelva a entrar (para usar docker sin sudo)."
echo "   2. cd ~/FabriHub && cp .env.production.example .env.production && nano .env.production"
echo "   3. sh scripts/deploy/deploy.sh"
