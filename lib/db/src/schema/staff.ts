import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const staffTable = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: text("position").notNull(),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  revenueGenerated: numeric("revenue_generated", { precision: 10, scale: 2 }).notNull().default("0"),
  completedBookings: integer("completed_bookings").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffScheduleTable = pgTable("staff_schedule", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull(),
  day: text("day").notNull(),
  isAvailable: boolean("is_available").notNull().default(true),
  startTime: text("start_time").notNull().default("09:00"),
  endTime: text("end_time").notNull().default("17:00"),
});

export const staffServicesTable = pgTable("staff_services", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull(),
  serviceId: integer("service_id").notNull(),
});

export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true, createdAt: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;
export type StaffSchedule = typeof staffScheduleTable.$inferSelect;
