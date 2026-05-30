import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { stringifyFilters } from "@/contexts/MemoFilterContext";

export type DateFilterFactor = "displayTime" | "updateTime";

export const useDateFilterNavigation = (factor: DateFilterFactor = "updateTime") => {
  const navigate = useNavigate();

  const navigateToDateFilter = useCallback(
    (date: string) => {
      const filterQuery = stringifyFilters([{ factor, value: date }]);
      navigate(`/?filter=${filterQuery}`);
    },
    [factor, navigate],
  );

  return navigateToDateFilter;
};
