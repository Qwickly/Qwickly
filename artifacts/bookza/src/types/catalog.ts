export type BookingStatus = "confirmed" | "pending" | "cancelled" | "completed" | "no_show";
export type ClientType = "new" | "returning" | "vip";
export type ClientStatus = "new" | "active" | "inactive" | "archived";

export type CatalogService = {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  icon: string;
  color: string;
  isActive: boolean;
  depositRequired: boolean;
  depositAmount: number;
  createdAt: string;
};

export type CatalogClient = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  clientType: ClientType;
  status: ClientStatus;
  noShowCount: number;
  avatarUrl: string | null;
  notes: string | null;
  totalSpent: number;
  lifetimeBookings: number;
  lastVisit: string | null;
  createdAt: string;
};

export type CatalogStaff = {
  id: string;
  name: string;
  position: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  workingDays: string[];
  upcomingBookings: number;
  revenueGenerated: number;
  completedBookings: number;
  createdAt: string;
};

export type StaffInput = {
  name: string;
  position: string;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean;
};

export type CatalogBooking = {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  serviceId: string;
  serviceName: string;
  staffId: string | null;
  staffName: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  depositPaid: boolean;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
};

export type CalendarEvent = {
  id: string;
  bookingId: string;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  staffName: string;
  staffId: string | null;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  depositPaid: boolean;
  color: string;
  notes: string | null;
};

export type ServiceInput = {
  name: string;
  description?: string;
  price: number;
  duration: number;
  icon?: string;
  color?: string;
  isActive?: boolean;
};

export type ClientInput = {
  name: string;
  phone: string;
  email?: string | null;
  clientType?: ClientType;
  notes?: string | null;
};

export type BookingInput = {
  clientId: string;
  serviceId: string;
  staffId?: string | null;
  startTime: string;
  notes?: string | null;
};

export type PaymentMethod = "payfast" | "yoco" | "cash" | "eft";
export type PaymentStatus = "completed" | "pending" | "refunded" | "failed";
export type PaymentType = "deposit" | "full_payment" | "refund";

export type CatalogPayment = {
  id: string;
  clientId: string;
  clientName: string;
  bookingId: string | null;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  type: PaymentType;
  providerReference: string | null;
  date: string;
  createdAt: string;
};

export type PaymentSummary = {
  totalRevenue: number;
  depositsCollected: number;
  outstandingPayments: number;
  refunds: number;
  revenueChange: number;
  depositsChange: number;
  outstandingChange: number;
  refundsChange: number;
};

export type PaymentInput = {
  clientId: string;
  bookingId?: string | null;
  amount: number;
  method: PaymentMethod;
  status?: PaymentStatus;
  type: PaymentType;
  paidAt?: string;
  notes?: string | null;
};
