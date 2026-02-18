import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { GlassCard, GlassCardContent } from './GlassCard';

const techStack = [
  { name: 'ClickHouse', icon: 'simple-icons:clickhouse', fallback: 'mdi:database', desc: 'Analytics database', url: 'https://clickhouse.com/', category: 'Database' },
  { name: 'PostgreSQL', icon: 'simple-icons:postgresql', fallback: 'mdi:database', desc: 'RBAC Storage', url: 'https://www.postgresql.org/', category: 'Database' },
  { name: 'Bun', icon: 'simple-icons:bun', fallback: 'mdi:language-javascript', desc: 'JavaScript runtime', url: 'https://bun.sh/', category: 'Runtime' },
  { name: 'Hono', icon: 'simple-icons:hono', fallback: 'mdi:web', desc: 'Web framework', url: 'https://hono.dev/', category: 'Framework' },
  { name: 'React', icon: 'simple-icons:react', fallback: 'mdi:react', desc: 'UI library', url: 'https://react.dev/', category: 'Frontend' },
  { name: 'Tailwind CSS', icon: 'simple-icons:tailwindcss', fallback: 'mdi:tailwind', desc: 'Styling', url: 'https://tailwindcss.com/', category: 'Styling' },
  { name: 'AI Models', icon: 'mdi:brain', fallback: 'mdi:robot', desc: 'Query Optimization', url: 'https://chouse-ui.com', category: 'AI' },
  { name: 'Vite', icon: 'simple-icons:vite', fallback: 'mdi:lightning-bolt', desc: 'Build tool', url: 'https://vitejs.dev/', category: 'Tooling' },
];

const categoryColors: Record<string, string> = {
  Database: 'from-blue-500 to-cyan-500',
  Runtime: 'from-purple-500 to-pink-500',
  Framework: 'from-green-500 to-emerald-500',
  Frontend: 'from-blue-500 to-indigo-500',
  Tooling: 'from-orange-500 to-red-500',
  Styling: 'from-teal-500 to-cyan-500',
  AI: 'from-orange-500 to-red-500',
};

export default function TechStack() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  // Duplicate for seamless marquee effect
  const seamlessStack = [...techStack, ...techStack, ...techStack, ...techStack];

  return (
    <section id="tech-stack" className="py-24 px-4 bg-gradient-to-b from-transparent via-blue-500/5 to-transparent relative overflow-hidden group/stack">
      {/* Animated background background decoration */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <motion.div
          animate={{
            x: [0, 100, 0],
            y: [0, 50, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{ duration: 15, repeat: Infinity }}
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -80, 0],
            y: [0, -40, 0],
            scale: [1, 1.3, 1],
          }}
          transition={{ duration: 20, repeat: Infinity }}
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-3xl"
        />
      </div>

      <div className="max-w-7xl mx-auto relative z-10" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-5xl md:text-6xl font-bold mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              Built With
            </span>
          </h2>
          <p className="text-gray-400 text-xl font-medium">Modern technologies and best practices</p>
        </motion.div>

        <div className="relative w-full overflow-hidden pause-on-hover py-12">
          {/* Gradient Masks */}
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#0a0a0a] to-transparent z-20 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#0a0a0a] to-transparent z-20 pointer-events-none" />

          <div className="flex w-max animate-marquee gap-6">
            {seamlessStack.map((tech, index) => {
              const categoryColor = categoryColors[tech.category] || 'from-gray-500 to-gray-700';
              return (
                <motion.a
                  key={`${tech.name}-${index}`}
                  href={tech.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-[280px] flex-shrink-0"
                  whileHover={{ y: -8 }}
                >
                  <GlassCard className="h-full bg-white/[0.03] border-white/10 hover:border-purple-500/30 hover:bg-white/[0.05] transition-all duration-300">
                    <GlassCardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${categoryColor} flex items-center justify-center p-2.5 shadow-lg`}>
                          <img
                            src={`https://api.iconify.design/${tech.icon}.svg?color=ffffff`}
                            alt={tech.name}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              if (tech.fallback) {
                                target.src = `https://api.iconify.design/${tech.fallback}.svg?color=ffffff`;
                              } else {
                                target.style.display = 'none';
                                const parent = target.parentElement;
                                if (parent) parent.innerHTML = '<div class="w-6 h-6 bg-white/20 rounded"></div>';
                              }
                            }}
                          />
                        </div>
                        <span className="text-[10px] uppercase font-black tracking-widest text-gray-500 group-hover:text-purple-400 transition-colors">
                          {tech.category}
                        </span>
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2 group-hover:text-purple-400 transition-colors">
                        {tech.name}
                      </h3>
                      <p className="text-sm text-gray-400 leading-relaxed line-clamp-2">
                        {tech.desc}
                      </p>
                    </GlassCardContent>
                  </GlassCard>
                </motion.a>
              );
            })}
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-gray-500 text-sm">Hover to pause • Click to learn more</p>
        </div>
      </div>
    </section>
  );
}
