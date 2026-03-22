import { useQuery } from "@tanstack/react-query";

interface URLMetadata {
  title: string;
  description: string;
  image: string;
  favicon: string;
}

export function useURLMetadata(url: string, enabled = true) {
  return useQuery<URLMetadata>({
    queryKey: ["url-metadata", url],
    queryFn: async () => {
      const res = await fetch(`/api/v1/url-metadata?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        throw new Error("Failed to fetch URL metadata");
      }
      return res.json();
    },
    enabled: enabled && !!url,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
