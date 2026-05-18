import { useCallback, useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Copy,
  GripVertical,
  Home,
  Info,
  Plus,
  Save,
  Terminal,
  X,
  XSquareIcon,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import HomeTab from "@/features/workspace/components/HomeTab";
import { useWorkspaceStore, genTabId, Tab } from "@/stores";
import SqlTab from "@/features/workspace/components/SqlTab";
import InformationTab from "@/features/workspace/components/infoTab/InfoTab";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";

interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
}

function SortableTab({ tab, isActive, onActivate }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: tab.id });
  const { removeTab, duplicateTab } = useWorkspaceStore();
  const [isHovering, setIsHovering] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getTabIcon = () => {
    if (tab.type === "home") return <Home className="h-3.5 w-3.5" />;
    if (tab.type === "sql" && tab.isSaved) return <Save className="h-3.5 w-3.5" />;
    if (tab.type === "sql") return <Terminal className="h-3.5 w-3.5" />;
    if (tab.type === "information") return <Info className="h-3.5 w-3.5" />;
    return null;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center", isActive ? "z-10" : "z-0")}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          removeTab(tab.id);
        }
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TabsTrigger
            value={tab.id}
            onClick={onActivate}
            className={cn(
              "relative flex h-9 items-center gap-2 rounded-none border-x border-t border-transparent px-3 transition-colors",
              "data-[state=active]:border-ink-500 data-[state=active]:bg-ink-100 data-[state=active]:text-paper",
              "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200",
              tab.type === "home" ? "min-w-[90px]" : "min-w-[120px] max-w-[200px]"
            )}
          >
            {/* Drag handle */}
            {isActive && isHovering && tab.type !== "home" && (
              <button
                type="button"
                {...attributes}
                {...listeners}
                className="cursor-move text-paper-faint hover:text-paper"
                aria-label="Drag tab"
              >
                <GripVertical className="h-3 w-3" aria-hidden />
              </button>
            )}

            <span
              className={cn(
                "shrink-0",
                isActive ? "text-paper-muted" : "text-paper-faint"
              )}
            >
              {getTabIcon()}
            </span>

            <span className="truncate font-mono text-[11.5px]">{tab.title}</span>

            {tab.id !== "home" && (
              <span
                role="button"
                tabIndex={0}
                className={cn(
                  "ml-auto grid h-4 w-4 place-items-center rounded-xs transition-all hover:bg-ink-300 hover:text-paper",
                  isHovering ? "opacity-100" : "opacity-0"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    removeTab(tab.id);
                  }
                }}
                aria-label="Close tab"
              >
                <X className="h-3 w-3 text-paper-faint" aria-hidden />
              </span>
            )}

            {/* Active indicator — solid brand yellow bar */}
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute -bottom-px left-0 right-0 h-px bg-brand"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </TabsTrigger>
        </ContextMenuTrigger>

        <ContextMenuContent>
          {tab.type === "sql" && (
            <ContextMenuItem onClick={() => duplicateTab(tab.id)} className="gap-2">
              <Copy className="h-4 w-4" />
              Duplicate tab
            </ContextMenuItem>
          )}

          {tab.type !== "home" && (
            <ContextMenuItem onClick={() => removeTab(tab.id)} className="gap-2 text-red-400">
              <XSquareIcon className="h-4 w-4" />
              Close tab
            </ContextMenuItem>
          )}

          {tab.type === "home" && (
            <ContextMenuItem className="gap-2">
              <Home className="h-4 w-4" />
              Home tab
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function WorkspaceTabs() {
  const { tabs, activeTab, addTab, setActiveTab, moveTab, closeAllTabs } =
    useWorkspaceStore();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const database = searchParams.get("database") || "";
    const table = searchParams.get("table") || "";
    if (database || table) {
      const existingTab = tabs.find(
        (tab) =>
          tab.type === "information" &&
          typeof tab.content === "object" &&
          tab.content.database === database &&
          tab.content.table === table
      );
      if (existingTab) {
        setActiveTab(existingTab.id);
      } else {
        addTab({
          id: genTabId(),
          title: `Info: ${table || database}`,
          type: "information",
          content: { database, table },
        });
      }

      setSearchParams({}, { replace: true });
    }
  }, [searchParams, tabs, addTab, setActiveTab, setSearchParams]);

  const addNewCodeTab = useCallback(() => {
    const queryCount = tabs.filter((t) => t.type === "sql").length;
    addTab({
      id: genTabId(),
      title: `Query ${queryCount + 1}`,
      type: "sql",
      content: "",
    });
  }, [tabs, addTab]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id && active.id !== "home" && over?.id !== "home") {
      const oldIndex = tabs.findIndex((tab) => tab.id === active.id);
      const newIndex = tabs.findIndex((tab) => tab.id === over?.id);
      moveTab(oldIndex, newIndex);
    }
  };

  const sortedTabs = useMemo(() => {
    const homeTab = tabs.find((tab) => tab.id === "home");
    const otherTabs = tabs.filter((tab) => tab.id !== "home");
    return homeTab ? [homeTab, ...otherTabs] : otherTabs;
  }, [tabs]);

  return (
    <div className="flex h-full flex-col bg-ink-50">
      <Tabs
        value={activeTab || undefined}
        onValueChange={setActiveTab}
        className="flex h-full flex-col"
      >
        {/* Tab bar */}
        <div className="flex flex-shrink-0 items-center border-b border-ink-500 bg-ink-100">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-none border-r border-ink-500 px-3 text-paper-dim hover:bg-ink-200 hover:text-paper"
            onClick={addNewCodeTab}
            aria-label="New tab"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>

          <ScrollArea className="flex-grow">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={sortedTabs.map((tab) => tab.id)}
                    strategy={horizontalListSortingStrategy}
                  >
                    <TabsList className="inline-flex h-9 w-full items-end gap-0 rounded-none bg-transparent p-0">
                      {sortedTabs.map((tab) => (
                        <SortableTab
                          key={tab.id}
                          tab={tab.id === "home" ? { ...tab, title: "Home" } : tab}
                          isActive={activeTab === tab.id}
                          onActivate={() => setActiveTab(tab.id)}
                        />
                      ))}
                    </TabsList>
                  </SortableContext>
                </DndContext>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={addNewCodeTab} className="gap-2">
                  <Plus className="h-4 w-4" />
                  New tab
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={closeAllTabs} className="gap-2 text-red-400">
                  <XSquareIcon className="h-4 w-4" />
                  Close all tabs
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        {/* Tab content */}
        <div className="min-h-0 flex-1">
          {sortedTabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="m-0 h-full p-0 outline-none data-[state=active]:block"
            >
              {tab.type === "home" ? (
                <HomeTab />
              ) : tab.type === "sql" ? (
                <SqlTab tabId={tab.id} />
              ) : tab.type === "information" ? (
                <InformationTab
                  database={
                    typeof tab.content === "object" && tab.content.database
                      ? tab.content.database
                      : ""
                  }
                  tableName={
                    typeof tab.content === "object" ? tab.content.table : undefined
                  }
                />
              ) : null}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

export default WorkspaceTabs;
