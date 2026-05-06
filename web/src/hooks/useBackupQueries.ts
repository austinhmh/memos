import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/auth-state";

export interface BackupObject {
  key: string;
  size: number;
  lastModified: string;
}

interface ListBackupsResponse {
  backups: BackupObject[];
}

export const backupKeys = {
  all: ["backup"] as const,
  lists: () => [...backupKeys.all, "list"] as const,
};

async function parseJSONResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload: Record<string, unknown> = text
    ? await Promise.resolve()
        .then(() => JSON.parse(text) as Record<string, unknown>)
        .catch(() => ({}))
    : {};
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : typeof payload.code === "string"
            ? payload.code
            : text || "Backup request failed";
    throw new Error(message);
  }
  return payload as T;
}

function backupHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  const accessToken = getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

export function useListBackups() {
  return useQuery({
    queryKey: backupKeys.lists(),
    queryFn: async () => {
      const response = await fetch("/api/v1/admin/backups", {
        credentials: "include",
        headers: backupHeaders(),
      });
      const data = await parseJSONResponse<ListBackupsResponse>(response);
      return data.backups;
    },
  });
}

export function useRunBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/v1/admin/backups/run", {
        method: "POST",
        credentials: "include",
        headers: backupHeaders(),
      });
      return parseJSONResponse<BackupObject>(response);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
    },
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/v1/admin/backups/restore", {
        method: "POST",
        credentials: "include",
        headers: backupHeaders(),
        body: formData,
      });
      return parseJSONResponse<Record<string, unknown>>(response);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
    },
  });
}
