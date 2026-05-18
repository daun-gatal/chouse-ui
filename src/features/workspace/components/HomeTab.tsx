import { useMemo } from "react";
import { useWorkspaceStore, genTabId, useAuthStore, useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useSavedQueries } from "@/hooks";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowRight, Clock, FilePlus, Save } from "lucide-react";
import { cn } from "@/lib/utils";

const HomeTab = () => {
  const { addTab, tabs } = useWorkspaceStore();
  const { activeConnectionId } = useAuthStore();
  const { hasPermission } = useRbacStore();
  const canViewSavedQueries = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_VIEW);
  const { data: savedQueries = [] } = useSavedQueries(
    activeConnectionId ?? undefined,
    { enabled: canViewSavedQueries }
  );

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
    <div className="h-full overflow-y-auto bg-ink-50">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="flex flex-col gap-4 border-b border-ink-500 pb-8">
          <span className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
            <span className="text-paper-faint">01</span>
            <span className="h-px w-6 bg-ink-700" aria-hidden />
            <span>Query workspace</span>
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-paper">
            Start a query.{" "}
            <span className="text-paper-dim">Or open one you saved.</span>
          </h1>
          <div>
            <Button
              type="button"
              onClick={handleNewQuery}
              className="group inline-flex h-10 items-center gap-2 rounded-xs bg-brand px-4 text-sm font-semibold tracking-tight text-ink-50 hover:bg-brand-soft hover:-translate-y-px transition-[transform,background-color] duration-200"
            >
              <FilePlus className="h-4 w-4" />
              New query
            </Button>
          </div>
        </header>

        <section
          className={cn(
            "mt-10 grid gap-5",
            canViewSavedQueries ? "md:grid-cols-2" : "md:grid-cols-1"
          )}
        >
          {/* Recent queries */}
          <div className="flex h-[280px] flex-col rounded-md border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-3 border-b border-ink-500 px-4 py-3">
              <Clock className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
              <span className="text-[13px] font-medium text-paper">Recent queries</span>
              {recentTabs.length > 0 && (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  {recentTabs.length}
                </span>
              )}
            </div>
            <ScrollArea className="flex-1">
              {recentTabs.length > 0 ? (
                <div className="flex flex-col">
                  {recentTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        addTab({
                          ...tab,
                          id: genTabId(),
                          title: `${tab.title} (Copy)`,
                        })
                      }
                      className="group flex items-center gap-3 border-t border-ink-500 px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-ink-200"
                    >
                      <span className="flex-1 truncate text-[13px] text-paper">
                        {tab.title}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-paper-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6 py-10 text-center">
                  <p className="text-sm text-paper-muted">No recent queries</p>
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Saved queries */}
          {canViewSavedQueries && (
            <div className="flex h-[280px] flex-col rounded-md border border-ink-500 bg-ink-100">
              <div className="flex items-center gap-3 border-b border-ink-500 px-4 py-3">
                <Save className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
                <span className="text-[13px] font-medium text-paper">Saved queries</span>
                {savedQueries.length > 0 && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                    {savedQueries.length}
                  </span>
                )}
              </div>
              <ScrollArea className="flex-1">
                {!activeConnectionId ? (
                  <div className="flex h-full items-center justify-center px-6 py-10 text-center">
                    <p className="text-sm text-paper-muted">
                      Connect to a server to view saved queries.
                    </p>
                  </div>
                ) : savedQueries.length > 0 ? (
                  <div className="flex flex-col">
                    {savedQueries.slice(0, 5).map((query) => (
                      <button
                        key={query.id}
                        type="button"
                        onClick={() => handleOpenSavedQuery(query)}
                        className="group flex items-center gap-3 border-t border-ink-500 px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-ink-200"
                      >
                        <span className="flex-1 truncate text-[13px] text-paper">
                          {query.name}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-paper-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center px-6 py-10 text-center">
                    <p className="text-sm text-paper-muted">No saved queries yet.</p>
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default HomeTab;
