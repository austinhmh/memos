import { RefreshCcwIcon, UploadIcon } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BackupObject, useListBackups, useRestoreBackup, useRunBackup } from "@/hooks/useBackupQueries";
import { handleError } from "@/lib/error";
import { formatFileSize } from "@/utils/format";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

const formatBackupTime = (value: string) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const BackupSection = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const { data: backups = [], isLoading, isError, error, refetch, isFetching } = useListBackups();
  const runBackupMutation = useRunBackup();
  const restoreBackupMutation = useRestoreBackup();

  const handleRunBackup = async () => {
    try {
      await runBackupMutation.mutateAsync();
      toast.success("Backup completed");
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Run backup" });
    }
  };

  const handleRestoreFileChanged = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setRestoreDialogOpen(Boolean(file));
  };

  const handleRestoreCancel = () => {
    setRestoreDialogOpen(false);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRestoreConfirm = async () => {
    if (!selectedFile) {
      toast.error("Backup file is required");
      return;
    }
    try {
      await restoreBackupMutation.mutateAsync(selectedFile);
      toast.success("Restore completed");
      handleRestoreCancel();
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Restore backup" });
    }
  };

  return (
    <SettingSection>
      <SettingGroup title="Backup">
        <div className="w-full flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Create, list, and restore logical backups stored in S3.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-busy={isFetching}
                data-testid="backup-refresh-button"
              >
                <RefreshCcwIcon />
                Refresh
              </Button>
              <Button
                type="button"
                onClick={handleRunBackup}
                disabled={runBackupMutation.isPending}
                aria-busy={runBackupMutation.isPending}
                data-testid="backup-run-button"
              >
                Run backup
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                data-testid="backup-restore-select-button"
              >
                <UploadIcon />
                Restore
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".tar.gz,application/gzip,application/x-gzip"
                className="hidden"
                onChange={handleRestoreFileChanged}
                data-testid="backup-restore-file-input"
              />
            </div>
          </div>

          <div className="w-full overflow-x-auto border rounded-md">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Object key</th>
                  <th className="px-3 py-2 text-left font-medium">Size</th>
                  <th className="px-3 py-2 text-left font-medium">Last modified</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground" data-testid="backup-list-loading">
                      Loading backups...
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-destructive" data-testid="backup-list-error">
                      {error instanceof Error ? error.message : "Failed to load backups"}
                    </td>
                  </tr>
                ) : backups.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground" data-testid="backup-list-empty">
                      No backups found
                    </td>
                  </tr>
                ) : (
                  backups.map((backup: BackupObject) => (
                    <tr key={backup.key} className="border-t" data-testid="backup-list-row">
                      <td className="px-3 py-2 font-mono text-xs break-all">{backup.key}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatFileSize(backup.size)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatBackupTime(backup.lastModified)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </SettingGroup>

      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore backup</DialogTitle>
            <DialogDescription>
              Restore is only allowed on an empty instance. This action imports the selected logical backup.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="backup-restore-file-name">
            {selectedFile?.name ?? "No file selected"}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleRestoreCancel} data-testid="backup-restore-cancel-button">
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleRestoreConfirm}
              disabled={!selectedFile || restoreBackupMutation.isPending}
              aria-busy={restoreBackupMutation.isPending}
              data-testid="backup-restore-confirm-button"
            >
              Confirm restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingSection>
  );
};

export default BackupSection;
