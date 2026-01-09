<p align="center">
  <img src="public/logo.svg" alt="ClickHouse Studio" width="120" />
</p>

<h1 align="center">ClickHouse Studio</h1>

<p align="center">
  <strong>A production-grade web interface for ClickHouse with built-in RBAC</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#api-reference">API</a>
</p>

---

## Overview

ClickHouse Studio is a modern, secure web interface for managing ClickHouse databases. Unlike traditional tools that expose credentials in the browser, ClickHouse Studio implements a proper **Role-Based Access Control (RBAC)** system with encrypted credential storage.

### Why ClickHouse Studio?

| Traditional Tools | ClickHouse Studio |
|-------------------|-------------------|
| Credentials in browser localStorage | Encrypted server-side storage |
| Direct browser-to-ClickHouse | Secure backend proxy |
| No access control | Full RBAC with permissions |
| Single connection | Multi-connection management |
| No audit logging | Complete audit trail |

---

## Features

### 🔐 Security & Access Control
- **RBAC System** - Role-based permissions (Super Admin, Admin, Developer, Analyst, Viewer)
- **Encrypted Credentials** - AES-256-GCM encryption for stored passwords
- **JWT Authentication** - Secure token-based sessions
- **Data Access Rules** - Granular database/table permissions per user
- **Audit Logging** - Track all user actions

### 🗄️ Database Management
- **Multi-Connection Support** - Manage multiple ClickHouse servers
- **Database Explorer** - Tree view with schema inspection
- **Table Management** - Create, alter, and drop tables
- **Data Preview** - Sample data with pagination

### 📊 Query & Analytics
- **SQL Editor** - Monaco editor with syntax highlighting
- **Query Execution** - Run queries with statistics
- **Saved Queries** - Persist frequently used queries
- **Data Export** - CSV, JSON, TSV formats
- **Real-time Metrics** - System monitoring dashboard

### 🎨 User Experience
- **Modern UI** - Glassmorphism design with dark theme
- **Responsive** - Works on desktop and tablet
- **Connection Selector** - Quick server switching
- **Keyboard Shortcuts** - Power user support

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Login     │  │  Explorer   │  │   Query     │  │   Admin     │    │
│  │   Page      │  │   View      │  │  Workspace  │  │   Panel     │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │                │            │
│         └────────────────┴────────────────┴────────────────┘            │
│                                   │                                      │
│                          ┌────────▼────────┐                            │
│                          │   API Client    │                            │
│                          │  (with JWT)     │                            │
│                          └────────┬────────┘                            │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │ HTTPS
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                         Hono API Server                              │  │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────────┐ │  │
│  │  │   Auth    │  │  Query    │  │  Explorer │  │   RBAC Routes     │ │  │
│  │  │  Routes   │  │  Routes   │  │  Routes   │  │  (users/roles/    │ │  │
│  │  │           │  │           │  │           │  │   connections)    │ │  │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────────┬─────────┘ │  │
│  │        │              │              │                  │           │  │
│  │        └──────────────┴──────────────┴──────────────────┘           │  │
│  │                               │                                      │  │
│  │                    ┌──────────▼──────────┐                          │  │
│  │                    │    Middleware       │                          │  │
│  │                    │  ┌──────────────┐   │                          │  │
│  │                    │  │ JWT Auth     │   │                          │  │
│  │                    │  │ Data Access  │   │                          │  │
│  │                    │  │ CORS/Error   │   │                          │  │
│  │                    │  └──────────────┘   │                          │  │
│  │                    └──────────┬──────────┘                          │  │
│  └───────────────────────────────┼──────────────────────────────────────┘  │
│                                  │                                         │
│     ┌────────────────────────────┼────────────────────────────┐           │
│     │                            │                            │           │
│     ▼                            ▼                            ▼           │
│ ┌─────────┐              ┌─────────────┐              ┌─────────────┐     │
│ │  RBAC   │              │  ClickHouse │              │  Session    │     │
│ │Database │              │   Service   │              │   Store     │     │
│ │(SQLite/ │              │             │              │             │     │
│ │Postgres)│              └──────┬──────┘              └─────────────┘     │
│ └─────────┘                     │                                         │
│                                 ▼                                         │
└─────────────────────────────────┼─────────────────────────────────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   ClickHouse    │
                         │    Server(s)    │
                         └─────────────────┘
```

### Data Flow

1. **Authentication**: User logs in → JWT tokens issued → Stored in memory (access) + HTTP-only cookie (refresh)
2. **API Requests**: Frontend sends request with JWT → Backend validates → Checks permissions → Executes
3. **ClickHouse Access**: Backend retrieves encrypted credentials → Decrypts → Creates ClickHouse session
4. **Data Access Control**: Query validated against user's data access rules → Filtered results returned

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+ (or Node.js 18+)
- A ClickHouse server (or use Docker Compose)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/daun-gatal/clickhouse-studio.git
cd clickhouse-studio

# Install dependencies
bun install

# Start development servers
bun run dev
```

This starts:
- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:5521

### Default Login

On first run, an admin user is created:
- **Email**: `admin@localhost`
- **Password**: `Admin123!@#`

> ⚠️ **Change this password immediately in production!**

---

## Deployment

### Docker (Recommended)

#### Quick Start with SQLite

```bash
# Clone and run
git clone https://github.com/daun-gatal/clickhouse-studio.git
cd clickhouse-studio
docker-compose up -d
```

Access at http://localhost:5521

#### Production with PostgreSQL

```bash
# Use the PostgreSQL compose file
docker-compose -f docker-compose.postgres.yml up -d
```

#### Custom Docker Run

```bash
# Build image
docker build -t clickhouse-studio .

# Run with environment variables
docker run -d \
  -p 5521:5521 \
  -v clickhouse-studio-data:/app/data \
  -e RBAC_JWT_SECRET=$(openssl rand -base64 32) \
  -e ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -e RBAC_ADMIN_PASSWORD="YourSecurePassword123!" \
  clickhouse-studio
```

### Manual Deployment

```bash
# Build frontend
bun run build:web

# Start production server
NODE_ENV=production \
RBAC_JWT_SECRET=your-secret \
ENCRYPTION_KEY=your-key \
bun run packages/server/src/index.ts
```

### Kubernetes

Example deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clickhouse-studio
spec:
  replicas: 2
  selector:
    matchLabels:
      app: clickhouse-studio
  template:
    metadata:
      labels:
        app: clickhouse-studio
    spec:
      containers:
      - name: clickhouse-studio
        image: clickhouse-studio:latest
        ports:
        - containerPort: 5521
        env:
        - name: RBAC_DB_TYPE
          value: "postgres"
        - name: RBAC_POSTGRES_URL
          valueFrom:
            secretKeyRef:
              name: clickhouse-studio-secrets
              key: postgres-url
        - name: RBAC_JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: clickhouse-studio-secrets
              key: jwt-secret
        - name: ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: clickhouse-studio-secrets
              key: encryption-key
```

---

## Configuration

### Environment Variables

#### Core Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5521` |
| `NODE_ENV` | Environment (`development`/`production`) | `development` |
| `CORS_ORIGIN` | Allowed CORS origins | `*` |
| `STATIC_PATH` | Path to frontend build | `./dist` |

#### RBAC Database

| Variable | Description | Default |
|----------|-------------|---------|
| `RBAC_DB_TYPE` | Database type (`sqlite`/`postgres`) | `sqlite` |
| `RBAC_SQLITE_PATH` | SQLite file path | `./data/rbac.db` |
| `RBAC_POSTGRES_URL` | PostgreSQL connection URL | - |
| `RBAC_POSTGRES_POOL_SIZE` | Connection pool size | `10` |

#### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `RBAC_JWT_SECRET` | JWT signing secret | **Required in production** |
| `RBAC_JWT_ACCESS_EXPIRY` | Access token expiry | `15m` |
| `RBAC_JWT_REFRESH_EXPIRY` | Refresh token expiry | `7d` |
| `RBAC_ADMIN_PASSWORD` | Initial admin password | `Admin123!@#` |

#### Security

| Variable | Description | Default |
|----------|-------------|---------|
| `ENCRYPTION_KEY` | AES-256 key for passwords | **Required in production** |
| `SESSION_TTL` | Session timeout (ms) | `3600000` |

### Generating Secrets

```bash
# Generate JWT secret
openssl rand -base64 32

# Generate encryption key
openssl rand -hex 32

# Generate strong password
openssl rand -base64 16
```

---

## RBAC System

### Role Hierarchy

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| **Super Admin** | Full system access | All permissions |
| **Admin** | Server management | Users, roles, connections |
| **Developer** | Write access | Insert, update, DDL |
| **Analyst** | Read access | Select, export |
| **Viewer** | Read-only | Select only |

### Data Access Rules

Control access to specific databases and tables:

```
Rule: Allow "analyst" role to access "analytics.*"
Rule: Deny "viewer" role from "system.*"
Rule: Allow user "john" to access "sales.orders"
```

Features:
- **Wildcards**: `*` matches any database/table
- **Patterns**: Regex support for complex rules
- **Deny Rules**: Explicit denials take precedence
- **Priority**: Higher priority rules evaluated first

### Permission Categories

- **User Management**: Create, update, delete users
- **Role Management**: Manage roles and permissions
- **Connection Management**: Add/edit ClickHouse connections
- **Query Operations**: Execute queries, DML, DDL
- **Table Operations**: Select, insert, update, delete
- **System**: Audit logs, settings

---

## API Reference

### Authentication

```http
POST /api/rbac/auth/login
Content-Type: application/json

{
  "identifier": "admin@localhost",
  "password": "Admin123!@#"
}
```

```http
POST /api/rbac/auth/logout
Authorization: Bearer <access_token>
```

```http
GET /api/rbac/auth/me
Authorization: Bearer <access_token>
```

### Connections

```http
GET /api/rbac/connections
Authorization: Bearer <access_token>

POST /api/rbac/connections
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Production",
  "host": "clickhouse.example.com",
  "port": 8123,
  "username": "default",
  "password": "secret",
  "database": "default"
}
```

### Query Execution

```http
POST /api/query/execute
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "query": "SELECT * FROM system.tables LIMIT 10"
}
```

### Database Explorer

```http
GET /api/explorer/databases
GET /api/explorer/table/:database/:table
GET /api/explorer/table/:database/:table/sample
```

### User Management

```http
GET /api/rbac/users
POST /api/rbac/users
PUT /api/rbac/users/:id
DELETE /api/rbac/users/:id
```

---

## Project Structure

```
clickhouse-studio/
├── packages/
│   └── server/                 # Backend (Bun + Hono)
│       ├── src/
│       │   ├── index.ts        # Server entry point
│       │   ├── routes/         # API route handlers
│       │   ├── middleware/     # Auth, CORS, error handling
│       │   ├── services/       # Business logic
│       │   ├── rbac/           # RBAC system
│       │   │   ├── db/         # Database (Drizzle ORM)
│       │   │   ├── routes/     # RBAC API routes
│       │   │   ├── services/   # RBAC services
│       │   │   └── schema/     # DB schemas (SQLite/Postgres)
│       │   └── types/          # TypeScript types
│       └── package.json
├── src/                        # Frontend (React + Vite)
│   ├── api/                    # API client
│   ├── components/             # UI components
│   │   ├── common/             # Shared components
│   │   └── ui/                 # shadcn/ui components
│   ├── features/               # Feature modules
│   │   ├── admin/              # Admin panel
│   │   ├── explorer/           # Database explorer
│   │   ├── metrics/            # Metrics dashboard
│   │   ├── rbac/               # RBAC components
│   │   └── workspace/          # Query workspace
│   ├── hooks/                  # Custom React hooks
│   ├── stores/                 # Zustand state stores
│   └── pages/                  # Page components
├── Dockerfile                  # Production Docker image
├── docker-compose.yml          # SQLite deployment
├── docker-compose.postgres.yml # PostgreSQL deployment
└── package.json
```

---

## Security Best Practices

### Production Checklist

- [ ] Generate unique `RBAC_JWT_SECRET` (min 32 bytes)
- [ ] Generate unique `ENCRYPTION_KEY` (32 bytes hex)
- [ ] Change default admin password
- [ ] Set `CORS_ORIGIN` to your domain
- [ ] Use PostgreSQL for multi-instance deployments
- [ ] Enable HTTPS via reverse proxy
- [ ] Configure firewall rules
- [ ] Set up regular backups

### Security Features

| Feature | Description |
|---------|-------------|
| **No Browser Credentials** | Passwords never reach the frontend |
| **Encrypted Storage** | AES-256-GCM for ClickHouse passwords |
| **JWT Tokens** | Short-lived access, long-lived refresh |
| **RBAC Enforcement** | Every request checked against permissions |
| **Query Validation** | SQL parsed and validated against access rules |
| **Audit Logging** | All actions logged with user context |

---

## CLI Tools

Manage the RBAC database from command line:

```bash
cd packages/server

# Check migration status
bun run rbac:status

# Run migrations
bun run rbac:migrate

# Seed default data
bun run rbac:seed

# Check version
bun run rbac:version

# Reset database (DANGEROUS!)
CONFIRM_RESET=yes bun run rbac:reset
```

---

## Contributing

We welcome contributions! Please see our contributing guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Make your changes
4. Run tests (`bun test`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing`)
7. Open a Pull Request

---

## License

Apache-2.0 © [Daun Gatal](https://github.com/daun-gatal)

---

## Acknowledgments

- Inspired by [CH-UI](https://github.com/caioricciuti/ch-ui) by Caio Ricciuti
- Built with [ClickHouse](https://clickhouse.com/), [Bun](https://bun.sh/), [Hono](https://hono.dev/), [React](https://react.dev/), [shadcn/ui](https://ui.shadcn.com/)
