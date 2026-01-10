# GitHub Pages Portfolio Site

This directory contains the React-based portfolio site for ClickHouse Studio.

> **Note**: The repository is private. Users can test ClickHouse Studio by pulling the Docker image from Docker Hub.

## Structure

```
docs/
├── portfolio/          # React portfolio app source
│   ├── src/            # React components
│   ├── public/         # Static assets
│   └── package.json    # Dependencies
└── dist/               # Built files (generated, deployed to GitHub Pages)
```

## Development

```bash
cd portfolio
bun install
bun run dev
```

Visit `http://localhost:5173`

## Build & Deploy

```bash
cd portfolio
bun run build
./deploy.sh
```

This will:
1. Build the React app
2. Copy files to `../dist/` (which GitHub Pages serves from `/docs`)

## GitHub Pages Setup

1. **Build the site**:
   ```bash
   cd portfolio
   bun run build
   ./deploy.sh
   ```

2. **Enable GitHub Pages**:
   - Go to repository Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` (or your default branch)
   - Folder: `/docs`
   - Click "Save"

3. **Access Your Site**:
   - `https://<username>.github.io/clickhouse-studio/`

## Docker Hub

The application is available on Docker Hub:
- **Image**: `daun-gatal/clickhouse-studio:latest`
- **Docker Hub**: https://hub.docker.com/r/daun-gatal/clickhouse-studio

Users can pull and run the image directly:
```bash
docker pull daun-gatal/clickhouse-studio:latest
docker run -d -p 5521:5521 daun-gatal/clickhouse-studio:latest
```

## Features

- ✨ React + Vite for fast development
- 🎨 Glassmorphism design matching the app
- 🎭 Framer Motion animations
- 📱 Fully responsive
- ⚡ Optimized performance
- 🎯 Interactive components

## Notes

- The `.nojekyll` file in the root `docs/` folder is required for GitHub Pages
- Logo is served from `/logo.svg` (copied to public folder during build)
- All external links open in new tabs
