#!/bin/sh
# start.sh — Generate runtime env config, then serve the built frontend.
# This runs at Railway container startup so VITE_API_URL is always current.

if [ -n "$VITE_API_PROXY_UPSTREAM_URL" ]; then
  API_PROXY_UPSTREAM="$VITE_API_PROXY_UPSTREAM_URL"
elif [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  API_PROXY_UPSTREAM="https://${RAILWAY_PUBLIC_DOMAIN}"
else
  API_PROXY_UPSTREAM="https://qwickly-production.up.railway.app"
fi

case "$API_PROXY_UPSTREAM" in
  http://*|https://*) ;;
  *) API_PROXY_UPSTREAM="https://${API_PROXY_UPSTREAM}" ;;
esac

echo "==> Generating runtime env-config.js"
echo "    VITE_API_URL = (relative same-origin)"
echo "    VITE_API_PROXY_UPSTREAM_URL = ${API_PROXY_UPSTREAM}"

cat > dist/public/env-config.js << ENVEOF
// Auto-generated at container startup by start.sh
window.__ENV__ = {
  "VITE_API_URL": "",
  "VITE_API_PROXY_UPSTREAM_URL": "${API_PROXY_UPSTREAM}",
  "VITE_SUPABASE_URL": "${VITE_SUPABASE_URL:-https://kzfixfcatknkkqttnvvi.supabase.co}",
  "VITE_SUPABASE_ANON_KEY": "${VITE_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6Zml4ZmNhdGtua2txdHRudnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODQ5MDYsImV4cCI6MjA5Njc2MDkwNn0.NFJOSWvOstCMEgQw0BBD1IV4kZLrfdoKO2RY3Qi6g8w}"
};
ENVEOF

echo "==> Starting Express SPA server on port ${PORT:-3000}"
exec node server.js
