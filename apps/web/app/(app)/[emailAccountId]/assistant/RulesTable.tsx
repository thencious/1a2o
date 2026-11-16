import type { ReactNode } from "react";
import { MutedText } from "@/components/Typography";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function RulesToolbar({
  description,
  actions,
}: {
  description: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <MutedText className="hidden sm:block">{description}</MutedText>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}

export function RulesTable({
  children,
  headerAction,
}: {
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16 px-2 sm:px-4">Enabled</TableHead>
          <TableHead className="px-2 sm:px-4">Name</TableHead>
          <TableHead className="hidden px-2 sm:table-cell sm:px-4">
            Prompt
          </TableHead>
          <TableHead className="px-2 sm:px-4">Action</TableHead>
          <TableHead className="w-fit whitespace-nowrap px-1">
            {headerAction}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

export function RulesTableRow({
  enabled,
  interactive = true,
  onClick,
  children,
}: {
  enabled: boolean;
  interactive?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <TableRow
      className={`${!enabled ? "bg-muted opacity-60" : ""} ${interactive ? "cursor-pointer" : "cursor-default"}`}
      onClick={onClick}
    >
      {children}
    </TableRow>
  );
}
