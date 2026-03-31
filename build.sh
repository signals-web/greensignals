#!/bin/sh
# Generate env.js from Vercel environment variables
# This runs as the Vercel build command to inject secrets at deploy time

cat > env.js << EOF
window.__ENV__ = {
  MAPTILER_KEY: "${MAPTILER_KEY}",
  SHEETS_API_KEY: "${SHEETS_API_KEY}",
  FIREBASE_CONFIG: {
    apiKey: "${FIREBASE_API_KEY}",
    authDomain: "${FIREBASE_AUTH_DOMAIN}",
    databaseURL: "${FIREBASE_DATABASE_URL}",
    projectId: "${FIREBASE_PROJECT_ID}",
    storageBucket: "${FIREBASE_STORAGE_BUCKET}",
    messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID}",
    appId: "${FIREBASE_APP_ID}",
    measurementId: "${FIREBASE_MEASUREMENT_ID}"
  }
};
EOF

echo "✓ env.js generated from environment variables"
