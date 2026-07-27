#!/usr/bin/env bash
# Install GARIL backend API on a Debian/Ubuntu VPS (API only — no Next UI).
#
# Monorepo:
#   sudo bash deploy/backend/setup-vps.sh [/var/www/garil-ai]
#
# Standalone clone (garila-backend):
#   sudo bash setup-vps.sh [/var/www/garila-backend]
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
	echo "Run as root: sudo bash setup-vps.sh [APP_DIR]" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# deploy/backend → monorepo root; or script at standalone repo root
if [[ -f "$SCRIPT_DIR/../backend/package.json" ]]; then
	REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
	LAYOUT=monorepo
	DEFAULT_APP_DIR="/var/www/garil-ai"
elif [[ -f "$SCRIPT_DIR/package.json" && -d "$SCRIPT_DIR/src" ]]; then
	REPO_ROOT="$SCRIPT_DIR"
	LAYOUT=standalone
	DEFAULT_APP_DIR="/var/www/garila-backend"
else
	echo "Cannot detect backend layout from $SCRIPT_DIR" >&2
	exit 1
fi

APP_DIR="${1:-$DEFAULT_APP_DIR}"
SERVICE_USER="${GARIL_SERVICE_USER:-www-data}"
SERVICE_NAME="garil-backend"

echo "==> Layout:      $LAYOUT"
echo "==> App directory: $APP_DIR"
echo "==> Source:        $REPO_ROOT"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx

need_node=0
if ! command -v node >/dev/null 2>&1; then
	need_node=1
else
	major="$(node -v | sed 's/^v//' | cut -d. -f1)"
	if [[ "$major" -lt 20 || "$major" -ge 26 ]]; then
		need_node=1
	fi
fi

if [[ "$need_node" -eq 1 ]]; then
	echo "==> Installing Node.js 22.x"
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	apt-get install -y nodejs
fi

echo "==> Node $(node -v) / npm $(npm -v)"

if [[ "$REPO_ROOT" != "$APP_DIR" ]]; then
	echo "==> Syncing project to $APP_DIR"
	mkdir -p "$APP_DIR"
	if [[ "$LAYOUT" == "monorepo" ]]; then
		rsync -a --delete \
			--exclude node_modules \
			--exclude backend/node_modules \
			--exclude .git \
			--exclude .env \
			--exclude backend/.env \
			--exclude .next \
			--exclude out \
			"$REPO_ROOT/" "$APP_DIR/"
	else
		rsync -a --delete \
			--exclude node_modules \
			--exclude dist \
			--exclude .git \
			--exclude .env \
			--exclude backups \
			"$REPO_ROOT/" "$APP_DIR/"
	fi
fi

if [[ "$LAYOUT" == "monorepo" ]]; then
	BACKEND_DIR="$APP_DIR/backend"
	ENV_EXAMPLE_CANDIDATES=(
		"$APP_DIR/deploy/backend/.env.example"
		"$APP_DIR/backend/.env.example"
		"$APP_DIR/.env.example"
	)
	BUILD_CMD=(bash "$APP_DIR/deploy/backend/build.sh")
	UNIT_SRC="$APP_DIR/deploy/backend/garil-backend.service"
	NGINX_SRC="$APP_DIR/deploy/backend/nginx.conf"
	WORKDIR_LINE="WorkingDirectory=$BACKEND_DIR"
	ENV_FILE_LINE="EnvironmentFile=-$BACKEND_DIR/.env"
	EXEC_START="ExecStart=$(command -v node) dist/index.js"
	RW_PATHS="ReadWritePaths=$BACKEND_DIR/backups"
else
	BACKEND_DIR="$APP_DIR"
	ENV_EXAMPLE_CANDIDATES=(
		"$APP_DIR/.env.example"
	)
	BUILD_CMD=(bash -lc "cd \"$APP_DIR\" && if [[ -f package-lock.json ]]; then npm ci; else npm install; fi && npx tsc -p tsconfig.json && test -f dist/index.js")
	UNIT_SRC="$APP_DIR/garil-backend.service"
	NGINX_SRC="$APP_DIR/nginx.conf"
	WORKDIR_LINE="WorkingDirectory=$BACKEND_DIR"
	ENV_FILE_LINE="EnvironmentFile=-$BACKEND_DIR/.env"
	EXEC_START="ExecStart=$(command -v node) dist/index.js"
	RW_PATHS="ReadWritePaths=$BACKEND_DIR/backups"
fi

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
	for example in "${ENV_EXAMPLE_CANDIDATES[@]}"; do
		if [[ -f "$example" ]]; then
			cp "$example" "$BACKEND_DIR/.env"
			echo "Created $BACKEND_DIR/.env from $(basename "$example") — edit secrets before starting."
			break
		fi
	done
	if [[ ! -f "$BACKEND_DIR/.env" && -f "$APP_DIR/.env" ]]; then
		cp "$APP_DIR/.env" "$BACKEND_DIR/.env"
	fi
fi

echo "==> Building backend"
if [[ "$LAYOUT" == "monorepo" ]]; then
	(cd "$APP_DIR" && bash deploy/backend/build.sh)
else
	(
		cd "$APP_DIR"
		if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
		npx tsc -p tsconfig.json
		test -f dist/index.js
	)
fi

mkdir -p "$BACKEND_DIR/backups"

echo "==> Installing systemd unit ($SERVICE_NAME)"
if [[ -f "$UNIT_SRC" ]]; then
	# Rewrite common placeholders to this install path
	sed \
		-e "s|/var/www/garil-ai/backend|$BACKEND_DIR|g" \
		-e "s|/var/www/garila-backend|$BACKEND_DIR|g" \
		-e "s|/var/www/garil-ai|$APP_DIR|g" \
		"$UNIT_SRC" >"/etc/systemd/system/${SERVICE_NAME}.service"
else
	cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=GARIL AI backend API (Fastify)
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
${WORKDIR_LINE}
Environment=NODE_ENV=production
${ENV_FILE_LINE}
${EXEC_START}
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
${RW_PATHS}

[Install]
WantedBy=multi-user.target
EOF
fi

# Ensure ExecStart uses the installed node binary
sed -i "s|^ExecStart=.*|${EXEC_START}|" "/etc/systemd/system/${SERVICE_NAME}.service"
# Ensure WorkingDirectory / EnvironmentFile / ReadWritePaths match install
sed -i "s|^WorkingDirectory=.*|${WORKDIR_LINE}|" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s|^EnvironmentFile=-.*backend/.env|${ENV_FILE_LINE}|" "/etc/systemd/system/${SERVICE_NAME}.service" || true
grep -q '^EnvironmentFile=' "/etc/systemd/system/${SERVICE_NAME}.service" \
	|| sed -i "/^Environment=NODE_ENV/a ${ENV_FILE_LINE}" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s|^ReadWritePaths=.*|${RW_PATHS}|" "/etc/systemd/system/${SERVICE_NAME}.service"

id "$SERVICE_USER" >/dev/null 2>&1 || SERVICE_USER=root
if [[ "$SERVICE_USER" != "root" ]]; then
	# Fix User= in unit if we fell back earlier — keep file's User unless missing
	:
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
mkdir -p "$BACKEND_DIR/backups"
chown -R "$SERVICE_USER:$SERVICE_USER" "$BACKEND_DIR/backups"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

echo "==> Installing nginx site"
if [[ -f "$NGINX_SRC" ]]; then
	cp "$NGINX_SRC" /etc/nginx/sites-available/garil-backend
else
	cat >/etc/nginx/sites-available/garil-backend <<'EOF'
upstream garil_backend {
	server 127.0.0.1:3141;
	keepalive 32;
}

server {
	listen 80;
	listen [::]:80;
	server_name API_DOMAIN;

	client_max_body_size 50m;
	proxy_connect_timeout 60s;
	proxy_send_timeout 300s;
	proxy_read_timeout 300s;

	location /api/ {
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header Connection "";
		proxy_pass http://garil_backend;
	}

	location /ws {
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 3600s;
		proxy_send_timeout 3600s;
		proxy_pass http://garil_backend;
	}

	location / {
		return 404 '{"error":"API only — use /api or /ws"}';
		add_header Content-Type application/json;
	}
}
EOF
fi
ln -sfn /etc/nginx/sites-available/garil-backend /etc/nginx/sites-enabled/garil-backend
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo "==> Setup complete. Next steps:"
echo "    1. Edit secrets:  nano $BACKEND_DIR/.env"
echo "       Required: OPENROUTER_API_KEY, AUTH_SECRET, MONGODB_URI"
echo "    2. Edit domain:   nano /etc/nginx/sites-available/garil-backend"
echo "       Replace API_DOMAIN with your API host"
echo "    3. Start API:     systemctl start $SERVICE_NAME"
echo "    4. HTTPS:         certbot --nginx -d api.your.domain"
echo "    5. Health check:  curl -s http://127.0.0.1:3141/api/health"
echo ""
