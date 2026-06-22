import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Check, CreditCard, Download, Receipt, Zap, Building2, Sparkles } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Starter",
    price: 199,
    desc: "For solo practitioners just getting started.",
    features: [
      "1 staff member",
      "Up to 100 bookings/month",
      "WhatsApp reminders",
      "250 AI messages/month",
      "Basic analytics",
      "Booking page",
    ],
    cta: "Downgrade",
    icon: Zap,
    color: "border-border/50",
    current: false,
  },
  {
    name: "Pro",
    price: 499,
    desc: "The full toolkit for growing businesses.",
    features: [
      "Up to 5 staff members",
      "Unlimited bookings",
      "WhatsApp reminders + AI bot",
      "1,000 AI messages/month",
      "Advanced analytics",
      "Marketing campaigns",
      "Referral program",
      "Priority support",
    ],
    cta: "Current Plan",
    icon: Sparkles,
    color: "border-primary",
    current: true,
  },
  {
    name: "Business",
    price: 999,
    desc: "For multi-location businesses at scale.",
    features: [
      "Unlimited staff members",
      "Unlimited bookings",
      "Full AI bot suite",
      "Unlimited AI messages",
      "Full analytics + exports",
      "White-label booking page",
      "API access",
      "Dedicated account manager",
    ],
    cta: "Upgrade",
    icon: Building2,
    color: "border-border/50",
    current: false,
  },
];

const invoices = [
  { id: "INV-2024-009", date: "Sep 12, 2024", amount: 499, status: "Paid" },
  { id: "INV-2024-008", date: "Aug 12, 2024", amount: 499, status: "Paid" },
  { id: "INV-2024-007", date: "Jul 12, 2024", amount: 499, status: "Paid" },
  { id: "INV-2024-006", date: "Jun 12, 2024", amount: 499, status: "Paid" },
  { id: "INV-2024-005", date: "May 12, 2024", amount: 199, status: "Paid" },
];

export default function BillingPage() {
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Billing & Subscription</h1>
        <p className="text-muted-foreground text-sm">Manage your plan, payment methods, and invoices.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 shadow-sm border-border/50">
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>You are on the Pro Plan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 p-6 border rounded-xl bg-gradient-to-r from-primary/5 to-transparent">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-2xl font-bold text-foreground">Pro Plan</h3>
                  <Badge className="bg-primary hover:bg-primary">Active</Badge>
                </div>
                <p className="text-muted-foreground font-medium">R 499 / month</p>
                <p className="text-sm text-muted-foreground mt-1">Renews on Oct 12, 2024</p>
              </div>
              <div className="flex flex-col gap-2 w-full sm:w-auto">
                <Button variant="outline" className="bg-background" onClick={() => setPlanDialogOpen(true)}>Change Plan</Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setCancelDialogOpen(true)}
                >
                  Cancel Subscription
                </Button>
              </div>
            </div>

            <div className="mt-8 space-y-5">
              <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Plan Usage</h4>

              {[
                { label: "AI Messages Sent", used: 452, total: 1000 },
                { label: "Staff Members", used: 4, total: 5 },
                { label: "Bookings This Month", used: 87, total: null },
              ].map(u => {
                const pct = u.total ? Math.round((u.used / u.total) * 100) : null;
                const isWarn = pct !== null && pct >= 80;
                return (
                  <div key={u.label} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{u.label}</span>
                      <span className={cn("text-muted-foreground", isWarn && "text-amber-600 font-medium")}>
                        {u.used}{u.total ? ` / ${u.total.toLocaleString()} included` : " this month (unlimited)"}
                        {isWarn && " ⚠️"}
                      </span>
                    </div>
                    {u.total && (
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", isWarn ? "bg-amber-400" : "bg-primary")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Payment Method</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 p-4 border rounded-lg">
                <div className="w-12 h-8 bg-muted rounded flex items-center justify-center border">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">•••• •••• •••• 4242</p>
                  <p className="text-xs text-muted-foreground">Visa · Expires 12/25</p>
                </div>
                <Badge variant="outline" className="text-xs">Default</Badge>
              </div>
              <Button variant="outline" className="w-full mt-4">Update Method</Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/50 bg-primary text-primary-foreground border-none">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-lg">Need more power?</h3>
              <p className="text-primary-foreground/80 text-sm">Upgrade to Business for unlimited AI messages, staff, and API access.</p>
              <Button className="w-full bg-background text-primary hover:bg-background/90 font-semibold" onClick={() => setPlanDialogOpen(true)}>
                View Plans
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>View and download past invoices.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-muted-foreground" />
                      {inv.id}
                    </div>
                  </TableCell>
                  <TableCell>{inv.date}</TableCell>
                  <TableCell className="text-muted-foreground">{inv.amount >= 499 ? "Pro" : "Starter"}</TableCell>
                  <TableCell>R {inv.amount}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{inv.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon">
                      <Download className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Change Plan Dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose Your Plan</DialogTitle>
            <DialogDescription>All plans include a 14-day free trial. Cancel anytime.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
            {plans.map(plan => (
              <div key={plan.name} className={cn("relative border-2 rounded-xl p-5 flex flex-col", plan.color)}>
                {plan.current && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-0.5 rounded-full">
                    Current
                  </div>
                )}
                <div className={cn("p-2 rounded-lg w-fit mb-3", plan.current ? "bg-primary/10" : "bg-muted")}>
                  <plan.icon className={cn("w-5 h-5", plan.current ? "text-primary" : "text-muted-foreground")} />
                </div>
                <h3 className="font-bold text-lg">{plan.name}</h3>
                <p className="text-muted-foreground text-sm mb-3">{plan.desc}</p>
                <p className="text-3xl font-bold mb-4">R {plan.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className={cn("w-full", plan.current ? "bg-muted text-muted-foreground cursor-default" : "bg-primary hover:bg-primary/90")}
                  disabled={plan.current}
                  onClick={() => { if (!plan.current) setPlanDialogOpen(false); }}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Subscription Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Subscription?</DialogTitle>
            <DialogDescription>
              Your Pro plan will remain active until October 12, 2024. After that date, your account will revert to the free tier and some features will be disabled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">You will lose access to:</p>
            <ul className="space-y-1">
              {["WhatsApp AI bot", "Marketing campaigns", "Advanced analytics", "Up to 5 staff accounts"].map(f => (
                <li key={f} className="text-sm flex items-center gap-2 text-destructive">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Keep My Plan</Button>
            <Button variant="destructive" onClick={() => setCancelDialogOpen(false)}>Cancel Subscription</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
