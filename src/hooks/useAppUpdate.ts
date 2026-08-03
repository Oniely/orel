import { getBundleType, getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

const UPDATE_QUERY_KEY = ["app-update"] as const;
const APP_INFO_QUERY_KEY = ["app-info"] as const;

export function useAppUpdate() {
  return useQuery<Update | null>({
    queryKey: UPDATE_QUERY_KEY,
    queryFn: () => check({ timeout: 15_000 }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAppInfo() {
  return useQuery({
    queryKey: APP_INFO_QUERY_KEY,
    queryFn: async () => {
      const [version, bundleType] = await Promise.all([getVersion(), getBundleType()]);
      return { version, bundleType };
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useInstallUpdate() {
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: async (update: Update) => {
      let downloaded = 0;
      let total: number | undefined;
      setProgress(0);

      const onDownload = (event: DownloadEvent) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        } else {
          setProgress(100);
        }
      };

      await update.downloadAndInstall(onDownload);
      await relaunch();
    },
  });

  return { ...mutation, progress };
}
