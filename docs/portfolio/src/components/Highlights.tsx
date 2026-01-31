import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { GlassCard, GlassCardContent, GlassCardTitle, GlassCardDescription } from './GlassCard';
import {
  Shield,
  Users,
  Database,
  Zap,
} from 'lucide-react';

const highlights = [
  {
    icon: Shield,
    title: 'Enterprise Security',
    description: 'AES-256 encryption, Argon2 password hashing, SQL injection protection, and XSS prevention built-in.',
    color: 'from-purple-500 to-purple-700',
  },
  {
    icon: Users,
    title: 'Role-Based Access',
    description: '6 predefined roles with granular data access rules per user. Control who sees what.',
    color: 'from-blue-500 to-blue-700',
  },
  {
    icon: Database,
    title: 'Multi-Connection',
    description: 'Manage multiple ClickHouse servers from one interface. Switch connections instantly.',
    color: 'from-green-500 to-green-700',
  },
  {
    icon: Zap,
    title: 'Live Operations',
    description: 'Real-time query monitoring, metrics dashboard, and comprehensive audit logging.',
    color: 'from-orange-500 to-orange-700',
  },
];

export default function Highlights() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="highlights" className="py-24 px-4 bg-gradient-to-b from-transparent via-purple-500/5 to-transparent relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 opacity-10">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 left-1/4 w-64 h-64 border border-purple-500/30 rounded-full"
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 right-1/4 w-64 h-64 border border-blue-500/30 rounded-full"
        />
      </div>

      <div className="max-w-7xl mx-auto relative z-10" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-5xl md:text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              Why Choose CHouse UI?
            </span>
          </h2>
          <p className="text-gray-400 text-xl max-w-2xl mx-auto">
            Built for teams who need secure, scalable ClickHouse management
          </p>
        </motion.div>

        {/* Highlights Grid - 4 cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {highlights.map((highlight, index) => (
            <motion.div
              key={highlight.title}
              initial={{ opacity: 0, y: 30, rotateX: -15 }}
              animate={isInView ? { opacity: 1, y: 0, rotateX: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              whileHover={{ y: -12, scale: 1.02 }}
              style={{ perspective: 1000 }}
            >
              <GlassCard className="h-full bg-gradient-to-br from-white/10 to-white/5 border-purple-500/20 hover:border-purple-400/40 transition-all duration-300">
                <GlassCardContent className="p-6">
                  <motion.div
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    className={`w-14 h-14 rounded-xl bg-gradient-to-br ${highlight.color} flex items-center justify-center mb-4 shadow-xl`}
                  >
                    <highlight.icon className="w-7 h-7 text-white" />
                  </motion.div>
                  <GlassCardTitle className="text-xl mb-3">{highlight.title}</GlassCardTitle>
                  <GlassCardDescription className="text-sm leading-relaxed">
                    {highlight.description}
                  </GlassCardDescription>
                </GlassCardContent>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
