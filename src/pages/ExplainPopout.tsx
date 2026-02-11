import React, { useEffect, useState } from 'react';
import VisualExplain from "@/features/workspace/components/VisualExplain";

const ExplainPopout = () => {
    const [plan, setPlan] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        try {
            // Read plan from local storage
            const storedPlan = localStorage.getItem('explain_popout_data');
            if (storedPlan) {
                setPlan(JSON.parse(storedPlan));

                // Update document title
                document.title = "Visual Explain Plan - ClickHouse";
            } else {
                setError("No explain plan found. Please run an EXPLAIN query in the main window first.");
            }
        } catch (err) {
            setError("Failed to parse explain plan data.");
            console.error(err);
        }
    }, []);

    if (error) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a] text-white">
                <div className="text-center p-8 border border-white/10 rounded-lg bg-white/5 backdrop-blur-sm">
                    <h1 className="text-xl font-bold mb-2">Error</h1>
                    <p className="text-muted-foreground">{error}</p>
                </div>
            </div>
        );
    }

    if (!plan) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a] text-white">
                <div className="text-muted-foreground">Loading explain plan...</div>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen bg-[#0a0a0a] text-white overflow-hidden">
            <VisualExplain plan={plan} />
        </div>
    );
};

export default ExplainPopout;
