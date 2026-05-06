import { ExternalLinkIcon, PencilIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useURLMetadata } from "@/hooks/useURLMetadata";
import { cn } from "@/lib/utils";

interface BookmarkCardProps {
  url: string;
  onUrlChange?: (oldUrl: string, newUrl: string) => void;
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

export default function BookmarkCard({ url: initialUrl, onUrlChange }: BookmarkCardProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, isError } = useURLMetadata(currentUrl);

  const handleEditClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsEditingUrl(true);
    setTimeout(() => inputRef.current?.select(), 50);
  }, []);

  const handleUrlSubmit = useCallback(() => {
    const newUrl = inputRef.current?.value.trim();
    if (newUrl && newUrl !== currentUrl) {
      onUrlChange?.(currentUrl, newUrl);
      setCurrentUrl(newUrl);
    }
    setIsEditingUrl(false);
  }, [currentUrl, onUrlChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleUrlSubmit();
      } else if (e.key === "Escape") {
        setIsEditingUrl(false);
      }
    },
    [handleUrlSubmit],
  );

  if (isLoading) {
    return <BookmarkCardSkeleton />;
  }

  if (isError || !data || (!data.title && !data.description)) {
    return <BookmarkCardFallback url={currentUrl} />;
  }

  const domain = extractDomain(currentUrl);

  return (
    <div className="relative my-2 group/card">
      {/* Edit URL button — top right */}
      {onUrlChange && !isEditingUrl && (
        <button
          type="button"
          onClick={handleEditClick}
          className={cn(
            "absolute top-2 right-2 z-10 p-1 rounded",
            "bg-card/80 backdrop-blur-sm border border-border",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            "opacity-0 group-hover/card:opacity-100 transition-all cursor-pointer",
          )}
          title="编辑链接"
        >
          <PencilIcon className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Inline URL editor */}
      {isEditingUrl && (
        <div className="flex items-center gap-2 px-3 py-1.5 border border-border border-b-0 rounded-t-lg bg-muted/50">
          <ExternalLinkIcon className="w-3.5 h-3.5 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            type="url"
            defaultValue={currentUrl}
            onBlur={handleUrlSubmit}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm font-mono outline-none placeholder:text-muted-foreground"
            placeholder="https://..."
            autoFocus
          />
        </div>
      )}

      {/* Card */}
      <a
        href={currentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex border border-border overflow-hidden",
          "no-underline text-inherit hover:shadow-md hover:border-primary/20",
          "transition-all duration-200 group",
          isEditingUrl ? "rounded-b-lg" : "rounded-lg",
        )}
      >
        <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
          {data.title && (
            <div className="font-medium text-sm text-foreground line-clamp-1 group-hover:text-primary transition-colors">{data.title}</div>
          )}
          {data.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{data.description}</div>}
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
