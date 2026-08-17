import { useGetPatientStats } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Users, Clock, PersonStanding } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: stats, isLoading } = useGetPatientStats();

  const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))'];

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clinical Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of clinical research data collection.</p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4 rounded-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16 mb-1" />
                  <Skeleton className="h-3 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : stats ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <p className="text-xs text-muted-foreground">Registered in database</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Recent Records</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.recentCount}</div>
                  <p className="text-xs text-muted-foreground">Added in the last 30 days</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Male Patients</CardTitle>
                  <PersonStanding className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.maleCount}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.total > 0 ? Math.round((stats.maleCount / stats.total) * 100) : 0}% of total
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Female Patients</CardTitle>
                  <PersonStanding className="h-4 w-4 text-pink-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.femaleCount}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.total > 0 ? Math.round((stats.femaleCount / stats.total) * 100) : 0}% of total
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
              <Card className="col-span-4">
                <CardHeader>
                  <CardTitle>Top Diagnoses</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.diagnosisCounts}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="diagnosis" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                        <RechartsTooltip cursor={{fill: 'hsl(var(--secondary))'}} contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="col-span-3">
                <CardHeader>
                  <CardTitle>Age Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.ageBrackets} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis dataKey="bracket" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <RechartsTooltip cursor={{fill: 'hsl(var(--secondary))'}} contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }} />
                        <Bar dataKey="count" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {stats.collectionTypeCounts?.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-3">
                  <CardHeader>
                    <CardTitle>Collection Type Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stats.collectionTypeCounts ?? []}
                            dataKey="count"
                            nameKey="type"
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={95}
                            paddingAngle={3}
                          >
                            {stats.collectionTypeCounts?.map((entry, idx) => (
                              <Cell key={entry.type} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }}
                            formatter={(value, name) => [value, name]}
                          />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
                <Card className="col-span-4">
                  <CardHeader>
                    <CardTitle>Type Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 mt-2">
                      {stats.collectionTypeCounts?.map((entry, idx) => (
                        <div key={entry.type} className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                          />
                          <div className="flex-1 flex items-center justify-between">
                            <span className="text-sm font-medium">{entry.type}</span>
                            <div className="flex items-center gap-2">
                              <div className="w-32 bg-muted rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-2 rounded-full"
                                  style={{
                                    width: `${Math.round((entry.count / stats.total) * 100)}%`,
                                    backgroundColor: COLORS[idx % COLORS.length],
                                  }}
                                />
                              </div>
                              <span className="text-sm text-muted-foreground w-16 text-right">
                                {entry.count} ({Math.round((entry.count / stats.total) * 100)}%)
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Layout>
  );
}
