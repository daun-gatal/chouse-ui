import { motion } from 'framer-motion';
import { GlassCard, GlassCardContent } from './GlassCard';
import { Copy, Check, Terminal, Package, AlertCircle, Key, Settings, Info } from 'lucide-react';
import { useState } from 'react';


const dockerComposeCode = `version: '3.8'

services:
  # ClickHouse Database Server
  clickhouse:
    image: clickhouse/clickhouse-server:24-alpine
    container_name: clickhouse
    ports:
      - "8123:8123"   # HTTP interface
      - "9000:9000"   # Native TCP interface
    volumes:
      - clickhouse_data:/var/lib/clickhouse
    environment:
      CLICKHOUSE_DB: default
      CLICKHOUSE_USER: default
      CLICKHOUSE_PASSWORD: \${CLICKHOUSE_PASSWORD:-clickhouse123}
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
    restart: unless-stopped
    networks:
      - clickhouse-network

  # PostgreSQL for RBAC (Production)
  postgres:
    image: postgres:16-alpine
    container_name: postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: clickhouse_studio
      POSTGRES_USER: chstudio
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-changeme}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - clickhouse-network

  # CHouse UI Application
  clickhouse-studio:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    container_name: clickhouse-studio
    ports:
      - "5521:5521"
    volumes:
      - rbac_data:/app/data
    environment:
      NODE_ENV: production
      PORT: 5521
      # RBAC Configuration
      RBAC_DB_TYPE: \${RBAC_DB_TYPE:-postgres}
      RBAC_POSTGRES_URL: postgres://chstudio:\${POSTGRES_PASSWORD:-changeme}@postgres:5432/clickhouse_studio
      # Security (REQUIRED in production v2.6.1+ - change these!)
      JWT_SECRET: \${JWT_SECRET:-change-me-in-production}
      RBAC_ENCRYPTION_KEY: \${RBAC_ENCRYPTION_KEY:-change-me-in-production}
      RBAC_ENCRYPTION_SALT: \${RBAC_ENCRYPTION_SALT:-change-me-in-production}
      # Optional
      RBAC_ADMIN_PASSWORD: \${RBAC_ADMIN_PASSWORD:-}
      CORS_ORIGIN: \${CORS_ORIGIN:-*}
      # Optional
      RBAC_ADMIN_PASSWORD: \${RBAC_ADMIN_PASSWORD:-}
      CORS_ORIGIN: \${CORS_ORIGIN:-*}
    depends_on:
      - clickhouse
      - postgres
    restart: unless-stopped
    networks:
      - clickhouse-network

networks:
  clickhouse-network:
    driver: bridge

volumes:
  clickhouse_data:
  postgres_data:
  rbac_data:`;

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

type TabType = 'overview' | 'dockercompose' | 'envvars';

export default function DockerDeploy() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
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
    { id: 'dockercompose' as TabType, label: 'Docker Compose', icon: Terminal },
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
                      className={`flex-1 min-w-[150px] px-6 py-4 flex items-center justify-center gap-2 transition-all duration-300 relative ${
                        isActive
                          ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-b-2 border-purple-400 text-white'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-purple-400' : ''}`} />
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
                                title: 'Generate Secure Secrets (v2.6.1+)',
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
                                className={`p-4 rounded-lg border ${
                                  item.critical
                                    ? 'bg-red-500/10 border-red-500/30'
                                    : 'bg-white/5 border-white/10'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    item.critical ? 'bg-red-500/20' : 'bg-blue-500/20'
                                  }`}>
                                    {item.critical ? (
                                      <AlertCircle className="w-4 h-4 text-red-400" />
                                    ) : (
                                      <Info className="w-4 h-4 text-blue-400" />
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <h5 className="text-white font-semibold mb-1">{item.title}</h5>
                                    <p className="text-sm text-gray-400 mb-2">{item.desc}</p>
                                    <code className="text-xs bg-black/30 px-2 py-1 rounded text-purple-300">
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

                {/* Docker Compose Tab */}
                {activeTab === 'dockercompose' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                      <Terminal className="w-6 h-6 text-purple-400" />
                      Production Docker Compose
                    </h3>
                    <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <p className="text-sm text-gray-300">
                        <strong className="text-white">Note:</strong> This is the production-ready docker-compose configuration. 
                        For a quick start, see the "Quick Start" section above. This version includes PostgreSQL for RBAC storage 
                        and production environment variables.
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
