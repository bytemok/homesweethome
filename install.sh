#!/usr/bin/env bash
# ============================================================================
#  Instalador del Portal de Proveedores – Todo en Muebles
#  Debe ejecutarse DESDE ADENTRO del repo ya clonado. Ej:
#     cd /opt/portal-proveedores && DOMAIN=tudominio.com EMAIL=tu@mail.com bash install.sh
#  Variables opcionales: DOMAIN, EMAIL, APPDIR, PORT
# ============================================================================
set -euo pipefail

APPDIR="${APPDIR:-$(pwd)}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
PORT="${PORT:-3000}"

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

echo "==> [1/6] Dependencias del sistema (Node 22, git, nginx, certbot)..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
fi
$SUDO apt-get update -y
$SUDO apt-get install -y nodejs git nginx certbot python3-certbot-nginx
$SUDO npm install -g pm2

echo "==> [2/6] Dependencias de la aplicación..."
cd "$APPDIR"
npm install --omit=dev

echo "==> [3/6] Configuración (.env con clave secreta aleatoria)..."
if [ ! -f .env ]; then
  cp .env.example .env
  JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" .env
  echo "    .env creado con JWT_SECRET seguro."
else
  echo "    .env ya existe, se respeta."
fi

echo "==> [4/6] Datos de prueba (solo la primera vez)..."
if [ -f data/portal.db ]; then echo "    Base ya existente, no se toca."; else npm run seed; fi

echo "==> [5/6] Arrancando la app con pm2..."
pm2 delete portal >/dev/null 2>&1 || true
pm2 start server/index.js --name portal
pm2 save
PM2_USER="${SUDO_USER:-$(id -un)}"
PM2_HOME=$(eval echo "~$PM2_USER")
$SUDO env PATH="$PATH" pm2 startup systemd -u "$PM2_USER" --hp "$PM2_HOME" 2>/dev/null | grep -E '^sudo ' | bash || true

if [ -n "$DOMAIN" ]; then
  echo "==> [6/6] Nginx + HTTPS para $DOMAIN..."
  $SUDO tee /etc/nginx/sites-available/portal >/dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    client_max_body_size 20M;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  $SUDO ln -sf /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/portal
  $SUDO rm -f /etc/nginx/sites-enabled/default
  $SUDO nginx -t && $SUDO systemctl reload nginx
  if [ -n "$EMAIL" ]; then
    $SUDO certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
      || echo "    (!) certbot no pudo emitir el certificado. Revisá que el DNS de $DOMAIN apunte a este servidor. La app queda igual en http://"
  fi
else
  echo "==> [6/6] Sin DOMAIN: se omite nginx/HTTPS. La app queda en el puerto $PORT."
fi

echo ""
echo "======================================================================"
echo "  ✔ LISTO"
if [ -n "$DOMAIN" ]; then echo "     -> https://$DOMAIN"; else echo "     -> http://<IP-del-servidor>:$PORT"; fi
echo "     Usuarios de prueba:"
echo "       admin / admin123   ·   sur / proveedor123   ·   deposito / deposito123"
echo "     IMPORTANTE: entrá como admin y cambiá las contraseñas."
echo "======================================================================"
