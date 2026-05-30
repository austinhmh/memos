import { sanitizeImageUrl } from "@/lib/sanitize-url";
import { cn } from "@/lib/utils";

interface Props {
  avatarUrl?: string;
  className?: string;
}

const UserAvatar = (props: Props) => {
  const { avatarUrl, className } = props;
  const safeAvatarUrl = sanitizeImageUrl(avatarUrl) || "/full-logo.webp";

  return (
    <div className={cn(`w-8 h-8 overflow-clip rounded-xl border border-border`, className)}>
      <img className="w-full h-auto shadow min-w-full min-h-full object-cover" src={safeAvatarUrl} decoding="async" loading="lazy" alt="" />
    </div>
  );
};

export default UserAvatar;
