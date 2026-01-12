import { motion } from 'framer-motion';
import { GlassCard, GlassCardContent } from './GlassCard';
import { Copy, Check, Terminal, Package, AlertCircle, Key, Settings, Info } from 'lucide-react';
import { useState } from 'react';

const prerequisites = [
  { title: 'Docker & Docker Compose', desc: 'Docker 20.10+ and Docker Compose installed and running' },
  { title: 'Ports Available', desc: 'Ports 5521 (UI), 8123/9000 (ClickHouse), 5432 (PostgreSQL)' },
  { title: 'Disk Space', desc: 'Sufficient space for Docker volumes (data persistence)' },
  { title: 'Memory', desc: 'Recommended: 2GB+ RAM for all services' },
];

const dockerComposeCode = `version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: clickhouse_studio
      POSTGRES_USER: chstudio
      POSTGRES_PASSWORD: changeme
    restart: unless-stopped

  ch-server:
    image: clickhouse/clickhouse-server:24-alpine
    ports:
      - "8123:8123"
      - "9000:9000"
    environment:
      CLICKHOUSE_PASSWORD: clickhouse123
    restart: unless-stopped

  chouse-ui:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    ports:
      - "5521:5521"
    environment:
      RBAC_DB_TYPE: postgres
      RBAC_POSTGRES_URL: postgres://chstudio:changeme@postgres:5432/clickhouse_studio
      JWT_SECRET: \${JWT_SECRET:-change-me-in-production}
      RBAC_ENCRYPTION_KEY: \${RBAC_ENCRYPTION_KEY:-change-me-in-production}
    depends_on:
      - postgres
      - ch-server
    restart: unless-stopped`;

const dockerComposeNote = 'Save as docker-compose.yml and run:\n\n  docker-compose up -d\n\nAccess at http://localhost:5521\n\nDefault login:\n• Email: admin@localhost\n• Password: admin123!\n\n⚠️ Change JWT_SECRET and RBAC_ENCRYPTION_KEY in production!';

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
    desc: 'Encryption key for ClickHouse passwords. Generate with: openssl rand -hex 32',
  },
  {
    name: 'RBAC_DB_TYPE',
    required: false,
    default: 'sqlite',
    desc: 'Database type: "sqlite" (default) or "postgres"',
  },
  {
    name: 'RBAC_POSTGRES_URL',
    required: false,
    default: '',
    desc: 'PostgreSQL connection URL (if using postgres). Format: postgres://user:pass@host:5432/dbname',
  },
  {
    name: 'PORT',
    required: false,
    default: '5521',
    desc: 'Port for the web interface',
  },
  {
    name: 'CORS_ORIGIN',
    required: false,
    default: '*',
    desc: 'CORS allowed origin. Use your domain in production (e.g., https://yourdomain.com)',
  },
  {
    name: 'RBAC_ADMIN_PASSWORD',
    required: false,
    default: '',
    desc: 'Default admin password (only used on first run). Email: admin@localhost',
  },
];

type TabType = 'overview' | 'prerequisites' | 'dockercompose' | 'envvars';

export default function DockerDeploy() {
  const [activeTab, setActiveTab] = useState<TabType>('dockercompose');
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: Info },
    { id: 'prerequisites' as TabType, label: 'Prerequisites', icon: AlertCircle },
    { id: 'dockercompose' as TabType, label: 'Docker Compose', icon: Terminal },
    { id: 'envvars' as TabType, label: 'Env Variables', icon: Key },
  ];

  return (
    <section id="quick-start" className="py-24 px-4 relative overflow-hidden bg-gradient-to-b from-transparent via-purple-500/5 to-transparent">
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
              Quick Start
            </span>
          </h2>
          <p className="text-gray-400 text-xl mb-6">Deploy with Docker</p>
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
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 min-w-[150px] px-6 py-4 flex items-center justify-center gap-2 transition-all duration-300 ${
                        isActive
                          ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-b-2 border-purple-400 text-white'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium">{tab.label}</span>
                    </button>
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
                      <Info className="w-6 h-6 text-purple-400" />
                      Deployment Overview
                    </h3>
                    <div className="space-y-6">
                      <div className="prose prose-invert max-w-none">
                        <p className="text-gray-300 leading-relaxed text-lg mb-4">
                          CHouse UI is available as a Docker image from GitHub Container Registry (GHCR). 
                          Deploy everything you need with Docker Compose - including ClickHouse database and PostgreSQL 
                          for production-ready RBAC storage. All services are configured and ready to run with a single command.
                        </p>
                        <div className="grid md:grid-cols-2 gap-6 my-6">
                          <div className="p-5 bg-white/5 rounded-lg border border-white/10">
                            <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                              <Package className="w-5 h-5 text-purple-400" />
                              Image Location
                            </h4>
                            <code className="text-purple-400 text-sm block mb-2">ghcr.io/daun-gatal/chouse-ui:latest</code>
                            <p className="text-sm text-gray-400">
                              Pull directly from GitHub Container Registry. No authentication required for public images.
                            </p>
                          </div>
                          <div className="p-5 bg-white/5 rounded-lg border border-white/10">
                            <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                              <Terminal className="w-5 h-5 text-blue-400" />
                              Complete Stack
                            </h4>
                            <p className="text-sm text-gray-400 mb-2">
                              Docker Compose includes ClickHouse, CHouse UI, and optional PostgreSQL. Everything runs with a single command.
                            </p>
                            <p className="text-xs text-gray-500">
                              Ports: 5521 (UI), 8123/9000 (ClickHouse), 5432 (PostgreSQL)
                            </p>
                          </div>
                        </div>
                        <div className="p-5 bg-white/5 rounded-lg border border-white/10 my-6">
                          <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                            <Settings className="w-5 h-5 text-green-400" />
                            Backend Metadata Storage
                          </h4>
                          <p className="text-sm text-gray-400 mb-4">
                            CHouse UI supports two backend options for storing RBAC metadata (users, roles, permissions, connections):
                          </p>
                          <div className="grid md:grid-cols-2 gap-4 mt-4">
                            <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                              <h5 className="text-white font-medium mb-2 flex items-center gap-2">
                                <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                                SQLite (Default)
                              </h5>
                              <p className="text-sm text-gray-400 mb-2">
                                Perfect for single-instance deployments and development. No additional setup required.
                              </p>
                              <ul className="text-xs text-gray-500 space-y-1">
                                <li>• Zero configuration</li>
                                <li>• File-based storage</li>
                                <li>• Ideal for small teams</li>
                                <li>• Persisted in Docker volume</li>
                              </ul>
                            </div>
                            <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                              <h5 className="text-white font-medium mb-2 flex items-center gap-2">
                                <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                                PostgreSQL
                              </h5>
                              <p className="text-sm text-gray-400 mb-2">
                                Recommended for production with high availability and scalability requirements.
                              </p>
                              <ul className="text-xs text-gray-500 space-y-1">
                                <li>• Multi-instance support</li>
                                <li>• Better performance</li>
                                <li>• Production-ready</li>
                                <li>• Shared metadata across instances</li>
                              </ul>
                            </div>
                          </div>
                          <p className="text-sm text-gray-400 mt-4">
                            The docker-compose setup includes PostgreSQL for RBAC storage, providing production-ready scalability and high availability.
                          </p>
                        </div>
                        <div className="p-5 bg-blue-500/10 rounded-lg border border-blue-500/20 my-6">
                          <h4 className="text-white font-semibold mb-3">What You Get</h4>
                          <ul className="space-y-2 text-gray-300 text-sm space-y-2">
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>ClickHouse Server</strong> - Pre-configured ClickHouse database included in docker-compose</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>Web Interface</strong> - Full-featured UI for ClickHouse management</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>RBAC System</strong> - Built-in role-based access control with PostgreSQL backend</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>PostgreSQL</strong> - PostgreSQL database for RBAC metadata storage (production-ready)</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>Secure Storage</strong> - Encrypted ClickHouse credentials stored server-side</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>Data Persistence</strong> - All data persisted in Docker volumes</span>
                            </li>
                          </ul>
                        </div>
                        <div className="p-5 bg-yellow-500/10 rounded-lg border border-yellow-500/20 my-6">
                          <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-yellow-400" />
                            Important Notes
                          </h4>
                          <ul className="space-y-2 text-gray-300 text-sm">
                            <li className="flex items-start gap-2">
                              <span className="text-yellow-400 mt-1">⚠</span>
                              <span>Change <code className="text-yellow-300">JWT_SECRET</code> and <code className="text-yellow-300">RBAC_ENCRYPTION_KEY</code> in production</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-yellow-400 mt-1">⚠</span>
                              <span>Set <code className="text-yellow-300">CORS_ORIGIN</code> to your domain for production deployments</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-yellow-400 mt-1">⚠</span>
                              <span>PostgreSQL is included in the docker-compose setup for production-ready deployments</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Prerequisites Tab */}
                {activeTab === 'prerequisites' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                      <AlertCircle className="w-6 h-6 text-purple-400" />
                      Prerequisites
                    </h3>
                    <div className="grid md:grid-cols-3 gap-4">
                      {prerequisites.map((req, index) => (
                        <motion.div
                          key={req.title}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className="p-4 bg-white/5 rounded-lg border border-white/10"
                        >
                          <h4 className="font-semibold text-white mb-2">{req.title}</h4>
                          <p className="text-sm text-gray-400">{req.desc}</p>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Docker Compose Tab */}
                {activeTab === 'dockercompose' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                      <Terminal className="w-6 h-6 text-purple-400" />
                      Docker Compose Setup
                    </h3>
                    <div className="relative">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">yaml</span>
                        <motion.button
                          onClick={() => copyToClipboard(dockerComposeCode, 'dockercompose')}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors"
                        >
                          {copied === 'dockercompose' ? (
                            <>
                              <Check className="w-4 h-4 text-green-400" />
                              <span className="text-sm text-green-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span className="text-sm">Copy</span>
                            </>
                          )}
                        </motion.button>
                      </div>
                      <div className="bg-black/60 backdrop-blur-sm p-6 rounded-xl border border-white/10 overflow-x-auto">
                        <pre className="text-sm">
                          <code className="text-gray-300 font-mono">{dockerComposeCode}</code>
                        </pre>
                      </div>
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg"
                      >
                        <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">{dockerComposeNote}</p>
                      </motion.div>
                    </div>
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
                    <div className="space-y-4">
                      {envVars.map((env, index) => (
                        <motion.div
                          key={env.name}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="p-4 bg-white/5 rounded-lg border border-white/10"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <code className="text-purple-400 font-mono text-sm font-semibold">{env.name}</code>
                                {env.required && (
                                  <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">Required</span>
                                )}
                                {!env.required && (
                                  <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs rounded">Optional</span>
                                )}
                              </div>
                              <p className="text-sm text-gray-400 mb-2">{env.desc}</p>
                              <div className="text-xs text-gray-500">
                                <span className="font-semibold">Default:</span> <code className="text-gray-400">{env.default}</code>
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
