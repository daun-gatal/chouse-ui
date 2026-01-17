import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Tag } from 'lucide-react';

export default function Hero() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    // Fetch changelog to extract latest version
    const baseUrl = import.meta.env.BASE_URL || '/';
    const changelogPath = `${baseUrl}CHANGELOG.md`.replace(/\/+/g, '/');
    fetch(changelogPath)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load changelog');
        return res.text();
      })
      .then((text) => {
        // Extract the first version from CHANGELOG.md
        const versionMatch = text.match(/^## \[(v[\d.]+)\] - \d{4}-\d{2}-\d{2}/m);
        if (versionMatch) {
          setLatestVersion(versionMatch[1]);
        }
      })
      .catch(() => {
        // Silently fail if changelog can't be loaded
      });
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden" aria-label="Hero section">
      {/* Enhanced Animated Background */}
      <div className="absolute inset-0 z-0">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
            x: [0, 50, 0],
            y: [0, 30, 0],
          }}
          transition={{ duration: 20, repeat: Infinity }}
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.5, 0.3],
            x: [0, -40, 0],
            y: [0, -20, 0],
          }}
          transition={{ duration: 25, repeat: Infinity, delay: 0.5 }}
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.2, 0.4, 0.2],
            x: [0, 30, 0],
            y: [0, -30, 0],
          }}
          transition={{ duration: 30, repeat: Infinity, delay: 1 }}
          className="absolute top-1/2 right-1/3 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"
        />
      </div>

      {/* Animated Grid Pattern */}
      <div className="absolute inset-0 z-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(rgba(147, 51, 234, 0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(147, 51, 234, 0.1) 1px, transparent 1px)`,
          backgroundSize: '50px 50px',
        }} />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.5, rotate: -180 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.4 }}
          className="mb-8 flex justify-center"
        >
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 6, repeat: Infinity, repeatDelay: 2 }}
          >
            <img
              src={`${import.meta.env.BASE_URL}logo.svg`}
              alt="CHouse UI Logo - ClickHouse Database Management Interface"
              className="w-40 h-40 md:w-48 md:h-48 drop-shadow-[0_0_30px_rgba(255,200,0,0.6)]"
              width="192"
              height="192"
              loading="eager"
            />
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          <motion.h1
            className="text-6xl md:text-8xl font-bold mb-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <span className="bg-gradient-to-r from-white via-purple-200 to-blue-200 bg-clip-text text-transparent">
              CHouse
            </span>
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              UI
            </span>
          </motion.h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mb-6"
        >
          <p className="text-2xl md:text-3xl text-gray-300 mb-4 font-medium">
            Open-source ClickHouse web interface with built-in RBAC and enterprise security
          </p>
          {latestVersion && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.7, duration: 0.5 }}
              className="flex items-center justify-center gap-2 mt-4"
            >
              <Tag className="w-4 h-4 text-purple-400" />
              <span className="text-lg text-gray-400">
                Latest version: <span className="text-purple-400 font-semibold">{latestVersion}</span>
              </span>
            </motion.div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mb-8 max-w-4xl mx-auto"
        >
          <p className="text-xl md:text-2xl text-gray-300 mb-6 leading-relaxed font-light">
            Built from the ground up to solve real-world challenges in ClickHouse database management. 
            This project combines modern web technologies with enterprise-grade security to deliver a 
            powerful yet intuitive interface for teams.
          </p>
          
          {/* Interactive Feature Pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            {[
              { label: 'Zero-trust architecture', color: 'purple', icon: '🔒' },
              { label: 'Production-ready', color: 'blue', icon: '🚀' },
              { label: 'Enterprise security', color: 'pink', icon: '🛡️' },
              { label: 'RBAC built-in', color: 'cyan', icon: '👥' },
            ].map((feature, idx) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.7 + idx * 0.1, duration: 0.4 }}
                whileHover={{ scale: 1.05, y: -2 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:border-white/20 transition-all cursor-default backdrop-blur-sm"
              >
                <span className="text-sm">{feature.icon}</span>
                <span className="text-sm text-gray-300 font-medium">{feature.label}</span>
              </motion.div>
            ))}
          </div>

          {/* Key Benefits Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[
              { title: 'Secure by Default', desc: 'Credentials never leave the server', icon: '🔐' },
              { title: 'Role-Based Access', desc: 'Granular permissions for teams', icon: '🎯' },
              { title: 'Easy Deployment', desc: 'Docker-ready in minutes', icon: '⚡' },
            ].map((benefit, idx) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 + idx * 0.1, duration: 0.5 }}
                whileHover={{ y: -4, scale: 1.02 }}
                className="p-4 rounded-lg bg-white/5 border border-white/10 hover:border-purple-500/30 transition-all backdrop-blur-sm"
              >
                <div className="text-2xl mb-2">{benefit.icon}</div>
                <h3 className="text-white font-semibold mb-1 text-sm">{benefit.title}</h3>
                <p className="text-xs text-gray-400">{benefit.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.5 }}
          className="flex flex-col sm:flex-row justify-center items-center gap-4"
        >
          <motion.button
            onClick={() => scrollToSection('quick-start')}
            whileHover={{ scale: 1.05, boxShadow: '0 20px 40px rgba(147, 51, 234, 0.4)' }}
            whileTap={{ scale: 0.95 }}
            className="px-8 py-4 bg-gradient-to-r from-purple-600 via-blue-600 to-purple-600 bg-size-200 bg-pos-0 hover:bg-pos-100 text-white rounded-xl font-semibold shadow-2xl shadow-purple-900/30 transition-all duration-500 flex items-center justify-center gap-2 text-lg group"
            style={{
              backgroundSize: '200% 100%',
            }}
            aria-label="Get started with CHouse UI - scroll to quick start guide"
          >
            <span>Get Started</span>
            <motion.span
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              aria-hidden="true"
            >
              →
            </motion.span>
          </motion.button>
          
          <motion.a
            href="https://github.com/daun-gatal/chouse-ui"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-8 py-4 bg-white/5 border border-white/20 hover:border-white/30 text-white rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2 text-lg backdrop-blur-sm"
          >
            <span>View on GitHub</span>
            <span className="text-xl">⭐</span>
          </motion.a>
        </motion.div>
      </div>

    </section>
  );
}
