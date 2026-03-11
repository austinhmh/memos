import { Outlet } from "react-router-dom";
import BlogExplorer from "@/components/BlogExplorer";
import MobileHeader from "@/components/MobileHeader";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const BlogLayout = () => {
  const md = useMediaQuery("md");
  const lg = useMediaQuery("lg");

  return (
    <section className="@container w-full min-h-full flex flex-col justify-start items-center">
      {!md && (
        <MobileHeader>
          <span className="text-sm font-medium">Blog</span>
        </MobileHeader>
      )}
      {md && (
        <div className={cn("fixed top-0 left-16 shrink-0 h-svh transition-all", "border-r border-border", lg ? "w-72" : "w-56")}>
          <BlogExplorer className="px-3 py-6" />
        </div>
      )}
      <div className={cn("w-full min-h-full", lg ? "pl-72" : md ? "pl-56" : "")}>
        <div className="w-full mx-auto px-2 sm:px-4 md:pt-6 pb-8">
          <Outlet />
        </div>
      </div>
    </section>
  );
};

export default BlogLayout;
