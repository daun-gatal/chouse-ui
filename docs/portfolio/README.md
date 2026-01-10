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

## Build

```bash
# Build the site
bun run build
# or
npm run build

# The built files will be in ../dist/
```

## Docker Deployment

### Build Docker Image

```bash
docker build -t clickhouse-studio-portfolio:latest .
```

### Run Locally

```bash
docker run -d -p 8080:3000 clickhouse-studio-portfolio:latest
```

Visit `http://localhost:8080`

### Push to GitHub Container Registry

```bash
# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Tag and push
docker tag clickhouse-studio-portfolio:latest ghcr.io/daun-gatal/clickhouse-studio-portfolio:latest
docker push ghcr.io/daun-gatal/clickhouse-studio-portfolio:latest
```

## Kubernetes Deployment

See [k8s/README.md](./k8s/README.md) for detailed Kubernetes deployment instructions.

Quick deploy:

```bash
# Deploy to Kubernetes
kubectl apply -f k8s/deployment.yaml

# Expose with Tailscale Funnel
tailscale funnel --set-enabled=true --target=clickhouse-studio-portfolio:80
```

The GitHub Actions workflow will automatically build and push the Docker image when you push changes to the portfolio.

## Features

- ✨ React + Vite for fast development
- 🎨 Glassmorphism design matching the app
- 🎭 Framer Motion animations
- 📱 Fully responsive
- ⚡ Optimized performance
- 🎯 Interactive components
