import { motion } from 'framer-motion';
import { useState } from 'react';
import { GlassCard, GlassCardContent, GlassCardTitle, GlassCardDescription } from './GlassCard';
import {
  Shield,
  Database,
  BarChart3,
  Palette,
  Lock,
  Users,
  FileText,
  Zap,
  Search,
  Download,
  Settings,
  Eye,
  ChevronRight,
  Activity,
  Star,
  Sparkles,
  Bot,
} from 'lucide-react';

const features = [
  {
    category: 'AI & Automation',
    icon: Sparkles,
    color: 'from-amber-500 to-amber-700',
    items: [
      { icon: Zap, title: 'AI Query Optimizer', desc: 'Intelligent query rewriting for performance' },
      { icon: Bot, title: 'Smart Query Debugging', desc: 'Automated error analysis and fix suggestions' },
    ],
  },
  {
    category: 'Security & Access Control',
    icon: Shield,
    color: 'from-purple-500 to-purple-700',
    items: [
      { icon: Shield, title: 'RBAC System', desc: 'Role-based permissions (Super Admin, Admin, Developer, Analyst, Viewer, Guest)' },
      { icon: Lock, title: 'Encrypted Credentials', desc: 'AES-256-GCM encryption with PBKDF2 key derivation for ClickHouse connection passwords' },
      { icon: Users, title: 'JWT Authentication', desc: 'Secure token-based sessions with access and refresh tokens' },
      { icon: FileText, title: 'Audit Logging', desc: 'Track all user actions and query history' },
    ],
  },
  {
    category: 'Database Management',
    icon: Database,
    color: 'from-blue-500 to-blue-700',
    items: [
      { icon: Database, title: 'Multi-Connection Support', desc: 'Manage multiple ClickHouse servers' },
      { icon: Activity, title: 'Live Query Management', desc: 'View and kill running queries in real-time' },
      { icon: Search, title: 'Database Explorer', desc: 'Tree view with schema inspection' },
      { icon: Settings, title: 'Table Management', desc: 'Create, alter, and drop tables with various engines' },
      { icon: Download, title: 'File Upload', desc: 'Upload CSV, TSV, or JSON files to existing tables' },
    ],
  },
  {
    category: 'Query & Analytics',
    icon: BarChart3,
    color: 'from-green-500 to-green-700',
    items: [
      { icon: FileText, title: 'SQL Editor', desc: 'Monaco editor with syntax highlighting and auto-completion' },
      { icon: Zap, title: 'Query Execution', desc: 'Run queries with execution statistics' },
      { icon: Eye, title: 'Query History', desc: 'View and filter query logs with auto-refresh' },
      { icon: FileText, title: 'Auto-Save Queries', desc: 'Real-time sync like Google Docs with ⌘S instant save' },
      { icon: Download, title: 'Data Export', desc: 'CSV, JSON, TSV formats' },
    ],
  },
  {
    category: 'User Experience',
    icon: Palette,
    color: 'from-pink-500 to-pink-700',
    items: [
      { icon: Palette, title: 'Modern UI', desc: 'Glassmorphism design with dark theme' },
      { icon: Star, title: 'Favorites & Recent', desc: 'Star databases and tables for quick access' },
      { icon: Settings, title: 'Responsive', desc: 'Works on desktop and tablet' },
      { icon: Zap, title: 'Keyboard Shortcuts', desc: 'Power user support' },
    ],
  },
];

export default function Features() {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  return (
    <section id="features" className="py-24 px-4 relative overflow-hidden" aria-label="Features section">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-block mb-6"
          >
            <span className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              Powerful Features
            </span>
          </motion.div>
          <p className="text-gray-400 text-xl max-w-2xl mx-auto mt-4">
            Everything you need to manage ClickHouse databases securely and efficiently
          </p>
          <p className="text-gray-500 text-sm max-w-xl mx-auto mt-2">
            Click on any category below to explore detailed features
          </p>
        </motion.div>

        <div className="space-y-8">
          {features.map((category, categoryIndex) => (
            <motion.div
              key={category.category}
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.6, delay: categoryIndex * 0.1 }}
            >
              <motion.button
                onClick={() => setExpandedCategory(expandedCategory === category.category ? null : category.category)}
                className="w-full"
                whileHover={{ scale: 1.01, y: -2 }}
                whileTap={{ scale: 0.99 }}
              >
                <GlassCard className={`overflow-hidden transition-all ${expandedCategory === category.category
                  ? 'border-purple-500/40 shadow-lg shadow-purple-500/20'
                  : 'hover:border-white/20'
                  }`}>
                  <div className="p-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <motion.div
                        animate={{
                          scale: expandedCategory === category.category ? 1.1 : 1,
                          rotate: expandedCategory === category.category ? 5 : 0
                        }}
                        className={`w-14 h-14 rounded-xl bg-gradient-to-br ${category.color} flex items-center justify-center shadow-lg`}
                      >
                        <category.icon className="w-7 h-7 text-white" />
                      </motion.div>
                      <div className="text-left">
                        <h3 className="text-2xl font-bold text-white mb-1">{category.category}</h3>
                        <p className="text-sm text-gray-400">
                          {category.items.length} {category.items.length === 1 ? 'feature' : 'features'}
                        </p>
                      </div>
                    </div>
                    <motion.div
                      animate={{
                        rotate: expandedCategory === category.category ? 90 : 0,
                        scale: expandedCategory === category.category ? 1.1 : 1
                      }}
                      transition={{ duration: 0.3 }}
                      className="text-gray-400"
                    >
                      <ChevronRight className="w-6 h-6" />
                    </motion.div>
                  </div>

                  <motion.div
                    initial={false}
                    animate={{
                      height: expandedCategory === category.category ? 'auto' : 0,
                      opacity: expandedCategory === category.category ? 1 : 0,
                    }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 pb-6 pt-0">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        {category.items.map((item, itemIndex) => (
                          <motion.div
                            key={item.title}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{
                              opacity: expandedCategory === category.category ? 1 : 0,
                              y: expandedCategory === category.category ? 0 : 10,
                            }}
                            transition={{ delay: itemIndex * 0.05 }}
                            whileHover={{ y: -4 }}
                          >
                            <motion.div
                              whileHover={{ y: -4, scale: 1.02 }}
                              transition={{ duration: 0.2 }}
                            >
                              <GlassCard className="bg-white/5 border-white/10 hover:border-purple-500/30 transition-all duration-300 h-full group">
                                <GlassCardContent className="p-5">
                                  <div className="flex items-start gap-4">
                                    <motion.div
                                      whileHover={{ rotate: 5, scale: 1.1 }}
                                      className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-400/30 flex items-center justify-center flex-shrink-0 group-hover:border-purple-400/50 transition-colors"
                                    >
                                      <item.icon className="w-5 h-5 text-purple-400 group-hover:text-purple-300 transition-colors" />
                                    </motion.div>
                                    <div className="flex-1 min-w-0">
                                      <GlassCardTitle className="text-base mb-2 text-white group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-purple-400 group-hover:to-blue-400 group-hover:bg-clip-text transition-all">
                                        {item.title}
                                      </GlassCardTitle>
                                      <GlassCardDescription className="text-sm text-gray-400 leading-relaxed group-hover:text-gray-300 transition-colors">
                                        {item.desc}
                                      </GlassCardDescription>
                                    </div>
                                  </div>
                                </GlassCardContent>
                              </GlassCard>
                            </motion.div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </GlassCard>
              </motion.button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
