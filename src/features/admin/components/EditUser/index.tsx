import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { UserCog, ArrowLeft, Loader2, Shield, Key, Trash2, AlertTriangle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useExecuteQuery, useUserDetails } from "@/hooks";

// Predefined role templates (same as CreateUser)
const ROLE_TEMPLATES = {
  admin: {
    name: "Admin",
    description: "Full access to all databases and system operations",
    icon: "🛡️",
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    borderColor: "border-red-500/50",
  },
  developer: {
    name: "Developer",
    description: "Read/write access with DDL capabilities",
    icon: "👨‍💻",
    color: "text-blue-400",
    bgColor: "bg-blue-500/20",
    borderColor: "border-blue-500/50",
  },
  readWrite: {
    name: "Read-Write",
    description: "Read and write data, no schema changes",
    icon: "📝",
    color: "text-green-400",
    bgColor: "bg-green-500/20",
    borderColor: "border-green-500/50",
  },
  readOnly: {
    name: "Read Only",
    description: "Query data only, no modifications",
    icon: "👁️",
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    borderColor: "border-purple-500/50",
  },
};

type RoleTemplate = keyof typeof ROLE_TEMPLATES;

const EditUser: React.FC = () => {
  const navigate = useNavigate();
  const { username } = useParams<{ username: string }>();
  const executeQuery = useExecuteQuery();
  const { data: userDetails, isLoading: loadingDetails, refetch } = useUserDetails(username || "");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentGrants, setCurrentGrants] = useState<string[]>([]);

  // Fetch current grants for the user
  useEffect(() => {
    if (username) {
      executeQuery.mutateAsync({
        query: `SELECT access_type FROM system.grants WHERE user_name = '${username}'`,
      }).then((result) => {
        const grants = (result.data as { access_type: string }[]).map(g => g.access_type);
        setCurrentGrants(grants);
      }).catch(() => {
        // Ignore errors
      });
    }
  }, [username]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword.trim()) {
      toast.error("Please enter a new password");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setIsUpdatingPassword(true);

    try {
      const escapedPassword = newPassword.replace(/'/g, "\\'");
      await executeQuery.mutateAsync({
        query: `ALTER USER '${username}' IDENTIFIED BY '${escapedPassword}'`,
      });
      toast.success("Password updated successfully");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Failed to update password:", error);
      toast.error(`Failed to update password: ${(error as Error).message}`);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleDeleteUser = async () => {
    setIsDeleting(true);

    try {
      await executeQuery.mutateAsync({
        query: `DROP USER IF EXISTS '${username}'`,
      });
      toast.success(`User "${username}" deleted successfully`);
      navigate("/admin");
    } catch (error) {
      console.error("Failed to delete user:", error);
      toast.error(`Failed to delete user: ${(error as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleApplyRole = async (role: RoleTemplate) => {
    try {
      // First revoke all existing grants
      await executeQuery.mutateAsync({
        query: `REVOKE ALL ON *.* FROM '${username}'`,
      });

      // Then apply new grants based on role
      switch (role) {
        case "admin":
          await executeQuery.mutateAsync({
            query: `GRANT ALL ON *.* TO '${username}' WITH GRANT OPTION`,
          });
          break;
        case "developer":
          await executeQuery.mutateAsync({
            query: `GRANT SELECT, INSERT, CREATE TABLE, DROP TABLE, ALTER TABLE ON *.* TO '${username}'`,
          });
          break;
        case "readWrite":
          await executeQuery.mutateAsync({
            query: `GRANT SELECT, INSERT ON *.* TO '${username}'`,
          });
          break;
        case "readOnly":
          await executeQuery.mutateAsync({
            query: `GRANT SELECT ON *.* TO '${username}'`,
          });
          break;
      }

      toast.success(`Applied ${ROLE_TEMPLATES[role].name} role to ${username}`);
      
      // Refresh grants
      const result = await executeQuery.mutateAsync({
        query: `SELECT access_type FROM system.grants WHERE user_name = '${username}'`,
      });
      const grants = (result.data as { access_type: string }[]).map(g => g.access_type);
      setCurrentGrants(grants);
    } catch (error) {
      console.error("Failed to apply role:", error);
      toast.error(`Failed to apply role: ${(error as Error).message}`);
    }
  };

  if (loadingDetails) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="container mx-auto p-6 space-y-6 max-w-4xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <UserCog className="h-6 w-6 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Edit User</h1>
              <p className="text-gray-400 text-sm">{username}</p>
            </div>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2">
              <Trash2 className="h-4 w-4" />
              Delete User
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Delete User
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete user <strong>{username}</strong>? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteUser}
                className="bg-red-600 hover:bg-red-700"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* User Info Card */}
      <GlassCard>
        <GlassCardHeader>
          <GlassCardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-400" />
            User Information
          </GlassCardTitle>
        </GlassCardHeader>
        <GlassCardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Username</div>
              <div className="text-white font-medium">{username}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Host IP</div>
              <div className="text-white font-medium">{userDetails?.host_ip || "Any"}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Roles</div>
              <div className="text-white font-medium">
                {userDetails?.default_roles_all ? "All Roles" : userDetails?.default_roles_list || "None"}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Current Grants</div>
              <div className="text-white font-medium">{currentGrants.length} permissions</div>
            </div>
          </div>

          {/* Current permissions */}
          <div className="mt-4">
            <div className="text-sm text-gray-400 mb-2">Current Permissions:</div>
            <div className="flex flex-wrap gap-2">
              {currentGrants.length === 0 ? (
                <span className="text-gray-500 text-sm italic">No permissions granted</span>
              ) : (
                currentGrants.slice(0, 10).map((grant, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 rounded text-xs bg-white/10 text-gray-300 border border-white/10"
                  >
                    {grant}
                  </span>
                ))
              )}
              {currentGrants.length > 10 && (
                <span className="px-2 py-1 rounded text-xs bg-white/10 text-gray-400">
                  +{currentGrants.length - 10} more
                </span>
              )}
            </div>
          </div>
        </GlassCardContent>
      </GlassCard>

      {/* Tabs */}
      <Tabs defaultValue="role" className="space-y-4">
        <TabsList className="bg-white/5 border border-white/10 p-1">
          <TabsTrigger value="role" className="data-[state=active]:bg-purple-500/20">
            <Shield className="h-4 w-4 mr-2" />
            Change Role
          </TabsTrigger>
          <TabsTrigger value="password" className="data-[state=active]:bg-blue-500/20">
            <Key className="h-4 w-4 mr-2" />
            Change Password
          </TabsTrigger>
        </TabsList>

        <TabsContent value="role">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle>Apply Role Template</GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent>
              <p className="text-sm text-gray-400 mb-4">
                Select a role template to apply. This will revoke existing permissions and apply new ones.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(Object.entries(ROLE_TEMPLATES) as [RoleTemplate, typeof ROLE_TEMPLATES.admin][]).map(
                  ([key, role]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleApplyRole(key)}
                      className={`p-4 rounded-lg border-2 transition-all text-left hover:scale-105 ${role.bgColor} ${role.borderColor}`}
                    >
                      <div className="text-2xl mb-2">{role.icon}</div>
                      <div className={`font-semibold ${role.color}`}>{role.name}</div>
                      <div className="text-xs text-gray-400 mt-1">{role.description}</div>
                    </button>
                  )
                )}
              </div>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>

        <TabsContent value="password">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-yellow-400" />
                Change Password
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent>
              <form onSubmit={handleUpdatePassword} className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="bg-white/5 border-white/10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="bg-white/5 border-white/10"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show-password"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="show-password" className="text-sm text-gray-400 cursor-pointer">
                    Show password
                  </Label>
                </div>

                <Button type="submit" disabled={isUpdatingPassword}>
                  {isUpdatingPassword ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Password"
                  )}
                </Button>
              </form>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default EditUser;
