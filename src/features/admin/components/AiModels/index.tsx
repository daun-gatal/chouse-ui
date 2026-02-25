import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProvidersTab from './ProvidersTab';
import BaseModelsTab from './BaseModelsTab';
import ConfigsTab from './ConfigsTab';

export default function AiModelsManagement() {
    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <h2 className="text-xl font-semibold text-white">AI Models</h2>
                <p className="text-sm text-gray-400 mt-1">
                    Manage AI Providers, SDK Models, and User-Facing Configurations
                </p>
            </div>

            <Tabs defaultValue="configs" className="space-y-6">
                <TabsList className="bg-gray-800 border border-gray-700">
                    <TabsTrigger value="configs" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white">
                        Deployments
                    </TabsTrigger>
                    <TabsTrigger value="basemodels" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white">
                        SDK Models
                    </TabsTrigger>
                    <TabsTrigger value="providers" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white">
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
