import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import { HelpCircle, ChevronDown } from 'lucide-react';
import { GlassCard, GlassCardContent } from './GlassCard';

const faqs = [
  {
    question: 'What is CHouse UI?',
    answer: 'CHouse UI is an open-source web UI for managing ClickHouse databases. It provides a secure, user-friendly way to interact with ClickHouse through a modern web browser, featuring built-in Role-Based Access Control (RBAC), encrypted credential storage, SQL query editor, and comprehensive database management tools.',
  },
  {
    question: 'How is CHouse UI different from other ClickHouse management tools?',
    answer: 'CHouse UI is designed specifically for teams requiring enterprise-grade security and centralized access control. Key features include server-side encrypted credential storage (credentials never reach the browser), comprehensive RBAC with 6 predefined roles and granular permissions, complete audit logging, and multi-connection support. Different tools serve different use cases - CHouse UI focuses on security, access control, and team collaboration for ClickHouse database management.',
  },
  {
    question: 'Is CHouse UI free and open source?',
    answer: 'Yes, CHouse UI is completely free and open source, licensed under Apache License 2.0. You can use it for personal projects, commercial applications, or contribute to its development. The source code is available on GitHub.',
  },
  {
    question: 'What security features does CHouse UI provide?',
    answer: 'CHouse UI includes multiple security layers: AES-256-GCM encryption for ClickHouse passwords, Argon2id password hashing for user accounts, JWT-based authentication with refresh tokens, comprehensive RBAC system with 6 predefined roles (Super Admin, Admin, Developer, Analyst, Viewer, Guest), granular data access rules, complete audit logging, SQL injection protection, XSS protection with DOMPurify, and PBKDF2 key derivation for encryption keys.',
  },
  {
    question: 'Can I use CHouse UI with multiple ClickHouse servers?',
    answer: 'Yes, CHouse UI supports managing multiple ClickHouse connections simultaneously. You can easily switch between different ClickHouse servers, and each connection\'s credentials are stored securely and encrypted separately.',
  },
  {
    question: 'What database backends does CHouse UI support for RBAC?',
    answer: 'CHouse UI supports two backend options for storing RBAC metadata: SQLite (default, perfect for single-instance deployments) and PostgreSQL (recommended for production with high availability requirements and multi-instance support).',
  },
  {
    question: 'How do I deploy CHouse UI?',
    answer: 'CHouse UI can be deployed using Docker Compose in minutes. Simply clone the repository, run docker-compose up -d, and access the UI at http://localhost:5521. For production deployments (v2.6.1+), you must configure three required environment variables: JWT_SECRET (min 32 chars), RBAC_ENCRYPTION_KEY (min 32 chars), and RBAC_ENCRYPTION_SALT (exactly 64 hex chars). See the Quick Start section for detailed instructions.',
  },
  {
    question: 'Does CHouse UI require direct ClickHouse access from the browser?',
    answer: 'No, CHouse UI uses a secure backend proxy architecture. All ClickHouse connections are made server-side, and credentials never reach the browser. This zero-trust architecture ensures maximum security.',
  },
  {
    question: 'What roles are available in CHouse UI?',
    answer: 'CHouse UI includes 6 predefined roles: Super Admin (full system access), Admin (server management), Developer (write access, DDL operations), Analyst (read access, queries), Viewer (read-only access), and Guest (read-only with system tables access). Each role has specific permissions tailored for different use cases and team responsibilities.',
  },
  {
    question: 'Can I integrate CHouse UI with my existing infrastructure?',
    answer: 'Yes, CHouse UI is designed to integrate seamlessly with existing infrastructure. It can connect to any ClickHouse server (cloud or self-hosted), supports Docker deployments, Kubernetes, and can be deployed behind reverse proxies with HTTPS.',
  },
];

export default function FAQ() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  // Generate FAQ Schema for SEO
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  };

  return (
    <>
      {/* FAQ Schema for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <section id="faq" className="py-24 px-4 relative overflow-hidden" aria-label="Frequently asked questions" ref={ref}>
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto relative z-10">
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
              <HelpCircle className="w-16 h-16 text-purple-400 mx-auto" />
            </motion.div>
            <h2 className="text-5xl md:text-6xl font-bold mb-4">
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                Frequently Asked Questions
              </span>
            </h2>
            <p className="text-gray-400 text-xl mb-2">Everything you need to know about CHouse UI</p>
            <p className="text-gray-500 text-sm">Click on any question to see the answer</p>
          </motion.div>

          <div className="space-y-4">
            {faqs.map((faq, index) => {
              const isExpanded = expandedIndex === index;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <motion.button
                    onClick={() => toggleExpand(index)}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="w-full text-left"
                    aria-expanded={isExpanded}
                    aria-controls={`faq-answer-${index}`}
                  >
                    <GlassCard className={`overflow-hidden transition-all ${isExpanded
                        ? 'border-purple-500/40 shadow-lg shadow-purple-500/20'
                        : 'hover:border-white/20'
                      }`}>
                      <GlassCardContent className="p-6">
                        <div className="flex items-start gap-4">
                          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                            <HelpCircle className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-bold text-white mb-2 pr-8">
                              {faq.question}
                            </h3>
                            <motion.div
                              initial={false}
                              animate={{
                                height: isExpanded ? 'auto' : 0,
                                opacity: isExpanded ? 1 : 0,
                              }}
                              transition={{ duration: 0.3 }}
                              className="overflow-hidden"
                              id={`faq-answer-${index}`}
                            >
                              <p className="text-gray-300 leading-relaxed pt-2">
                                {faq.answer}
                              </p>
                            </motion.div>
                          </div>
                          <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.3 }}
                            className="flex-shrink-0 text-gray-400"
                          >
                            <ChevronDown className="w-5 h-5" />
                          </motion.div>
                        </div>
                      </GlassCardContent>
                    </GlassCard>
                  </motion.button>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
