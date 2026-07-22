#!/bin/sh
# start.sh — Generate runtime env config, then serve the built frontend.
# This runs at Railway container startup so VITE_API_URL is always current.

if [ -n "$VITE_API_URL" ]; then
  API_URL="$VITE_API_URL"
elif [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  API_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
else
  API_URL="https://qwickly-production.up.railway.app"
fi

case "$API_URL" in
  http://*|https://*) ;;
  *) API_URL="https://${API_URL}" ;;
esac

echo "==> Generating runtime env-config.js"
echo "    VITE_API_URL = ${API_URL}"

cat > dist/public/env-config.js << ENVEOF
// Auto-generated at container startup by start.sh
window.__ENV__ = {
  "VITE_API_URL": "${API_URL}",
  "VITE_SUPABASE_URL": "${VITE_SUPABASE_URL:-}",
  "VITE_SUPABASE_ANON_KEY": "${VITE_SUPABASE_ANON_KEY:-}"
};
ENVEOF

echo "==> Starting Express SPA server on port ${PORT:-3000}"
exec node server.js
