import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whatsappTemplatesTable = pgTable("whatsapp_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("custom"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappRemindersTable = pgTable("whatsapp_reminders", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  bookingId: integer("booking_id").notNull(),
  message: text("message").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappConversationsTable = pgTable("whatsapp_conversations", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  lastMessage: text("last_message").notNull().default(""),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  unreadCount: integer("unread_count").notNull().default(0),
  isBot: boolean("is_bot").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  content: text("content").notNull(),
  direction: text("direction").notNull().default("outbound"),
  status: text("status").notNull().default("sent"),
  isBot: boolean("is_bot").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhatsappTemplateSchema = createInsertSchema(whatsappTemplatesTable).omit({ id: true, createdAt: true });
export type InsertWhatsappTemplate = z.infer<typeof insertWhatsappTemplateSchema>;
export type WhatsappTemplate = typeof whatsappTemplatesTable.$inferSelect;
