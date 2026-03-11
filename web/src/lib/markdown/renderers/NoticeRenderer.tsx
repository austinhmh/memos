import { AlertCircle, AlertTriangle, Info, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface NoticeRendererProps {
  style: string;
  children: React.ReactNode;
}

const NOTICE_CONFIG: Record<string, { icon: React.FC<{ className?: string }>; className: string }> = {
  info: { icon: Info, className: "border-blue-500 bg-blue-50 dark:bg-blue-950/30" },
  warning: { icon: AlertTriangle, className: "border-amber-500 bg-amber-50 dark:bg-amber-950/30" },
  tip: { icon: Lightbulb, className: "border-green-500 bg-green-50 dark:bg-green-950/30" },
  success: { icon: AlertCircle, className: "border-green-600 bg-green-50 dark:bg-green-950/30" },
};

export const NoticeRenderer: React.FC<NoticeRendererProps> = ({ style, children }) => {
  const config = NOTICE_CONFIG[style] || NOTICE_CONFIG.info;
  const Icon = config.icon;

  return (
    <div className={cn("notice border-l-4 rounded-r-md p-4 my-4", config.className)}>
      <div className="flex gap-3">
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5 opacity-70" />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
};
