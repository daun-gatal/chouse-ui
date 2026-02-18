import { motion } from 'framer-motion';
import { Rocket, Terminal, CheckCircle2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { GlassCard, GlassCardContent } from './GlassCard';

const steps = [
  {
    number: 1,
    title: 'Prerequisites',
    description: 'Minimal requirements',
    icon: CheckCircle2,
    content: (
      <div className="space-y-3">
        <p className="text-gray-300 text-sm">You'll need:</p>
        <ul className="space-y-2 text-sm text-gray-400">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span>Docker & Docker Compose</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span>Ports 5521 & 8123 available</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span>2GB+ RAM recommended</span>
          </li>
        </ul>
      </div>
    ),
  },
  {
    number: 2,
    title: 'Docker Compose',
    description: 'Full stack with ClickHouse',
    icon: Terminal,
    content: (
      <div className="space-y-3">
        <p className="text-gray-300 text-sm mb-3">Create <code className="text-purple-300">docker-compose.yml</code>:</p>
        <CodeBlock
          code={`services:
  chouse-ui:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    container_name: chouse-ui
    ports:
      - "5521:5521"
    environment:
      NODE_ENV: production
      JWT_SECRET: dev-secret-change-me
      RBAC_ENCRYPTION_KEY: dev-key-change-me
      RBAC_ENCRYPTION_SALT: dev-salt-change-me
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    container_name: clickhouse-server
    ports:
      - "8123:8123"
    environment:
      CLICKHOUSE_USER: admin
      CLICKHOUSE_PASSWORD: password
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
    restart: unless-stopped`}
        />
        <p className="text-gray-300 text-sm mt-3 mb-2">Then run:</p>
        <CodeBlock code="docker-compose up -d" />
      </div>
    ),
  },
  {
    number: 3,
    title: 'Access & Login',
    description: 'Open your browser and start using',
    icon: Rocket,
    content: (
      <div className="space-y-3">
        <div className="p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/20">
          <p className="text-white font-semibold mb-2">Access the UI:</p>
          <code className="text-purple-300 text-sm">http://localhost:5521</code>
        </div>
        <div className="p-4 bg-white/5 rounded-lg border border-white/10">
          <p className="text-white font-semibold mb-2">Default credentials:</p>
          <div className="space-y-1 text-sm">
            <p className="text-gray-300">
              <span className="text-gray-500">Email:</span> <code className="text-purple-300">admin@localhost</code>
            </p>
            <p className="text-gray-300">
              <span className="text-gray-500">Password:</span> <code className="text-purple-300">admin123!</code>
            </p>
          </div>
          <p className="text-xs text-yellow-400 mt-3">⚠️ Change password in production!</p>
        </div>
      </div>
    ),
  },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative group">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">bash</span>
        <motion.button
          onClick={copyToClipboard}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-2 px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="text-xs">Copy</span>
            </>
          )}
        </motion.button>
      </div>
      <div className="bg-black/60 backdrop-blur-sm p-4 rounded-lg border border-white/10 overflow-x-auto">
        <pre className="text-sm">
          <code className="text-gray-300 font-mono whitespace-pre">{code}</code>
        </pre>
      </div>
    </div>
  );
}

export default function QuickStart() {
  const [activeStep, setActiveStep] = useState<number | null>(null);

  return (
    <section id="quick-start" className="py-24 px-4 relative overflow-hidden" aria-label="Quick start guide">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
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
            <Rocket className="w-16 h-16 text-purple-400 mx-auto" />
          </motion.div>
          <h2 className="text-5xl md:text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              Quick Start
            </span>
          </h2>
          <p className="text-gray-400 text-xl mb-2">Get CHouse UI running in under 5 minutes</p>
          <p className="text-gray-500 text-sm">Perfect for trying out or deploying to production</p>
        </motion.div>

        {/* Interactive Steps */}
        <div className="space-y-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = activeStep === index;

            return (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="relative"
              >
                {/* Connection Line */}
                {index < steps.length - 1 && (
                  <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-gradient-to-b from-purple-500/30 to-transparent" />
                )}

                <motion.button
                  onClick={() => setActiveStep(isActive ? null : index)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="w-full text-left"
                >
                  <GlassCard className="overflow-hidden hover:border-purple-500/30 transition-all">
                    <GlassCardContent className="p-6">
                      <div className="flex items-start gap-4">
                        {/* Step Number & Icon */}
                        <motion.div
                          animate={{ scale: isActive ? 1.1 : 1 }}
                          className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg"
                        >
                          {isActive ? (
                            <Icon className="w-6 h-6 text-white" />
                          ) : (
                            <span className="text-white font-bold text-lg">{step.number}</span>
                          )}
                        </motion.div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <h3 className="text-xl font-bold text-white mb-1">{step.title}</h3>
                              <p className="text-sm text-gray-400">{step.description}</p>
                            </div>
                            <motion.div
                              animate={{ rotate: isActive ? 180 : 0 }}
                              transition={{ duration: 0.3 }}
                              className="text-gray-400"
                            >
                              <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 9l-7 7-7-7"
                                />
                              </svg>
                            </motion.div>
                          </div>

                          {/* Expandable Content */}
                          <motion.div
                            initial={false}
                            animate={{
                              height: isActive ? 'auto' : 0,
                              opacity: isActive ? 1 : 0,
                            }}
                            transition={{ duration: 0.3 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-4 pt-4 border-t border-white/10">
                              {step.content}
                            </div>
                          </motion.div>
                        </div>
                      </div>
                    </GlassCardContent>
                  </GlassCard>
                </motion.button>
              </motion.div>
            );
          })}
        </div>

        {/* Call to Action */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12 text-center"
        >
          <p className="text-gray-400 mb-4">Ready for production? Check out the production deployment guide below</p>
          <motion.button
            onClick={() => {
              const element = document.getElementById('docker-deploy');
              element?.scrollIntoView({ behavior: 'smooth' });
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-6 py-3 bg-white/5 border border-white/20 hover:border-white/30 text-white rounded-lg font-medium transition-all backdrop-blur-sm"
          >
            View Production Guide ↓
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
