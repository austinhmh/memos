import { CodeIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useURLMetadata } from "@/hooks/useURLMetadata";
import { cn } from "@/lib/utils";

interface BookmarkCardProps {
  url: string;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function BookmarkCardSkeleton() {
  return (
    <div className="flex border border-border rounded-lg overflow-hidden my-2 animate-pulse">
      <div className="flex-1 p-3 space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-1/3" />
      </div>
      <div className="w-[120px] shrink-0 bg-muted hidden sm:block" />
    </div>
  );
}

function BookmarkCardFallback({ url }: { url: string }) {
  const domain = extractDomain(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 px-3 py-2 my-1 rounded-md border border-border",
        "text-sm text-primary hover:bg-accent transition-colors no-underline",
        "max-w-full overflow-hidden",
      )}
    >
      <ExternalLinkIcon className="w-4 h-4 shrink-0 opacity-60" />
      <span className="truncate">{domain}</span>
    </a>
  );
}

export default function BookmarkCard({ url }: BookmarkCardProps) {
  const { data, isLoading, isError } = useURLMetadata(url);
  const [showSource, setShowSource] = useState(false);

  if (isLoading) {
    return <BookmarkCardSkeleton />;
  }

  if (isError || !data || (!data.title && !data.description)) {
    return <BookmarkCardFallback url={url} />;
  }

  const domain = extractDomain(url);

  return (
    <div className="relative my-2 group/card">
      {/* Toggle source button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowSource(!showSource);
        }}
        className={cn(
          "absolute top-2 right-2 z-10 px-2 py-0.5 rounded text-[11px]",
          "border border-border bg-card/90 backdrop-blur-sm",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          "transition-all cursor-pointer select-none",
          showSource ? "opacity-100" : "opacity-0 group-hover/card:opacity-100",
        )}
      >
        {showSource ? (
          <span className="flex items-center gap-1"><XIcon className="w-3 h-3" />隐藏链接</span>
        ) : (
          <span className="flex items-center gap-1"><CodeIcon className="w-3 h-3" />显示链接</span>
        )}
      </button>

      {/* Source URL bar */}
      {showSource && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-0 border border-border border-b-0 rounded-t-lg bg-muted/50 text-xs text-muted-foreground font-mono overflow-hidden">
          <ExternalLinkIcon className="w-3 h-3 shrink-0 opacity-50" />
          <a href={url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-primary transition-colors">
            {url}
          </a>
        </div>
      )}

      {/* Card */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex border border-border overflow-hidden",
          "no-underline text-inherit hover:shadow-md hover:border-primary/20",
          "transition-all duration-200 group",
          showSource ? "rounded-b-lg" : "rounded-lg",
        )}
      >
        <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
          {data.title && (
            <div className="font-medium text-sm text-foreground line-clamp-1 group-hover:text-primary transition-colors">
              {data.title}
            </div>
          )}
          {data.description && (
            <div className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
              {data.description}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            {data.favicon && (
              <img
                src={data.favicon}
                alt=""
                className="w-4 h-4 rounded-sm object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <span className="text-xs text-muted-foreground truncate">{domain}</span>
          </div>
        </div>
        {data.image && (
          <div className="w-[120px] shrink-0 hidden sm:block">
            <img
              src={data.image}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).parentElement!.style.display = "none";
              }}
            />
          </div>
        )}
      </a>
    </div>
  );
}
