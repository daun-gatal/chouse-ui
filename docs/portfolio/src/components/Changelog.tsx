import { motion, useInView, AnimatePresence } from 'framer-motion';
import { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GlassCard, GlassCardContent } from './GlassCard';
import { Calendar, Tag, ChevronDown } from 'lucide-react';

interface ChangelogEntry {
  version: string;
  date: string;
  content: string;
}

export default function Changelog() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [changelog, setChangelog] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Fetch changelog from public folder using base URL
    const baseUrl = import.meta.env.BASE_URL || '/';
    const changelogPath = `${baseUrl}CHANGELOG.md`.replace(/\/+/g, '/'); // Normalize slashes
    fetch(changelogPath)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load changelog');
        return res.text();
      })
      .then((text) => {
        setChangelog(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Parse changelog entries
  const parseChangelog = (markdown: string): ChangelogEntry[] => {
    const entries: ChangelogEntry[] = [];
    const versionRegex = /^## \[(v[\d.]+)\] - (\d{4}-\d{2}-\d{2})/gm;
    
    // Find all version matches first
    const matches: Array<{ version: string; date: string; index: number }> = [];
    let match;
    
    while ((match = versionRegex.exec(markdown)) !== null) {
      matches.push({
        version: match[1],
        date: match[2],
        index: match.index,
      });
    }
    
    // Extract content for each version
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextIndex = i < matches.length - 1 ? matches[i + 1].index : markdown.length;
      let content = markdown.substring(current.index, nextIndex).trim();
      
      // Remove the version header line from content since we display it separately
      const headerRegex = /^## \[v[\d.]+\] - \d{4}-\d{2}-\d{2}\s*\n?/m;
      content = content.replace(headerRegex, '').trim();
      
      entries.push({
        version: current.version,
        date: current.date,
        content: content,
      });
    }

    // Return the last 3 releases (first 3 entries)
    return entries.slice(0, 3);
  };

  const entries = changelog ? parseChangelog(changelog) : [];

  // Initialize expanded state: expand only the latest release by default
  useEffect(() => {
    if (entries.length > 0 && expandedVersions.size === 0) {
      setExpandedVersions(new Set([entries[0].version]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changelog]);

  const toggleExpand = (version: string) => {
    setExpandedVersions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(version)) {
        newSet.delete(version);
      } else {
        newSet.add(version);
      }
      return newSet;
    });
  };

  const isExpanded = (version: string) => expandedVersions.has(version);

  return (
    <section id="changelog" className="py-24 px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
      </div>

      <div className="max-w-5xl mx-auto relative z-10" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5 }}
            className="inline-block mb-6"
          >
            <span className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Latest Release
            </span>
          </motion.div>
          <p className="text-gray-400 text-xl max-w-2xl mx-auto mt-4">
            See what's new in the latest releases
          </p>
        </motion.div>

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
            <p className="text-gray-400 mt-4">Loading changelog...</p>
          </div>
        )}

        {error && (
          <GlassCard className="bg-red-500/10 border-red-500/20">
            <GlassCardContent className="p-6">
              <p className="text-red-400">Error loading changelog: {error}</p>
            </GlassCardContent>
          </GlassCard>
        )}

        {!loading && !error && entries.length === 0 && changelog && (
          <GlassCard>
            <GlassCardContent className="p-6">
              <p className="text-gray-400">No version entries found in changelog.</p>
            </GlassCardContent>
          </GlassCard>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="space-y-8">
            {entries.map((entry, index) => (
              <motion.div
                key={entry.version}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.1 }}
              >
                <GlassCard className="overflow-hidden">
                  <GlassCardContent className="p-8">
                    <div 
                      className="flex items-center gap-4 mb-6 pb-6 border-b border-white/10 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => toggleExpand(entry.version)}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                        <Tag className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-2xl font-bold text-white">
                            {entry.version}
                          </h3>
                          {index === 0 && (
                            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 text-green-400 animate-pulse">
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-gray-400 text-sm">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(entry.date).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                          })}</span>
                        </div>
                      </div>
                      <motion.div
                        animate={{ rotate: isExpanded(entry.version) ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                        className="text-gray-400 hover:text-white transition-colors"
                      >
                        <ChevronDown className="w-6 h-6" />
                      </motion.div>
                    </div>
                    
                    <AnimatePresence initial={false}>
                      {isExpanded(entry.version) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className="prose prose-invert prose-purple max-w-none">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-white mt-6 mb-4" {...props} />,
                                h2: ({node, ...props}) => <h2 className="text-xl font-bold text-white mt-5 mb-3" {...props} />,
                                h3: ({node, ...props}) => <h3 className="text-lg font-semibold text-white mt-4 mb-2" {...props} />,
                                h4: ({node, ...props}) => <h4 className="text-base font-semibold text-white mt-3 mb-2" {...props} />,
                                p: ({node, ...props}) => <p className="text-gray-300 mb-3 leading-relaxed" {...props} />,
                                ul: ({node, ...props}) => <ul className="list-disc list-inside text-gray-300 mb-4 space-y-2 ml-4" {...props} />,
                                ol: ({node, ...props}) => <ol className="list-decimal list-inside text-gray-300 mb-4 space-y-2 ml-4" {...props} />,
                                li: ({node, ...props}) => <li className="text-gray-300 leading-relaxed" {...props} />,
                                strong: ({node, ...props}) => <strong className="font-bold text-white" {...props} />,
                                code: ({node, ...props}) => <code className="bg-white/10 px-2 py-1 rounded text-purple-300 text-sm font-mono" {...props} />,
                                pre: ({node, ...props}) => <pre className="bg-black/30 p-4 rounded-lg overflow-x-auto mb-4 border border-white/10" {...props} />,
                                a: ({node, ...props}) => <a className="text-purple-400 hover:text-purple-300 underline" {...props} />,
                                blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-purple-500 pl-4 italic text-gray-400 my-4" {...props} />,
                              }}
                            >
                              {entry.content}
                            </ReactMarkdown>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </GlassCardContent>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
