import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import { ExternalLink, Copy, Check, FlaskConical, Zap, Database, Shield } from 'lucide-react';

const labFeatures = [
    { icon: Zap, label: 'No Install Required', color: 'from-amber-400 to-orange-500' },
    { icon: Database, label: 'Real ClickHouse Instance', color: 'from-blue-400 to-cyan-500' },
    { icon: Shield, label: 'Full Feature Access', color: 'from-purple-400 to-pink-500' },
];

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <motion.button
            onClick={handleCopy}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="ml-2 p-1 rounded-md hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
            aria-label={`Copy ${text}`}
        >
            {copied ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
            ) : (
                <Copy className="w-3.5 h-3.5" />
            )}
        </motion.button>
    );
}

export default function TryLab() {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: '-100px' });

    return (
        <section
            id="try-lab"
            className="py-28 px-4 relative overflow-hidden"
        >
            {/* Animated background */}
            <div className="absolute inset-0">
                {/* Central glow */}
                <motion.div
                    animate={{
                        scale: [1, 1.3, 1],
                        opacity: [0.15, 0.3, 0.15],
                    }}
                    transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-radial from-purple-600/30 via-blue-600/10 to-transparent rounded-full blur-3xl"
                    style={{
                        background: 'radial-gradient(circle, rgba(147,51,234,0.25) 0%, rgba(59,130,246,0.1) 50%, transparent 70%)',
                    }}
                />
                {/* Rotating rings */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-purple-500/15 rounded-full"
                />
                <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] border border-blue-500/10 rounded-full"
                />
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 50, repeat: Infinity, ease: 'linear' }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] border border-pink-500/5 rounded-full"
                />
            </div>

            <div className="max-w-4xl mx-auto relative z-10" ref={ref}>
                {/* Badge */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.5 }}
                    className="flex justify-center mb-8"
                >
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 backdrop-blur-sm">
                        <FlaskConical className="w-4 h-4 text-purple-400" />
                        <span className="text-sm text-purple-300 font-medium">Live Playground</span>
                    </div>
                </motion.div>

                {/* Headline */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    className="text-center mb-6"
                >
                    <h2 className="text-5xl md:text-7xl font-bold mb-4">
                        <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                            Try CHouse UI — Live
                        </span>
                    </h2>
                </motion.div>

                {/* Subtitle */}
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.6, delay: 0.2 }}
                    className="text-gray-400 text-lg md:text-xl text-center max-w-2xl mx-auto mb-10 leading-relaxed"
                >
                    Explore the full power of CHouse UI in our hosted lab environment.
                    No setup, no Docker, no configuration — just log in and start querying.
                </motion.p>

                {/* Feature pills */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.6, delay: 0.3 }}
                    className="flex flex-wrap items-center justify-center gap-4 mb-12"
                >
                    {labFeatures.map((feature, idx) => (
                        <motion.div
                            key={feature.label}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={isInView ? { opacity: 1, scale: 1 } : {}}
                            transition={{ duration: 0.4, delay: 0.4 + idx * 0.1 }}
                            whileHover={{ scale: 1.05, y: -2 }}
                            className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 hover:border-white/20 transition-all backdrop-blur-sm"
                        >
                            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${feature.color} flex items-center justify-center`}>
                                <feature.icon className="w-3.5 h-3.5 text-white" />
                            </div>
                            <span className="text-sm text-gray-300 font-medium">{feature.label}</span>
                        </motion.div>
                    ))}
                </motion.div>

                {/* Credentials card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.6, delay: 0.5 }}
                    className="max-w-md mx-auto mb-12"
                >
                    <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl p-6 shadow-2xl">
                        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4 text-center">
                            Guest Credentials
                        </p>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-white/5 border border-white/5">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500 uppercase tracking-wider w-16">User</span>
                                    <code className="text-sm text-purple-300 font-mono">guest</code>
                                </div>
                                <CopyButton text="guest" />
                            </div>
                            <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-white/5 border border-white/5">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500 uppercase tracking-wider w-16">Pass</span>
                                    <code className="text-sm text-purple-300 font-mono">Guest#User#21</code>
                                </div>
                                <CopyButton text="Guest#User#21" />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* CTA Button */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.6, delay: 0.6 }}
                    className="flex justify-center"
                >
                    <motion.a
                        href="https://lab.chouse-ui.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        whileHover={{ scale: 1.05, boxShadow: '0 20px 60px rgba(147, 51, 234, 0.5)' }}
                        whileTap={{ scale: 0.95 }}
                        className="px-10 py-4 bg-gradient-to-r from-purple-600 via-blue-600 to-purple-600 text-white rounded-xl font-semibold shadow-2xl shadow-purple-900/30 transition-all duration-500 flex items-center gap-3 text-lg group"
                        style={{ backgroundSize: '200% 100%' }}
                    >
                        <span>Launch Lab</span>
                        <motion.span
                            animate={{ x: [0, 4, 0] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                        >
                            <ExternalLink className="w-5 h-5" />
                        </motion.span>
                    </motion.a>
                </motion.div>

                {/* Subtle note */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={isInView ? { opacity: 1 } : {}}
                    transition={{ duration: 0.6, delay: 0.8 }}
                    className="text-center text-xs text-gray-600 mt-6"
                >
                    Read-only guest access · No sign-up required
                </motion.p>
            </div>
        </section>
    );
}
