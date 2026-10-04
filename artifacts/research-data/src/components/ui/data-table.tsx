import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type Table,
  type VisibilityState,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  Search,
  X,
  Check,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { useDensity, type Density } from "@/hooks/use-density"

// Re-exported so existing `import { type Density } from "@/components/ui/data-table"`
// call sites keep working; the hook is now the single source of truth.
export type { Density }

const DENSITY_CLASSES: Record<Density, string> = {
  compact: "h-8 text-xs",
  comfortable: "h-10 text-sm",
  spacious: "h-12 text-[15px]",
}

const CELL_DENSITY_CLASSES: Record<Density, string> = {
  compact: "px-2 py-1",
  comfortable: "px-3 py-2",
  spacious: "px-4 py-3",
}

interface DataTableProps<TData> {
  data: TData[]
  columns: ColumnDef<TData, unknown>[]
  /** Enable row selection. Default false. */
  enableRowSelection?: boolean
  /** Initial column visibility. */
  initialColumnVisibility?: VisibilityState
  /** Optional toolbar: search input. Default true. */
  searchable?: boolean
  /** Render a bulk-action bar above the table when rows are selected. */
  bulkActions?: (table: Table<TData>) => React.ReactNode
  /** Global empty state. */
  emptyState?: React.ReactNode
  /** Container className. */
  className?: string
  /** Persist column visibility / density to localStorage. */
  storageKey?: string
  /** Initial sort. */
  initialSort?: SortingState
  /** Row key extractor. */
  getRowId?: (row: TData, index: number) => string
  /**
   * Accessible name for the inner scrollable region. Required because the
   * region is focusable (keyboard scrolling) and therefore becomes a landmark.
   * Give each table on a page a distinct label.
   */
  scrollRegionLabel?: string
  /** Controlled row selection (keyed by rowId). When provided the table
   *  is fully controlled and calls onRowSelectionChange on change.
   *
   *  Typed as TanStack's `OnChangeFn` rather than a bare function because the
   *  library passes an *updater function* (`old => new`), not a plain value.
   *  Declaring it as `(updater: (old) => new) => void` made every caller's
   *  handler fail to type-check, which is how `patients.tsx` ended up calling
   *  `Object.keys()` on the updater and getting `[]` -- row selection silently
   *  never latched. Consumers must handle both forms:
   *      const next = typeof updater === "function" ? updater(prev) : updater
   */
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** Called when a row body is activated (click or Enter/Space). Makes the row
   *  itself a viable navigation target so the primary action on a table is not
   *  hidden behind a column-visibility toggle. Keep an explicit per-row control
   *  as well for keyboard and assistive-technology users. */
  onRowClick?: (row: TData) => void
}

export function DataTable<TData>({
  data,
  columns,
  enableRowSelection = false,
  initialColumnVisibility,
  searchable = true,
  bulkActions,
  emptyState,
  className,
  storageKey,
  initialSort,
  getRowId,
  scrollRegionLabel = "Table rows, scrollable",
  rowSelection: controlledSelection,
  onRowSelectionChange,
  onRowClick,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSort ?? [])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialColumnVisibility ?? {},
  )
  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({})
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [debouncedFilter, setDebouncedFilter] = React.useState("")

  const rowSelection = controlledSelection ?? internalSelection
  const setRowSelection: OnChangeFn<RowSelectionState> =
    onRowSelectionChange ?? setInternalSelection
  // Density is owned by the shared hook (persisted + mirrored to
  // <html data-density> pre-hydration), not by local component state, so /settings
  // and every table on the page stay in sync.
  const [density, setDensity] = useDensity()

  // Debounce global filter 200ms.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedFilter(globalFilter), 200)
    return () => clearTimeout(id)
  }, [globalFilter])

  // Persist column visibility when storageKey provided.
  React.useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(`${storageKey}:cols`)
      if (raw) setColumnVisibility(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [storageKey])
  React.useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(`${storageKey}:cols`, JSON.stringify(columnVisibility))
    } catch {
      /* ignore */
    }
  }, [storageKey, columnVisibility])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection, globalFilter: debouncedFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setDebouncedFilter,
    enableRowSelection,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  })

  const tableContainerRef = React.useRef<HTMLDivElement | null>(null)
  const rows = table.getRowModel().rows

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => (density === "compact" ? 32 : density === "spacious" ? 48 : 40),
    overscan: 8,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0

  const selectedCount = Object.keys(rowSelection).length

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative">
            <Search className="pointer-events-none absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search…"
              className="h-9 w-56 ps-8 pe-8"
              aria-label="Search rows"
            />
            {globalFilter && (
              <button
                type="button"
                onClick={() => setGlobalFilter("")}
                aria-label="Clear search"
                className="absolute end-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="ms-auto flex items-center gap-1">
          <DensityToggle density={density} onChange={setDensity} />
          <ColumnVisibilityMenu table={table} />
        </div>
      </div>

      {/* Bulk action bar */}
      {enableRowSelection && selectedCount > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm"
        >
          <span className="font-medium">{selectedCount} selected</span>
          <div className="ms-auto flex items-center gap-1">
            {bulkActions?.(table)}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => table.resetRowSelection()}
              className="h-7"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table. The virtualized body renders ~15 <tr> at a time, so without the
          row-count/index pairing below a screen reader announces "row 1 of 15"
          for a 2,000-row dataset. */}
      <div
        ref={tableContainerRef}
        role="region"
        aria-label={scrollRegionLabel}
        // Keyboard-scrollable: a scroll container that is not focusable cannot be
        // scrolled with the keyboard, and the page scroller cannot reach the
        // rows clipped inside it.
        tabIndex={0}
        className="relative overflow-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        style={{ maxHeight: 560 }}
      >
        <table
          className="w-full caption-bottom text-sm"
          // +1 for the header row, which is also a row in the a11y tree.
          aria-rowcount={rows.length + 1}
          aria-colcount={table.getVisibleLeafColumns().length}
        >
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} aria-rowindex={1} className="border-b">
                {hg.headers.map((header) => {
                  const sort = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  const isSelectColumn = header.column.id === "select"
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      // aria-sort lives on the <th>, not on the inner button: it is
                      // a property of the column, and a changing aria-label on the
                      // button gave assistive tech nothing stable to announce.
                      aria-sort={
                        !canSort
                          ? undefined
                          : sort === "asc"
                            ? "ascending"
                            : sort === "desc"
                              ? "descending"
                              : "none"
                      }
                      className={cn(
                        "text-start align-middle font-medium text-muted-foreground",
                        CELL_DENSITY_CLASSES[density],
                      )}
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : isSelectColumn ? (
                        // The select-all checkbox must NOT be wrapped in the sort
                        // <button>: that produced <button><button role="checkbox">,
                        // which is invalid nesting and a second tab stop inside the
                        // first. The column already sets enableSorting: false.
                        <span className="inline-flex items-center">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex select-none items-center gap-1 rounded px-1 py-0.5 text-xs",
                            canSort && "cursor-pointer hover:bg-accent",
                            !canSort && "cursor-default",
                          )}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          aria-label={
                            canSort
                              ? sort === "asc"
                                ? "Sort descending"
                                : sort === "desc"
                                ? "Clear sort"
                                : "Sort ascending"
                              : undefined
                          }
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <span aria-hidden>
                              {sort === "asc" ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : sort === "desc" ? (
                                <ArrowDown className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                              )}
                            </span>
                          )}
                        </button>
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr aria-rowindex={2}>
                <td
                  colSpan={table.getAllColumns().length}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  {emptyState ?? "No results."}
                </td>
              </tr>
            )}
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: paddingTop }}>
                <td colSpan={table.getAllColumns().length} />
              </tr>
            )}
            {virtualRows.map((vr) => {
              const row = rows[vr.index]
              const selected = row.getIsSelected()
              return (
                <tr
                  key={row.id}
                  // 1-based, header row occupies index 1, so the first data row
                  // is 2. Matches aria-rowcount above.
                  aria-rowindex={vr.index + 2}
                  data-state={selected ? "selected" : undefined}
                  className={cn(
                    // NO ENTRANCE ANIMATION, ON PURPOSE. This is the one
                    // component in the primitives layer that renders an
                    // unbounded number of rows — the patients list is thousands
                    // of them, virtualised. `transition-colors` -> 
                    // `.row-transition` keeps hover on --dur-fast and adds
                    // nothing else. An entrance stagger here is the exact bug
                    // `cappedStagger` in src/lib/motion.tsx exists to prevent:
                    // the visible page would take seconds to settle, and every
                    // row would be a moving target while the user tries to
                    // click one. If you need an entrance on a table, animate
                    // the empty state and the header, not the body.
                    "border-b row-transition hover:bg-muted/40",
                    selected && "bg-muted/60",
                    // Only advertise interactivity when a handler exists, so
                    // screen readers do not announce every row as clickable.
                    onRowClick && "cursor-pointer",
                  )}
                  style={{ height: vr.size }}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onRowClick(row.original)
                          }
                        }
                      : undefined
                  }
                  // Rows are focusable only when they are actionable. Without
                  // this, tabbing through a table with an interactive row
                  // handler would silently skip the primary navigation target.
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn("align-middle", CELL_DENSITY_CLASSES[density])}
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: paddingBottom }}>
                <td colSpan={table.getAllColumns().length} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length} of {data.length} row{data.length === 1 ? "" : "s"}
          {globalFilter && ` · filtered by "${globalFilter}"`}
        </span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

/** Full words: the previous `d[0].toUpperCase()` produced "C", "C", "S" — two
 *  radios with the same accessible name, which is unusable with a screen
 *  reader. */
const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
]

function DensityToggle({
  density,
  onChange,
}: {
  density: Density
  onChange: (d: Density) => void
}) {
  // Roving tabindex: a radiogroup is ONE tab stop. Without this the group
  // contributed three, and arrow keys did nothing.
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])
  const selected = DENSITY_OPTIONS.find((o) => o.value === density) ?? DENSITY_OPTIONS[1]

  const focusAt = (index: number) => {
    const wrapped = (index + DENSITY_OPTIONS.length) % DENSITY_OPTIONS.length
    onChange(DENSITY_OPTIONS[wrapped].value)
    refs.current[wrapped]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = DENSITY_OPTIONS.findIndex((o) => o.value === density)
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault()
        focusAt(current + 1)
        break
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault()
        focusAt(current - 1)
        break
      case "Home":
        e.preventDefault()
        focusAt(0)
        break
      case "End":
        e.preventDefault()
        focusAt(DENSITY_OPTIONS.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div
      className="inline-flex h-9 items-center rounded-md border bg-background p-0.5 text-xs"
      role="radiogroup"
      aria-label="Row density"
      onKeyDown={onKeyDown}
    >
      {DENSITY_OPTIONS.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={density === o.value}
          tabIndex={o.value === selected.value ? 0 : -1}
          ref={(el) => {
            refs.current[i] = el
          }}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded px-2",
            density === o.value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ColumnVisibilityMenu<TData>({ table }: { table: Table<TData> }) {
  const cols = table.getAllColumns().filter((c) => c.getCanHide())
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Columns3 className="h-4 w-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {cols.map((col) => {
          const label =
            typeof col.columnDef.header === "string" ? col.columnDef.header : col.id
          return (
            <DropdownMenuCheckboxItem
              key={col.id}
              className="capitalize"
              checked={col.getIsVisible()}
              onCheckedChange={(v) => col.toggleVisibility(!!v)}
            >
              {label}
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* -------------------------------------------------------------------------- */
/* Selection cell — a reusable <Checkbox> column for row selection.           */
/* -------------------------------------------------------------------------- */

export function selectionColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "select",
    size: 36,
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows"
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select row ${row.index + 1}`}
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
      />
    ),
  }
}

/* -------------------------------------------------------------------------- */
/* Empty state helper used by pages that need a richer empty state.           */
/* -------------------------------------------------------------------------- */

export function TableEmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {Icon ? (
        <div className="grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      ) : null}
      {/* Heading level: accepted as h3. The empty state is rendered inside a
          <td>, so the surrounding page's heading level is not knowable from
          here — hard-coding h2 would skip a level on pages whose title is an
          h1 followed by no h2, and de-heading it would throw away the
          navigation landmark that screen-reader users rely on to jump to
          "no results". Consumers who need a different level should wrap this
          and pass their own markup. */}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// Suppress unused-import warning for the icon we re-export
void Check
