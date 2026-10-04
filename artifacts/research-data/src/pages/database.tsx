import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
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
import { CrossFade, FadeIn, StaggeredItem, StaggeredList } from "@/lib/page-motion";
import { ErrorState, NoDataState } from "@/components/ui/states";

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

function useUsers(t: (k: string, o?: Record<string, unknown>) => string) {
  return useQuery<UserRow[]>({
    queryKey: ["database-users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) throw new Error(t("database.loadUsersFailed"));
      const body = await res.json();
      return body.users as UserRow[];
    },
    retry: false,
  });
}

function useUserData(id: number | null, t: (k: string, o?: Record<string, unknown>) => string) {
  return useQuery<UserDataResponse>({
    queryKey: ["admin-user-data", id],
    queryFn: async () => {
      const res = await fetch(`/api/users/${id}/data`, { credentials: "include" });
      if (!res.ok) throw new Error(t("database.loadUserDataFailed"));
      return res.json();
    },
    enabled: !!id,
    retry: false,
  });
}

/**
 * Role badge tones.
 *
 * These were `bg-purple-100 text-purple-800` and friends with no `dark:`
 * variant, so in dark mode they rendered as pale pastel chips with dark text —
 * technically readable, but a completely different visual language from the
 * rest of the app and a 4.x:1 pairing at `text-xs`. Each tone now carries an
 * explicit dark counterpart.
 */
function roleBadgeClass(role: string) {
  switch (role) {
    case "admin":
      return "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200";
    case "editor":
      return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200";
    case "suspended":
      return "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200";
    default:
      return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
}

function roleKey(role: string) {
  if (role === "admin") return "database.roleAdmin";
  if (role === "editor") return "database.roleEditor";
  return "database.roleMember";
}

function statusKey(status: string) {
  if (status === "active") return "database.statusActive";
  if (status === "suspended") return "database.statusSuspended";
  return "database.statusPending";
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

// ---- Raw table explorer ----------------------------------------------------
interface TablesResponse { tables: Record<string, { columns: unknown[] }>; }
interface TableDataResponse { table: string; count: number; rows: Record<string, unknown>[]; }

function useTables(t: (k: string, o?: Record<string, unknown>) => string) {
  return useQuery<TablesResponse>({
    queryKey: ["db-tables"],
    queryFn: async () => {
      const res = await fetch("/api/db/tables", { credentials: "include" });
      if (!res.ok) throw new Error(t("database.loadTablesFailed"));
      return res.json();
    },
    retry: false,
  });
}

function useTableData(
  table: string,
  limit: number,
  offset: number,
  t: (k: string, o?: Record<string, unknown>) => string,
) {
  return useQuery<TableDataResponse>({
    queryKey: ["db-table", table, limit, offset],
    queryFn: async () => {
      const res = await fetch(`/api/db/${table}?limit=${limit}&offset=${offset}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(t("database.loadTableDataFailed"));
      return res.json();
    },
    enabled: !!table,
    retry: false,
  });
}

function RawTables() {
  const { t } = useTranslation();
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  const {
    data: tablesData,
    isLoading: isLoadingTables,
    isError: isErrorTables,
    refetch: refetchTables,
  } = useTables(t);
  const {
    data: tableData,
    isLoading: isLoadingData,
    isError: isErrorData,
    refetch: refetchData,
  } = useTableData(selectedTable ?? "", limit, offset, t);

  const tables = tablesData
    ? Object.entries(tablesData.tables ?? {}).map(([name, info]) => ({
        name,
        columns: (info as { columns?: unknown[] }).columns ?? [],
      }))
    : [];

  const filteredTables = tables.filter((t2) =>
    t2.name.toLowerCase().includes(search.toLowerCase()),
  );
  const totalPages = tableData ? Math.ceil(tableData.count / limit) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("database.tables")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <label htmlFor="db-table-filter" className="sr-only">
              {t("database.filterTablesLabel")}
            </label>
            <Input
              id="db-table-filter"
              placeholder={t("database.filterTables")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {isLoadingTables ? (
              [...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : isErrorTables ? (
              <ErrorState
                size="sm"
                title={t("common.errorTitle")}
                description={t("database.loadTablesFailed")}
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetchTables()}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : (
              filteredTables.map((table, i) => (
                <StaggeredItem key={table.name} index={i}>
                  <button
                    onClick={() => {
                      setSelectedTable(table.name);
                      setOffset(0);
                    }}
                    aria-pressed={selectedTable === table.name}
                    className={`w-full text-start px-3 py-2 text-sm rounded-md hover:bg-secondary ${selectedTable === table.name ? "bg-secondary font-medium" : ""}`}
                  >
                    {table.name}
                  </button>
                </StaggeredItem>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            {isLoadingData
              ? t("database.loading")
              : selectedTable
                ? `${selectedTable}`
                : t("database.selectTable")}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void refetchTables();
              if (selectedTable) void refetchData();
            }}
          >
            <RefreshCw className="h-4 w-4 me-2" aria-hidden /> {t("database.refresh")}
          </Button>
        </CardHeader>
        <CardContent>
          {!selectedTable ? (
            <FadeIn>
              <NoDataState
                title={t("database.selectTable")}
                description={t("database.selectTableHint")}
                icon={Database}
              />
            </FadeIn>
          ) : (
            <CrossFade
              loading={isLoadingData}
              label={t("database.loading")}
              skeleton={
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              }
            >
              {isErrorData ? (
                <ErrorState
                  title={t("common.errorTitle")}
                  description={t("database.loadTableDataFailed")}
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetchData()}>
                      {t("common.retry")}
                    </Button>
                  }
                />
              ) : tableData && tableData.rows.length === 0 ? (
                <NoDataState title={t("database.noDataInTable")} icon={Database} size="sm" />
              ) : (
                <>
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
                                {value === null
                                  ? "NULL"
                                  : typeof value === "object"
                                    ? JSON.stringify(value)
                                    : String(value)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex justify-between items-center mt-4">
                      <span className="text-sm text-muted-foreground">
                        {t("database.rowsCount", { count: tableData?.count ?? 0 })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {t("database.pageOf", {
                            page: Math.floor(offset / limit) + 1,
                            total: totalPages,
                          })}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t("common.previous")}
                          disabled={offset === 0}
                          onClick={() => setOffset(Math.max(0, offset - limit))}
                        >
                          <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t("common.next")}
                          disabled={offset + limit >= (tableData?.count ?? 0)}
                          onClick={() => setOffset(offset + limit)}
                        >
                          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CrossFade>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Users browser ---------------------------------------------------------
function UsersBrowser() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { data: users, isLoading, isError, refetch } = useUsers(t);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const { data: userData, isLoading: isLoadingData, isError: isErrorData, refetch: refetchData } =
    useUserData(selectedId, t);

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
            <UsersIcon className="h-4 w-4" aria-hidden />{" "}
            {t("database.tabUsers")} ({users?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <label htmlFor="db-user-filter" className="sr-only">
              {t("database.searchUsersLabel")}
            </label>
            <Input
              id="db-user-filter"
              placeholder={t("database.searchUsers")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {isLoading ? (
              [...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : isError ? (
              <ErrorState
                size="sm"
                title={t("common.errorTitle")}
                description={t("database.loadUsersFailed")}
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetch()}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : filtered.length === 0 ? (
              <NoDataState title={t("database.noUsers")} icon={UsersIcon} size="sm" />
            ) : (
              filtered.map((u, i) => (
                <StaggeredItem key={u.id} index={i}>
                  <button
                    onClick={() => setSelectedId(u.id)}
                    aria-pressed={selectedId === u.id}
                    className={`w-full flex items-center gap-3 text-start px-3 py-2 rounded-md hover:bg-secondary ${selectedId === u.id ? "bg-secondary" : ""}`}
                  >
                    <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                      {initials(u.username)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {u.username}
                        <Badge className={`text-xs ${roleBadgeClass(u.role)}`}>
                          {t(roleKey(u.role))}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {u.fullName ?? u.email ?? t("common.emDash")}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-xs ${statusBadgeClass(u.status)}`}>
                      {t(statusKey(u.status))}
                    </Badge>
                  </button>
                </StaggeredItem>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{t("database.userData")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedId ? (
            <FadeIn>
              <NoDataState
                title={t("database.userData")}
                description={t("database.selectUserHint")}
                icon={UsersIcon}
              />
            </FadeIn>
          ) : (
            <CrossFade
              loading={isLoadingData}
              label={t("database.loading")}
              skeleton={
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              }
            >
              {isErrorData ? (
                <ErrorState
                  title={t("common.errorTitle")}
                  description={t("database.loadUserDataFailed")}
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetchData()}>
                      {t("common.retry")}
                    </Button>
                  }
                />
              ) : userData ? (
                <FadeIn>
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold shrink-0">
                        {initials(userData.user.username)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-lg font-semibold">{userData.user.username}</span>
                          <Badge className={roleBadgeClass(userData.user.role)}>
                            {t(roleKey(userData.user.role))}
                          </Badge>
                          <Badge variant="outline" className={statusBadgeClass(userData.user.status)}>
                            {t(statusKey(userData.user.status))}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          {userData.user.fullName && <span>{userData.user.fullName}</span>}
                          {userData.user.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" aria-hidden />
                              {userData.user.email}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" aria-hidden />
                            {t("database.joined", {
                              date: new Date(userData.user.createdAt).toLocaleDateString(),
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                        <FileText className="h-4 w-4" aria-hidden />{" "}
                        {t("database.collectionsCount", { count: userData.definitions.length })}
                      </h3>
                      {userData.definitions.length === 0 ? (
                        <NoDataState title={t("database.noCollections")} size="sm" />
                      ) : (
                        <StaggeredList className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {userData.definitions.map((d, i) => (
                            <StaggeredItem key={d.id} index={i}>
                              <button
                                onClick={() => navigate(`/records/${d.id}`)}
                                className="text-start border rounded-md p-3 hover:bg-secondary flex items-center justify-between gap-2 w-full"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">{d.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {t("database.fieldsCount", {
                                      count: (d.fields as unknown[])?.length ?? 0,
                                    })}
                                  </div>
                                </div>
                                <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                              </button>
                            </StaggeredItem>
                          ))}
                        </StaggeredList>
                      )}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                        {t("database.recordsTitle", { count: userData.recordCount })}
                      </h3>
                      {userData.records.length === 0 ? (
                        <NoDataState title={t("database.noRecords")} size="sm" />
                      ) : (
                        <div className="border rounded-md overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">{t("database.colRecord")}</TableHead>
                                <TableHead className="text-xs">{t("database.colCollection")}</TableHead>
                                <TableHead className="text-xs">{t("database.colUpdated")}</TableHead>
                                <TableHead className="text-end text-xs">{t("database.colOpen")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {userData.records.map((r) => {
                                const def = userData.definitions.find((d) => d.id === r.definitionId);
                                const preview = Object.values(r.data ?? {})
                                  .filter((v) => v !== null && v !== "")
                                  .slice(0, 2)
                                  .join(" · ");
                                return (
                                  <TableRow key={r.id}>
                                    <TableCell className="text-sm truncate max-w-[200px]">
                                      {preview || `#${r.id}`}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {def?.name ?? t("common.emDash")}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {new Date(r.createdAt).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-end">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        aria-label={`${t("common.openRecord")}: ${r.id}`}
                                        onClick={() => navigate(`/records/${r.definitionId}/${r.id}`)}
                                      >
                                        <ArrowUpRight className="h-4 w-4" aria-hidden />
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
                </FadeIn>
              ) : null}
            </CrossFade>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DatabaseViewer() {
  const { t } = useTranslation();
  return (
    <Layout>
      <div className="space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("database.title")}</h1>
            <p className="text-muted-foreground">{t("database.subtitle")}</p>
          </div>
        </FadeIn>
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" className="flex items-center gap-1.5">
              <UsersIcon className="h-4 w-4" aria-hidden /> {t("database.tabUsers")}
            </TabsTrigger>
            <TabsTrigger value="raw" className="flex items-center gap-1.5">
              <Database className="h-4 w-4" aria-hidden /> {t("database.tabRaw")}
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
