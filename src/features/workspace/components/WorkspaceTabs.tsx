import { useCallback, useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  X,
  Plus,
  Home,
  GripVertical,
  Info,
  Terminal,
  XSquareIcon,
  Copy,
  Save,
  Sparkles,
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

  const getTabColor = () => {
    if (tab.type === "home") return "text-purple-400";
    if (tab.type === "sql" && tab.isSaved) return "text-amber-400";
    if (tab.type === "sql") return "text-emerald-400";
    if (tab.type === "information") return "text-blue-400";
    return "text-gray-400";
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
              "relative flex items-center gap-2 h-9 px-3 rounded-t-lg border-t border-x border-transparent",
              "transition-all duration-200",
              "data-[state=active]:bg-white/5 data-[state=active]:border-white/10",
              "data-[state=active]:shadow-[0_2px_10px_rgba(0,0,0,0.3)]",
              "hover:bg-white/5",
              tab.type === "home" ? "min-w-[90px]" : "min-w-[120px] max-w-[180px]"
            )}
          >
            {/* Drag Handle */}
            {isActive && isHovering && tab.type !== "home" && (
              <div {...attributes} {...listeners} className="cursor-move">
                <GripVertical className="h-3 w-3 text-gray-500" />
              </div>
            )}

            {/* Icon */}
            <span className={getTabColor()}>{getTabIcon()}</span>

            {/* Title */}
            <span className="truncate text-xs font-medium">{tab.title}</span>

            {/* Close Button */}
            {tab.id !== "home" && (
              <span
                role="button"
                tabIndex={0}
                className={cn(
                  "ml-auto p-0.5 rounded hover:bg-white/10 transition-colors",
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
              >
                <X className="h-3 w-3 text-gray-400 hover:text-white" />
              </span>
            )}

            {/* Active Indicator */}
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-blue-500"
              />
            )}
          </TabsTrigger>
        </ContextMenuTrigger>

        <ContextMenuContent>
          {tab.type === "sql" && (
            <ContextMenuItem onClick={() => duplicateTab(tab.id)} className="gap-2">
              <Copy className="h-4 w-4" />
              Duplicate Tab
            </ContextMenuItem>
          )}

          {tab.type !== "home" && (
            <ContextMenuItem onClick={() => removeTab(tab.id)} className="gap-2 text-red-400">
              <XSquareIcon className="h-4 w-4" />
              Close Tab
            </ContextMenuItem>
          )}

          {tab.type === "home" && (
            <ContextMenuItem className="gap-2">
              <Home className="h-4 w-4" />
              Home Tab
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
    <div className="flex flex-col h-full">
      <Tabs
        value={activeTab || undefined}
        onValueChange={setActiveTab}
        className="flex flex-col h-full"
      >
        {/* Tab Bar */}
        <div className="flex-shrink-0 flex items-center border-b border-white/10 bg-black/20">
          {/* New Tab Button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 rounded-none border-r border-white/10 hover:bg-white/5"
            onClick={addNewCodeTab}
          >
            <Plus className="h-4 w-4 text-gray-400" />
          </Button>

          {/* Scrollable Tabs */}
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
                    <TabsList className="inline-flex h-10 items-end bg-transparent rounded-none w-full gap-0.5 px-1">
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
                  New Tab
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={closeAllTabs} className="gap-2 text-red-400">
                  <XSquareIcon className="h-4 w-4" />
                  Close All Tabs
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0">
          {sortedTabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="h-full p-0 m-0 outline-none data-[state=active]:block"
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
