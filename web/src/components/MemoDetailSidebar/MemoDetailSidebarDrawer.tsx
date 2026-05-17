import { GanttChartIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { BlogEditorSaveStatus } from "@/components/BlogEditor";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Memo } from "@/types/proto/api/v1/memo_service_pb";
import MemoDetailSidebar from "./MemoDetailSidebar";

interface Props {
  memo: Memo;
  parentPage?: string;
  saveStatus?: BlogEditorSaveStatus;
}

const MemoDetailSidebarDrawer = ({ memo, parentPage, saveStatus }: Props) => {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" className="bg-transparent! px-2">
          <GanttChartIcon className="w-5 h-auto text-muted-foreground" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-80 px-4 pb-[calc(1rem+var(--sab))] bg-background overflow-y-auto">
        <MemoDetailSidebar className="py-4" memo={memo} parentPage={parentPage} saveStatus={saveStatus} />
      </SheetContent>
    </Sheet>
  );
};

export default MemoDetailSidebarDrawer;
