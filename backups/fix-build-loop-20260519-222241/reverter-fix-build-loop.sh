#!/usr/bin/env bash
set -Eeuo pipefail
cd "/home/ubuntu/projetos/RAFACAR-DEV2"
cp "backups/fix-build-loop-20260519-222241/main.jsx.bak" src/main.jsx
cp "backups/fix-build-loop-20260519-222241/styles.css.bak" src/styles.css
npm run build
git add src/main.jsx src/styles.css
git commit -m "Reverte correção automática de build" || true
git push -u origin main
echo "✅ Reversão concluída"
