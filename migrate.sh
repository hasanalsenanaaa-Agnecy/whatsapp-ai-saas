#!/bin/bash

echo "🚀 Starting project restructure..."

# 1. Create archive folder
mkdir -p _archive/api
mkdir -p _archive/routes
mkdir -p _archive/security
mkdir -p _archive/database
mkdir -p _archive/tools
mkdir -p _archive/portal
mkdir -p _archive/docs
mkdir -p _archive/services

# 2. Move unused files to archive
echo "📦 Moving unused files to archive..."

mv src/api/* _archive/api/ 2>/dev/null
[ -d "src/routes" ] && mv src/routes/* _archive/routes/ 2>/dev/null
[ -d "src/security" ] && mv src/security/* _archive/security/ 2>/dev/null
[ -d "src/database" ] && mv src/database/* _archive/database/ 2>/dev/null
[ -d "src/tools" ] && mv src/tools/* _archive/tools/ 2>/dev/null
[ -d "portal" ] && mv portal/* _archive/portal/ 2>/dev/null
[ -f "src/services/knowledge.ts" ] && mv src/services/knowledge.ts _archive/services/

mv PHASE_*.md _archive/docs/ 2>/dev/null
mv UPGRADE.md _archive/docs/ 2>/dev/null
mv ACTIVATE_CLIENT.md _archive/docs/ 2>/dev/null
mv allfiles.txt _archive/docs/ 2>/dev/null
mv FETCH_HEAD _archive/docs/ 2>/dev/null

# 3. Backup current files
cp src/index.ts _archive/index.ts.backup 2>/dev/null
cp src/conversation.ts _archive/conversation.ts.backup 2>/dev/null
cp src/messages.ts _archive/messages.ts.backup 2>/dev/null
cp src/services/whatsapp.ts _archive/services/whatsapp.ts.backup 2>/dev/null
cp src/services/database.ts _archive/services/database.ts.backup 2>/dev/null
cp src/services/googleSheets.ts _archive/services/googleSheets.ts.backup 2>/dev/null

# 4. Clean up empty folders
rmdir src/api src/routes src/security src/database src/tools portal 2>/dev/null

echo "✅ Done! Old files moved to _archive/"
