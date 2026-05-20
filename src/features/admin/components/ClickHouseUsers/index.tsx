/**
 * ClickHouse Users Management Component
 * 
 * Manages ClickHouse database users with role-based access control.
 * Supports Developer, Analyst, and Viewer roles with database/table whitelisting.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  Code,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Database,
  Table,
  Shield,
  Copy,
  Check,
  ChevronRight,
  ChevronLeft,
  Server,
  Sparkles,
  ChevronDown,
  Search,
  CheckSquare,
  Square,
  FileCode,
  BarChart3,
  Eye as EyeIcon,
  Download,
} from 'lucide-react';
import { log } from '@/lib/log';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';
import { toast } from 'sonner';
import {
  rbacClickHouseUsersApi,
  rbacConnectionsApi,
  type ClickHouseUser,
  type CreateClickHouseUserInput,
  type UpdateClickHouseUserInput,
  type ClickHouseUserRole,
  type ClickHouseUserDDL,
} from '@/api/rbac';
import { getSessionId } from '@/api/client';
import { getDatabases, type DatabaseInfo } from '@/api/explorer';
import { useRbacStore, useAuthStore, RBAC_PERMISSIONS } from '@/stores';
import { cn } from '@/lib/utils';
import { SkeletonRows } from '@/components/common/Skeletons';

// ============================================
// User Form Dialog Component
// ============================================

interface UserFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user?: ClickHouseUser;
  onSuccess: () => void;
}

function UserFormDialog({ isOpen, onClose, user, onSuccess }: UserFormDialogProps) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<ClickHouseUserRole>('viewer');
  const [allowedDatabases, setAllowedDatabases] = useState<string[]>([]);
  const [allowedTables, setAllowedTables] = useState<Array<{ database: string; table: string }>>([]);
  const [hostIp, setHostIp] = useState('');
  const [hostNames, setHostNames] = useState('');
  const [cluster, setCluster] = useState<string>('');
  const [authType, setAuthType] = useState<string>('sha256_password');

  // Password validation requirements
  const passwordReqs = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password),
  };

  const isPasswordValid = authType === 'no_password' || Object.values(passwordReqs).every(Boolean);

  // Generate secure password
  const handleGeneratePassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let pwd = "";
    // Ensure at least one of each required character type
    pwd += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];
    pwd += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
    pwd += "0123456789"[Math.floor(Math.random() * 10)];
    pwd += "!@#$%^&*"[Math.floor(Math.random() * 8)];
    // Add random characters to reach 16 characters total
    for (let i = 0; i < 12; i++) {
      pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    // Shuffle the password
    pwd = pwd.split("").sort(() => Math.random() - 0.5).join("");
    setPassword(pwd);
    setConfirmPassword(pwd);
  };
  const [ddl, setDdl] = useState<ClickHouseUserDDL | null>(null);
  const [isGeneratingDDL, setIsGeneratingDDL] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ddlCopied, setDdlCopied] = useState(false);

  // Database and table selection
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [selectedDatabaseForTable, setSelectedDatabaseForTable] = useState<string>('');
  const [clusters, setClusters] = useState<string[]>([]);
  const [isLoadingClusters, setIsLoadingClusters] = useState(false);
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const { hasPermission } = useRbacStore();
  const canCreate = hasPermission(RBAC_PERMISSIONS.CH_USERS_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.CH_USERS_UPDATE);

  const isEditing = !!user;

  // Fetch databases and clusters when dialog opens
  useEffect(() => {
    if (isOpen) {
      const fetchData = async () => {
        setIsLoadingDatabases(true);
        setIsLoadingClusters(true);
        try {
          const [dbList, clusterList] = await Promise.all([
            getDatabases().catch((err) => {
              log.error('Failed to fetch databases:', err);
              return [];
            }),
            rbacClickHouseUsersApi.getClusters().catch((err) => {
              log.error('Failed to fetch clusters:', err);
              return [];
            }),
          ]);
          if (process.env.NODE_ENV === 'development') {
            log.debug('Fetched databases and clusters', { dbCount: dbList?.length, clusterCount: clusterList?.length });
          }
          setDatabases(dbList || []);
          setClusters(clusterList || []);
        } catch (error) {
          log.error('Failed to fetch data:', error);
          toast.error('Failed to load some data. You can still enter names manually.');
          setDatabases([]);
          setClusters([]);
        } finally {
          setIsLoadingDatabases(false);
          setIsLoadingClusters(false);
        }
      };

      fetchData();
    } else {
      // Reset when dialog closes
      setDatabases([]);
      setClusters([]);
    }
  }, [isOpen]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      if (isEditing && user) {
        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] Loading user data for editing', { userName: user?.name });
        }
        setUsername(user.name);
        setPassword('');
        setConfirmPassword('');
        // Use role from grants if available, otherwise default to viewer
        const userRole = user.role || 'viewer';
        setRole(userRole);
        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] Setting role', { userRole });
        }

        // Use allowedDatabases and allowedTables from grants if available
        const userDatabases = user.allowedDatabases || [];
        const userTables = user.allowedTables || [];
        setAllowedDatabases(userDatabases);
        setAllowedTables(userTables);
        if (process.env.NODE_ENV === 'development') {
log.debug('[ClickHouse Users] Setting databases and tables', { databasesCount: userDatabases?.length, tablesCount: userTables?.length });
        }

        // Auto-expand databases that have selected tables
        if (userDatabases.length > 0 || userTables.length > 0) {
          const dbSet = new Set(userDatabases);
          userTables.forEach(t => dbSet.add(t.database));
          setExpandedDatabases(dbSet);
          if (process.env.NODE_ENV === 'development') {
            log.debug('[ClickHouse Users] Auto-expanding databases', { count: dbSet?.size });
          }
        }

        // ClickHouse returns host_ip and host_names as arrays, convert to strings
        const hostIpValue = user.host_ip;
        const hostNamesValue = user.host_names;
        const hostIpStr = Array.isArray(hostIpValue) ? (hostIpValue[0] || '') : (typeof hostIpValue === 'string' ? hostIpValue : '');
        const hostNamesStr = Array.isArray(hostNamesValue) ? (hostNamesValue[0] || '') : (typeof hostNamesValue === 'string' ? hostNamesValue : '');
        setHostIp(hostIpStr);
        setHostNames(hostNamesStr);
        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] Setting hostIp and hostNames');
        }

        // Cluster is not stored in ClickHouse, so we can't retrieve it
        // User will need to set it again if they want to use a cluster
        setCluster('');
      } else {
        setUsername('');
        setPassword('');
        setConfirmPassword('');
        setRole('viewer');
        setAllowedDatabases([]);
        setAllowedTables([]);
        setHostIp('');
        setHostNames('');
        setAuthType('sha256_password');
        setCluster('');
        setExpandedDatabases(new Set());
      }
      setStep(1);
      setDdl(null);
      setDdlCopied(false);
      setSelectedDatabaseForTable('');
      setSearchQuery('');
    }
  }, [isOpen, user, isEditing]);

  // Auto-expand databases that have selected tables
  useEffect(() => {
    if (allowedTables.length > 0) {
      const dbsWithTables = new Set(allowedTables.map(t => t.database));
      setExpandedDatabases(prev => {
        const next = new Set(prev);
        dbsWithTables.forEach(db => next.add(db));
        return next;
      });
    }
  }, [allowedTables]);

  const handleGenerateDDL = async () => {
    if (!username) {
      toast.error('Username is required');
      return;
    }

    if (!isEditing && authType !== 'no_password') {
      if (!password) {
        toast.error('Password is required');
        return;
      }
      if (password !== confirmPassword) {
        toast.error('Passwords do not match');
        return;
      }
      if (!isPasswordValid) {
        toast.error('Password does not meet security requirements');
        return;
      }
    }

    setIsGeneratingDDL(true);
    try {
      if (isEditing) {
        // For updates, password is optional
        const updateInput: UpdateClickHouseUserInput = {
          role,
          allowedDatabases: allowedDatabases,
          allowedTables: allowedTables,
        };

        // Only include password if provided
        if (password) {
          updateInput.password = password;
        }

        // Only include optional fields if they have values (ensure they're strings, not arrays)
        const hostIpStr = Array.isArray(hostIp) ? (hostIp[0] || '') : (typeof hostIp === 'string' ? hostIp : '');
        const hostNamesStr = Array.isArray(hostNames) ? (hostNames[0] || '') : (typeof hostNames === 'string' ? hostNames : '');

        if (hostIpStr && hostIpStr.trim()) {
          updateInput.hostIp = hostIpStr;
        }
        if (hostNamesStr && hostNamesStr.trim()) {
          updateInput.hostNames = hostNamesStr;
        }
        if (cluster) {
          updateInput.cluster = cluster;
        }
        // Note: authType is not included in update - it cannot be changed

        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] Generating DDL with input');
        }
        const generatedDdl = await rbacClickHouseUsersApi.generateUpdateDDL(username, updateInput);
        setDdl(generatedDdl);
      } else {
        // For creates, password is required unless authType is 'no_password'
        const createInput: CreateClickHouseUserInput = {
          username,
          role,
          allowedDatabases: allowedDatabases.length > 0 ? allowedDatabases : undefined,
          allowedTables: allowedTables.length > 0 ? allowedTables : undefined,
          hostIp: hostIp || undefined,
          hostNames: hostNames || undefined,
          cluster: cluster || undefined,
          authType: authType || 'sha256_password',
        };

        // Only include password if authType is not 'no_password'
        if (authType !== 'no_password' && password) {
          createInput.password = password;
        }

        const generatedDdl = await rbacClickHouseUsersApi.generateDDL(createInput);
        setDdl(generatedDdl);
      }

      setStep(4); // Move to DDL preview step
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to generate DDL';
      toast.error(errorMsg);
    } finally {
      setIsGeneratingDDL(false);
    }
  };

  const handleSubmit = async () => {
    if (!ddl) {
      toast.error('Please generate DDL first');
      return;
    }

    setIsSubmitting(true);
    try {
      // Only include optional fields if they have values (ensure they're strings, not arrays)
      const hostIpStr = Array.isArray(hostIp) ? (hostIp[0] || '') : (typeof hostIp === 'string' ? hostIp : '');
      const hostNamesStr = Array.isArray(hostNames) ? (hostNames[0] || '') : (typeof hostNames === 'string' ? hostNames : '');

      if (isEditing) {
        // Build update input object
        const input: UpdateClickHouseUserInput = {
          role,
          allowedDatabases: allowedDatabases,
          allowedTables: allowedTables,
        };

        // Only include password if it's provided and authType is not 'no_password'
        if (password && authType !== 'no_password') {
          // Validate password strength for updates too
          if (!isPasswordValid) {
            toast.error('Password does not meet security requirements');
            setIsSubmitting(false);
            return;
          }
          input.password = password;
        }

        if (hostIpStr && hostIpStr.trim()) {
          input.hostIp = hostIpStr;
        }
        if (hostNamesStr && hostNamesStr.trim()) {
          input.hostNames = hostNamesStr;
        }
        if (cluster) {
          input.cluster = cluster;
        }
        // Note: authType is not included in update - it cannot be changed

        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] Submitting update input');
        }
        await rbacClickHouseUsersApi.update(username, input);
        toast.success('ClickHouse user updated successfully');
      } else {
        // Build create payload with required fields
        const createPayload: CreateClickHouseUserInput = {
          username,
          role: role!, // role is required for create
          allowedDatabases: allowedDatabases,
          allowedTables: allowedTables,
          authType: authType || 'sha256_password',
        };

        // Add optional fields
        if (hostIpStr && hostIpStr.trim()) {
          createPayload.hostIp = hostIpStr;
        }
        if (hostNamesStr && hostNamesStr.trim()) {
          createPayload.hostNames = hostNamesStr;
        }
        if (cluster) {
          createPayload.cluster = cluster;
        }

        // Only include password if authType is not 'no_password'
        if (authType !== 'no_password' && password) {
          // Validate password strength
          if (!isPasswordValid) {
            toast.error('Password does not meet security requirements');
            setIsSubmitting(false);
            return;
          }
          createPayload.password = password;
        }

        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] Submitting create payload');
        }
        await rbacClickHouseUsersApi.create(createPayload);
        toast.success('ClickHouse user created successfully');
      }

      onSuccess();
      onClose();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Operation failed';
      toast.error(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyDDL = () => {
    if (ddl) {
      navigator.clipboard.writeText(ddl.fullDDL);
      setDdlCopied(true);
      toast.success('DDL copied to clipboard');
      setTimeout(() => setDdlCopied(false), 2000);
    }
  };

  const addDatabase = (dbName?: string) => {
    if (!dbName) return;
    if (!allowedDatabases.includes(dbName)) {
      setAllowedDatabases([...allowedDatabases, dbName]);
      // When database is selected, automatically select all tables in that database
      const tables = getTablesForDatabase(dbName);
      const newTables = tables.map(table => ({ database: dbName, table }));
      // Only add tables that aren't already selected
      const existingTables = allowedTables.filter(t => t.database === dbName);
      const tablesToAdd = newTables.filter(nt =>
        !existingTables.some(et => et.database === nt.database && et.table === nt.table)
      );
      if (tablesToAdd.length > 0) {
        setAllowedTables([...allowedTables, ...tablesToAdd]);
      }
    }
  };

  const removeDatabase = (db: string) => {
    setAllowedDatabases(allowedDatabases.filter(d => d !== db));
    // Also remove tables from that database
    setAllowedTables(allowedTables.filter(t => t.database !== db));
  };

  const addTable = (database?: string, table?: string) => {
    if (!database || !table) return;
    const exists = allowedTables.some(t => t.database === database && t.table === table);
    if (!exists) {
      setAllowedTables([...allowedTables, { database, table }]);
      setSelectedDatabaseForTable(''); // Reset selection
    }
  };

  const removeTable = (database: string, table: string) => {
    setAllowedTables(allowedTables.filter(t => !(t.database === database && t.table === table)));
  };

  // Get available tables for a selected database
  const getTablesForDatabase = (dbName: string): string[] => {
    const db = databases.find(d => d.name === dbName);
    return db?.children?.map(t => t.name) || [];
  };

  // Get all database names
  const databaseNames = databases.map(db => db.name);

  // Get available databases for table selection (only from selected allowed databases)
  const getAvailableDatabasesForTables = (): string[] => {
    if (allowedDatabases.length === 0) {
      return databaseNames; // If no restrictions, show all databases
    }
    return allowedDatabases; // Only show databases that were selected
  };

  // Toggle database expansion
  const toggleDatabase = (dbName: string) => {
    setExpandedDatabases(prev => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
      }
      return next;
    });
  };

  // Check if database is selected
  // A database is considered selected if:
  // 1. It's in allowedDatabases, OR
  // 2. All tables in that database are selected
  const isDatabaseSelected = (dbName: string) => {
    if (allowedDatabases.includes(dbName)) return true;
    // Check if all tables in this database are selected
    const tables = getTablesForDatabase(dbName);
    if (tables.length === 0) return false;
    return tables.every(table => isTableSelectedCheck(dbName, table));
  };

  // Check if table is selected
  const isTableSelectedCheck = (dbName: string, tableName: string) =>
    allowedTables.some(t => t.database === dbName && t.table === tableName);

  // Get selected tables count for a database
  const getSelectedTablesCount = (dbName: string) =>
    allowedTables.filter(t => t.database === dbName).length;

  // Toggle database selection
  const toggleDatabaseSelection = (dbName: string) => {
    if (isDatabaseSelected(dbName)) {
      removeDatabase(dbName);
    } else {
      addDatabase(dbName);
      // Auto-expand when selected
      setExpandedDatabases(prev => new Set(prev).add(dbName));
    }
  };

  // Toggle table selection
  const toggleTableSelection = (dbName: string, tableName: string) => {
    if (isTableSelectedCheck(dbName, tableName)) {
      removeTable(dbName, tableName);
      // After removing a table, check if we should also remove the database from allowedDatabases
      // (since database selection means all tables are selected)
      const remainingTables = allowedTables.filter(t => !(t.database === dbName && t.table === tableName));
      const allTables = getTablesForDatabase(dbName);
      // If not all tables are selected, remove database from allowedDatabases
      if (remainingTables.length < allTables.length && allowedDatabases.includes(dbName)) {
        setAllowedDatabases(allowedDatabases.filter(d => d !== dbName));
      }
    } else {
      addTable(dbName, tableName);
      // After adding a table, check if all tables in the database are now selected
      // If so, add the database to allowedDatabases
      const allTables = getTablesForDatabase(dbName);
      const selectedTables = [...allowedTables, { database: dbName, table: tableName }].filter(t => t.database === dbName);
      if (selectedTables.length === allTables.length && allTables.length > 0 && !allowedDatabases.includes(dbName)) {
        setAllowedDatabases([...allowedDatabases, dbName]);
      }
    }
  };

  // Select all tables in a database
  const selectAllTablesInDatabase = (dbName: string) => {
    const tables = getTablesForDatabase(dbName);
    const newTables = tables.map(table => ({ database: dbName, table }));
    // Only add tables that aren't already selected
    const existingTables = allowedTables.filter(t => t.database === dbName);
    const tablesToAdd = newTables.filter(nt =>
      !existingTables.some(et => et.database === nt.database && et.table === nt.table)
    );
    if (tablesToAdd.length > 0) {
      setAllowedTables([...allowedTables, ...tablesToAdd]);
    }
    // Also add database to allowedDatabases if all tables are now selected
    if (tables.length > 0 && !allowedDatabases.includes(dbName)) {
      setAllowedDatabases([...allowedDatabases, dbName]);
    }
  };

  // Deselect all tables in a database
  const deselectAllTablesInDatabase = (dbName: string) => {
    // Remove all tables from this database
    setAllowedTables(allowedTables.filter(t => t.database !== dbName));
    // Also remove database from allowedDatabases
    if (allowedDatabases.includes(dbName)) {
      setAllowedDatabases(allowedDatabases.filter(d => d !== dbName));
    }
  };

  // Filter databases and tables based on search
  const filteredDatabases = databases.filter(db => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    if (db.name.toLowerCase().includes(query)) return true;
    return db.children?.some(t => t.name.toLowerCase().includes(query));
  });

  const nextStep = () => {
    if (step < 4 && canProceed()) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const canProceed = () => {
    if (step === 1) {
      if (!username) return false;
      if (!isEditing) {
        return password && confirmPassword && password === confirmPassword;
      }
      return true; // For editing, password is optional
    }
    if (step === 2) {
      return true; // Role is always selected
    }
    if (step === 3) {
      return true; // Whitelist is optional
    }
    return false;
  };

  const steps = [
    { number: 1, title: 'Basic Info', icon: Users },
    { number: 2, title: 'Role', icon: Shield },
    { number: 3, title: 'Whitelist', icon: Database },
    { number: 4, title: 'Preview', icon: Code },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] h-[90vh] overflow-hidden flex flex-col p-0 rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-ink-500">
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <Users className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">{isEditing ? 'Edit ClickHouse user' : 'Create ClickHouse user'}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                {isEditing ? 'Update configuration' : 'Role-based access control'}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="mt-2 text-paper-muted">
            {isEditing
              ? 'Update the ClickHouse user configuration.'
              : 'Create a new ClickHouse database user with role-based access control.'}
          </DialogDescription>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="py-6 px-6 flex-shrink-0 border-b border-ink-500">
          <div className="flex items-center justify-between relative">
            {/* Progress Line */}
            <div className="absolute top-5 left-0 right-0 h-px bg-ink-500 -z-10">
              <motion.div
                className="h-full bg-brand"
                initial={{ width: '0%' }}
                animate={{ width: `${((step - 1) / 3) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {steps.map((s) => {
              const isActive = step === s.number;
              const isCompleted = step > s.number;
              const Icon = s.icon;

              return (
                <div key={s.number} className="flex flex-col items-center flex-1 relative">
                  <motion.div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all ${isCompleted
                      ? 'bg-brand border-brand text-ink-50'
                      : isActive
                        ? 'bg-ink-200 border-brand text-brand'
                        : 'bg-ink-100 border-ink-500 text-paper-faint'
                      }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isCompleted ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </motion.div>
                  <span className={`mt-2 font-mono text-[10px] uppercase tracking-[0.14em] ${isActive ? 'text-paper' : 'text-paper-faint'
                    }`}>
                    {s.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >

                {step === 1 && (
                  <div className="space-y-4">
                    {isEditing && (
                      <div className="mb-4 rounded-xs border border-ink-500 bg-ink-200 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Editing existing user</p>
                        <p className="mt-1 text-[12px] text-paper-muted">All fields below show current values. Modify as needed.</p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="username">Username *</Label>
                      <Input
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="user_name"
                        className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                        disabled={isEditing}
                      />
                      <p className="text-[11px] text-paper-faint">Must start with a letter or underscore.</p>
                    </div>

                    {!isEditing ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="password">
                            Password {authType === 'no_password' ? '(not required)' : '*'}
                          </Label>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={authType === 'no_password' ? 'Not required' : '••••••••'}
                                className="rounded-xs border-ink-500 bg-ink-200 pr-10 text-paper"
                                disabled={authType === 'no_password'}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-2 top-2.5 text-paper-dim hover:text-paper"
                                disabled={authType === 'no_password'}
                              >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            {authType !== 'no_password' && (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleGeneratePassword}
                                className="shrink-0"
                                title="Generate secure password"
                              >
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate
                              </Button>
                            )}
                          </div>
                          <p className="text-[11px] text-paper-faint">
                            {authType === 'no_password'
                              ? 'Password is not required when using no_password authentication.'
                              : 'Password for the user account.'}
                          </p>

                          {/* Password Requirements */}
                          {authType !== 'no_password' && password && (
                            <div className="mt-2 rounded-xs border border-ink-500 bg-ink-100 p-3">
                              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Password requirements</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.length ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                  <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.length ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                    {passwordReqs.length ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                  </div>
                                  <span>At least 8 characters</span>
                                </div>
                                <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.upper ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                  <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.upper ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                    {passwordReqs.upper ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                  </div>
                                  <span>Uppercase letter</span>
                                </div>
                                <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.lower ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                  <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.lower ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                    {passwordReqs.lower ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                  </div>
                                  <span>Lowercase letter</span>
                                </div>
                                <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.number ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                  <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.number ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                    {passwordReqs.number ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                  </div>
                                  <span>Number</span>
                                </div>
                                <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.special ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                  <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.special ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                    {passwordReqs.special ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                  </div>
                                  <span>Special character</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {authType !== 'no_password' && (
                          <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Confirm Password *</Label>
                            <Input
                              id="confirmPassword"
                              type={showPassword ? 'text' : 'password'}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              placeholder="••••••••"
                              className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                            />
                            {confirmPassword && password !== confirmPassword && (
                              <p className="text-[11px] text-red-300">Passwords do not match.</p>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="password">
                          {authType === 'no_password' ? 'Password (not required for no_password)' : 'New Password (optional)'}
                        </Label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              id="password"
                              type={showPassword ? 'text' : 'password'}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder={authType === 'no_password' ? 'Not required' : 'Leave empty to keep current password'}
                              className="rounded-xs border-ink-500 bg-ink-200 pr-10 text-paper"
                              disabled={authType === 'no_password'}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-2.5 text-paper-dim hover:text-paper"
                              disabled={authType === 'no_password'}
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {authType !== 'no_password' && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleGeneratePassword}
                              className="shrink-0"
                              title="Generate secure password"
                            >
                              <Sparkles className="w-4 h-4 mr-2" />
                              Generate
                            </Button>
                          )}
                        </div>
                        <p className="text-[11px] text-paper-faint">
                          {authType === 'no_password'
                            ? 'Password is not required when using no_password authentication.'
                            : 'Leave empty to keep the current password.'}
                        </p>

                        {/* Password Requirements for Edit */}
                        {authType !== 'no_password' && password && (
                          <div className="mt-2 rounded-xs border border-ink-500 bg-ink-100 p-3">
                            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Password requirements</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.length ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.length ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                  {passwordReqs.length ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                </div>
                                <span>At least 8 characters</span>
                              </div>
                              <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.upper ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.upper ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                  {passwordReqs.upper ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                </div>
                                <span>Uppercase letter</span>
                              </div>
                              <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.lower ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.lower ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                  {passwordReqs.lower ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                </div>
                                <span>Lowercase letter</span>
                              </div>
                              <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.number ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.number ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                  {passwordReqs.number ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                </div>
                                <span>Number</span>
                              </div>
                              <div className={`flex items-center gap-2 text-[11px] transition-colors ${passwordReqs.special ? 'text-emerald-300' : 'text-paper-faint'}`}>
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.special ? 'border-emerald-700 bg-emerald-950/40' : 'border-ink-500 bg-ink-200'}`}>
                                  {passwordReqs.special ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
                                </div>
                                <span>Special character</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="hostIp">Host IP (optional)</Label>
                        <Input
                          id="hostIp"
                          value={hostIp}
                          onChange={(e) => setHostIp(e.target.value)}
                          placeholder="192.168.1.1"
                          className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="hostNames">Host Names (optional)</Label>
                        <Input
                          id="hostNames"
                          value={hostNames}
                          onChange={(e) => setHostNames(e.target.value)}
                          placeholder="example.com"
                          className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cluster" className="flex items-center gap-2">
                        <Server className="w-4 h-4" />
                        Cluster (optional)
                      </Label>
                      <Select
                        value={cluster || "none"}
                        onValueChange={(value) => setCluster(value === "none" ? "" : value)}
                        disabled={isLoadingClusters}
                      >
                        <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
                          <SelectValue placeholder={isLoadingClusters ? "Loading clusters..." : "Select cluster (optional)"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None (local)</SelectItem>
                          {clusters.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-paper-faint">Leave empty for local user, or select a cluster.</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="authType">
                        Authentication Type {isEditing ? '(cannot be changed)' : '*'}
                      </Label>
                      <Select
                        value={authType}
                        onValueChange={(value) => setAuthType(value)}
                        disabled={isEditing}
                      >
                        <SelectTrigger className={`rounded-xs border-ink-500 bg-ink-200 text-paper ${isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}>
                          <SelectValue placeholder="Select authentication type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sha256_password">SHA256 Password (Recommended)</SelectItem>
                          <SelectItem value="double_sha1_password">Double SHA1 Password</SelectItem>
                          <SelectItem value="plaintext_password">Plaintext Password (Not Recommended)</SelectItem>
                          <SelectItem value="no_password">No Password (Use with host restrictions)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-paper-faint">
                        {isEditing
                          ? 'Authentication type cannot be changed after user creation.'
                          : authType === 'no_password'
                            ? 'User can connect without password. Recommended to use with host IP/name restrictions for security.'
                            : 'Password encryption method for the user'}
                      </p>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-6">
                    {isEditing && role && (
                      <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Current role: <span className="text-paper">{role}</span></p>
                        <p className="mt-1 text-[12px] text-paper-muted">Select a different role below to change it.</p>
                      </div>
                    )}
                    <div>
                      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                        <span className="h-px w-6 bg-ink-700" />
                        <span>Select role</span>
                      </span>
                      <p className="mt-2 text-[12px] text-paper-muted">Choose the access level for this user.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {([
                        { role: 'developer' as ClickHouseUserRole, icon: FileCode, code: 'DV', description: 'Full DDL/DML access' },
                        { role: 'analyst' as ClickHouseUserRole, icon: BarChart3, code: 'AN', description: 'Read/write data access' },
                        { role: 'viewer' as ClickHouseUserRole, icon: EyeIcon, code: 'VW', description: 'Read-only access' },
                      ]).map(({ role: r, icon: RoleIcon, code, description }) => {
                        const isSelected = role === r;

                        return (
                          <motion.button
                            key={r}
                            type="button"
                            onClick={() => setRole(r)}
                            className={`rounded-xs border p-4 text-left transition-all ${isSelected
                              ? 'border-brand/60 bg-ink-200'
                              : 'border-ink-500 bg-ink-100 hover:border-ink-700'
                              }`}
                            whileTap={{ scale: 0.99 }}
                          >
                            <div className="flex items-start gap-3">
                              <span className={`grid h-9 w-9 place-items-center rounded-xs border font-mono text-[10px] uppercase tracking-[0.14em] ${isSelected ? 'border-brand/60 bg-brand/10 text-brand' : 'border-ink-500 bg-ink-200 text-paper-muted'}`}>
                                {code}
                              </span>
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-[13px] font-semibold capitalize text-paper">{r}</h3>
                                  {isSelected && (
                                    <motion.span
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      className="grid h-5 w-5 place-items-center rounded-xs bg-brand text-ink-50"
                                    >
                                      <Check className="h-3 w-3" />
                                    </motion.span>
                                  )}
                                </div>
                                <p className="mt-1 flex items-center gap-2 text-[12px] text-paper-muted">
                                  <RoleIcon className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
                                  {description}
                                </p>
                                <ul className="mt-3 space-y-1 border-t border-ink-500 pt-3 font-mono text-[11px] text-paper-muted">
                                  {r === 'developer' && (
                                    <>
                                      <li>+ Create/Drop databases and tables</li>
                                      <li>+ ALTER tables</li>
                                      <li>+ SELECT, INSERT, UPDATE, DELETE</li>
                                    </>
                                  )}
                                  {r === 'analyst' && (
                                    <>
                                      <li>+ SELECT, INSERT, UPDATE, DELETE</li>
                                      <li>- No DDL operations</li>
                                    </>
                                  )}
                                  {r === 'viewer' && (
                                    <li>+ SELECT only (read-only)</li>
                                  )}
                                </ul>
                              </div>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-6">
                    {isEditing && (allowedDatabases.length > 0 || allowedTables.length > 0) && (
                      <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Current access restrictions</p>
                        <div className="mt-2 space-y-1 text-[12px] text-paper-muted">
                          {allowedDatabases.length > 0 && (
                            <p>· Databases: {allowedDatabases.length} selected</p>
                          )}
                          {allowedTables.length > 0 && (
                            <p>· Tables: {allowedTables.length} selected</p>
                          )}
                          {allowedDatabases.length === 0 && allowedTables.length === 0 && (
                            <p>· Full access to all databases and tables</p>
                          )}
                        </div>
                        <p className="mt-2 text-[11px] text-paper-faint">Modify selections below to change access.</p>
                      </div>
                    )}
                    <div>
                      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                        <span className="h-px w-6 bg-ink-700" />
                        <span>Access restrictions (optional)</span>
                      </span>
                      <p className="mt-2 text-[12px] text-paper-muted">
                        Leave empty to allow access to all databases/tables. Select specific databases and tables to restrict access.
                      </p>
                    </div>

                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-dim" />
                      <Input
                        type="text"
                        placeholder="Search databases and tables..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="rounded-xs border-ink-500 bg-ink-200 pl-10 text-paper"
                      />
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xs border border-ink-500 bg-ink-100 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Selected databases</p>
                            <p className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-paper">
                              {allowedDatabases.length || 'All'}
                            </p>
                          </div>
                          <Database className="h-6 w-6 text-paper-faint" aria-hidden />
                        </div>
                      </div>
                      <div className="rounded-xs border border-ink-500 bg-ink-100 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Selected tables</p>
                            <p className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-paper">
                              {allowedTables.length || 'All'}
                            </p>
                          </div>
                          <Table className="h-6 w-6 text-paper-faint" aria-hidden />
                        </div>
                      </div>
                    </div>

                    {/* Database Tree */}
                    {isLoadingDatabases ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
                        <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">Loading databases…</span>
                      </div>
                    ) : filteredDatabases.length === 0 ? (
                      <div className="rounded-xs border border-ink-500 bg-ink-100 py-12 text-center">
                        <Database className="mx-auto mb-2 h-8 w-8 text-paper-faint" aria-hidden />
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No databases found</p>
                        {searchQuery ? (
                          <p className="mt-1 text-[12px] text-paper-muted">Try a different search term.</p>
                        ) : databases.length === 0 ? (
                          <p className="mt-1 text-[12px] text-paper-muted">No databases available. Make sure you're connected to ClickHouse.</p>
                        ) : (
                          <p className="mt-1 text-[12px] text-paper-muted">No databases match your search.</p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xs border border-ink-500 bg-ink-100">
                        <div className="relative h-[400px] overflow-y-auto overflow-x-hidden">
                          <div className="p-2">
                            {filteredDatabases.map((db) => {
                              const isExpanded = expandedDatabases.has(db.name);
                              const isDbSelected = isDatabaseSelected(db.name);
                              const tables = db.children || [];
                              const selectedTablesCount = getSelectedTablesCount(db.name);
                              const allTablesSelected = tables.length > 0 && selectedTablesCount === tables.length;
                              const someTablesSelected = selectedTablesCount > 0 && selectedTablesCount < tables.length;

                              return (
                                <div key={db.name} className="mb-1">
                                  {/* Database Row - Frozen Header */}
                                  <div
                                    className={`flex items-center gap-3 rounded-xs border p-3 transition-colors hover:bg-ink-200 ${isExpanded ? 'border-brand/40 bg-ink-200' : 'border-ink-500 bg-ink-100'
                                      }`}
                                    style={isExpanded ? {
                                      position: 'sticky',
                                      top: 0,
                                      zIndex: 20,
                                      marginTop: 0,
                                      marginBottom: 0
                                    } : {}}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => toggleDatabase(db.name)}
                                      className="text-paper-dim transition-colors hover:text-paper"
                                    >
                                      <ChevronRight
                                        className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                      />
                                    </button>

                                    <Checkbox
                                      checked={isDbSelected}
                                      onCheckedChange={() => toggleDatabaseSelection(db.name)}
                                      className="border-ink-500"
                                    />

                                    <div className="flex flex-1 items-center gap-2">
                                      <Database className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
                                      <span className="font-medium text-paper">{db.name}</span>
                                      {tables.length > 0 && (
                                        <span className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                                          {tables.length} {tables.length === 1 ? 'table' : 'tables'}
                                        </span>
                                      )}
                                      {isDbSelected && selectedTablesCount > 0 && (
                                        <span className="rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                          {selectedTablesCount} selected
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Tables List - Part of Main Scroll */}
                                  <AnimatePresence>
                                    {isExpanded && tables.length > 0 && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="mt-1 overflow-visible pl-2"
                                      >
                                        <div className="ml-4 space-y-1 border-l border-ink-500 py-2 pl-9 pr-3">
                                          {/* Select All Tables */}
                                          {isDbSelected && tables.length > 0 && (
                                            <div className="flex cursor-pointer items-center gap-2 rounded-xs p-2 hover:bg-ink-200"
                                              onClick={() => {
                                                if (allTablesSelected) {
                                                  deselectAllTablesInDatabase(db.name);
                                                } else {
                                                  selectAllTablesInDatabase(db.name);
                                                }
                                              }}
                                            >
                                              <div className="relative">
                                                <Checkbox
                                                  checked={allTablesSelected}
                                                  onCheckedChange={(checked) => {
                                                    if (checked) {
                                                      selectAllTablesInDatabase(db.name);
                                                    } else {
                                                      deselectAllTablesInDatabase(db.name);
                                                    }
                                                  }}
                                                  className="border-ink-500"
                                                />
                                                {someTablesSelected && !allTablesSelected && (
                                                  <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="h-2 w-2 rounded-xs bg-brand" />
                                                  </div>
                                                )}
                                              </div>
                                              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
                                                {allTablesSelected ? 'Deselect all tables' : 'Select all tables'}
                                                {someTablesSelected && !allTablesSelected && ` (${selectedTablesCount}/${tables.length})`}
                                              </span>
                                            </div>
                                          )}

                                          {/* Individual Tables */}
                                          {tables.map((table) => {
                                            const isTableSel = isTableSelectedCheck(db.name, table.name);
                                            const matchesSearch = !searchQuery ||
                                              db.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                              table.name.toLowerCase().includes(searchQuery.toLowerCase());

                                            if (!matchesSearch) return null;

                                            return (
                                              <div
                                                key={`${db.name}.${table.name}`}
                                                className="flex items-center gap-2 rounded-xs p-2 transition-colors hover:bg-ink-200"
                                              >
                                                <Checkbox
                                                  checked={isTableSel}
                                                  onCheckedChange={() => toggleTableSelection(db.name, table.name)}
                                                  disabled={!isDbSelected}
                                                  className="border-ink-500"
                                                />
                                                <Table className="h-3 w-3 text-paper-faint" aria-hidden />
                                                <span className="flex-1 text-[12px] text-paper-muted">{table.name}</span>
                                                {table.type === 'view' && (
                                                  <span className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                                    view
                                                  </span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Info Message */}
                    {allowedDatabases.length === 0 && allowedTables.length === 0 && (
                      <div className="rounded-xs border border-ink-500 bg-ink-200 p-4">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-paper-dim" aria-hidden />
                          <div className="text-[12px] text-paper-muted">
                            <strong className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">No restrictions selected.</strong>
                            <p className="mt-1">The user will have access to all databases and tables based on their role permissions.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    {ddl ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                            <span className="h-px w-6 bg-ink-700" />
                            <span>Generated DDL</span>
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={copyDDL}
                            className="h-8 gap-2 rounded-xs border-ink-500 bg-ink-100 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                          >
                            {ddlCopied ? (
                              <>
                                <Check className="h-3 w-3" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copy DDL
                              </>
                            )}
                          </Button>
                        </div>

                        <Textarea
                          value={ddl.fullDDL}
                          readOnly
                          className="h-64 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper"
                        />

                        <div className="rounded-xs border border-amber-900/60 bg-amber-950/40 p-3">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-amber-300" aria-hidden />
                            <p className="text-[12px] text-amber-200">
                              Review the DDL above. Click "Create user" to execute these statements in ClickHouse.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xs border border-ink-500 bg-ink-100 py-12 text-center">
                        <Code className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Click "Generate DDL" to preview SQL</p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </ScrollArea>

        <DialogFooter className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-t border-ink-500">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={step === 1}
            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </Button>

          <div className="flex gap-2">
            {step < 4 ? (
              <Button
                onClick={nextStep}
                disabled={!canProceed()}
                className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <>
                {!ddl ? (
                  <Button
                    onClick={handleGenerateDDL}
                    disabled={isGeneratingDDL}
                    className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                  >
                    {isGeneratingDDL ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        Generate DDL
                      </>
                    )}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={copyDDL}
                      variant="outline"
                      className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                    >
                      {ddlCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy DDL
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={isSubmitting}
                      className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {isEditing ? 'Updating…' : 'Creating…'}
                        </>
                      ) : (
                        <>
                          {isEditing ? 'Update user' : 'Create user'}
                        </>
                      )}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Main Component
// ============================================

export default function ClickHouseUsersManagement() {
  const [users, setUsers] = useState<ClickHouseUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ClickHouseUser | undefined>();
  const [deleteUser, setDeleteUser] = useState<ClickHouseUser | null>(null);
  const [hasClickHouseSession, setHasClickHouseSession] = useState<boolean | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const { hasPermission } = useRbacStore();
  const canView = hasPermission(RBAC_PERMISSIONS.CH_USERS_VIEW);
  const canCreate = hasPermission(RBAC_PERMISSIONS.CH_USERS_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.CH_USERS_UPDATE);
  const canDelete = hasPermission(RBAC_PERMISSIONS.CH_USERS_DELETE);

  // Check for active ClickHouse session by trying to fetch users
  // Returns true if a valid session was found, false otherwise
  const checkSessionAndFetchUsers = async (): Promise<boolean> => {
    setIsCheckingSession(true);
    setIsLoading(true);

    try {
      // First, check if we have a session ID locally
      const localSessionId = getSessionId();
      const authStoreSessionId = useAuthStore.getState().sessionId;
      const sessionId = localSessionId || authStoreSessionId;

      if (!sessionId) {
        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] No session ID found, checking server-side session status');
        }
        // No local session ID — try server-side session check as fallback
        try {
          const status = await rbacConnectionsApi.getSessionStatus();
          if (status.connected) {
            // Server has a session we didn't know about — fetch users
            const result = await rbacClickHouseUsersApi.list();
            setUsers(result);
            setHasClickHouseSession(true);
            return true;
          }
        } catch {
          // Server check failed — no session available
        }
        setHasClickHouseSession(false);
        return false;
      }

      // Try to fetch users - this will verify the session is valid
      try {
        const result = await rbacClickHouseUsersApi.list();
        setUsers(result);
        setHasClickHouseSession(true);
        if (process.env.NODE_ENV === 'development') {
          log.debug('[ClickHouse Users] Successfully fetched users, session is valid');
        }
        return true;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to load ClickHouse users';
        log.error('[ClickHouse Users] Failed to fetch users:', errorMsg);

        // Check if it's a session error
        if (errorMsg.includes('No active ClickHouse session') ||
          errorMsg.includes('session') ||
          errorMsg.includes('NO_SESSION') ||
          (error instanceof Error && error.message.includes('session'))) {
          setHasClickHouseSession(false);
          if (process.env.NODE_ENV === 'development') {
            log.debug('[ClickHouse Users] Session error detected');
          }
          return false;
        } else {
          // Other error - still show as connected but show error toast
          setHasClickHouseSession(true);
          toast.error(errorMsg);
          return true;
        }
      }
    } catch (error) {
      log.error('[ClickHouse Users] Error checking session:', error);
      setHasClickHouseSession(false);
      return false;
    } finally {
      setIsCheckingSession(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!canView) return;

    checkSessionAndFetchUsers();

    // Listen for connection events
    const handleConnection = () => {
      if (process.env.NODE_ENV === 'development') {
        log.debug('[ClickHouse Users] Connection event received, refreshing');
      }
      checkSessionAndFetchUsers();
    };

    window.addEventListener('clickhouse:connected', handleConnection);

    return () => {
      window.removeEventListener('clickhouse:connected', handleConnection);
    };
  }, [canView]);

  const handleDelete = async () => {
    if (!deleteUser || !canDelete) return;

    try {
      await rbacClickHouseUsersApi.delete(deleteUser.name);
      toast.success(`ClickHouse user "${deleteUser.name}" deleted successfully`);
      setDeleteUser(null);
      checkSessionAndFetchUsers();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete user';
      toast.error(errorMsg);
    }
  };

  const openCreateDialog = () => {
    setEditingUser(undefined);
    setIsFormOpen(true);
  };

  const openEditDialog = async (user: ClickHouseUser) => {
    try {
      // Fetch full user details including grants
      const fullUser = await rbacClickHouseUsersApi.get(user.name);
      setEditingUser(fullUser);
      setIsFormOpen(true);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to load user details';
      toast.error(errorMsg);
      // Fallback to using the user from the list
      setEditingUser(user);
      setIsFormOpen(true);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await rbacClickHouseUsersApi.sync();
      if (result.errors.length > 0) {
        toast.warning(`Synced ${result.synced} users, but ${result.errors.length} had errors`);
        log.error('Sync errors', result.errors);
      } else {
        toast.success(`Successfully synced ${result.synced} unregistered user(s) to metadata`);
      }
      // Refresh the user list
      checkSessionAndFetchUsers();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to sync users';
      toast.error(errorMsg);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">You don't have permission to view ClickHouse users</p>
      </div>
    );
  }

  // Show loading state while checking session
  if (isCheckingSession) {
    return (
      <div className="p-6 text-center">
        <Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-paper-dim" />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Checking ClickHouse connection…</p>
      </div>
    );
  }

  // Show message when no ClickHouse session is active
  if (!hasClickHouseSession) {
    return (
      <div className="p-6">
        <div className="mx-auto mt-12 max-w-2xl">
          <div className="rounded-xs border border-ink-500 bg-ink-100 p-8 text-center">
            <Database className="mx-auto mb-4 h-10 w-10 text-paper-faint" aria-hidden />
            <h3 className="mb-2 text-[16px] font-semibold tracking-tight text-paper">
              Not connected
            </h3>
            <p className="mb-6 text-[12px] text-paper-muted">
              Pick a ClickHouse server from the dock — managing CH-side users needs an open session.
            </p>
            <div className="flex flex-col items-center gap-3">
              <div className="space-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                <p>01 — Open the connection dock (left edge)</p>
                <p>02 — Pick a server, hit Connect</p>
                <p>03 — Come back — the user list will populate</p>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  const found = await checkSessionAndFetchUsers();
                  if (!found) {
                    toast.info('No active connection found. Please connect to a ClickHouse server first.');
                  }
                }}
                disabled={isCheckingSession || isLoading}
                className="mt-4 h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${(isCheckingSession || isLoading) ? 'animate-spin' : ''}`} />
                Check connection
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">ClickHouse users</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              {users.length} {users.length === 1 ? 'user' : 'users'} · Role-based access control
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkSessionAndFetchUsers}
            disabled={isLoading || isCheckingSession}
            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isCheckingSession) && "animate-spin")} />
            Refresh
          </Button>
          {canCreate && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={isSyncing || !hasClickHouseSession}
                className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                title="Sync unregistered ClickHouse users to metadata"
              >
                <Download className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
              <Button
                size="sm"
                onClick={openCreateDialog}
                className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                <Plus className="h-3.5 w-3.5" />
                Create user
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
          <table className="w-full">
            <tbody>
              <SkeletonRows count={5} cols={4} />
            </tbody>
          </table>
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
          <Users className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No ClickHouse users yet</h3>
          <p className="mt-2 text-[12px] text-paper-muted">Provision a user with database-scoped grants — DDL or DML, your call.</p>
          {canCreate && (
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="mt-4 h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              <Plus className="h-3.5 w-3.5" />
              Create user
            </Button>
          )}
        </div>
      ) : (
        <TooltipProvider>
          <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            <UITable>
              <TableHeader>
                <TableRow className="border-ink-500 hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Username</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Host restrictions</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Auth type</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.name} className="border-ink-500">
                    <TableCell className="font-medium text-paper">{user.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {user.host_ip && (
                          <span className="w-fit rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                            IP: {user.host_ip}
                          </span>
                        )}
                        {user.host_names && (
                          <span className="w-fit rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                            Host: {user.host_names}
                          </span>
                        )}
                        {!user.host_ip && !user.host_names && (
                          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">Any host</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-paper-muted">
                      {user.auth_type || 'sha256_password'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditDialog(user)}
                                className="h-8 w-8 rounded-xs text-paper-muted hover:bg-ink-200 hover:text-paper"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit user</TooltipContent>
                          </Tooltip>
                        )}
                        {canDelete && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteUser(user)}
                                className="h-8 w-8 rounded-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete user</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </UITable>
          </div>
        </TooltipProvider>
      )}

      {/* Create/Edit Dialog */}
      <UserFormDialog
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        user={editingUser}
        onSuccess={checkSessionAndFetchUsers}
      />

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
        title="Delete ClickHouse User"
        description={`Are you sure you want to delete ClickHouse user <strong>${deleteUser?.name}</strong>? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
