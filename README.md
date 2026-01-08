# ClickHouse Studio

A modern, production-grade web interface for ClickHouse databases. Built with React, TypeScript, and Bun.

![ClickHouse Studio](public/logo.svg)

## Features

- **SQL Editor** with syntax highlighting, auto-completion, and query history
- **Database Explorer** with tree view navigation
- **Real-time Metrics** dashboard with system monitoring
- **User Management** for admin users
- **Saved Queries** with cloud persistence
- **Data Export** in multiple formats (CSV, JSON, TSV)
- **Dark/Light Theme** support
- **Secure Session-based Authentication**

## Architecture

This project follows a production-grade architecture with proper separation of concerns:

```
clickhouse-studio/
├── packages/
│   └── server/           # Backend API (Bun/Hono)
│       ├── src/
│       │   ├── routes/   # API endpoints
│       │   ├── services/ # Business logic
│       │   ├── middleware/ # Auth, CORS, error handling
│       │   └── types/    # TypeScript types
│       └── index.ts
├── src/                  # Frontend (React/Vite)
│   ├── api/              # API client
│   ├── components/       # UI components
│   ├── features/         # Feature modules
│   ├── hooks/            # React Query hooks
│   ├── providers/        # Context providers
│   └── stores/           # Zustand stores
└── ...
```

### Key Design Decisions

1. **Backend API Layer**: All ClickHouse interactions go through a secure backend API, eliminating credential exposure in the browser.

2. **Session-based Auth**: Credentials are never stored in localStorage. Sessions are managed server-side with secure HTTP-only cookies.

3. **Modular Store Architecture**: State management is split into domain-based slices (auth, workspace, explorer) for better maintainability.

4. **React Query Integration**: Data fetching with automatic caching, refetching, and error handling.

5. **Type-safe API Client**: Fully typed API client with proper error handling and request/response transformation.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- A ClickHouse server to connect to

### Installation

```bash
# Install dependencies
bun install

# Install server dependencies
cd packages/server && bun install && cd ../..
```

### Development

```bash
# Start both frontend and backend in development mode
bun run dev

# Or run them separately:
bun run dev:web      # Frontend on http://localhost:5173
bun run dev:server   # Backend on http://localhost:5521
```

### Production Build

```bash
# Build both frontend and backend
bun run build

# Start production server
bun run start
```

### Docker

```bash
# Build Docker image
docker build -t clickhouse-studio .

# Run container
docker run -p 5521:5521 \
  -e CLICKHOUSE_URL=http://your-clickhouse:8123 \
  clickhouse-studio

# Or use Docker Compose (includes ClickHouse)
docker-compose up -d
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5521` |
| `STATIC_PATH` | Path to static files | `./dist` |
| `NODE_ENV` | Environment mode | `development` |
| `CORS_ORIGIN` | Allowed CORS origins | `*` |

### Frontend Configuration

Frontend configuration is managed through Vite environment variables:

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API URL (default: `/api`) |

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with credentials
- `POST /api/auth/logout` - Logout and destroy session
- `GET /api/auth/session` - Get current session info
- `POST /api/auth/refresh` - Refresh session

### Query Execution
- `POST /api/query/execute` - Execute SQL query
- `GET /api/query/intellisense` - Get autocomplete data

### Database Explorer
- `GET /api/explorer/databases` - List all databases/tables
- `GET /api/explorer/table/:db/:table` - Get table details
- `GET /api/explorer/table/:db/:table/sample` - Get data sample
- `POST /api/explorer/database` - Create database
- `DELETE /api/explorer/database/:name` - Drop database
- `POST /api/explorer/table` - Create table
- `DELETE /api/explorer/table/:db/:table` - Drop table

### Metrics
- `GET /api/metrics/stats` - Get system statistics
- `GET /api/metrics/recent-queries` - Get query log

### Saved Queries
- `GET /api/saved-queries/status` - Check feature status
- `POST /api/saved-queries/activate` - Enable feature (admin)
- `GET /api/saved-queries` - List saved queries
- `POST /api/saved-queries` - Save new query
- `PUT /api/saved-queries/:id` - Update query
- `DELETE /api/saved-queries/:id` - Delete query

## Security

### Authentication Flow

1. User submits credentials via login form
2. Backend validates credentials against ClickHouse
3. Session is created server-side with encrypted session ID
4. Session ID is stored in HTTP-only cookie
5. All subsequent requests include session ID
6. Backend looks up session and ClickHouse client

### Security Features

- **No Client-Side Credentials**: Passwords never stored in browser
- **HTTP-Only Cookies**: Session tokens not accessible via JavaScript
- **Session Expiration**: Auto-cleanup of inactive sessions
- **Permission Checking**: API validates user permissions
- **Input Validation**: Zod schema validation on all endpoints

## Development

### Project Structure

```
src/
├── api/              # API client and type definitions
│   ├── client.ts     # Base HTTP client
│   ├── auth.ts       # Auth API functions
│   ├── query.ts      # Query API functions
│   └── ...
├── components/
│   ├── common/       # Shared components
│   └── ui/           # shadcn/ui components
├── features/         # Feature modules
│   ├── admin/        # Admin panel
│   ├── explorer/     # Database explorer
│   ├── metrics/      # Metrics dashboard
│   └── workspace/    # Query workspace
├── hooks/            # Custom React hooks
├── providers/        # Context providers
├── stores/           # Zustand stores
└── types/            # TypeScript types
```

### Adding New Features

1. Create feature module in `src/features/`
2. Add API functions in `src/api/`
3. Add React Query hooks in `src/hooks/`
4. Add backend routes in `packages/server/src/routes/`

### Testing

```bash
# Run tests
bun test

# Run tests with coverage
bun test --coverage
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

Apache-2.0

## Acknowledgments

- [ClickHouse](https://clickhouse.com/) - The database
- [Vite](https://vitejs.dev/) - Frontend build tool
- [Bun](https://bun.sh/) - JavaScript runtime
- [Hono](https://hono.dev/) - Web framework
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [TanStack Query](https://tanstack.com/query) - Data fetching

