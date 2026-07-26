#!/usr/bin/env bash
# H Evidence SLR — VPS setup script
# Run as a non-root user with sudo privileges on Ubuntu 22.04 (ARM or x86)
# Usage: fill in the four variables below, then: bash vps-setup.sh
set -euo pipefail

# ── CONFIGURE THESE BEFORE RUNNING ──────────────────────────────────────────
DUCKDNS_SUBDOMAIN=""        # e.g. h-evidence-ollama  (no .duckdns.org)
DUCKDNS_TOKEN=""            # from duckdns.org dashboard
OLLAMA_SECRET=""            # pick any strong random string, e.g.: openssl rand -hex 32
# ────────────────────────────────────────────────────────────────────────────

if [[ -z "$DUCKDNS_SUBDOMAIN" || -z "$DUCKDNS_TOKEN" || -z "$OLLAMA_SECRET" ]]; then
  echo "ERROR: fill in DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN, and OLLAMA_SECRET at the top of this script."
  exit 1
fi

DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"

echo "==> [1/8] System update"
sudo apt-get update -q && sudo apt-get upgrade -y -q

echo "==> [2/8] Open port 443 in OS firewall (Oracle Cloud adds iptables rules by default)"
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 80  -j ACCEPT
# Persist across reboots
sudo apt-get install -y -q iptables-persistent
sudo netfilter-persistent save

echo "==> [3/8] Install Ollama"
curl -fsSL https://ollama.com/install.sh | sh

echo "==> [3b] Configure Ollama to listen on localhost only (Caddy will proxy)"
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << 'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
EOF
sudo systemctl daemon-reload
sudo systemctl restart ollama
sudo systemctl enable ollama

echo "==> [4/8] Pull qwen2.5:14b (~9 GB, allow 10-15 min)"
ollama pull qwen2.5:14b
echo "Pull complete. Verifying..."
curl -sf http://localhost:11434/v1/models | python3 -c "import sys,json; models=json.load(sys.stdin).get('data',[]); [print('  model:', m['id']) for m in models]"

echo "==> [5/8] Set up DuckDNS auto-update"
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh << DUCKEOF
#!/bin/bash
curl -sf "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" > ~/duckdns/duck.log 2>&1
DUCKEOF
chmod +x ~/duckdns/duck.sh
~/duckdns/duck.sh
cat ~/duckdns/duck.log   # should print "OK"
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh") | crontab -
echo "DuckDNS cron registered (updates IP every 5 min)"

echo "==> [6/8] Install Caddy"
sudo apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -q && sudo apt-get install -y -q caddy

echo "==> [7/8] Write Caddyfile (HTTPS reverse proxy with secret-header auth)"
sudo tee /etc/caddy/Caddyfile > /dev/null << CADDYEOF
${DOMAIN} {
    @authorized {
        header X-Ollama-Secret ${OLLAMA_SECRET}
    }
    handle @authorized {
        reverse_proxy localhost:11434
    }
    handle {
        respond "Unauthorized" 401
    }
}
CADDYEOF

sudo systemctl restart caddy
sudo systemctl enable caddy
sleep 3
sudo systemctl is-active caddy && echo "Caddy: running" || echo "ERROR: Caddy failed — run: sudo journalctl -u caddy -n 50"

echo "==> [8/8] End-to-end verification"
echo "Waiting 15s for Let's Encrypt certificate..."
sleep 15
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
  -H "X-Ollama-Secret: ${OLLAMA_SECRET}" \
  "https://${DOMAIN}/v1/models" || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  echo ""
  echo "✓ VPS setup complete!"
  echo ""
  echo "Add these to Vercel environment variables:"
  echo "  OLLAMA_BASE_URL = https://${DOMAIN}"
  echo "  OLLAMA_SECRET   = ${OLLAMA_SECRET}"
  echo ""
  echo "Then redeploy on Vercel."
else
  echo ""
  echo "WARNING: verification returned HTTP $HTTP_CODE (expected 200)"
  echo "Check: sudo journalctl -u caddy -n 30"
  echo "Check: sudo journalctl -u ollama -n 30"
  echo ""
  echo "When resolved, your env vars will be:"
  echo "  OLLAMA_BASE_URL = https://${DOMAIN}"
  echo "  OLLAMA_SECRET   = ${OLLAMA_SECRET}"
fi
