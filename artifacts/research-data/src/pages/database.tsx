import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Database, RefreshCw, Users as UsersIcon, Mail, CalendarDays, FileText, ArrowUpRight } from "lucide-react";
import { useState } from "react";

interface UserRow {
  id: number;
  username: string;
  fullName: string | null;
  email: string | null;
  role: string;
  canAdminAccess: boolean;
  status: string;
  createdAt: string;
}

interface UserDataResponse {
  user: UserRow;
  definitions: Array<{ id: number; name: string; fields: unknown[]; createdAt: string }>;
  records: Array<{ id: number; definitionId: number; data: Record<string, unknown>; createdAt: string }>;
  recordCount: number;
}

function useUsers() {
  return useQuery<UserRow[]>({
    queryKey: ["database-users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      const body = await res.json();
      return body.users as UserRow[];
    },
  });
}

function useUserData(id: number | null) {
  return useQuery<UserDataResponse>({
    queryKey: ["admin-user-data", id],
    queryFn: async () => {
      const res = await fetch(`/api/users/${id}/data`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch user data");
      return res.json();
    },
    enabled: !!id,
  });
}

function roleBadgeClass(role: string) {
  switch (role) {
    case "admin":
      return "bg-purple-100 text-purple-800";
    case "editor":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-800";
    case "suspended":
      return "bg-red-100 text-red-800";
    default:
      return "bg-yellow-100 text-yellow-800";
  }
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

// ---- Raw table explorer ----------------------------------------------------
interface TableInfo {
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
}
interface TablesResponse { tables: Record<string, { columns: any[] }>; }
interface TableDataResponse { table: string; count: number; rows: any[]; }

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

function RawTables() {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  const { data: tablesData, isLoading: isLoadingTables, refetch: refetchTables } = useTables();
  const { data: tableData, isLoading: isLoadingData, refetch: refetchData } = useTableData(selectedTable ?? "", limit, offset);

  const tables = tablesData
    ? Object.entries(tablesData.tables ?? {}).map(([name, info]) => ({ name, columns: (info as any).columns ?? [] }))
    : [];

  const filteredTables = tables.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const totalPages = tableData ? Math.ceil(tableData.count / limit) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Tables</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Input placeholder="Filter tables..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {isLoadingTables ? (
              [...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : (
              filteredTables.map((table) => (
                <button
                  key={table.name}
                  onClick={() => { setSelectedTable(table.name); setOffset(0); }}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md hover:bg-secondary ${selectedTable === table.name ? "bg-secondary font-medium" : ""}`}
                >
                  {table.name}
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            {isLoadingData ? "Loading..." : selectedTable ? `${selectedTable}` : "Select a table"}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => { refetchTables(); if (selectedTable) refetchData(); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
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
                <div className="text-center py-8 text-muted-foreground"><p>No data in table</p></div>
              ) : (
                <div className="bg-card rounded-md border overflow-x-auto h-[60vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Object.keys(tableData?.rows[0] ?? {}).map((key) => (
                          <TableHead key={key} className="text-xs">{key.replace(/_/g, " ").toUpperCase()}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableData?.rows.map((row, i) => (
                        <TableRow key={i}>
                          {Object.values(row).map((value, j) => (
                            <TableCell key={j} className="text-xs max-w-[200px] truncate">
                              {value === null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4">
                  <span className="text-sm text-muted-foreground">{tableData?.count ?? 0} rows</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Page {Math.floor(offset / limit) + 1} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={offset + limit >= (tableData?.count ?? 0)} onClick={() => setOffset(offset + limit)}>
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
  );
}

// ---- Users browser ---------------------------------------------------------
function UsersBrowser() {
  const [, navigate] = useLocation();
  const { data: users, isLoading } = useUsers();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const { data: userData, isLoading: isLoadingData } = useUserData(selectedId);

  const filtered = (users ?? []).filter(
    (u) =>
      u.username.toLowerCase().includes(filter.toLowerCase()) ||
      (u.fullName ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <UsersIcon className="h-4 w-4" /> Users ({users?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Input placeholder="Search users..." value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {isLoading ? (
              [...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  className={`w-full flex items-center gap-3 text-left px-3 py-2 rounded-md hover:bg-secondary ${selectedId === u.id ? "bg-secondary" : ""}`}
                >
                  <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                    {initials(u.username)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {u.username}
                      <Badge className={`text-[10px] ${roleBadgeClass(u.role)}`}>{u.role}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{u.fullName ?? u.email ?? "—"}</div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(u.status)}`}>{u.status}</Badge>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">User data</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedId ? (
            <div className="text-center py-12 text-muted-foreground">
              <UsersIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Select a user to view their collections and records.</p>
            </div>
          ) : isLoadingData ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : userData ? (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold">
                  {initials(userData.user.username)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold">{userData.user.username}</span>
                    <Badge className={roleBadgeClass(userData.user.role)}>{userData.user.role}</Badge>
                    <Badge variant="outline" className={statusBadgeClass(userData.user.status)}>{userData.user.status}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {userData.user.fullName && <span>{userData.user.fullName}</span>}
                    {userData.user.email && (
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{userData.user.email}</span>
                    )}
                    <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />Joined {new Date(userData.user.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4" /> Collections ({userData.definitions.length})
                </h3>
                {userData.definitions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No collections created.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {userData.definitions.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => navigate(`/records/${d.id}`)}
                        className="text-left border rounded-md p-3 hover:bg-secondary flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{d.name}</div>
                          <div className="text-xs text-muted-foreground">{(d.fields as unknown[])?.length ?? 0} fields</div>
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  Records ({userData.recordCount})
                </h3>
                {userData.records.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No records yet.</p>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Record</TableHead>
                          <TableHead className="text-xs">Collection</TableHead>
                          <TableHead className="text-xs">Updated</TableHead>
                          <TableHead className="text-right text-xs">Open</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {userData.records.map((r) => {
                          const def = userData.definitions.find((d) => d.id === r.definitionId);
                          const preview = Object.values(r.data ?? {}).filter((v) => v !== null && v !== "").slice(0, 2).join(" · ");
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="text-sm truncate max-w-[200px]">{preview || `#${r.id}`}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{def?.name ?? "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                              <TableCell className="text-right">
                                <Button size="sm" variant="ghost" onClick={() => navigate(`/records/${r.definitionId}/${r.id}`)}>
                                  <ArrowUpRight className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DatabaseViewer() {
  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Database</h1>
          <p className="text-muted-foreground">Browse users and their data, or inspect raw tables.</p>
        </div>
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" className="flex items-center gap-1.5">
              <UsersIcon className="h-4 w-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="raw" className="flex items-center gap-1.5">
              <Database className="h-4 w-4" /> Raw Tables
            </TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-4">
            <UsersBrowser />
          </TabsContent>
          <TabsContent value="raw" className="mt-4">
            <RawTables />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
