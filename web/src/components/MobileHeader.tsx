import useWindowScroll from "react-use/lib/useWindowScroll";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import NavigationDrawer from "./NavigationDrawer";

interface Props {
  className?: string;
  children?: React.ReactNode;
}

const MobileHeader = (props: Props) => {
  const { className, children } = props;
  const { y: offsetTop } = useWindowScroll();
  const md = useMediaQuery("md");
  const sm = useMediaQuery("sm");

  if (md) return null;

  return (
    <div
      className={cn(
        "sticky top-0 pt-[calc(0.75rem+var(--sat))] pb-2 pl-[max(1rem,var(--sal))] pr-[max(1rem,var(--sar))] sm:pl-[max(1.5rem,var(--sal))] sm:pr-[max(1.5rem,var(--sar))] sm:mb-1 bg-background bg-opacity-80 backdrop-blur-lg flex flex-row justify-between items-center w-full h-auto flex-nowrap shrink-0 z-10 gap-2 min-w-0",
        offsetTop > 0 && "shadow-md",
        className,
      )}
    >
      {!sm && <NavigationDrawer />}
      <div className="flex-1 flex flex-row justify-end items-center gap-2 min-w-0">{children}</div>
    </div>
  );
};

export default MobileHeader;
