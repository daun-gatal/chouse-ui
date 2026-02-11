import React from 'react';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, AlertCircle, Loader2, Database, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface StepProgressProps {
    status: 'uploading' | 'creating_table' | 'success' | 'error';
    error?: string | null;
    onClose: () => void;
    onReset: () => void;
}

export function StepProgress({ status, error, onClose, onReset }: StepProgressProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-lg flex flex-col items-center text-center space-y-10"
            >
                {/* Status Icon */}
                <div className="relative">
                    {/* Ring Animation for active states */}
                    {(status === 'uploading' || status === 'creating_table') && (
                        <motion.div
                            className="absolute -inset-4 rounded-full border border-blue-500/30 border-t-blue-500"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        />
                    )}

                    <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 border border-white/10 flex items-center justify-center shadow-2xl">
                        {status === 'creating_table' && <Database className="w-10 h-10 text-blue-400" />}
                        {status === 'uploading' && <UploadCloud className="w-10 h-10 text-purple-400" />}
                        {status === 'success' && <CheckCircle2 className="w-12 h-12 text-green-400" />}
                        {status === 'error' && <AlertCircle className="w-12 h-12 text-red-400" />}
                    </div>
                </div>

                {/* Text Content */}
                <div className="space-y-3">
                    <h3 className="text-3xl font-light text-white tracking-tight">
                        {status === 'creating_table' && 'Creating Table...'}
                        {status === 'uploading' && 'Importing Data...'}
                        {status === 'success' && 'Import Successful'}
                        {status === 'error' && 'Import Failed'}
                    </h3>
                    <p className="text-gray-400 text-lg">
                        {status === 'creating_table' && 'Setting up the schema structure in ClickHouse.'}
                        {status === 'uploading' && 'Streaming your file content directly to the database.'}
                        {status === 'success' && 'Your data is now ready to query.'}
                        {status === 'error' && 'Something went wrong during the import process.'}
                    </p>
                </div>

                {/* Progress Bar (Indeterminate) */}
                {(status === 'uploading' || status === 'creating_table') && (
                    <div className="w-full max-w-sm bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <motion.div
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                            initial={{ x: '-100%' }}
                            animate={{ x: '100%' }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                        />
                    </div>
                )}

                {/* Success Actions */}
                {status === 'success' && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="pt-4"
                    >
                        <Button onClick={onClose} size="lg" className="min-w-[150px] bg-green-600 hover:bg-green-500 text-white rounded-full">
                            Complete
                        </Button>
                    </motion.div>
                )}

                {/* Error Box & Actions */}
                {status === 'error' && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="w-full space-y-6"
                    >
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-200 font-mono text-left max-h-48 overflow-auto">
                            {error || 'An unknown error occurred.'}
                        </div>
                        <div className="flex justify-center gap-4">
                            <Button variant="ghost" onClick={onClose} className="hover:bg-white/10 text-gray-300">
                                Cancel
                            </Button>
                            <Button onClick={onReset} variant="outline" className="border-white/10 hover:bg-white/5 text-white">
                                Try Again
                            </Button>
                        </div>
                    </motion.div>
                )}
            </motion.div>
        </div>
    );
}
