import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Settings, Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import useAppStore from "@/store";
import { retryInitialization } from "@/features/workspace/editor/monacoConfig";
import ClickhouseDefaultConfiguration from "@/features/admin/components/ClickhouseDefaultConfiguration";

const formSchema = z.object({
  isDistributed: z.boolean().optional(),
  clusterName: z.string().optional(),
});

export default function SettingsPage() {
  document.title = "ClickHouse UI | Settings";
  const {
    credential,
    setCredential,
    checkServerStatus,
    isLoadingCredentials,
    isServerAvailable,
    setCredentialSource,
    clearLocalData,
    isAdmin,
    updateDistributedSettings,
  } = useAppStore();

  const [showDistributedSettings, setShowDistributedSettings] = useState(
    credential?.isDistributed || false
  );
  const [searchParams] = useSearchParams();

  const currentFormValues = {
    isDistributed: credential?.isDistributed,
    clusterName: credential?.clusterName,
  };

  type FormData = {
    isDistributed?: boolean;
    clusterName?: string;
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      isDistributed:
        searchParams.get("isDistributed") === "true" ||
        credential?.isDistributed ||
        false,
      clusterName:
        searchParams.get("clusterName") || credential?.clusterName || "",
    },
  });

  useEffect(() => {
    form.reset({
      isDistributed:
        searchParams.get("isDistributed") === "true" ||
        credential?.isDistributed ||
        false,
      clusterName:
        searchParams.get("clusterName") || credential?.clusterName || "",
    });
  }, [searchParams, credential, form.reset]);

  const onSubmit = async (values: FormData) => {
    try {
      if (
        values.isDistributed === currentFormValues.isDistributed &&
        values.clusterName === currentFormValues.clusterName &&
        isServerAvailable
      ) {
        toast.info("No changes detected.");
        return;
      }

      // Check if ONLY distributed settings changed
      // We can compare with the current store credentials, excluding distributed flags
      // But simpler: since this form ONLY handles distributed settings when in this mode,
      // and we don't have other inputs here except the hidden ones (which are not in this form schema anyway?)
      // Wait, the form schema DOES NOT include url/user/pass. So we are ONLY changing distributed settings here.
      // So we can ALWAYS use updateDistributedSettings if we are just toggling flags.

      // However, we need to be careful. The original code was calling setCredential which reconnects.
      // If we just update the store, we don't reconnect.
      // The user wants "remove any connectivity when hit the save button".

      updateDistributedSettings({
        isDistributed: values.isDistributed || false,
        clusterName: values.clusterName,
      });

      toast.success("Settings saved successfully");

      // We do NOT call setCredential or checkServerStatus here.
    } catch (error) {
      toast.error("Error saving settings: " + (error as Error).message);
    }
  };

  const handleClearLocal = () => {
    const confirmed = window.confirm(
      "This will clear tabs and metrics layouts saved locally. Credentials are kept. Continue?"
    );
    if (!confirmed) return;
    clearLocalData();
    toast.success("Local data cleared");
  };

  return (
    <div className="max-h-screen w-full overflow-y-auto">
      <div className="max-w-2xl mx-auto py-8">
        <div className="space-y-8">
          {isAdmin && (
            <Card className="shadow-lg border-muted">
              <CardHeader>
                <CardTitle className="text-2xl font-bold flex items-center gap-2">
                  <Settings className="h-6 w-6 text-primary" />
                  Cluster Configuration
                </CardTitle>
                <CardDescription>
                  Configure distributed operations.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                  >
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="isDistributed"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                  setShowDistributedSettings(
                                    checked as boolean
                                  );
                                  field.onChange(checked);
                                }}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>Distributed Mode</FormLabel>
                              <FormDescription className="text-xs">
                                Enable this if you're using a ClickHouse
                                cluster
                              </FormDescription>
                            </div>
                          </FormItem>
                        )}
                      />

                      {showDistributedSettings && (
                        <FormField
                          control={form.control}
                          name="clusterName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Cluster Name</FormLabel>
                              <FormControl>
                                <Input
                                  className="font-mono"
                                  disabled={isLoadingCredentials}
                                  placeholder="my_cluster"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription className="text-xs">
                                The name of your ClickHouse cluster
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>

                    <div className="flex gap-4 pt-4">
                      <Button
                        type="submit"
                        disabled={isLoadingCredentials}
                        className="w-40"
                      >
                        {isLoadingCredentials ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save Settings"
                        )}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          <ClickhouseDefaultConfiguration />

          {/* Local data management */}
          <Card className="shadow-lg border-muted">
            <CardHeader>
              <CardTitle className="text-2xl font-bold flex items-center gap-2">
                <Trash2 className="h-6 w-6 text-primary" />
                Interface Reset
              </CardTitle>
              <CardDescription>
                Reset your workspace layout, including open tabs and dashboard customizations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This acts as a "Factory Reset" for the UI. It does not log you out or delete any data on the server.
              </p>
            </CardContent>
            <CardFooter className="border-t bg-muted/50 rounded-b-lg pt-4 flex justify-end">
              <Button variant="destructive" onClick={handleClearLocal}>
                <Trash2 className="mr-2 h-4 w-4" /> Clear Local Data
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
