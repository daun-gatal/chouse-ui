import { useMemo } from "react";
import { useWorkspaceStore, genTabId, useAuthStore } from "@/stores";
import { useSavedQueries } from "@/hooks";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FilePlus, Save, Clock, ArrowRight } from "lucide-react";

const HomeTab = () => {
  const { addTab, tabs } = useWorkspaceStore();
  const { activeConnectionId } = useAuthStore();
  const { data: savedQueries = [] } = useSavedQueries(activeConnectionId ?? undefined);

  const recentTabs = useMemo(() => {
    return tabs
      .filter((tab) => tab.type === "sql")
      .slice(-5)
      .reverse();
  }, [tabs]);

  const handleOpenSavedQuery = (query: { id: string; name: string; query: string }) => {
    addTab({
      id: query.id,
      type: "sql",
      title: query.name,
      content: query.query,
      isSaved: true,
    });
  };

  const handleNewQuery = () => {
    addTab({
      id: genTabId(),
      type: "sql",
      title: "New Query",
      content: "",
    });
  };

  return (
    <div className="h-full p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white/90 mb-2">
            Query Workspace
          </h1>
          <p className="text-gray-400">
            Create and manage your SQL queries
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex justify-center">
          <Button
            onClick={handleNewQuery}
            className="gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500"
          >
            <FilePlus className="h-4 w-4" />
            New Query
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Recent Queries */}
          <div className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-purple-400" />
              <h2 className="text-lg font-semibold text-white/90">
                Recent Queries
              </h2>
            </div>
            <ScrollArea className="h-[200px]">
              {recentTabs.length > 0 ? (
                <div className="space-y-2">
                  {recentTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className="p-3 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors flex items-center justify-between group"
                      onClick={() =>
                        addTab({
                          ...tab,
                          id: genTabId(),
                          title: `${tab.title} (Copy)`,
                        })
                      }
                    >
                      <span className="text-sm text-gray-300 truncate flex-1">
                        {tab.title}
                      </span>
                      <ArrowRight className="h-4 w-4 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">
                  No recent queries
                </p>
              )}
            </ScrollArea>
          </div>

          {/* Saved Queries */}
          <div className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Save className="h-5 w-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white/90">
                Saved Queries
              </h2>
            </div>
            <ScrollArea className="h-[200px]">
              {!activeConnectionId ? (
                <p className="text-center text-gray-500 py-8">
                  Connect to a server to view saved queries
                </p>
              ) : savedQueries.length > 0 ? (
                <div className="space-y-2">
                  {savedQueries.slice(0, 5).map((query) => (
                    <div
                      key={query.id}
                      className="p-3 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors flex items-center justify-between group"
                      onClick={() => handleOpenSavedQuery(query)}
                    >
                      <span className="text-sm text-gray-300 truncate flex-1">
                        {query.name}
                      </span>
                      <ArrowRight className="h-4 w-4 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">
                  No saved queries yet
                </p>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomeTab;
