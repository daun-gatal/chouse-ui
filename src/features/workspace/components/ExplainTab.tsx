import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import VisualExplain from './VisualExplain';

interface ExplainTabProps {
    plan: any;
    error?: string | null;
    isLoading?: boolean;
}

const ExplainTab: React.FC<ExplainTabProps> = ({ plan, error, isLoading }) => {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground animate-pulse">
                Generating explain plan...
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4">
                <Alert variant="destructive">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            </div>
        );
    }

    if (!plan) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                No explain plan available. Run "Explain" to visualize the query.
            </div>
        );
    }

    return (
        <div className="w-full h-full">
            <VisualExplain plan={plan} />
        </div>
    );
};

export default ExplainTab;
