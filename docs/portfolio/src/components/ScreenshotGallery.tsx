
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';
import { GlassCard } from './GlassCard';

export default function ScreenshotGallery() {
    const [screenshots, setScreenshots] = useState<string[]>([]);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/screenshots.json')
            .then((res) => res.json())
            .then((data) => {
                setScreenshots(data);
                setLoading(false);
            })
            .catch((err) => {
                console.error('Failed to load screenshots:', err);
                setLoading(false);
            });
    }, []);

    const handleNext = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!selectedImage) return;
        const currentIndex = screenshots.indexOf(selectedImage);
        const nextIndex = (currentIndex + 1) % screenshots.length;
        setSelectedImage(screenshots[nextIndex]);
    };

    const handlePrev = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!selectedImage) return;
        const currentIndex = screenshots.indexOf(selectedImage);
        const prevIndex = (currentIndex - 1 + screenshots.length) % screenshots.length;
        setSelectedImage(screenshots[prevIndex]);
    };

    if (loading || screenshots.length === 0) return null;

    // Duplicate the array to create a seamless loop
    const seamlessScreenshots = [...screenshots, ...screenshots, ...screenshots, ...screenshots];

    return (
        <section id="gallery" className="py-24 relative overflow-hidden bg-black/40 backdrop-blur-sm border-y border-white/5">
            <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[100px]" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[100px]" />
            </div>

            <div className="max-w-7xl mx-auto relative z-10 px-4 mb-12 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                >
                    <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-4">
                        Interface Preview
                    </h2>
                    <p className="text-gray-400 max-w-2xl mx-auto">
                        A glimpse into the diverse tools available in our platform.
                    </p>
                </motion.div>
            </div>

            <div className="relative w-full overflow-hidden pause-on-hover py-8">
                {/* Gradient Masks */}
                <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#0a0a0a] to-transparent z-20 pointer-events-none" />
                <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#0a0a0a] to-transparent z-20 pointer-events-none" />

                <div className="flex w-max animate-marquee gap-8 pl-8">
                    {seamlessScreenshots.map((screenshot, index) => (
                        <div
                            key={`${screenshot}-${index}`}
                            className="relative group cursor-pointer flex-shrink-0 w-[600px] aspect-video rounded-xl overflow-hidden border border-white/10 hover:border-purple-500/50 hover:shadow-[0_0_30px_rgba(168,85,247,0.2)] transition-all duration-300"
                            onClick={() => setSelectedImage(screenshot)}
                        >
                            <GlassCard className="h-full w-full bg-black/40">
                                <div className="relative h-full w-full">
                                    <img
                                        src={`/screenshots/${screenshot}`}
                                        alt={screenshot}
                                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700"
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-300" />

                                    {/* Overlay Content */}
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                                        <div className="bg-black/60 backdrop-blur-md p-3 rounded-full border border-white/10 text-white">
                                            <ZoomIn className="w-6 h-6" />
                                        </div>
                                    </div>

                                    <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 to-transparent translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                                        <p className="text-white text-sm font-medium capitalize truncate">
                                            {screenshot.replace(/[-_]/g, ' ').replace(/\.png$/i, '')}
                                        </p>
                                    </div>
                                </div>
                            </GlassCard>
                        </div>
                    ))}
                </div>
            </div>

            <AnimatePresence>
                {selectedImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedImage(null)}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl"
                    >
                        <button
                            onClick={() => setSelectedImage(null)}
                            className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors z-50 hover:bg-white/10 rounded-full"
                        >
                            <X className="w-8 h-8" />
                        </button>

                        <button
                            onClick={handlePrev}
                            className="absolute left-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors z-50 border border-white/5 backdrop-blur-md group hidden md:block" // Hidden on mobile for space
                        >
                            <ChevronLeft className="w-8 h-8 group-hover:-translate-x-1 transition-transform" />
                        </button>

                        <button
                            onClick={handleNext}
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors z-50 border border-white/5 backdrop-blur-md group hidden md:block"
                        >
                            <ChevronRight className="w-8 h-8 group-hover:translate-x-1 transition-transform" />
                        </button>

                        {/* Mobile Navigation overlay at bottom */}
                        <div className="absolute bottom-4 inset-x-0 flex justify-center gap-8 md:hidden z-50">
                            <button onClick={handlePrev} className="p-4 rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronLeft /></button>
                            <button onClick={handleNext} className="p-4 rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronRight /></button>
                        </div>

                        <motion.div
                            className="relative max-w-7xl w-full h-full max-h-[90vh] flex items-center justify-center p-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <motion.img
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                src={`/screenshots/${selectedImage}`}
                                alt={selectedImage}
                                className="w-full h-full object-contain max-h-[85vh] rounded-lg shadow-2xl"
                            />
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/50 backdrop-blur-md rounded-full border border-white/10"
                            >
                                <p className="text-white text-lg font-medium capitalize">
                                    {selectedImage.replace(/[-_]/g, ' ').replace(/\.png$/i, '')}
                                </p>
                            </motion.div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
