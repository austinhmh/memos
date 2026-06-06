import { matchPath, Outlet, useLocation } from "react-router-dom";
import BlogExplorer from "@/components/BlogExplorer";
import MobileHeader from "@/components/MobileHeader";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

export const isWritingDetailPath = (pathname: string) => {
  return !!matchPath("/writing/:uid", pathname) || !!matchPath("/blog/:uid", pathname);
};

const BlogLayout = () => {
  const md = useMediaQuery("md");
  const lg = useMediaQuery("lg");
  const location = useLocation();
  const showExplorer = md && !isWritingDetailPath(location.pathname);

  return (
    <section className="@container w-full min-h-full flex flex-col justify-start items-center overflow-x-hidden">
      {!md && (
        <MobileHeader>
          <span className="text-sm font-medium">Blog</span>
        </MobileHeader>
      )}
      {showExplorer && (
        <div className={cn("fixed top-0 left-16 shrink-0 h-svh transition-all", "border-r border-border", lg ? "w-72" : "w-56")}>
          <BlogExplorer className="px-3 py-6" />
        </div>
      )}
      <div className={cn("w-full min-h-full min-w-0", showExplorer ? (lg ? "pl-72" : "pl-56") : "")}>
        <div className="w-full min-w-0 mx-auto px-0 sm:px-4 md:pt-6 pb-8">
          <Outlet />
        </div>
      </div>
    </section>
  );
};

export default BlogLayout;
