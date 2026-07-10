import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { OnboardingGuard } from "@/components/auth/OnboardingGuard";
import NotFound from "@/pages/not-found";

import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/dashboard";
import CalendarPage from "@/pages/calendar";
import BookingsPage from "@/pages/bookings";
import ClientsPage from "@/pages/clients";
import ClientDetailPage from "@/pages/client-detail";
import ServicesPage from "@/pages/services";
import ServiceDetailPage from "@/pages/service-detail";
import StaffPage from "@/pages/staff";
import StaffDetailPage from "@/pages/staff-detail";
import PaymentsPage from "@/pages/payments";
import AnalyticsPage from "@/pages/analytics";
import WhatsAppPage from "@/pages/whatsapp";
import WhatsAppBotPage from "@/pages/whatsapp-bot";
import MarketingPage from "@/pages/marketing";
import BookingPageBuilder from "@/pages/booking-page";
import PublicBookingPage from "@/pages/public-booking";
import ManageBookingPage from "@/pages/manage-booking";
import AiAssistantPage from "@/pages/ai-assistant";
import SettingsPage from "@/pages/settings";
import BillingPage from "@/pages/billing";
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AppShell({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <OnboardingGuard>
        <AppLayout>{children}</AppLayout>
      </OnboardingGuard>
    </ProtectedRoute>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public Routes */}
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/register" component={SignupPage} />
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
      <Route path="/clients/:id">
        {params => (
          <AppShell>
            <ClientDetailPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/services">
        <AppShell>
          <ServicesPage />
        </AppShell>
      </Route>
      <Route path="/services/:id">
        {params => (
          <AppShell>
            <ServiceDetailPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/staff">
        <AppShell>
          <StaffPage />
        </AppShell>
      </Route>
      <Route path="/staff/:id">
        {params => (
          <AppShell>
            <StaffDetailPage id={params.id} />
          </AppShell>
        )}
      </Route>
      <Route path="/payments">
        <AppShell>
          <PaymentsPage />
        </AppShell>
      </Route>
      <Route path="/analytics">
        <AppShell>
          <AnalyticsPage />
        </AppShell>
      </Route>
      <Route path="/whatsapp/bot">
        <AppShell>
          <WhatsAppBotPage />
        </AppShell>
      </Route>
      <Route path="/whatsapp">
        <AppShell>
          <WhatsAppPage />
        </AppShell>
      </Route>
      <Route path="/marketing">
        <AppShell>
          <MarketingPage />
        </AppShell>
      </Route>
      <Route path="/booking-page">
        <AppShell>
          <BookingPageBuilder />
        </AppShell>
      </Route>
      <Route path="/ai-assistant">
        <AppShell>
          <AiAssistantPage />
        </AppShell>
      </Route>
      <Route path="/settings">
        <AppShell>
          <SettingsPage />
        </AppShell>
      </Route>
      <Route path="/billing">
        <AppShell>
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
  );
}

export default App;
