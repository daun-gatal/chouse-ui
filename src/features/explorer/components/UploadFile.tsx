import React, { useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Upload, FileText } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExplorerStore } from "@/stores";
import { useDatabases } from "@/hooks";
import { queryApi } from "@/api";

const UploadFile: React.FC = () => {
  const { uploadFileModalOpen, closeUploadFileModal, selectedDatabase } = useExplorerStore();
  const { data: databases = [], refetch: refetchDatabases } = useDatabases();

  const [database, setDatabase] = useState(selectedDatabase || "");
  const [tableName, setTableName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState("CSV");
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const droppedFile = acceptedFiles[0];
      setFile(droppedFile);

      // Auto-detect format from extension
      const ext = droppedFile.name.split(".").pop()?.toLowerCase();
      if (ext === "csv") setFormat("CSV");
      else if (ext === "json" || ext === "jsonl") setFormat("JSONEachRow");
      else if (ext === "tsv") setFormat("TSV");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/json": [".json", ".jsonl"],
      "text/tab-separated-values": [".tsv"],
    },
    maxFiles: 1,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!database) {
      toast.error("Please select a database");
      return;
    }

    if (!tableName.trim()) {
      toast.error("Please enter a table name");
      return;
    }

    if (!file) {
      toast.error("Please select a file to upload");
      return;
    }

    setIsUploading(true);
    try {
      const content = await file.text();
      
      // Insert the data
      const query = `INSERT INTO ${database}.${tableName} FORMAT ${format}\n${content}`;
      await queryApi.execute({ query });
      
      toast.success(`Data uploaded successfully to ${database}.${tableName}`);
      await refetchDatabases();
      handleClose();
    } catch (error) {
      console.error("Failed to upload file:", error);
      toast.error(`Failed to upload: ${(error as Error).message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setDatabase(selectedDatabase || "");
    setTableName("");
    setFile(null);
    setFormat("CSV");
    closeUploadFileModal();
  };

  return (
    <Dialog open={uploadFileModalOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Database</Label>
                <Select value={database} onValueChange={setDatabase}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select database" />
                  </SelectTrigger>
                  <SelectContent>
                    {databases.map((db) => (
                      <SelectItem key={db.name} value={db.name}>
                        {db.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Table Name</Label>
                <Input
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="Existing table name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CSV">CSV</SelectItem>
                  <SelectItem value="TSV">TSV</SelectItem>
                  <SelectItem value="JSONEachRow">JSON (one object per line)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>File</Label>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? "border-purple-500 bg-purple-500/10"
                    : "border-white/20 hover:border-white/40"
                }`}
              >
                <input {...getInputProps()} />
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="h-6 w-6 text-purple-400" />
                    <span className="text-white">{file.name}</span>
                    <span className="text-gray-400">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                ) : isDragActive ? (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-8 w-8 text-purple-400" />
                    <p className="text-purple-400">Drop the file here...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-8 w-8 text-gray-400" />
                    <p className="text-gray-400">
                      Drag & drop a file here, or click to select
                    </p>
                    <p className="text-xs text-gray-500">
                      Supports CSV, TSV, JSON
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isUploading}>
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default UploadFile;
