import type { LucideIcon } from "lucide-react";
import { Globe2Icon, LockIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";

interface Props {
  visibility: Visibility;
  className?: string;
}

const VisibilityIcon = (props: Props) => {
  const { className, visibility } = props;

  const iconMap: Partial<Record<Visibility, LucideIcon>> = {
    [Visibility.PRIVATE]: LockIcon,
    [Visibility.PROTECTED]: UsersIcon,
    [Visibility.PUBLIC]: Globe2Icon,
  };
  const Icon = iconMap[visibility];
  if (!Icon) {
    return null;
  }

  return <Icon className={cn("w-4 h-auto text-muted-foreground", className)} />;
};

export default VisibilityIcon;
