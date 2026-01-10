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
              console.error('Failed to fetch databases:', err);
              return [];
            }),
            rbacClickHouseUsersApi.getClusters().catch((err) => {
              console.error('Failed to fetch clusters:', err);
              return [];
            }),
          ]);
          console.log('Fetched databases:', dbList);
          console.log('Fetched clusters:', clusterList);
          setDatabases(dbList || []);
          setClusters(clusterList || []);
        } catch (error) {
          console.error('Failed to fetch data:', error);
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
        console.log('[ClickHouse Users] Loading user data for editing:', user);
        setUsername(user.name);
        setPassword('');
        setConfirmPassword('');
        // Use role from grants if available, otherwise default to viewer
        const userRole = user.role || 'viewer';
        setRole(userRole);
        console.log('[ClickHouse Users] Setting role:', userRole);
        
        // Use allowedDatabases and allowedTables from grants if available
        const userDatabases = user.allowedDatabases || [];
        const userTables = user.allowedTables || [];
        setAllowedDatabases(userDatabases);
        setAllowedTables(userTables);
        console.log('[ClickHouse Users] Setting databases:', userDatabases);
        console.log('[ClickHouse Users] Setting tables:', userTables);
        
        // Auto-expand databases that have selected tables
        if (userDatabases.length > 0 || userTables.length > 0) {
          const dbSet = new Set(userDatabases);
          userTables.forEach(t => dbSet.add(t.database));
          setExpandedDatabases(dbSet);
          console.log('[ClickHouse Users] Auto-expanding databases:', Array.from(dbSet));
        }
        
        // ClickHouse returns host_ip and host_names as arrays, convert to strings
        const hostIpValue = user.host_ip;
        const hostNamesValue = user.host_names;
        const hostIpStr = Array.isArray(hostIpValue) ? (hostIpValue[0] || '') : (typeof hostIpValue === 'string' ? hostIpValue : '');
        const hostNamesStr = Array.isArray(hostNamesValue) ? (hostNamesValue[0] || '') : (typeof hostNamesValue === 'string' ? hostNamesValue : '');
        setHostIp(hostIpStr);
        setHostNames(hostNamesStr);
        console.log('[ClickHouse Users] Setting hostIp:', hostIpStr, 'hostNames:', hostNamesStr);
        
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
        
        console.log('[ClickHouse Users] Generating DDL with input:', updateInput);
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
        
        console.log('[ClickHouse Users] Submitting input:', input);
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
        
        console.log('[ClickHouse Users] Submitting input:', createPayload);
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
      <DialogContent className="sm:max-w-[800px] bg-gray-900 border-gray-800 max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-4 border-b border-gray-800">
          <DialogTitle className="text-white flex items-center gap-2 text-xl">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <Users className="w-5 h-5 text-purple-400" />
            </div>
            {isEditing ? 'Edit ClickHouse User' : 'Create ClickHouse User'}
          </DialogTitle>
          <DialogDescription className="text-gray-400 mt-2">
            {isEditing
              ? 'Update the ClickHouse user configuration.'
              : 'Create a new ClickHouse database user with role-based access control.'}
          </DialogDescription>
        </DialogHeader>
        
        {/* Progress Indicator */}
        <div className="py-6 px-2">
          <div className="flex items-center justify-between relative">
            {/* Progress Line */}
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-800 -z-10">
              <motion.div
                className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                initial={{ width: '0%' }}
                animate={{ width: `${((step - 1) / 3) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            
            {steps.map((s, idx) => {
              const isActive = step === s.number;
              const isCompleted = step > s.number;
              const Icon = s.icon;
              
              return (
                <div key={s.number} className="flex flex-col items-center flex-1 relative">
                  <motion.div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                      isCompleted
                        ? 'bg-gradient-to-br from-purple-500 to-blue-500 border-purple-500 text-white'
                        : isActive
                        ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                        : 'bg-gray-800 border-gray-700 text-gray-500'
                    }`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isCompleted ? (
                      <Check className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </motion.div>
                  <span className={`text-xs mt-2 font-medium ${
                    isActive ? 'text-white' : 'text-gray-500'
                  }`}>
                    {s.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Step Content */}
        <div className="flex-1 overflow-y-auto px-1">
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
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-blue-400 font-medium">Editing existing user</p>
                <p className="text-xs text-gray-400 mt-1">All fields below show current values. Modify as needed.</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="user_name"
                className="bg-gray-800 border-gray-700"
                disabled={isEditing}
              />
              <p className="text-xs text-gray-500">Must start with a letter or underscore</p>
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
                        className="bg-gray-800 border-gray-700 pr-10"
                        disabled={authType === 'no_password'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-2.5 text-gray-400 hover:text-white"
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
                  <p className="text-xs text-gray-500">
                    {authType === 'no_password' 
                      ? 'Password is not required when using no_password authentication'
                      : 'Password for the user account'}
                  </p>
                  
                  {/* Password Requirements */}
                  {authType !== 'no_password' && password && (
                    <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 mt-2">
                      <p className="text-xs text-gray-400 mb-2">Password Requirements:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.length ? 'text-green-400' : 'text-gray-500'}`}>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.length ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                            {passwordReqs.length ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                          </div>
                          <span>At least 8 characters</span>
                        </div>
                        <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.upper ? 'text-green-400' : 'text-gray-500'}`}>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.upper ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                            {passwordReqs.upper ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                          </div>
                          <span>Uppercase letter</span>
                        </div>
                        <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.lower ? 'text-green-400' : 'text-gray-500'}`}>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.lower ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                            {passwordReqs.lower ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                          </div>
                          <span>Lowercase letter</span>
                        </div>
                        <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.number ? 'text-green-400' : 'text-gray-500'}`}>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.number ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                            {passwordReqs.number ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                          </div>
                          <span>Number</span>
                        </div>
                        <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.special ? 'text-green-400' : 'text-gray-500'}`}>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.special ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                            {passwordReqs.special ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
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
                      className="bg-gray-800 border-gray-700"
                    />
                    {confirmPassword && password !== confirmPassword && (
                      <p className="text-xs text-red-400">Passwords do not match</p>
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
                      className="bg-gray-800 border-gray-700 pr-10"
                      disabled={authType === 'no_password'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-2.5 text-gray-400 hover:text-white"
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
                <p className="text-xs text-gray-500">
                  {authType === 'no_password' 
                    ? 'Password is not required when using no_password authentication'
                    : 'Leave empty to keep the current password'}
                </p>
                
                {/* Password Requirements for Edit */}
                {authType !== 'no_password' && password && (
                  <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 mt-2">
                    <p className="text-xs text-gray-400 mb-2">Password Requirements:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.length ? 'text-green-400' : 'text-gray-500'}`}>
                        <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.length ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                          {passwordReqs.length ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                        </div>
                        <span>At least 8 characters</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.upper ? 'text-green-400' : 'text-gray-500'}`}>
                        <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.upper ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                          {passwordReqs.upper ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                        </div>
                        <span>Uppercase letter</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.lower ? 'text-green-400' : 'text-gray-500'}`}>
                        <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.lower ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                          {passwordReqs.lower ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                        </div>
                        <span>Lowercase letter</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.number ? 'text-green-400' : 'text-gray-500'}`}>
                        <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.number ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                          {passwordReqs.number ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
                        </div>
                        <span>Number</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs transition-colors ${passwordReqs.special ? 'text-green-400' : 'text-gray-500'}`}>
                        <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${passwordReqs.special ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
                          {passwordReqs.special ? <Check className="w-2 h-2" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
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
                  className="bg-gray-800 border-gray-700"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="hostNames">Host Names (optional)</Label>
                <Input
                  id="hostNames"
                  value={hostNames}
                  onChange={(e) => setHostNames(e.target.value)}
                  placeholder="example.com"
                  className="bg-gray-800 border-gray-700"
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
                <SelectTrigger className="bg-gray-800 border-gray-700">
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
              <p className="text-xs text-gray-500">Leave empty for local user, or select a cluster</p>
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
                <SelectTrigger className={`bg-gray-800 border-gray-700 ${isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <SelectValue placeholder="Select authentication type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sha256_password">SHA256 Password (Recommended)</SelectItem>
                  <SelectItem value="double_sha1_password">Double SHA1 Password</SelectItem>
                  <SelectItem value="plaintext_password">Plaintext Password (Not Recommended)</SelectItem>
                  <SelectItem value="no_password">No Password (Use with host restrictions)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                {isEditing 
                  ? 'Authentication type cannot be changed after user creation'
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
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <p className="text-sm text-blue-400 font-medium">Current Role: <span className="capitalize">{role}</span></p>
                      <p className="text-xs text-gray-400 mt-1">Select a different role below to change it</p>
                    </div>
                  )}
                  <div>
                    <Label className="text-lg">Select Role *</Label>
                    <p className="text-sm text-gray-400 mt-1">Choose the access level for this user</p>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                    {([
                      { role: 'developer' as ClickHouseUserRole, icon: FileCode, color: 'purple', description: 'Full DDL/DML access' },
                      { role: 'analyst' as ClickHouseUserRole, icon: BarChart3, color: 'blue', description: 'Read/write data access' },
                      { role: 'viewer' as ClickHouseUserRole, icon: EyeIcon, color: 'green', description: 'Read-only access' },
                    ]).map(({ role: r, icon: RoleIcon, color, description }) => {
                      const isSelected = role === r;
                      const colorClasses = {
                        purple: {
                          selected: 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/20',
                          iconBg: 'bg-purple-500/20',
                          icon: 'text-purple-400',
                          check: 'bg-purple-500',
                        },
                        blue: {
                          selected: 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/20',
                          iconBg: 'bg-blue-500/20',
                          icon: 'text-blue-400',
                          check: 'bg-blue-500',
                        },
                        green: {
                          selected: 'border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20',
                          iconBg: 'bg-green-500/20',
                          icon: 'text-green-400',
                          check: 'bg-green-500',
                        },
                      };
                      const colors = colorClasses[color as keyof typeof colorClasses];
                      
                      return (
                        <motion.button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className={`p-4 rounded-lg border-2 text-left transition-all ${
                            isSelected
                              ? colors.selected
                              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                          }`}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg ${
                              isSelected ? colors.iconBg : 'bg-gray-700/50'
                            }`}>
                              <RoleIcon className={`w-5 h-5 ${
                                isSelected ? colors.icon : 'text-gray-400'
                              }`} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-white capitalize">{r}</h3>
                                {isSelected && (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className={`w-5 h-5 rounded-full ${colors.check} flex items-center justify-center`}
                                  >
                                    <Check className="w-3 h-3 text-white" />
                                  </motion.div>
                                )}
                              </div>
                              <p className="text-sm text-gray-400 mt-1">{description}</p>
                              <div className="mt-3 pt-3 border-t border-gray-700">
                                <ul className="text-xs text-gray-300 space-y-1">
                                  {r === 'developer' && (
                                    <>
                                      <li>✓ Create/Drop databases and tables</li>
                                      <li>✓ ALTER tables</li>
                                      <li>✓ SELECT, INSERT, UPDATE, DELETE</li>
                                    </>
                                  )}
                                  {r === 'analyst' && (
                                    <>
                                      <li>✓ SELECT, INSERT, UPDATE, DELETE</li>
                                      <li>✗ No DDL operations</li>
                                    </>
                                  )}
                                  {r === 'viewer' && (
                                    <>
                                      <li>✓ SELECT only (read-only)</li>
                                    </>
                                  )}
                                </ul>
                              </div>
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
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <p className="text-sm text-blue-400 font-medium">Current Access Restrictions</p>
                      <div className="mt-2 text-xs text-gray-400 space-y-1">
                        {allowedDatabases.length > 0 && (
                          <p>• Databases: {allowedDatabases.length} selected</p>
                        )}
                        {allowedTables.length > 0 && (
                          <p>• Tables: {allowedTables.length} selected</p>
                        )}
                        {allowedDatabases.length === 0 && allowedTables.length === 0 && (
                          <p>• Full access to all databases and tables</p>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Modify selections below to change access</p>
                    </div>
                  )}
                  <div>
                    <Label className="text-lg flex items-center gap-2">
                      <Database className="w-5 h-5" />
                      Access Restrictions (Optional)
                    </Label>
                    <p className="text-sm text-gray-400 mt-2">
                      Leave empty to allow access to all databases/tables. Select specific databases and tables to restrict access.
                    </p>
                  </div>
                  
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Search databases and tables..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 bg-gray-800 border-gray-700"
                    />
                  </div>
                  
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    <motion.div
                      className="p-4 rounded-lg border border-gray-700 bg-gray-800/50"
                      whileHover={{ scale: 1.02 }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-400">Selected Databases</p>
                          <p className="text-2xl font-bold text-white mt-1">
                            {allowedDatabases.length || 'All'}
                          </p>
                        </div>
                        <Database className="w-8 h-8 text-purple-400" />
                      </div>
                    </motion.div>
                    <motion.div
                      className="p-4 rounded-lg border border-gray-700 bg-gray-800/50"
                      whileHover={{ scale: 1.02 }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-400">Selected Tables</p>
                          <p className="text-2xl font-bold text-white mt-1">
                            {allowedTables.length || 'All'}
                          </p>
                        </div>
                        <Table className="w-8 h-8 text-blue-400" />
                      </div>
                    </motion.div>
                  </div>
                  
                  {/* Database Tree */}
                  {isLoadingDatabases ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                      <span className="ml-2 text-gray-400">Loading databases...</span>
                    </div>
                  ) : filteredDatabases.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No databases found</p>
                      {searchQuery ? (
                        <p className="text-sm mt-1">Try a different search term</p>
                      ) : databases.length === 0 ? (
                        <p className="text-sm mt-1">No databases available. Make sure you're connected to ClickHouse.</p>
                      ) : (
                        <p className="text-sm mt-1">No databases match your search</p>
                      )}
                    </div>
                  ) : (
                    <div className="border border-gray-700 rounded-lg bg-gray-800/30">
                      <div className="h-[400px] overflow-y-auto overflow-x-hidden relative">
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
                                  className={`flex items-center gap-3 p-3 hover:bg-gray-700/30 transition-colors bg-gray-800/98 backdrop-blur-sm border border-gray-700 rounded-lg ${
                                    isExpanded ? 'shadow-lg border-b-2 border-purple-500/30' : ''
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
                                    className="text-gray-400 hover:text-white transition-colors"
                                  >
                                    <ChevronRight
                                      className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                    />
                                  </button>
                                  
                                  <Checkbox
                                    checked={isDbSelected}
                                    onCheckedChange={() => toggleDatabaseSelection(db.name)}
                                    className="border-gray-600"
                                  />
                                  
                                  <div className="flex-1 flex items-center gap-2">
                                    <Database className="w-4 h-4 text-purple-400" />
                                    <span className="font-medium text-white">{db.name}</span>
                                    {tables.length > 0 && (
                                      <Badge variant="outline" className="text-xs border-gray-600 text-gray-400">
                                        {tables.length} {tables.length === 1 ? 'table' : 'tables'}
                                      </Badge>
                                    )}
                                    {isDbSelected && selectedTablesCount > 0 && (
                                      <Badge className="text-xs bg-purple-500/20 text-purple-300 border-purple-500/30">
                                        {selectedTablesCount} selected
                                      </Badge>
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
                                      className="overflow-visible pl-2 mt-1"
                                    >
                                      <div className="pl-9 pr-3 pb-2 pt-2 space-y-1 border-l-2 border-gray-700/50 ml-4">
                                        {/* Select All Tables */}
                                        {isDbSelected && tables.length > 0 && (
                                          <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-700/20 cursor-pointer"
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
                                                className="border-gray-600"
                                              />
                                              {someTablesSelected && !allTablesSelected && (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                  <div className="w-2 h-2 bg-purple-400 rounded-sm" />
                                                </div>
                                              )}
                                            </div>
                                            <span className="text-sm text-gray-400">
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
                                            <motion.div
                                              key={`${db.name}.${table.name}`}
                                              className="flex items-center gap-2 p-2 rounded hover:bg-gray-700/20 transition-colors"
                                              whileHover={{ x: 4 }}
                                            >
                                              <Checkbox
                                                checked={isTableSel}
                                                onCheckedChange={() => toggleTableSelection(db.name, table.name)}
                                                disabled={!isDbSelected}
                                                className="border-gray-600"
                                              />
                                              <Table className="w-3 h-3 text-blue-400" />
                                              <span className="text-sm text-gray-300 flex-1">{table.name}</span>
                                              {table.type === 'view' && (
                                                <Badge variant="outline" className="text-xs border-gray-600 text-gray-500">
                                                  view
                                                </Badge>
                                              )}
                                            </motion.div>
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
                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                        <div className="text-sm text-blue-200">
                          <strong>No restrictions selected.</strong> The user will have access to all databases and tables based on their role permissions.
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
                  <Label>Generated DDL</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copyDDL}
                    className="border-gray-700"
                  >
                    {ddlCopied ? (
                      <>
                        <Check className="w-4 h-4 mr-1" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1" />
                        Copy DDL
                      </>
                    )}
                  </Button>
                </div>
                
                <Textarea
                  value={ddl.fullDDL}
                  readOnly
                  className="bg-gray-800 border-gray-700 font-mono text-sm h-64"
                />
                
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5" />
                    <p className="text-sm text-yellow-200">
                      Review the DDL above. Click "Create User" to execute these statements in ClickHouse.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Code className="w-12 h-12 mx-auto text-gray-600 mb-4" />
                <p className="text-gray-400">Click "Generate DDL" to preview the SQL statements</p>
              </div>
            )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        
        <DialogFooter className="flex items-center justify-between pt-4 border-t border-gray-800">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={step === 1}
            className="border-gray-700"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          
          <div className="flex gap-2">
            {step < 4 ? (
              <Button
                onClick={nextStep}
                disabled={!canProceed()}
                className="bg-purple-600 hover:bg-purple-700"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <>
                {!ddl ? (
                  <Button
                    onClick={handleGenerateDDL}
                    disabled={isGeneratingDDL}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {isGeneratingDDL ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate DDL
                      </>
                    )}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={copyDDL}
                      variant="outline"
                      className="border-gray-700"
                    >
                      {ddlCopied ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-2" />
                          Copy DDL
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={isSubmitting}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {isEditing ? 'Updating...' : 'Creating...'}
                        </>
                      ) : (
                        <>
                          {isEditing ? 'Update User' : 'Create User'}
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
  const checkSessionAndFetchUsers = async () => {
    setIsCheckingSession(true);
    setIsLoading(true);
    
    try {
      // First, check if we have a session ID locally
      const localSessionId = getSessionId();
      const authStoreSessionId = useAuthStore.getState().sessionId;
      const sessionId = localSessionId || authStoreSessionId;
      
      if (!sessionId) {
        console.log('[ClickHouse Users] No session ID found');
        setHasClickHouseSession(false);
        return;
      }
      
      // Try to fetch users - this will verify the session is valid
      try {
        const result = await rbacClickHouseUsersApi.list();
        setUsers(result);
        setHasClickHouseSession(true);
        console.log('[ClickHouse Users] Successfully fetched users, session is valid');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to load ClickHouse users';
        console.error('[ClickHouse Users] Failed to fetch users:', errorMsg);
        
        // Check if it's a session error
        if (errorMsg.includes('No active ClickHouse session') || 
            errorMsg.includes('session') || 
            errorMsg.includes('NO_SESSION') ||
            (error instanceof Error && error.message.includes('session'))) {
          setHasClickHouseSession(false);
          console.log('[ClickHouse Users] Session error detected');
        } else {
          // Other error - still show as connected but show error toast
          setHasClickHouseSession(true);
          toast.error(errorMsg);
        }
      }
    } catch (error) {
      console.error('[ClickHouse Users] Error checking session:', error);
      setHasClickHouseSession(false);
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
      console.log('[ClickHouse Users] Connection event received, refreshing...');
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
        console.error('Sync errors:', result.errors);
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
        <AlertCircle className="w-12 h-12 mx-auto text-gray-600 mb-4" />
        <p className="text-gray-400">You don't have permission to view ClickHouse users</p>
      </div>
    );
  }
  
  // Show loading state while checking session
  if (isCheckingSession) {
    return (
      <div className="p-6 text-center">
        <Loader2 className="w-8 h-8 mx-auto text-purple-500 animate-spin mb-4" />
        <p className="text-gray-400">Checking ClickHouse connection...</p>
      </div>
    );
  }
  
  // Show message when no ClickHouse session is active
  if (!hasClickHouseSession) {
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto mt-12">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
            <Database className="w-16 h-16 mx-auto text-gray-500 mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">
              No Active ClickHouse Connection
            </h3>
            <p className="text-gray-400 mb-6">
              You need to connect to a ClickHouse server before managing users. 
              Please select a connection from the sidebar to get started.
            </p>
            <div className="flex flex-col gap-3 items-center">
              <div className="text-sm text-gray-500 space-y-1">
                <p>1. Select a ClickHouse connection from the sidebar</p>
                <p>2. Click "Connect" to establish a session</p>
                <p>3. Return here to manage ClickHouse users</p>
              </div>
              <Button
                variant="outline"
                onClick={checkSessionAndFetchUsers}
                disabled={isCheckingSession || isLoading}
                className="mt-4 border-gray-700"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${(isCheckingSession || isLoading) ? 'animate-spin' : ''}`} />
                Check Connection
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">ClickHouse Users</h2>
          <p className="text-sm text-gray-400 mt-1">
            Manage ClickHouse database users with role-based access control
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkSessionAndFetchUsers}
            disabled={isLoading || isCheckingSession}
            className="border-gray-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${(isLoading || isCheckingSession) ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {canCreate && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={isSyncing || !hasClickHouseSession}
                className="border-gray-700"
                title="Sync unregistered ClickHouse users to metadata"
              >
                <Download className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
              <Button
                size="sm"
                onClick={openCreateDialog}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create User
              </Button>
            </>
          )}
        </div>
      </div>
      
      {/* Users Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-300">No ClickHouse users found</h3>
          <p className="text-gray-500 mt-1">Create your first ClickHouse user to get started</p>
          {canCreate && (
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="mt-4 bg-purple-600 hover:bg-purple-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create User
            </Button>
          )}
        </div>
      ) : (
        <TooltipProvider>
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            <UITable>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">Username</TableHead>
                  <TableHead className="text-gray-400">Host Restrictions</TableHead>
                  <TableHead className="text-gray-400">Auth Type</TableHead>
                  <TableHead className="text-gray-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.name} className="border-gray-800">
                    <TableCell className="font-medium text-white">{user.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {user.host_ip && (
                          <Badge variant="outline" className="text-xs border-gray-700 text-gray-300 w-fit">
                            IP: {user.host_ip}
                          </Badge>
                        )}
                        {user.host_names && (
                          <Badge variant="outline" className="text-xs border-gray-700 text-gray-300 w-fit">
                            Host: {user.host_names}
                          </Badge>
                        )}
                        {!user.host_ip && !user.host_names && (
                          <span className="text-xs text-gray-500">Any host</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-300">
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
                                className="h-8 w-8"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit User</TooltipContent>
                          </Tooltip>
                        )}
                        {canDelete && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteUser(user)}
                                className="h-8 w-8 text-red-400 hover:text-red-300"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete User</TooltipContent>
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
