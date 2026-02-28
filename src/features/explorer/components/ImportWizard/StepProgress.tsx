import React, { useCallback } from 'react';
import { CheckCircle2, AlertCircle, Database, UploadCloud, Table2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface StepProgressProps {
    status: 'uploading' | 'creating_table' | 'success' | 'error';
    error?: string | null;
    database?: string;
    tableName?: string;
    onClose: () => void;
    onViewTable?: (database: string, table: string) => void;
    onTryAgain?: () => void;
}

export function StepProgress({ status, error, database, tableName, onClose, onViewTable, onTryAgain }: StepProgressProps) {
    const canViewTable = status === 'success' && database && tableName && onViewTable;

    const handleCopyError = useCallback(() => {
        const text = error || 'An unknown error occurred.';
        navigator.clipboard.writeText(text).then(
            () => toast.success('Copied'),
            () => toast.error('Failed to copy')
        );
    }, [error]);

    return (
        <div className="flex flex-col items-center justify-center min-h-full p-8">
            <div className="w-full max-w-sm flex flex-col items-center text-center space-y-8">
                {/* Icon */}
                <div className="relative">
                    {(status === 'uploading' || status === 'creating_table') && (
                        <motion.div
                            className="absolute -inset-3 rounded-full border-2 border-emerald-500/20 border-t-emerald-400"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                        />
                    )}
                    <div
                        className={cn(
                            'flex h-16 w-16 items-center justify-center rounded-2xl',
                            status === 'creating_table' && 'bg-emerald-500/10 text-emerald-400',
                            status === 'uploading' && 'bg-emerald-500/10 text-emerald-400',
                            status === 'success' && 'bg-emerald-500/15 text-emerald-400',
                            status === 'error' && 'bg-red-500/10 text-red-400'
                        )}
                    >
                        {status === 'creating_table' && <Database className="h-8 w-8" />}
                        {status === 'uploading' && <UploadCloud className="h-8 w-8" />}
                        {status === 'success' && <CheckCircle2 className="h-9 w-9" />}
                        {status === 'error' && <AlertCircle className="h-9 w-9" />}
                    </div>
                </div>

                {/* Text */}
                <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-white">
                        {status === 'creating_table' && 'Creating table…'}
                        {status === 'uploading' && 'Importing…'}
                        {status === 'success' && 'Done'}
                        {status === 'error' && 'Import failed'}
                    </h3>
                    <p className="text-sm text-gray-500">
                        {status === 'creating_table' && 'Setting up your table.'}
                        {status === 'uploading' && 'Uploading your data.'}
                        {status === 'success' && 'Your data is ready to query.'}
                        {status === 'error' && 'Something went wrong.'}
                    </p>
                </div>

                {/* Progress bar */}
                {(status === 'uploading' || status === 'creating_table') && (
                    <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                        <motion.div
                            className="h-full bg-emerald-500"
                            initial={{ x: '-100%' }}
                            animate={{ x: '100%' }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                        />
                    </div>
                )}

                {/* Success actions */}
                {status === 'success' && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="flex flex-col sm:flex-row gap-3 w-full"
                        aria-live="polite"
                    >
                        {canViewTable && (
                            <Button
                                onClick={() => onViewTable(database, tableName)}
                                className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                            >
                                <Table2 className="h-4 w-4" />
                                View table
                            </Button>
                        )}
                        <Button
                            onClick={onClose}
                            variant="outline"
                            className={cn(
                                "flex-1 h-11 border-white/15 text-gray-300 hover:bg-white/10 hover:text-white",
                                canViewTable && "sm:flex-initial"
                            )}
                        >
                            {canViewTable ? 'Close' : 'Done'}
                        </Button>
                    </motion.div>
                )}

                {/* Error */}
                {status === 'error' && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="w-full space-y-4"
                        aria-live="assertive"
                    >
                        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-left">
                            <p className="text-sm font-mono text-red-200 break-words max-h-36 overflow-auto">
                                {error || 'An unknown error occurred.'}
                            </p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyError}
                                className="border-white/10 text-gray-400 hover:bg-white/10 h-9"
                            >
                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                Copy
                            </Button>
                            {onTryAgain && (
                                <Button onClick={onTryAgain} size="sm" className="bg-emerald-600 hover:bg-emerald-500 h-9">
                                    Try again
                                </Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-400 hover:bg-white/10 h-9">
                                Cancel
                            </Button>
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
