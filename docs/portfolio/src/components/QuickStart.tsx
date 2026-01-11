import { motion } from 'framer-motion';
import { GlassCard, GlassCardContent, GlassCardTitle } from './GlassCard';
import { ExternalLink, Globe } from 'lucide-react';

export default function QuickStart() {
  return (
    <section id="quick-start" className="py-24 px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
      </div>

      <div className="max-w-4xl mx-auto relative z-10">
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
            <Globe className="w-16 h-16 text-purple-400 mx-auto" />
          </motion.div>
          <h2 className="text-5xl md:text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              Try It Out
            </span>
          </h2>
          <p className="text-gray-400 text-xl mb-6">Experience CHouse UI in action</p>
        </motion.div>

        {/* Live Demo Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <GlassCard className="bg-gradient-to-br from-purple-500/20 via-blue-500/20 to-purple-500/20 border-purple-400/40 hover:border-purple-300/60 transition-all duration-300">
            <GlassCardContent className="p-10">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg">
                  <Globe className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1">
                  <GlassCardTitle className="text-3xl mb-3">Live Demo</GlassCardTitle>
                  <p className="text-gray-400 text-base leading-relaxed">
                    Explore the full application with a live instance. No installation required! 
                    Experience all features including SQL editor, database explorer, query execution, 
                    and the complete RBAC system.
                  </p>
                </div>
              </div>
              <motion.a
                href="https://chouse-ui-ext.kitty-barb.ts.net/"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="block w-full px-8 py-5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg font-semibold shadow-lg shadow-purple-900/20 transition-all duration-300 flex items-center justify-center gap-2 text-lg"
              >
                <span>Open Live Demo</span>
                <ExternalLink className="w-5 h-5" />
              </motion.a>
              <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-sm text-gray-300 mb-2 font-semibold">Guest Login:</p>
                <div className="text-sm text-gray-400 space-y-1">
                  <p>• Username: <code className="text-purple-400">guest</code></p>
                  <p>• Password: <code className="text-purple-400">Guest123456!</code></p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-400">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span>Demo is live and ready to explore</span>
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>
      </div>
    </section>
  );
}
