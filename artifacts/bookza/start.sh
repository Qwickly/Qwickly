#!/bin/sh
# start.sh — Generate runtime env config, then serve the built frontend.
# This runs at Railway container startup so VITE_API_URL is always current.

API_URL="${VITE_API_URL:-}"

echo "==> Generating runtime env-config.js"
echo "    VITE_API_URL = ${API_URL}"

cat > dist/public/env-config.js << ENVEOF
// Auto-generated at container startup by start.sh
window.__ENV__ = { "VITE_API_URL": "${API_URL}" };
ENVEOF

echo "==> Starting custom server on port ${PORT:-3000}"
exec node server.js
