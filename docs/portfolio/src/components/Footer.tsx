import { motion } from 'framer-motion';
import { Github } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black/50 backdrop-blur-xl py-16 px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <img
                src={`${import.meta.env.BASE_URL}logo.svg`}
                alt="CHouse UI"
                className="w-10 h-10 drop-shadow-[0_0_10px_rgba(255,200,0,0.3)]"
              />
              <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                CHouse UI
              </span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              A web interface for ClickHouse with built-in RBAC. 
              Built with modern technologies and best practices.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <h4 className="font-semibold text-white mb-6 text-lg">Navigation</h4>
            <ul className="space-y-3">
              {[
                { label: 'Features', href: '#features' },
                { label: 'Highlights', href: '#highlights' },
                { label: 'Quick Start', href: '#quick-start' },
                { label: 'Tech Stack', href: '#tech-stack' },
                { label: 'Latest Release', href: '#changelog' },
              ].map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="text-gray-400 hover:text-white transition-colors text-sm flex items-center gap-2 group"
                  >
                    <span className="w-0 group-hover:w-2 h-0.5 bg-gradient-to-r from-purple-400 to-blue-400 transition-all duration-300" />
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <h4 className="font-semibold text-white mb-6 text-lg">Repository</h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://github.com/daun-gatal/chouse-ui"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors text-sm flex items-center gap-2 group"
                >
                  <Github className="w-4 h-4" />
                  <span className="w-0 group-hover:w-2 h-0.5 bg-gradient-to-r from-purple-400 to-blue-400 transition-all duration-300" />
                  <span>GitHub</span>
                </a>
              </li>
            </ul>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="border-t border-white/10 pt-8 text-center"
        >
          <p className="text-gray-500 text-sm mb-2">
            © 2025 CHouse UI
          </p>
          <p className="text-gray-500 text-xs mb-2">
            Licensed under{' '}
            <a
              href="https://www.apache.org/licenses/LICENSE-2.0"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              Apache License 2.0
            </a>
          </p>
          <p className="text-gray-500 text-sm">
            Inspired by{' '}
            <a
              href="https://github.com/caioricciuti/ch-ui"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              CH-UI
            </a>{' '}
            by{' '}
            <a
              href="https://github.com/caioricciuti"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              Caio Ricciuti
            </a>
          </p>
        </motion.div>
      </div>
    </footer>
  );
}
