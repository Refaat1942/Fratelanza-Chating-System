import React from "react";
import {
  useGetReportsOverview,
  useGetChatVolumeReport,
  useGetResponseTimesReport,
  useGetCustomersReport,
  useGetBranchesReport,
  useGetTagsReport,
  useGetHeatmapReport,
  useGetAgentPerformance,
  exportReport,
  type GetChatVolumeReportParams,
} from "@workspace/api-client-react";
import {
  Download,
  TrendingUp,
  Clock,
  Users,
  Building2,
  TagIcon,
  Activity,
  CalendarIcon,
  CheckCircle2,
  AlertTriangle,
  Flame,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DateRange = { from: Date; to: Date };

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#10b981",
  "#f59e0b",
  "#ef4444",
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ReportsPage() {
  const { toast } = useToast();
  const [range, setRange] = React.useState<DateRange>({
    from: startOfDay(subDays(new Date(), 29)),
    to: endOfDay(new Date()),
  });
  const [groupBy, setGroupBy] =
    React.useState<NonNullable<GetChatVolumeReportParams["groupBy"]>>("day");
  const [exporting, setExporting] = React.useState(false);

  const params = React.useMemo(
    () => ({ from: range.from.toISOString(), to: range.to.toISOString() }),
    [range],
  );

  const { data: overview, isLoading: ovLoading } = useGetReportsOverview({
    query: {
      queryKey: ["/api/reports/overview"],
      refetchInterval: 30_000,
    },
  });
  const { data: volume, isLoading: volLoading } = useGetChatVolumeReport({
    ...params,
    groupBy,
  });
  const { data: rt, isLoading: rtLoading } = useGetResponseTimesReport(params);
  const { data: customers, isLoading: custLoading } = useGetCustomersReport({
    ...params,
    limit: 10,
  });
  const { data: branches, isLoading: brLoading } = useGetBranchesReport(params);
  const { data: tags, isLoading: tagLoading } = useGetTagsReport(params);
  const { data: heatmap, isLoading: hmLoading } = useGetHeatmapReport(params);
  const { data: agentPerf, isLoading: agLoading } = useGetAgentPerformance();

  const handleExport = async (
    type: "agents" | "conversations" | "customers" | "branches" | "tags",
  ) => {
    setExporting(true);
    try {
      const csv = await exportReport({ ...params, type });
      const blob = new Blob([csv ?? ""], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fratelanza-${type}-${format(new Date(), "yyyy-MM-dd")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${type}.csv successfully` });
    } catch {
      toast({ title: "Failed to export report", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-8 overflow-y-auto bg-background">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Performance Reports
          </h2>
          <p className="text-muted-foreground">
            Comprehensive analytics across the platform.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={exporting}>
                <Download className="mr-2 h-4 w-4" />
                {exporting ? "Exporting…" : "Export CSV"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("agents")}>
                Agent performance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("conversations")}>
                Conversations
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("customers")}>
                Customers
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("branches")}>
                Branches
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("tags")}>
                Tags
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Real-time KPI strip */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          title="Open Chats"
          value={overview?.openChats}
          icon={<MessageSquare className="h-4 w-4 text-amber-500" />}
          loading={ovLoading}
        />
        <KpiCard
          title="Pending"
          value={overview?.pendingChats}
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          loading={ovLoading}
        />
        <KpiCard
          title="Completed Today"
          value={overview?.resolvedToday}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          loading={ovLoading}
        />
        <KpiCard
          title="New Today"
          value={overview?.newToday}
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          loading={ovLoading}
        />
        <KpiCard
          title="Agents Online"
          value={
            overview
              ? `${overview.agentsOnline}/${overview.agentsTotal}`
              : undefined
          }
          icon={<Users className="h-4 w-4 text-purple-500" />}
          loading={ovLoading}
        />
        <KpiCard
          title="Avg FRT (today)"
          value={
            overview ? `${overview.avgFirstResponseTodayMinutes}m` : undefined
          }
          icon={<Activity className="h-4 w-4 text-rose-500" />}
          loading={ovLoading}
        />
      </div>

      <Tabs defaultValue="volume" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="volume">Volume</TabsTrigger>
          <TabsTrigger value="response">Response times</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
        </TabsList>

        {/* ============ VOLUME ============ */}
        <TabsContent value="volume" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Conversation Volume</CardTitle>
                <CardDescription>
                  Total conversations created, broken down by status
                </CardDescription>
              </div>
              <Select
                value={groupBy}
                onValueChange={(v) =>
                  setGroupBy(v as NonNullable<GetChatVolumeReportParams["groupBy"]>)
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">By day</SelectItem>
                  <SelectItem value="week">By week</SelectItem>
                  <SelectItem value="month">By month</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {volLoading ? (
                <Skeleton className="h-[360px] w-full" />
              ) : (
                <div className="h-[360px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={volume ?? []}>
                      <defs>
                        <linearGradient id="vol-resolved" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="vol-open" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="vol-pending" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="bucket" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="resolved" stackId="1" stroke="#10b981" fill="url(#vol-resolved)" />
                      <Area type="monotone" dataKey="open" stackId="1" stroke="hsl(var(--primary))" fill="url(#vol-open)" />
                      <Area type="monotone" dataKey="pending" stackId="1" stroke="#f59e0b" fill="url(#vol-pending)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <SummaryStatCard
              title="Total in range"
              value={
                volLoading
                  ? "—"
                  : (volume ?? []).reduce((s, p) => s + p.total, 0)
              }
              loading={volLoading}
            />
            <SummaryStatCard
              title="Completed in range"
              value={
                volLoading
                  ? "—"
                  : (volume ?? []).reduce((s, p) => s + p.resolved, 0)
              }
              loading={volLoading}
            />
          </div>
        </TabsContent>

        {/* ============ RESPONSE TIMES ============ */}
        <TabsContent value="response" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryStatCard
              title="Average FRT"
              value={rt ? `${rt.avgMinutes}m` : "—"}
              loading={rtLoading}
            />
            <SummaryStatCard
              title="Median (p50)"
              value={rt ? `${rt.p50Minutes}m` : "—"}
              loading={rtLoading}
            />
            <SummaryStatCard
              title="p90 / p95"
              value={rt ? `${rt.p90Minutes}m / ${rt.p95Minutes}m` : "—"}
              loading={rtLoading}
            />
            <SummaryStatCard
              title="Avg resolution"
              value={rt ? `${rt.avgResolutionMinutes}m` : "—"}
              loading={rtLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Response time distribution</CardTitle>
                <CardDescription>
                  How fast first agent replies are sent
                </CardDescription>
              </CardHeader>
              <CardContent>
                {rtLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : (
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rt?.distribution ?? []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="bucket" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip
                          cursor={{ fill: "transparent" }}
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            borderColor: "hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>SLA compliance</CardTitle>
                <CardDescription>
                  Replies within {rt?.slaMinutes ?? 5} min vs. breaches
                </CardDescription>
              </CardHeader>
              <CardContent>
                {rtLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : (
                  <div className="h-[280px] w-full flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Within SLA", value: rt?.withinSla ?? 0 },
                            { name: "Breached", value: rt?.breaches ?? 0 },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          label
                        >
                          <Cell fill="#10b981" />
                          <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {rt && rt.breaches > 0 && (
                  <div className="mt-2 flex items-center text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    {rt.breaches} conversations exceeded the SLA
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============ AGENTS ============ */}
        <TabsContent value="agents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Agent resolution performance</CardTitle>
              <CardDescription>Total handled vs. completed per agent</CardDescription>
            </CardHeader>
            <CardContent>
              {agLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agentPerf ?? []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="agentName" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: "transparent" }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Bar dataKey="totalHandled" name="Handled" fill="hsl(var(--muted))" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="resolved" name="Completed" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent performance ledger</CardTitle>
              <CardDescription>Detailed metrics for all team members</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Handled</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Resolution rate</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Avg response</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((__, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-16" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : agentPerf?.map((a) => {
                        const rate =
                          a.totalHandled > 0
                            ? Math.round((a.resolved / a.totalHandled) * 100)
                            : 0;
                        return (
                          <TableRow key={a.agentId}>
                            <TableCell className="font-medium">{a.agentName}</TableCell>
                            <TableCell className="text-right">{a.totalHandled}</TableCell>
                            <TableCell className="text-right">{a.resolved}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-muted-foreground">{rate}%</span>
                                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary"
                                    style={{ width: `${rate}%` }}
                                  />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{a.activeChats}</TableCell>
                            <TableCell className="text-right">
                              {a.avgResponseTimeMinutes}m
                            </TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ CUSTOMERS ============ */}
        <TabsContent value="customers" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryStatCard
              title="Active customers"
              value={customers?.summary.activeCustomers ?? "—"}
              loading={custLoading}
            />
            <SummaryStatCard
              title="Repeat customers"
              value={customers?.summary.repeatCustomers ?? "—"}
              loading={custLoading}
            />
            <SummaryStatCard
              title="Repeat rate"
              value={
                customers ? `${customers.summary.repeatRatePercent}%` : "—"
              }
              loading={custLoading}
            />
            <SummaryStatCard
              title="Avg conversations / customer"
              value={
                customers
                  ? customers.summary.avgConversationsPerCustomer
                  : "—"
              }
              loading={custLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>New customer growth</CardTitle>
                <CardDescription>Daily new customer signups</CardDescription>
              </CardHeader>
              <CardContent>
                {custLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : (
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={customers?.customerGrowth ?? []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="bucket" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            borderColor: "hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          strokeWidth={3}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top 10 customers</CardTitle>
                <CardDescription>Most active in selected period</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Chats</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {custLoading
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      : customers?.topCustomers.map((c) => (
                          <TableRow key={c.customerId}>
                            <TableCell className="font-medium">
                              {c.customerName}
                              <div className="text-xs text-muted-foreground">{c.phone}</div>
                            </TableCell>
                            <TableCell>
                              {c.branch ? (
                                <Badge variant="secondary">{c.branch}</Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {c.conversationCount}
                            </TableCell>
                          </TableRow>
                        ))}
                    {!custLoading && customers?.topCustomers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-6">
                          No customer activity in this range
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============ BRANCHES ============ */}
        <TabsContent value="branches" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Building2 className="h-5 w-5 mr-2 text-primary" />
                Branch performance
              </CardTitle>
              <CardDescription>Conversations and customers per branch</CardDescription>
            </CardHeader>
            <CardContent>
              {brLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={branches ?? []} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis dataKey="branch" type="category" stroke="#888" fontSize={12} tickLine={false} axisLine={false} width={80} />
                      <Tooltip
                        cursor={{ fill: "transparent" }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Bar dataKey="conversationCount" name="Total" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                      <Bar dataKey="resolvedCount" name="Completed" fill="#10b981" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Branch breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Total chats</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Avg response</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((__, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    : branches?.map((b) => (
                        <TableRow key={b.branch}>
                          <TableCell className="font-medium">{b.branch}</TableCell>
                          <TableCell className="text-right">{b.customerCount}</TableCell>
                          <TableCell className="text-right">{b.conversationCount}</TableCell>
                          <TableCell className="text-right text-emerald-600">{b.resolvedCount}</TableCell>
                          <TableCell className="text-right text-amber-600">{b.openCount}</TableCell>
                          <TableCell className="text-right">{b.avgResponseMinutes}m</TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ TAGS ============ */}
        <TabsContent value="tags" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <TagIcon className="h-5 w-5 mr-2 text-primary" />
                  Conversation tags
                </CardTitle>
                <CardDescription>Tags applied to chats in range</CardDescription>
              </CardHeader>
              <CardContent>
                {tagLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : (tags?.conversationTags.length ?? 0) === 0 ? (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                    No tagged conversations
                  </div>
                ) : (
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={tags?.conversationTags ?? []}
                          dataKey="count"
                          nameKey="tag"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={(p) => p.tag}
                        >
                          {(tags?.conversationTags ?? []).map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Customer tags</CardTitle>
                <CardDescription>All-time customer segmentation</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead className="text-right">Customers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tagLoading
                      ? Array.from({ length: 4 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      : tags?.customerTags.map((t) => (
                          <TableRow key={t.tag}>
                            <TableCell>
                              <Badge variant="secondary">{t.tag}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">{t.count}</TableCell>
                          </TableRow>
                        ))}
                    {!tagLoading && tags?.customerTags.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center text-muted-foreground text-sm py-6">
                          No customer tags
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============ HEATMAP ============ */}
        <TabsContent value="heatmap" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Flame className="h-5 w-5 mr-2 text-primary" />
                Activity heatmap
              </CardTitle>
              <CardDescription>
                When conversations start — find your peak hours
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hmLoading ? (
                <Skeleton className="h-[320px] w-full" />
              ) : (
                <Heatmap data={heatmap ?? []} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ----------------- Sub-components -----------------

function KpiCard({
  title,
  value,
  icon,
  loading,
}: {
  title: string;
  value?: string | number;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div className="text-2xl font-bold">{value ?? 0}</div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryStatCard({
  title,
  value,
  loading,
}: {
  title: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const presets: { label: string; days: number }[] = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 14 days", days: 14 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start text-left font-normal">
          <CalendarIcon className="mr-2 h-4 w-4" />
          {format(value.from, "MMM d, yyyy")} – {format(value.to, "MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-col gap-1 p-3 border-r border-border">
            {presets.map((p) => (
              <Button
                key={p.days}
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() =>
                  onChange({
                    from: startOfDay(subDays(new Date(), p.days - 1)),
                    to: endOfDay(new Date()),
                  })
                }
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            defaultMonth={value.from}
            selected={{ from: value.from, to: value.to }}
            onSelect={(r) => {
              if (r?.from && r?.to) {
                onChange({ from: startOfDay(r.from), to: endOfDay(r.to) });
              }
            }}
            numberOfMonths={2}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Heatmap({
  data,
}: {
  data: { dayOfWeek: number; hour: number; count: number }[];
}) {
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const d of data) matrix[d.dayOfWeek][d.hour] = d.count;
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex items-center text-[10px] text-muted-foreground pl-10 mb-1">
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="w-6 text-center">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {matrix.map((row, dow) => (
          <div key={dow} className="flex items-center mb-1">
            <div className="w-10 text-xs text-muted-foreground">
              {DOW_LABELS[dow]}
            </div>
            {row.map((count, h) => {
              const intensity = count / max;
              const bg =
                count === 0
                  ? "hsl(var(--muted))"
                  : `hsl(var(--primary) / ${0.15 + intensity * 0.85})`;
              return (
                <div
                  key={h}
                  className="w-6 h-6 mr-0.5 rounded-sm"
                  style={{ backgroundColor: bg }}
                  title={`${DOW_LABELS[dow]} ${h}:00 — ${count} chats`}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 pl-10 mt-3 text-xs text-muted-foreground">
          <span>Less</span>
          {[0.15, 0.35, 0.55, 0.75, 1].map((i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-sm"
              style={{ backgroundColor: `hsl(var(--primary) / ${i})` }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
