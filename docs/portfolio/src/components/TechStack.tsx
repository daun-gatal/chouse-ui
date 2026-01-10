import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { GlassCard, GlassCardContent } from './GlassCard';

const techStack = [
  { name: 'ClickHouse', icon: 'simple-icons:clickhouse', fallback: 'mdi:database', desc: 'Analytics database', url: 'https://clickhouse.com/', category: 'Database' },
  { name: 'Bun', icon: 'simple-icons:bun', fallback: 'mdi:language-javascript', desc: 'JavaScript runtime', url: 'https://bun.sh/', category: 'Runtime' },
  { name: 'Hono', icon: 'simple-icons:hono', fallback: 'mdi:web', desc: 'Web framework', url: 'https://hono.dev/', category: 'Framework' },
  { name: 'React', icon: 'simple-icons:react', fallback: 'mdi:react', desc: 'UI library', url: 'https://react.dev/', category: 'Frontend' },
  { name: 'Tailwind CSS', icon: 'simple-icons:tailwindcss', fallback: 'mdi:tailwind', desc: 'Styling', url: 'https://tailwindcss.com/', category: 'Styling' },
];

const categoryColors: Record<string, string> = {
  Database: 'from-blue-500 to-cyan-500',
  Runtime: 'from-purple-500 to-pink-500',
  Framework: 'from-green-500 to-emerald-500',
  Frontend: 'from-blue-500 to-indigo-500',
  Tooling: 'from-orange-500 to-red-500',
  Editor: 'from-yellow-500 to-orange-500',
  UI: 'from-pink-500 to-rose-500',
  State: 'from-indigo-500 to-purple-500',
  Data: 'from-cyan-500 to-blue-500',
  Styling: 'from-teal-500 to-cyan-500',
};

export default function TechStack() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="tech-stack" className="py-24 px-4 bg-gradient-to-b from-transparent via-blue-500/5 to-transparent relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 opacity-10">
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
          <h2 className="text-5xl md:text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              Built With
            </span>
          </h2>
          <p className="text-gray-400 text-xl">Modern technologies and best practices</p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 max-w-5xl mx-auto">
          {techStack.map((tech, index) => {
            const categoryColor = categoryColors[tech.category] || 'from-gray-500 to-gray-700';
            return (
              <motion.a
                key={tech.name}
                href={tech.url}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 30, scale: 0.9 }}
                animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
                transition={{ duration: 0.5, delay: index * 0.05 }}
                whileHover={{ y: -8, scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <GlassCard className="h-full bg-gradient-to-br from-white/10 to-white/5 border-purple-500/20 hover:border-purple-400/50 transition-all duration-300 group">
                  <GlassCardContent className="p-5">
                    <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${categoryColor} mb-3 flex items-center justify-center p-2`}>
                      <img
                        src={`https://api.iconify.design/${tech.icon}.svg?color=ffffff`}
                        alt={tech.name}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          // Fallback to alternative icon
                          const target = e.target as HTMLImageElement;
                          if (tech.fallback) {
                            target.src = `https://api.iconify.design/${tech.fallback}.svg?color=ffffff`;
                            target.onerror = () => {
                              // Final fallback: show a generic icon
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent) {
                                parent.innerHTML = '<div class="w-6 h-6 bg-white/30 rounded"></div>';
                              }
                            };
                          } else {
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.innerHTML = '<div class="w-6 h-6 bg-white/30 rounded"></div>';
                            }
                          }
                        }}
                      />
                    </div>
                    <h3 className="font-bold text-white mb-1 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-purple-400 group-hover:to-blue-400 group-hover:bg-clip-text transition-all duration-300">
                      {tech.name}
                    </h3>
                    <p className="text-sm text-gray-400">{tech.desc}</p>
                    <div className="mt-2 text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      {tech.category}
                    </div>
                  </GlassCardContent>
                </GlassCard>
              </motion.a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
