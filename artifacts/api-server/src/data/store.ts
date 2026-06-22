export type Client = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  totalSpent: string;
  lifetimeBookings: number;
  lastBookingDate: string | null;
  clientType: string;
  noShowCount: number;
  avatarUrl: string | null;
  createdAt: Date;
};

export type Service = {
  id: number;
  name: string;
  description: string;
  price: string;
  duration: number;
  depositRequired: boolean;
  depositAmount: string;
  bookingCount: number;
  color: string;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
};

export type StaffMember = {
  id: number;
  name: string;
  position: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  revenueGenerated: string;
  completedBookings: number;
  isActive: boolean;
  createdAt: Date;
};

export type StaffScheduleEntry = {
  id: number;
  staffId: number;
  day: string;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
};

export type Booking = {
  id: number;
  clientId: number;
  serviceId: number;
  staffId: number;
  startTime: Date;
  endTime: Date;
  status: string;
  depositPaid: boolean;
  depositAmount: string;
  totalAmount: string;
  notes: string | null;
  createdAt: Date;
};

export type Payment = {
  id: number;
  clientId: number;
  bookingId: number;
  amount: string;
  method: string;
  status: string;
  type: string;
  date: string;
  createdAt: Date;
};

export type WhatsappTemplate = {
  id: number;
  name: string;
  message: string;
  type: string;
  isActive: boolean;
  createdAt: Date;
};

export type WhatsappReminder = {
  id: number;
  clientId: number;
  bookingId: number;
  message: string;
  scheduledAt: Date;
  status: string;
  createdAt: Date;
};

export type WhatsappConversation = {
  id: number;
  clientId: number;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  isBot: boolean;
  createdAt: Date;
};

export type WhatsappMessage = {
  id: number;
  conversationId: number;
  content: string;
  direction: string;
  status: string;
  isBot: boolean;
  createdAt: Date;
};

function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function daysAgo(days: number): Date {
  return at(-days, 12);
}

export const store = {
  clients: [] satisfies Client[],
  services: [] satisfies Service[],
  staff: [] satisfies StaffMember[],
  staffSchedule: [] satisfies StaffScheduleEntry[],
  bookings: [] satisfies Booking[],
  payments: [] satisfies Payment[],
  whatsappTemplates: [] satisfies WhatsappTemplate[],
  whatsappReminders: [] satisfies WhatsappReminder[],
  whatsappConversations: [] satisfies WhatsappConversation[],
  whatsappMessages: [] satisfies WhatsappMessage[],

  nextId: {
    client: 1,
    service: 1,
    staff: 1,
    staffSchedule: 1,
    booking: 1,
    payment: 1,
    whatsappTemplate: 1,
    whatsappReminder: 1,
    whatsappConversation: 1,
    whatsappMessage: 1,
  },
};
