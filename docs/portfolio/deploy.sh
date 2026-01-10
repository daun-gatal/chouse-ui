#!/bin/bash

# Build and deploy script for GitHub Pages

set -e

echo "🔨 Building portfolio site..."
bun run build

echo "📦 Copying files to docs/dist folder..."
cp -r dist/* ../

echo "✅ Deployment files ready!"
echo "📝 Next steps:"
echo "   1. Review the changes in ../"
echo "   2. git add ../"
echo "   3. git commit -m 'Update portfolio site'"
echo "   4. git push"
