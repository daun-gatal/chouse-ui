import { Bot } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProvidersTab from './ProvidersTab';
import BaseModelsTab from './BaseModelsTab';
import ConfigsTab from './ConfigsTab';

export default function AiModelsManagement() {
    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6 flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                    <Bot className="h-4 w-4" aria-hidden />
                </span>
                <div className="flex flex-col gap-0.5">
                    <h2 className="text-[18px] font-semibold tracking-tight text-paper">AI models</h2>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                        Provider keys, SDK model IDs, deployments
                    </p>
                </div>
            </div>

            <Tabs defaultValue="configs" className="space-y-6">
                <TabsList className="h-9 rounded-xs border border-ink-500 bg-ink-200 p-0.5">
                    <TabsTrigger value="configs" className="h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                        Deployments
                    </TabsTrigger>
                    <TabsTrigger value="basemodels" className="h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                        SDK models
                    </TabsTrigger>
                    <TabsTrigger value="providers" className="h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                        Providers
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="configs" className="m-0">
                    <ConfigsTab />
                </TabsContent>
                <TabsContent value="basemodels" className="m-0">
                    <BaseModelsTab />
                </TabsContent>
                <TabsContent value="providers" className="m-0">
                    <ProvidersTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}
