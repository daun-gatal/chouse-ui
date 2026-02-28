import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface StepUploadProps {
    file: File | null;
    onFileSelect: (file: File) => void;
    onRemoveFile: () => void;
    onContinue: () => void;
    hasHeader: boolean;
    onHasHeaderChange: (checked: boolean) => void;
    isAnalyzing: boolean;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFormat(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.json')) return 'JSON';
    if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return 'TSV';
    return 'CSV';
}

export function StepUpload({
    file,
    onFileSelect,
    onRemoveFile,
    onContinue,
    hasHeader,
    onHasHeaderChange,
    isAnalyzing,
}: StepUploadProps) {
    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            if (acceptedFiles.length > 0) onFileSelect(acceptedFiles[0]);
        },
        [onFileSelect]
    );

    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
        maxFiles: 1,
        accept: {
            'text/csv': ['.csv'],
            'application/json': ['.json'],
            'text/tab-separated-values': ['.tsv', '.tab'],
            'text/plain': ['.txt'],
        },
    });

    const isCSVOrTSV = file && (getFormat(file.name) === 'CSV' || getFormat(file.name) === 'TSV');

    return (
        <div className="flex flex-col w-full p-4 sm:p-5">
            {!file ? (
                <div
                    {...getRootProps()}
                    className={cn(
                        'relative flex flex-col items-center justify-center min-h-[220px] w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
                        'border-white/15 hover:border-emerald-500/40 hover:bg-white/[0.02]'
                    )}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload file"
                >
                    <input {...getInputProps()} aria-hidden />
                    <div className="flex flex-col items-center gap-3 text-center px-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                            <Upload className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-white">Drop your file here</p>
                            <p className="text-xs text-gray-500 mt-0.5">or click to browse · CSV, JSON, or TSV</p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 shrink-0">
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                                <FileUp className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="font-medium text-white truncate" title={file.name}>
                                    {file.name}
                                </p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    {formatFileSize(file.size)} · {getFormat(file.name)}
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={onRemoveFile}
                                disabled={isAnalyzing}
                                className="shrink-0 h-8 w-8 text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                                aria-label="Remove file"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        {isCSVOrTSV && (
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                                <Checkbox
                                    id="hasHeader"
                                    checked={hasHeader}
                                    onCheckedChange={(c) => onHasHeaderChange(c === true)}
                                    className="border-white/20 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                <Label htmlFor="hasHeader" className="text-sm text-gray-400 cursor-pointer">
                                    First row is header
                                </Label>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                        <Button
                            onClick={onContinue}
                            disabled={isAnalyzing}
                            className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                            aria-label="Continue to preview"
                        >
                            Review schema
                        </Button>
                        <p className="text-xs text-gray-500 text-center">We’ll detect columns and types from your file.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
