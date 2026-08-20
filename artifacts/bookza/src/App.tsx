import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
// sonner, not the old ui/toaster: shadcn removed the `toast` component from the
// registry entirely, so the trio it belonged to (toast.tsx, toaster.tsx,
// hooks/use-toast.ts) is gone and all 226 call sites now use sonner's API.
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { SubscriptionGuard } from "@/components/auth/SubscriptionGuard";
import { RequireOnboarding } from "@/components/auth/RequireOnboarding";
import NotFound from "@/pages/not-found";

import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/dashboard";
import CalendarPage from "@/pages/calendar";
import BookingsPage from "@/pages/bookings";
import BookingNewPage from "@/pages/booking-new";
import BookingDetailPage from "@/pages/booking-detail";
import BookingEditPage from "@/pages/booking-edit";
import ClientsPage from "@/pages/clients";
import ClientDetailPage from "@/pages/client-detail";
import ClientNewPage from "@/pages/client-new";
import ClientEditPage from "@/pages/client-edit";
import ServicesPage from "@/pages/services";
import ServiceDetailPage from "@/pages/service-detail";
import ServiceNewPage from "@/pages/service-new";
import ServiceEditPage from "@/pages/service-edit";
import StaffPage from "@/pages/staff";
import StaffDetailPage from "@/pages/staff-detail";
import StaffNewPage from "@/pages/staff-new";
import StaffEditPage from "@/pages/staff-edit";
import PaymentsPage from "@/pages/payments";
import AnalyticsPage from "@/pages/analytics";
import WhatsAppPage from "@/pages/whatsapp";
import WhatsAppBotPage from "@/pages/whatsapp-bot";
import MarketingPage from "@/pages/marketing";
import CampaignNewPage from "@/pages/campaign-new";
import BookingPageBuilder from "@/pages/booking-page";
import BookingPageOverview from "@/pages/booking-page-overview";
import BookingPagePreviewPage from "@/pages/booking-page-preview";
import PublicBookingPage from "@/pages/public-booking";
import PublicBookingPaymentReturnPage from "@/pages/public-booking-payment-return";
import ManageBookingPage from "@/pages/manage-booking";
import AiAssistantPage from "@/pages/ai-assistant";
import SettingsPage from "@/pages/settings";
import GetStartedPage from "@/pages/get-started";
import OnboardingPage from "@/pages/onboarding";
import BillingPage from "@/pages/billing";
// Retired in favour of the static marketing homepage (index.html). The "/" route
// now hard-redirects there via <MarketingHomeRedirect> below. Kept for future re-enable.
// import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";
import SignupPage from "@/pages/signup";
import StaffLoginPage from "@/pages/staff-login";
import StaffSetPasswordPage from "@/pages/staff-portal/set-password";
import StaffMyBookingsPage from "@/pages/staff-portal/my-bookings";
import { StaffProtectedRoute } from "@/components/auth/StaffProtectedRoute";
import { StaffSessionRoute } from "@/components/auth/StaffSessionRoute";
import { PermissionRoute } from "@/components/auth/PermissionRoute";
import type { Permissions } from "@/hooks/use-permissions";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Dev-only: lets the marketing mockup recorder (scripts/src/mockups) drive
// query refetches on its own schedule to simulate live data. Stripped from
// production builds by the import.meta.env.DEV guard.
if (import.meta.env.DEV) {
  (window as unknown as { __mockupQueryClient?: typeof queryClient }).__mockupQueryClient =
    queryClient;
}

function AppShell({
  children,
  requireSubscription = true,
  permission,
}: {
  children: ReactNode;
  requireSubscription?: boolean;
  permission?: (perms: Permissions) => boolean;
}) {
  let content = children;

  if (permission) {
    content = <PermissionRoute require={permission}>{content}</PermissionRoute>;
  }

  if (requireSubscription) {
    content = <SubscriptionGuard>{content}</SubscriptionGuard>;
  }

  return (
    <ProtectedRoute>
      <RequireOnboarding>
        <AppLayout>{content}</AppLayout>
      </RequireOnboarding>
    </ProtectedRoute>
  );
}

// If the SPA is ever mounted at "/" (e.g. a stray client-side nav or the Back
// button landing on it), force a full-page load so the server serves the rich
// static marketing homepage instead of rendering the old SPA landing placeholder.
function MarketingHomeRedirect() {
  if (typeof window !== "undefined") {
    window.location.replace("/");
  }
  return null;
}

function Router() {
  return (
    <Switch>
      {/* Public Routes */}
      <Route path="/" component={MarketingHomeRedirect} />
      {/* <Route path="/" component={LandingPage} /> — retired SPA landing */}
      <Route path="/login" component={LoginPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/register" component={SignupPage} />
      <Route path="/staff-login" component={StaffLoginPage} />
      <Route path="/staff/set-password">
        <StaffSessionRoute>
          <StaffSetPasswordPage />
        </StaffSessionRoute>
      </Route>
      <Route path="/staff/bookings">
        <StaffProtectedRoute>
          <StaffMyBookingsPage />
        </StaffProtectedRoute>
      </Route>
      <Route path="/book/:slug/payment-return">
        {(params) => <PublicBookingPaymentReturnPage slug={params.slug} />}
      </Route>
      <Route path="/book/:slug">
        {(params) => <PublicBookingPage slug={params.slug} />}
      </Route>
      <Route path="/booking/manage/:token">
        {(params) => <ManageBookingPage token={params.token} />}
      </Route>

      {/* App Routes */}
      <Route path="/dashboard">
        <AppShell>
          <Dashboard />
        </AppShell>
      </Route>
      <Route path="/calendar">
        <AppShell>
          <CalendarPage />
        </AppShell>
      </Route>
      <Route path="/bookings/new">
        <AppShell permission={(p) => p.canWriteBookings}>
          <BookingNewPage />
        </AppShell>
      </Route>
      <Route path="/bookings/:id/edit">
        {(params) => (
          <AppShell permission={(p) => p.canWriteBookings}>
            <BookingEditPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/bookings/:id">
        {(params) => (
          <AppShell>
            <BookingDetailPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/bookings">
        <AppShell>
          <BookingsPage />
        </AppShell>
      </Route>
      <Route path="/clients">
        <AppShell>
          <ClientsPage />
        </AppShell>
      </Route>
      <Route path="/clients/new">
        <AppShell permission={(p) => p.canWriteClients}>
          <ClientNewPage />
        </AppShell>
      </Route>
      <Route path="/clients/:id/edit">
        {params => (
          <AppShell permission={(p) => p.canWriteClients}>
            <ClientEditPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/clients/:id">
        {params => (
          <AppShell>
            <ClientDetailPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/services">
        <AppShell permission={(p) => p.canManageSettings}>
          <ServicesPage />
        </AppShell>
      </Route>
      <Route path="/services/new">
        <AppShell permission={(p) => p.canWriteServices}>
          <ServiceNewPage />
        </AppShell>
      </Route>
      <Route path="/services/:id/edit">
        {params => (
          <AppShell permission={(p) => p.canWriteServices}>
            <ServiceEditPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/services/:id">
        {params => (
          <AppShell permission={(p) => p.canManageSettings}>
            <ServiceDetailPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/staff">
        <AppShell permission={(p) => p.canManageStaff}>
          <StaffPage />
        </AppShell>
      </Route>
      <Route path="/staff/new">
        <AppShell permission={(p) => p.canManageStaff}>
          <StaffNewPage />
        </AppShell>
      </Route>
      <Route path="/staff/:id/edit">
        {params => (
          <AppShell permission={(p) => p.canManageStaff}>
            <StaffEditPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/staff/:id">
        {params => (
          <AppShell permission={(p) => p.canManageStaff}>
            <StaffDetailPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/payments">
        <AppShell permission={(p) => p.canViewPayments}>
          <PaymentsPage />
        </AppShell>
      </Route>
      <Route path="/analytics">
        <AppShell permission={(p) => p.canViewAnalytics}>
          <AnalyticsPage />
        </AppShell>
      </Route>
      <Route path="/whatsapp/bot">
        <AppShell permission={(p) => p.canManageSettings}>
          <WhatsAppBotPage />
        </AppShell>
      </Route>
      <Route path="/whatsapp">
        <AppShell permission={(p) => p.canManageSettings}>
          <WhatsAppPage />
        </AppShell>
      </Route>
      <Route path="/marketing/campaigns/new">
        <AppShell permission={(p) => p.canManageSettings}>
          <CampaignNewPage />
        </AppShell>
      </Route>
      <Route path="/marketing">
        <AppShell permission={(p) => p.canManageSettings}>
          <MarketingPage />
        </AppShell>
      </Route>
      <Route path="/booking-page/:id/preview">
        {params => (
          <ProtectedRoute>
            <BookingPagePreviewPage id={params.id} />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/booking-page/:id/edit">
        {params => (
          <AppShell permission={(p) => p.canManageSettings}>
            <BookingPageBuilder id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/booking-page">
        <AppShell permission={(p) => p.canManageSettings}>
          <BookingPageOverview />
        </AppShell>
      </Route>
      <Route path="/ai-assistant">
        <AppShell permission={(p) => p.canManageSettings}>
          <AiAssistantPage />
        </AppShell>
      </Route>
      <Route path="/settings">
        <AppShell permission={(p) => p.canManageSettings}>
          <SettingsPage />
        </AppShell>
      </Route>
      <Route path="/onboarding">
        <ProtectedRoute>
          <OnboardingPage />
        </ProtectedRoute>
      </Route>
      <Route path="/get-started">
        <AppShell requireSubscription={false}>
          <GetStartedPage />
        </AppShell>
      </Route>
      <Route path="/billing">
        <AppShell requireSubscription={false} permission={(p) => p.role === "owner"}>
          <BillingPage />
        </AppShell>
      </Route>
      <Route>
        <AppShell>
          <NotFound />
        </AppShell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
