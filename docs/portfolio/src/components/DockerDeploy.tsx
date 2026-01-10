import { motion } from 'framer-motion';
import { GlassCard, GlassCardContent } from './GlassCard';
import { Copy, Check, Terminal, Package, AlertCircle, Key, Settings, Info, ExternalLink, Globe } from 'lucide-react';
import { useState } from 'react';

const prerequisites = [
  { title: 'Docker', desc: 'Docker 20.10+ installed and running' },
  { title: 'ClickHouse Server', desc: 'Accessible ClickHouse instance to manage (can be added after deployment)' },
  { title: 'Port 5521', desc: 'Available port for the web interface' },
  { title: 'PostgreSQL (Optional)', desc: 'For production: PostgreSQL 12+ if using postgres backend for RBAC metadata' },
];

const quickStartCode = `# Pull the image
docker pull ghcr.io/daun-gatal/clickhouse-studio:latest

# Run with minimal configuration
docker run -d \\
  --name clickhouse-studio \\
  -p 5521:5521 \\
  -v clickhouse-studio-data:/app/data \\
  -e JWT_SECRET="$(openssl rand -base64 32)" \\
  -e RBAC_ENCRYPTION_KEY="$(openssl rand -hex 32)" \\
  ghcr.io/daun-gatal/clickhouse-studio:latest`;

const quickStartNote = 'Access at http://localhost:5521\n\nDefault login:\n• Email: admin@localhost\n• Password: admin123! (or set RBAC_ADMIN_PASSWORD)';

const productionCode = `# Pull the image
docker pull ghcr.io/daun-gatal/clickhouse-studio:latest

# Run with production settings
docker run -d \\
  --name clickhouse-studio \\
  -p 5521:5521 \\
  -v clickhouse-studio-data:/app/data \\
  -e JWT_SECRET="your-jwt-secret-here" \\
  -e RBAC_ENCRYPTION_KEY="your-encryption-key-here" \\
  -e CORS_ORIGIN="https://yourdomain.com" \\
  -e RBAC_ADMIN_PASSWORD="your-secure-password" \\
  ghcr.io/daun-gatal/clickhouse-studio:latest`;

const productionNote = '⚠️ Change JWT_SECRET and RBAC_ENCRYPTION_KEY in production!\n\nGenerate secure keys:\n• JWT_SECRET: openssl rand -base64 32\n• RBAC_ENCRYPTION_KEY: openssl rand -hex 32';

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

type TabType = 'overview' | 'prerequisites' | 'quickstart' | 'production' | 'envvars';

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
    { id: 'overview' as TabType, label: 'Overview', icon: Info },
    { id: 'prerequisites' as TabType, label: 'Prerequisites', icon: AlertCircle },
    { id: 'quickstart' as TabType, label: 'Docker', icon: Terminal },
    { id: 'production' as TabType, label: 'Production', icon: Settings },
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
          <p className="text-gray-400 text-xl mb-6">Try the live demo or deploy with Docker</p>
        </motion.div>

        {/* Live Demo Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <GlassCard className="bg-gradient-to-br from-purple-500/20 via-blue-500/20 to-purple-500/20 border-purple-400/40 hover:border-purple-300/60 transition-all duration-300">
            <GlassCardContent className="p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg">
                  <Globe className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-3xl font-bold mb-3 text-white">Live Demo</h3>
                  <p className="text-gray-400 text-base leading-relaxed">
                    Explore the full application with a live instance. No installation required! 
                    Experience all features including SQL editor, database explorer, query execution, 
                    and the complete RBAC system.
                  </p>
                </div>
              </div>
              <motion.a
                href="https://clickhouse-studio-ext.kitty-barb.ts.net/"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="block w-full px-8 py-5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg font-semibold shadow-lg shadow-purple-900/20 transition-all duration-300 flex items-center justify-center gap-2 text-lg"
              >
                <span>Open Live Demo</span>
                <ExternalLink className="w-5 h-5" />
              </motion.a>
              <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-400">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span>Demo is live and ready to explore</span>
              </div>
            </GlassCardContent>
          </GlassCard>
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
                          ClickHouse Studio is available as a Docker image from GitHub Container Registry (GHCR). 
                          You can quickly deploy it using Docker with minimal configuration, or set it up for production 
                          with custom environment variables.
                        </p>
                        <div className="grid md:grid-cols-2 gap-6 my-6">
                          <div className="p-5 bg-white/5 rounded-lg border border-white/10">
                            <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                              <Package className="w-5 h-5 text-purple-400" />
                              Image Location
                            </h4>
                            <code className="text-purple-400 text-sm block mb-2">ghcr.io/daun-gatal/clickhouse-studio:latest</code>
                            <p className="text-sm text-gray-400">
                              Pull directly from GitHub Container Registry. No authentication required for public images.
                            </p>
                          </div>
                          <div className="p-5 bg-white/5 rounded-lg border border-white/10">
                            <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                              <Terminal className="w-5 h-5 text-blue-400" />
                              Quick Setup
                            </h4>
                            <p className="text-sm text-gray-400 mb-2">
                              Get started in seconds with minimal configuration. Perfect for testing and development.
                            </p>
                            <p className="text-xs text-gray-500">
                              Default port: 5521
                            </p>
                          </div>
                        </div>
                        <div className="p-5 bg-white/5 rounded-lg border border-white/10 my-6">
                          <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                            <Settings className="w-5 h-5 text-green-400" />
                            Backend Metadata Storage
                          </h4>
                          <p className="text-sm text-gray-400 mb-4">
                            ClickHouse Studio supports two backend options for storing RBAC metadata (users, roles, permissions, connections):
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
                            Switch between backends using the <code className="text-purple-400">RBAC_DB_TYPE</code> environment variable. 
                            Set to <code className="text-purple-400">sqlite</code> (default) or <code className="text-purple-400">postgres</code>.
                          </p>
                        </div>
                        <div className="p-5 bg-blue-500/10 rounded-lg border border-blue-500/20 my-6">
                          <h4 className="text-white font-semibold mb-3">What You Get</h4>
                          <ul className="space-y-2 text-gray-300 text-sm space-y-2">
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>Web Interface</strong> - Full-featured UI for ClickHouse management</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>RBAC System</strong> - Built-in role-based access control with SQLite (default) or PostgreSQL</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>Secure Storage</strong> - Encrypted ClickHouse credentials stored server-side</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-purple-400 mt-1">•</span>
                              <span><strong>Multi-Connection</strong> - Manage multiple ClickHouse servers from one interface</span>
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
                              <span>Use PostgreSQL for production if you need scalability and high availability</span>
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

                {/* Quick Start Tab */}
                {activeTab === 'quickstart' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                      <Terminal className="w-6 h-6 text-purple-400" />
                      Quick Start
                    </h3>
                    <div className="relative">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">bash</span>
                        <motion.button
                          onClick={() => copyToClipboard(quickStartCode, 'quickstart')}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors"
                        >
                          {copied === 'quickstart' ? (
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
                          <code className="text-gray-300 font-mono">{quickStartCode}</code>
                        </pre>
                      </div>
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg"
                      >
                        <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">{quickStartNote}</p>
                      </motion.div>
                    </div>
                  </motion.div>
                )}

                {/* Production Tab */}
                {activeTab === 'production' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                      <Settings className="w-6 h-6 text-purple-400" />
                      Production Setup
                    </h3>
                    <div className="relative">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">bash</span>
                        <motion.button
                          onClick={() => copyToClipboard(productionCode, 'production')}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors"
                        >
                          {copied === 'production' ? (
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
                          <code className="text-gray-300 font-mono">{productionCode}</code>
                        </pre>
                      </div>
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
                      >
                        <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">{productionNote}</p>
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
