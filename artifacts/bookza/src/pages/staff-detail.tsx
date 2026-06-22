import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, fetchStaffProfile, updateStaffWorkingDays } from "@/lib/catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Phone, Mail, TrendingUp, CheckCircle2, AlertCircle, Star } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "wouter";
import { format, isToday } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

export default function StaffDetailPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [workingDays, setWorkingDays] = useState<string[]>([]);

  const { data: profile, isLoading } = useQuery({
    queryKey: catalogKeys.staffMember(id),
    queryFn: () => fetchStaffProfile(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    const next = profile?.staffMember?.workingDays ?? [];
    setWorkingDays(next);
  }, [profile?.staffMember?.id, profile?.staffMember?.workingDays?.join(",")]);

  const weekly = useMemo(
    () =>
      [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ].map((day) => ({
        day,
        isAvailable: workingDays.includes(day),
      })),
    [workingDays],
  );

  const saveWorkingDaysMutation = useMutation({
    mutationFn: (days: string[]) => updateStaffWorkingDays(id, days),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.staffMember(id) });
      toast({ title: "Working days saved" });
    },
    onError: (err) => {
      toast({
        title: "Could not save working days",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) return <div>Staff member not found</div>;

  const { staffMember, upcomingBookings, performanceMetrics } = profile;
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/staff">
            <Button variant="outline" size="icon" className="h-9 w-9 bg-card">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
              {staffMember.name}
              <Badge
                variant={staffMember.isActive ? "default" : "secondary"}
                className={staffMember.isActive ? "bg-emerald-500 hover:bg-emerald-600" : ""}
              >
                {staffMember.isActive ? "Active" : "Inactive"}
              </Badge>
            </h1>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-sm border-border/50 md:col-span-1 h-fit">
          <div className="h-24 bg-gradient-to-r from-emerald-600 to-emerald-400 dark:from-emerald-900 dark:to-emerald-800 rounded-t-xl" />
          <CardContent className="p-6 pt-0 relative">
            <Avatar className="w-24 h-24 border-4 border-card absolute -top-12 left-6 bg-card shadow-sm">
              <AvatarImage src={staffMember.avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-2xl font-bold">
                {staffMember.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="pt-16 pb-6 border-b border-border/50">
              <h2 className="text-xl font-bold">{staffMember.name}</h2>
              <p className="text-sm font-medium text-primary mt-1">{staffMember.position}</p>
            </div>

            <div className="py-6 space-y-4">
              {staffMember.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span>{staffMember.phone}</span>
                </div>
              )}
              {staffMember.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="truncate">{staffMember.email}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="shadow-sm border-border/50 bg-card">
              <CardContent className="p-4 flex flex-col items-center text-center justify-center h-full gap-2">
                <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
                <span className="text-2xl font-bold">{performanceMetrics.averageRating}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Avg Rating</span>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-border/50 bg-card">
              <CardContent className="p-4 flex flex-col items-center text-center justify-center h-full gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-500" />
                <span className="text-2xl font-bold">{performanceMetrics.completionRate}%</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Completion</span>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-border/50 bg-card">
              <CardContent className="p-4 flex flex-col items-center text-center justify-center h-full gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <span className="text-2xl font-bold">{performanceMetrics.noShowRate}%</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">No-Show</span>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-border/50 bg-card">
              <CardContent className="p-4 flex flex-col items-center text-center justify-center h-full gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                <span className="text-2xl font-bold">{formatCurrency(performanceMetrics.revenueThisMonth)}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Rev (Mo)</span>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="schedule" className="w-full">
            <TabsList className="w-full grid grid-cols-2 bg-card shadow-sm border border-border/50">
              <TabsTrigger value="schedule">Weekly Schedule</TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming Bookings ({upcomingBookings.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="schedule" className="mt-4 m-0">
              <Card className="shadow-sm border-border/50">
                <CardHeader className="flex flex-row items-center justify-between py-4 border-b border-border/50">
                  <div>
                    <CardTitle className="text-base">Working Hours</CardTitle>
                  </div>
                  <Button
                    className="bg-primary hover:bg-primary/90"
                    disabled={saveWorkingDaysMutation.isPending}
                    onClick={() => saveWorkingDaysMutation.mutate(workingDays)}
                  >
                    {saveWorkingDaysMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Save
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border/50">
                    {weekly.map((day) => (
                      <div
                        key={day.day}
                        className={`flex items-center justify-between p-4 ${day.isAvailable ? "" : "bg-muted/30"}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`font-medium capitalize ${day.isAvailable ? "" : "text-muted-foreground"}`}>
                            {day.day}
                          </span>
                          <Badge variant={day.isAvailable ? "outline" : "secondary"} className={day.isAvailable ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "text-muted-foreground"}>
                            {day.isAvailable ? "Working" : "Off"}
                          </Badge>
                        </div>
                        <Switch
                          checked={day.isAvailable}
                          onCheckedChange={(checked) => {
                            setWorkingDays((current) => {
                              const next = new Set(current);
                              if (checked) next.add(day.day);
                              else next.delete(day.day);
                              return Array.from(next);
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upcoming" className="mt-4 m-0 space-y-4">
              {upcomingBookings.length === 0 ? (
                <div className="p-8 border border-dashed rounded-lg bg-card/50 text-center text-muted-foreground">
                  No upcoming bookings for this staff member.
                </div>
              ) : (
                upcomingBookings.map((booking) => {
                  const start = new Date(booking.startTime);
                  return (
                    <Card key={booking.id} className="shadow-sm border-border/50">
                      <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-lg bg-primary/10 flex flex-col items-center justify-center border border-primary/20 text-center shrink-0">
                            <span className="text-xs font-bold text-primary leading-none">
                              {isToday(start) ? "TODAY" : format(start, "MMM")}
                            </span>
                            <span className="text-lg font-bold leading-tight text-primary">{format(start, "HH:mm")}</span>
                          </div>
                          <div>
                            <h4 className="font-semibold">{booking.serviceName}</h4>
                            <p className="text-sm text-muted-foreground">with {booking.clientName}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 ml-auto sm:ml-0">
                          {booking.status}
                        </Badge>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
