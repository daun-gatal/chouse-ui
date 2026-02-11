import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileUp, FileJson, FileType, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

interface StepUploadProps {
    onFileSelect: (file: File) => void;
}

export function StepUpload({ onFileSelect }: StepUploadProps) {
    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            onFileSelect(acceptedFiles[0]);
        }
    }, [onFileSelect]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        maxFiles: 1,
        accept: {
            'text/csv': ['.csv'],
            'application/json': ['.json'],
            'text/tab-separated-values': ['.tsv', '.tab'],
            'text/plain': ['.txt']
        }
    });

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 md:p-12 overflow-y-auto">
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-2xl space-y-8"
            >
                <div
                    {...getRootProps()}
                    className={cn(
                        "group relative flex flex-col items-center justify-center w-full min-h-[320px] rounded-3xl border-2 border-dashed transition-all duration-300 ease-in-out cursor-pointer overflow-hidden",
                        isDragActive
                            ? "border-blue-500 bg-blue-500/5 scale-[1.02] shadow-2xl shadow-blue-500/10"
                            : "border-white/10 hover:border-white/20 hover:bg-white/5"
                    )}
                >
                    <input {...getInputProps()} />

                    {/* Background decoration */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                    <div className="relative flex flex-col items-center justify-center px-6 text-center z-10 space-y-6">
                        {/* Icon Circle */}
                        <div className={cn(
                            "w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-xl",
                            isDragActive
                                ? "bg-gradient-to-br from-blue-500 to-blue-600 scale-110 rotate-3"
                                : "bg-white/5 border border-white/10 group-hover:scale-105 group-hover:bg-white/10"
                        )}>
                            {isDragActive ? (
                                <FileUp className="w-10 h-10 text-white animate-bounce" />
                            ) : (
                                <Upload className="w-10 h-10 text-gray-400 group-hover:text-blue-400 transition-colors" />
                            )}
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-2xl font-semibold text-white tracking-tight">
                                {isDragActive ? "Drop to upload" : "Upload your data file"}
                            </h3>
                            <p className="text-gray-400 max-w-sm mx-auto">
                                Drag and drop your CSV or JSON file here, or click to browse your computer
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                        <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
                            <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-white">CSV</span>
                            <span className="text-xs text-gray-500">Comma Separated</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                        <div className="p-2 rounded-lg bg-yellow-500/20 text-yellow-400">
                            <FileJson className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-white">JSON</span>
                            <span className="text-xs text-gray-500">Lines or Array</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                        <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
                            <FileType className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-white">TSV</span>
                            <span className="text-xs text-gray-500">Tab Separated</span>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
