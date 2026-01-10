# ClickHouse Studio Portfolio Site

A beautiful, interactive React-based portfolio site showcasing ClickHouse Studio.

## Development

```bash
# Install dependencies
bun install
# or
npm install

# Start development server
bun run dev
# or
npm run dev
```

Visit `http://localhost:5173`

## Build for GitHub Pages

```bash
# Build the site
bun run build
# or
npm run build

# The built files will be in ../dist/
# Copy them to the docs folder root for GitHub Pages
cp -r dist/* ../

# Or use the deploy script
./deploy.sh
```

## GitHub Pages Setup

1. Build the site: `bun run build`
2. Copy `dist/*` to `docs/` folder root
3. Commit and push
4. GitHub Pages will automatically deploy from the `/docs` folder

## Features

- ✨ React + Vite for fast development
- 🎨 Glassmorphism design matching the app
- 🎭 Framer Motion animations
- 📱 Fully responsive
- ⚡ Optimized performance
- 🎯 Interactive components
