import { motion } from 'framer-motion';
import { GlassCard, GlassCardContent } from './GlassCard';
import { Copy, Check, Terminal, Package, AlertCircle, Key, Settings, Info, Cloud } from 'lucide-react';
import { useState } from 'react';


const kubernetesCode = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: chouse-ui
  namespace: default
  labels:
    app: chouse-ui
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chouse-ui
  template:
    metadata:
      labels:
        app: chouse-ui
    spec:
      containers:
        - name: chouse-ui
          image: ghcr.io/daun-gatal/chouse-ui:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 5521
              name: http
          env:
            # Core
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "5521"
            - name: STATIC_PATH
              value: "./dist"
            - name: CORS_ORIGIN
              value: "*"
            
            # RBAC Database
            - name: RBAC_DB_TYPE
              value: "sqlite"
            - name: RBAC_SQLITE_PATH
              value: "/app/data/rbac.db"
            - name: RBAC_POSTGRES_URL
              value: ""
            - name: RBAC_POSTGRES_POOL_SIZE
              value: "10"
            
            # Security (REQUIRED)
            - name: JWT_SECRET
              value: "change-me-in-production"
            - name: RBAC_ENCRYPTION_KEY
              value: "change-me-in-production"
            - name: RBAC_ENCRYPTION_SALT
              value: "change-me-in-production"
            
            # JWT Expiry
            - name: JWT_ACCESS_EXPIRY
              value: "4h"
            - name: JWT_REFRESH_EXPIRY
              value: "7d"
            
            # Admin Seeding (First run only)
            - name: RBAC_ADMIN_EMAIL
              value: "admin@localhost"
            - name: RBAC_ADMIN_USERNAME
              value: "admin"
            - name: RBAC_ADMIN_PASSWORD
              value: "admin123!"
            
            # AI Configuration
            - name: AI_OPTIMIZER_ENABLED
              value: "false"
            - name: AI_PROVIDER
              value: "openai"
            - name: AI_API_KEY
              value: ""
            - name: AI_MODEL_NAME
              value: ""
            - name: AI_BASE_URL
              value: ""
          volumeMounts:
            - name: rbac-data
              mountPath: /app/data
          livenessProbe:
            httpGet:
              path: /api/health
              port: 5521
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /api/health
              port: 5521
            initialDelaySeconds: 10
            periodSeconds: 5
      volumes:
        - name: rbac-data
          emptyDir: {} # Use PersistentVolumeClaim in production
---
apiVersion: v1
kind: Service
metadata:
  name: chouse-ui
  namespace: default
  labels:
    app: chouse-ui
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 5521
      protocol: TCP
      name: http
  selector:
    app: chouse-ui`;



const dockerComposeCode = `version: '3.8'

services:
  chouse-ui:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    container_name: chouse-ui
    ports:
      - "5521:5521"
    volumes:
      - ./data:/app/data
    environment:
      # Core
      NODE_ENV: production
      PORT: 5521
      STATIC_PATH: ./dist
      CORS_ORIGIN: \${CORS_ORIGIN:-*}
      
      # RBAC Database
      RBAC_DB_TYPE: \${RBAC_DB_TYPE:-sqlite}
      RBAC_SQLITE_PATH: \${RBAC_SQLITE_PATH:-/app/data/rbac.db}
      RBAC_POSTGRES_URL: \${RBAC_POSTGRES_URL:-}
      RBAC_POSTGRES_POOL_SIZE: \${RBAC_POSTGRES_POOL_SIZE:-10}
      
      # Security (REQUIRED)
      JWT_SECRET: \${JWT_SECRET:-change-me-in-production}
      RBAC_ENCRYPTION_KEY: \${RBAC_ENCRYPTION_KEY:-change-me-in-production}
      RBAC_ENCRYPTION_SALT: \${RBAC_ENCRYPTION_SALT:-change-me-in-production}
      
      # JWT Expiry
      JWT_ACCESS_EXPIRY: \${JWT_ACCESS_EXPIRY:-4h}
      JWT_REFRESH_EXPIRY: \${JWT_REFRESH_EXPIRY:-7d}
      
      # Admin Seeding (First run only)
      RBAC_ADMIN_EMAIL: \${RBAC_ADMIN_EMAIL:-admin@localhost}
      RBAC_ADMIN_USERNAME: \${RBAC_ADMIN_USERNAME:-admin}
      RBAC_ADMIN_PASSWORD: \${RBAC_ADMIN_PASSWORD:-admin123!}
      
      # AI Configuration
      AI_OPTIMIZER_ENABLED: \${AI_OPTIMIZER_ENABLED:-false}
      AI_PROVIDER: \${AI_PROVIDER:-openai}
      AI_API_KEY: \${AI_API_KEY:-}
      AI_MODEL_NAME: \${AI_MODEL_NAME:-}
      AI_BASE_URL: \${AI_BASE_URL:-}
    restart: unless-stopped`;

const dockerComposeNote = 'Save as docker-compose.yml and run:\n\n  docker-compose up -d\n\nAccess at http://localhost:5521\n\nDefault login:\n• Email: admin@localhost\n• Password: admin123!\n\n⚠️ In production, change JWT_SECRET, RBAC_ENCRYPTION_KEY, and RBAC_ENCRYPTION_SALT!';

const envVars = [
  {
    name: 'JWT_SECRET',
    required: true,
    default: 'change-me-in-production',
    desc: 'Secret key for JWT token signing. Generate with: openssl rand -base64 32',
  },
  {
    name: 'RBAC_ENCRYPTION_KEY',
    required: true,
    default: 'change-me-in-production',
    desc: 'Encryption key for ClickHouse passwords. Generate with: openssl rand -hex 32 (minimum 32 characters, recommended 64)',
  },
  {
    name: 'RBAC_ENCRYPTION_SALT',
    required: true,
    default: 'change-me-in-production',
    desc: 'Encryption salt for password derivation. Generate with: openssl rand -hex 32 (exactly 64 hex characters). Required in production.',
  },
  {
    name: 'JWT_ACCESS_EXPIRY',
    required: false,
    default: '4h',
    desc: 'JWT access token expiration time (e.g., 15m, 1h)',
  },
  {
    name: 'JWT_REFRESH_EXPIRY',
    required: false,
    default: '7d',
    desc: 'JWT refresh token expiration time (e.g., 7d, 30d)',
  },
  {
    name: 'RBAC_DB_TYPE',
    required: false,
    default: 'sqlite',
    desc: 'Database type: "sqlite" (default) or "postgres"',
  },
  {
    name: 'RBAC_SQLITE_PATH',
    required: false,
    default: './data/rbac.db',
    desc: 'Path to SQLite database file',
  },
  {
    name: 'RBAC_POSTGRES_URL',
    required: false,
    default: '',
    desc: 'PostgreSQL connection URL (if using postgres). Format: postgres://user:pass@host:5432/dbname',
  },
  {
    name: 'RBAC_POSTGRES_POOL_SIZE',
    required: false,
    default: '10',
    desc: 'Maximum number of connections in the PostgreSQL pool',
  },
  {
    name: 'PORT',
    required: false,
    default: '5521',
    desc: 'Port for the web UI',
  },
  {
    name: 'CORS_ORIGIN',
    required: false,
    default: '*',
    desc: 'CORS allowed origin. Use your domain in production (e.g., https://yourdomain.com)',
  },
  {
    name: 'STATIC_PATH',
    required: false,
    default: './dist',
    desc: 'Path to static files',
  },
  {
    name: 'RBAC_ADMIN_EMAIL',
    required: false,
    default: 'admin@localhost',
    desc: 'Initial admin email (seeding only)',
  },
  {
    name: 'RBAC_ADMIN_USERNAME',
    required: false,
    default: 'admin',
    desc: 'Initial admin username (seeding only)',
  },
  {
    name: 'RBAC_ADMIN_PASSWORD',
    required: false,
    default: 'admin123!',
    desc: 'Initial admin password (seeding only)',
  },
  {
    name: 'AI_OPTIMIZER_ENABLED',
    required: false,
    default: 'false',
    desc: 'Enable AI-powered query optimization features',
  },
  {
    name: 'AI_PROVIDER',
    required: false,
    default: 'openai',
    desc: 'AI Provider: "openai", "anthropic", "google", etc.',
  },
  {
    name: 'AI_API_KEY',
    required: false,
    default: '',
    desc: 'API Key for the chosen AI provider',
  },
  {
    name: 'AI_MODEL_NAME',
    required: false,
    default: '',
    desc: 'Model name (e.g., gpt-4o, claude-3-5-sonnet-20241022)',
  },
  {
    name: 'AI_BASE_URL',
    required: false,
    default: '',
    desc: 'Base URL for AI provider (e.g., for Ollama or OpenAI proxies)',
  },
];

type TabType = 'overview' | 'deployment' | 'envvars';
type DeploymentType = 'docker' | 'kubernetes';

export default function DockerDeploy() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [deploymentType, setDeploymentType] = useState<DeploymentType>('docker');
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const tabs = [
    { id: 'overview' as TabType, label: 'Production Setup', icon: Settings },
    { id: 'envvars' as TabType, label: 'Environment Variables', icon: Key },
    { id: 'deployment' as TabType, label: 'Deployment', icon: Terminal },
  ];

  return (
    <section id="docker-deploy" className="py-24 px-4 relative overflow-hidden bg-gradient-to-b from-transparent via-purple-500/5 to-transparent" aria-label="Production deployment guide">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, type: "spring" }}
            className="inline-block mb-6"
          >
            <Package className="w-16 h-16 text-purple-400 mx-auto" />
          </motion.div>
          <h2 className="text-5xl md:text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              Production Deployment
            </span>
          </h2>
          <p className="text-gray-400 text-xl mb-2">Advanced configuration for production environments</p>
          <p className="text-gray-500 text-sm">Security, environment variables, and production best practices</p>
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <GlassCard className="bg-gradient-to-br from-white/10 to-white/5 border-purple-500/20">
            <GlassCardContent className="p-0">
              {/* Tab Headers */}
              <div className="flex flex-wrap border-b border-white/10">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <motion.button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      className={`flex-1 min-w-[150px] px-6 py-4 flex items-center justify-center gap-2 transition-all duration-300 relative ${isActive
                        ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-b-2 border-purple-400 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                        } `}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-purple-400' : ''} `} />
                      <span className="font-medium">{tab.label}</span>
                      {isActive && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-400 to-blue-400"
                          initial={false}
                          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                        />
                      )}
                    </motion.button>
                  );
                })}
              </div>

              {/* Tab Content */}
              <div className="p-8">
                {/* Overview Tab */}
                {activeTab === 'overview' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                      <Settings className="w-6 h-6 text-purple-400" />
                      Production Setup Checklist
                    </h3>
                    <div className="space-y-6">
                      <div className="prose prose-invert max-w-none">
                        <p className="text-gray-300 leading-relaxed text-lg mb-6">
                          For production deployments, follow these essential security and configuration steps.
                          The quick start guide above covers basic setup - this section focuses on production best practices.
                        </p>

                        {/* Production Checklist */}
                        <div className="space-y-4 mb-6">
                          <h4 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-yellow-400" />
                            Critical Security Steps
                          </h4>
                          <div className="grid md:grid-cols-2 gap-4">
                            {[
                              {
                                title: 'Generate Secure Secrets',
                                desc: 'Create strong JWT_SECRET (min 32 chars), RBAC_ENCRYPTION_KEY (min 32 hex chars), and RBAC_ENCRYPTION_SALT (exactly 64 hex chars) using openssl. All three are now required in production.',
                                critical: true,
                                command: 'JWT_SECRET=$(openssl rand -base64 32)\nRBAC_ENCRYPTION_KEY=$(openssl rand -hex 32)\nRBAC_ENCRYPTION_SALT=$(openssl rand -hex 32)',
                              },
                              {
                                title: 'Set CORS Origin',
                                desc: 'Configure CORS_ORIGIN to your production domain (not *)',
                                critical: true,
                                command: 'CORS_ORIGIN=https://yourdomain.com',
                              },
                              {
                                title: 'Change Default Passwords',
                                desc: 'Update admin password and all default credentials',
                                critical: true,
                                command: 'RBAC_ADMIN_PASSWORD=your-secure-password',
                              },
                              {
                                title: 'Use PostgreSQL',
                                desc: 'Switch to PostgreSQL backend for multi-instance support',
                                critical: false,
                                command: 'RBAC_DB_TYPE=postgres',
                              },
                            ].map((item, idx) => (
                              <motion.div
                                key={item.title}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.1 }}
                                className={`p-4 rounded-lg border ${item.critical
                                  ? 'bg-red-500/10 border-red-500/30'
                                  : 'bg-white/5 border-white/10'
                                  } `}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${item.critical ? 'bg-red-500/20' : 'bg-blue-500/20'
                                    } `}>
                                    {item.critical ? (
                                      <AlertCircle className="w-4 h-4 text-red-400" />
                                    ) : (
                                      <Info className="w-4 h-4 text-blue-400" />
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <h5 className="text-white font-semibold mb-1">{item.title}</h5>
                                    <p className="text-sm text-gray-400 mb-2">{item.desc}</p>
                                    <code className="text-xs bg-black/30 px-3 py-2 rounded text-purple-300 block whitespace-pre-wrap font-mono">
                                      {item.command}
                                    </code>
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                        {/* Production Recommendations */}
                        <div className="p-5 bg-blue-500/10 rounded-lg border border-blue-500/20 my-6">
                          <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                            <Package className="w-5 h-5 text-blue-400" />
                            Production Recommendations
                          </h4>
                          <ul className="space-y-2 text-gray-300 text-sm">
                            <li className="flex items-start gap-2">
                              <span className="text-blue-400 mt-1">✓</span>
                              <span>Use a reverse proxy (nginx/traefik) with HTTPS/SSL certificates</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-blue-400 mt-1">✓</span>
                              <span>Set up regular backups for PostgreSQL and ClickHouse data</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-blue-400 mt-1">✓</span>
                              <span>Monitor resource usage and set up alerts</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-blue-400 mt-1">✓</span>
                              <span>Use Docker secrets or environment variable management tools</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-blue-400 mt-1">✓</span>
                              <span>Configure firewall rules to restrict access to necessary ports only</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Deployment Tab */}
                {activeTab === 'deployment' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="flex justify-center mb-8">
                      <div className="bg-white/5 p-1 rounded-lg border border-white/10 flex">
                        <button
                          onClick={() => setDeploymentType('docker')}
                          className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${deploymentType === 'docker'
                            ? 'bg-purple-500 text-white shadow-lg'
                            : 'text-gray-400 hover:text-white'
                            } `}
                        >
                          <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4" />
                            Docker Compose
                          </div>
                        </button>
                        <button
                          onClick={() => setDeploymentType('kubernetes')}
                          className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${deploymentType === 'kubernetes'
                            ? 'bg-purple-500 text-white shadow-lg'
                            : 'text-gray-400 hover:text-white'
                            } `}
                        >
                          <div className="flex items-center gap-2">
                            <Cloud className="w-4 h-4" />
                            Kubernetes
                          </div>
                        </button>
                      </div>
                    </div>

                    {deploymentType === 'docker' ? (
                      <div>
                        <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                          <Terminal className="w-6 h-6 text-purple-400" />
                          Docker Compose Deployment
                        </h3>
                        <p className="text-gray-400 text-sm mb-4">
                          Run the application with all production configuration options.
                        </p>

                        <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                          <p className="text-sm text-gray-300">
                            <strong className="text-white">Note:</strong> This configuration assumes you have an external ClickHouse server.
                            Update the environment variables to point to your database.
                          </p>
                        </div>
                        <div className="relative">
                          <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">docker-compose.yml</span>
                              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Production Ready</span>
                            </div>
                            <motion.button
                              onClick={() => copyToClipboard(dockerComposeCode, 'dockercompose')}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors group"
                            >
                              {copied === 'dockercompose' ? (
                                <>
                                  <Check className="w-4 h-4 text-green-400" />
                                  <span className="text-sm text-green-400">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4 group-hover:text-purple-400 transition-colors" />
                                  <span className="text-sm group-hover:text-purple-400 transition-colors">Copy</span>
                                </>
                              )}
                            </motion.button>
                          </div>
                          <div className="bg-black/60 backdrop-blur-sm p-6 rounded-xl border border-white/10 overflow-x-auto hover:border-purple-500/30 transition-colors">
                            <pre className="text-sm">
                              <code className="text-gray-300 font-mono">{dockerComposeCode}</code>
                            </pre>
                          </div>
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="mt-6 p-5 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg"
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <Terminal className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-white font-semibold mb-2">Quick Commands</h4>
                                <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">{dockerComposeNote}</p>
                              </div>
                            </div>
                          </motion.div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                          <Cloud className="w-6 h-6 text-purple-400" />
                          Kubernetes Deployment
                        </h3>

                        <div className="mb-6">
                          <p className="text-gray-300 mb-4">
                            Deploy CHouse UI to your Kubernetes cluster using the standard manifest below.
                          </p>

                          <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg mb-6">
                            <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                              <Info className="w-4 h-4 text-purple-400" />
                              Prerequisites
                            </h4>
                            <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
                              <li>A running Kubernetes cluster</li>
                              <li><code className="text-purple-300">kubectl</code> configured</li>
                              <li>(Optional) Ingress controller for external access</li>
                            </ul>
                          </div>

                          <div className="relative">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">chouse-ui.yaml</span>
                                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">K8s Manifest</span>
                              </div>
                              <motion.button
                                onClick={() => copyToClipboard(kubernetesCode, 'kubernetes')}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors group"
                              >
                                {copied === 'kubernetes' ? (
                                  <>
                                    <Check className="w-4 h-4 text-green-400" />
                                    <span className="text-sm text-green-400">Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-4 h-4 group-hover:text-purple-400 transition-colors" />
                                    <span className="text-sm group-hover:text-purple-400 transition-colors">Copy</span>
                                  </>
                                )}
                              </motion.button>
                            </div>
                            <div className="bg-black/60 backdrop-blur-sm p-6 rounded-xl border border-white/10 overflow-x-auto hover:border-purple-500/30 transition-colors">
                              <pre className="text-sm">
                                <code className="text-gray-300 font-mono">{kubernetesCode}</code>
                              </pre>
                            </div>
                          </div>

                          <div className="mt-8">
                            <h4 className="text-lg font-semibold text-white mb-3">Deployment Steps</h4>
                            <div className="space-y-4">
                              <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                                <div className="flex items-center gap-3 mb-2">
                                  <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-sm">1</div>
                                  <h5 className="text-white font-medium">Apply the manifest</h5>
                                </div>
                                <code className="block bg-black/30 p-2 rounded text-sm text-gray-300 font-mono">
                                  kubectl apply -f chouse-ui.yaml
                                </code>
                              </div>
                              <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                                <div className="flex items-center gap-3 mb-2">
                                  <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-sm">2</div>
                                  <h5 className="text-white font-medium">Verify deployment</h5>
                                </div>
                                <code className="block bg-black/30 p-2 rounded text-sm text-gray-300 font-mono">
                                  kubectl get pods -l app=chouse-ui
                                </code>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Environment Variables Tab */}
                {activeTab === 'envvars' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                      <Key className="w-6 h-6 text-purple-400" />
                      Environment Variables
                    </h3>
                    <div className="space-y-3">
                      {envVars.map((env, index) => (
                        <motion.div
                          key={env.name}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          whileHover={{ scale: 1.01, y: -2 }}
                          className="p-4 bg-white/5 rounded-lg border border-white/10 hover:border-purple-500/30 transition-all group"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <code className="text-purple-400 font-mono text-sm font-semibold group-hover:text-purple-300 transition-colors">{env.name}</code>
                                {env.required && (
                                  <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded border border-red-500/30">
                                    Required
                                  </span>
                                )}
                                {!env.required && (
                                  <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs rounded border border-gray-500/30">
                                    Optional
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-400 mb-2 group-hover:text-gray-300 transition-colors">{env.desc}</p>
                              <div className="text-xs text-gray-500 flex items-center gap-2">
                                <span className="font-semibold">Default:</span>
                                <code className="text-gray-400 bg-black/30 px-2 py-0.5 rounded">{env.default || '(none)'}</code>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>
      </div>
    </section>
  );
}
