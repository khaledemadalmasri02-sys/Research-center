import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Database, RefreshCw } from "lucide-react";
import { useState } from "react";

interface TableInfo {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
  }>;
}

interface TablesResponse {
  tables: Record<string, { columns: any[] }>;
}

interface TableDataResponse {
  table: string;
  count: number;
  rows: any[];
}

function useTables() {
  return useQuery<TablesResponse>({
    queryKey: ["db-tables"],
    queryFn: async () => {
      const res = await fetch("/api/db/tables", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tables");
      return res.json();
    },
  });
}

function useTableData(table: string, limit: number, offset: number) {
  return useQuery<TableDataResponse>({
    queryKey: ["db-table", table, limit, offset],
    queryFn: async () => {
      const res = await fetch(`/api/db/${table}?limit=${limit}&offset=${offset}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch table data");
      return res.json();
    },
    enabled: !!table,
  });
}

export default function DatabaseViewer() {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  const { data: tablesData, isLoading: isLoadingTables, refetch: refetchTables } = useTables();
  const { data: tableData, isLoading: isLoadingData, refetch: refetchData } = useTableData(
    selectedTable ?? "",
    limit,
    offset
  );

  const tables = tablesData 
    ? Object.entries(tablesData.tables ?? {}).map(([name, info]) => ({
        name,
        columns: (info as any).columns ?? [],
      }))
    : [];

  const filteredTables = tables.filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = tableData ? Math.ceil(tableData.count / limit) : 0;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Database Viewer</h1>
            <p className="text-muted-foreground">Inspect and query PostgreSQL data</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetchTables()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Tables List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Tables</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3">
                <Input
                  placeholder="Filter tables..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {isLoadingTables ? (
                  [...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
                ) : (
                  filteredTables.map((table) => (
                    <button
                      key={table.name}
                      onClick={() => {
                        setSelectedTable(table.name);
                        setOffset(0);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md hover:bg-secondary ${
                        selectedTable === table.name ? "bg-secondary font-medium" : ""
                      }`}
                    >
                      {table.name}
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Table Data */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>
                {isLoadingData ? "Loading..." : selectedTable ? `${selectedTable}` : "Select a table"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingData ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : !selectedTable ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Database className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Select a table to view data</p>
                </div>
              ) : (
                <>
                  {tableData && tableData.rows.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No data in table</p>
                    </div>
                  ) : (
                    <div className="bg-card rounded-md border overflow-x-auto h-[60vh] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(tableData?.rows[0] ?? {}).map((key) => (
                              <TableHead key={key} className="text-xs">
                                {key.replace(/_/g, " ").toUpperCase()}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tableData?.rows.map((row, i) => (
                            <TableRow key={i}>
                              {Object.values(row).map((value, j) => (
                                <TableCell key={j} className="text-xs max-w-[200px] truncate">
                                  {value === null ? "NULL" : 
                                   typeof value === "object" ? JSON.stringify(value) : String(value)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex justify-between items-center mt-4">
                      <span className="text-sm text-muted-foreground">
                        {tableData?.count ?? 0} rows
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          Page {Math.floor(offset / limit) + 1} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={offset === 0}
                          onClick={() => setOffset(Math.max(0, offset - limit))}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={offset + limit >= (tableData?.count ?? 0)}
                          onClick={() => setOffset(offset + limit)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}