# Kubernetes Deployment for Portfolio Site

This directory contains Kubernetes manifests to deploy the ClickHouse Studio portfolio site.

## Prerequisites

- Kubernetes cluster (1.19+)
- kubectl configured
- Docker image pushed to GitHub Container Registry (default: `ghcr.io/daun-gatal/clickhouse-studio-portfolio:latest`)
- Tailscale installed and configured on your cluster

### Image Pull Secret (if repository is private)

If your GitHub repository is private, you'll need to create an image pull secret:

```bash
# Create a GitHub Personal Access Token with `read:packages` permission
# Then create the secret:
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_TOKEN \
  --docker-email=YOUR_EMAIL

# Add imagePullSecrets to deployment.yaml:
# spec:
#   template:
#     spec:
#       imagePullSecrets:
#       - name: ghcr-secret
```

## Deployment

### 1. Deploy to Kubernetes

```bash
kubectl apply -f k8s/deployment.yaml
```

### 2. Verify deployment

```bash
# Check pods
kubectl get pods -l app=clickhouse-studio-portfolio

# Check service
kubectl get svc clickhouse-studio-portfolio
```

### 3. Expose with Tailscale Funnel

```bash
# Enable Tailscale Funnel for the service
tailscale funnel --set-enabled=true --target=clickhouse-studio-portfolio:80

# Or if running Tailscale in a pod, use:
# kubectl exec -it <tailscale-pod> -- tailscale funnel --set-enabled=true --target=clickhouse-studio-portfolio:80
```

### 4. Access the site

Tailscale Funnel will provide you with a public URL. Access the site at the provided Tailscale Funnel URL.

## Scaling

To scale the deployment:

```bash
kubectl scale deployment clickhouse-studio-portfolio --replicas=3
```

## Updating

After pushing a new Docker image:

```bash
# Force rollout restart
kubectl rollout restart deployment clickhouse-studio-portfolio

# Or update the image tag in deployment.yaml and reapply
kubectl apply -f k8s/deployment.yaml
```

## Resource Limits

The deployment is configured with minimal resources:
- Requests: 64Mi memory, 50m CPU
- Limits: 128Mi memory, 100m CPU

Adjust these in `deployment.yaml` based on your needs.
