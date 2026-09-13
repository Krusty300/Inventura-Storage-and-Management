import type { ReactNode } from "react";
import Skeleton from "./Skeleton";

export interface TableColumn {
  key: string;
  header?: ReactNode;
  className?: string;
  ariaLabel?: string;
  onClick?: () => void;
}

interface Props {
  columns: TableColumn[];
  children?: ReactNode;
  ariaLabel?: string;
  role?: "grid";
  tableClassName?: string;
  wrapperClassName?: string;
  headClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  loading?: boolean;
  skeletonRows?: number;
  skeletonCols?: number;
  empty?: ReactNode;
  noData?: boolean;
}

export default function Table({
  columns,
  children,
  ariaLabel,
  role,
  tableClassName = "w-full text-sm",
  wrapperClassName = "overflow-x-auto",
  headClassName = "bg-app text-left",
  headerClassName = "px-4 py-3 font-medium text-muted",
  bodyClassName = "divide-y divide-border",
  loading,
  skeletonRows,
  skeletonCols,
  empty,
  noData,
}: Props) {
  const showEmpty = !loading && noData === true && empty != null;
  return (
    <div className={wrapperClassName}>
      <table className={tableClassName} role={role} aria-label={ariaLabel}>
        <thead>
          <tr className={headClassName}>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.className ?? headerClassName} aria-label={col.ariaLabel} onClick={col.onClick}>
                {col.header ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={bodyClassName}>
          {loading && skeletonRows != null ? (
            <Skeleton rows={skeletonRows} cols={skeletonCols ?? columns.length} />
          ) : showEmpty ? (
            empty
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}