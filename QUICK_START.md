# Quick Reference - Staff Notifications Implementation

## What Got Built
✅ Staff WhatsApp notifications when:
- Booking is assigned to staff (`staff_new_booking` setting)
- Booking with assigned staff is cancelled (`staff_cancellation` setting)

## Files Added/Modified
```
supabase/migrations/
  └─ 014_staff_notifications.sql          (NEW: Queue table + trigger)

artifacts/api-server/src/
  ├─ lib/
  │   └─ staff-notifications.ts           (NEW: Worker process)
  └─ index.ts                              (MODIFIED: Start worker)

scripts/
  └─ test-staff-notifications.sh           (NEW: Testing guide)

Documentation/
  ├─ IMPLEMENTATION_SUMMARY.md            (NEW: User-friendly guide)
  ├─ STAFF_NOTIFICATIONS_README.md        (NEW: Technical details)
  └─ [This file]
```

## To Deploy

### 1. Run Supabase Migration
```sql
-- Copy entire contents of:
supabase/migrations/014_staff_notifications.sql

-- Paste into Supabase Dashboard → SQL Editor → New query
-- Click: Run
```

This creates:
- `staff_notifications` table
- `manage_booking_staff_notifications()` trigger function
- Indexes and policies

### 2. Restart API Server
```bash
cd artifacts/api-server
npm run dev  # or your production restart method
```

Server will automatically:
- Import the new worker
- Start polling every 10 seconds
- Process pending notifications

### 3. Test
See: `scripts/test-staff-notifications.sh`

Quick test:
1. Enable setting: Settings → Notifications → "New Booking Assigned"
2. Connect WhatsApp: Settings → WhatsApp → Connect
3. Create booking with staff assigned
4. Staff should get message within 10 seconds

## How It Works (Quick Overview)

```
Event: Booking assigned to staff
  ↓
Supabase Trigger: Creates entry in staff_notifications table
  ↓
Backend Worker: Every 10 seconds, fetches pending entries
  ↓
For each entry:
  - Get tenant_id (for WhatsApp session)
  - Get staff phone number
  - Send message via sendTenantMessageByPhone()
  - Mark as 'sent' or 'failed'
  ↓
Staff: Receives WhatsApp message
```

## Key Files Reference

| File | Purpose | When Used |
|------|---------|-----------|
| `014_staff_notifications.sql` | Database schema + trigger | On deployment (run once) |
| `staff-notifications.ts` | Message processor | Every 10s (auto-runs) |
| `index.ts` | Server startup | On server start (auto-runs) |

## Troubleshooting Quick Links

- **Messages not sending?**
  → Check: WhatsApp connected? Staff phone filled? Setting enabled?
  → See: IMPLEMENTATION_SUMMARY.md → Troubleshooting

- **Too many database queries?**
  → Increase polling: Change `10000` to `30000` in index.ts

- **Need to customize messages?**
  → Edit: 014_staff_notifications.sql → `v_msg :=` lines

## Important Notes

⚠️ **This does NOT implement:**
- `staff_daily_summary` (requires scheduler, separate work)
- Real-time notifications (10s delay, by design)
- Per-staff message preferences (business-wide setting)

✅ **These ARE working:**
- New booking notifications
- Cancellation notifications
- Error logging to database
- Automatic retry on worker cycle

## Configuration Options

**Polling frequency**: `index.ts` line 50
```typescript
startStaffNotificationWorker(10000); // milliseconds
```

**Message format**: `014_staff_notifications.sql` lines ~85-115
```sql
v_msg := 'Your custom format here'
```

**Rate limiting**: `staff-notifications.ts` line 140
```typescript
await new Promise((resolve) => setTimeout(resolve, 500)); // ms between messages
```

## Next Steps

1. ✅ Deploy migration
2. ✅ Restart server
3. ✅ Test (see script)
4. ✅ Monitor logs for `[Staff Notifications]` entries
5. ✅ Ask staff to verify they receive messages

## Support

If something breaks:
1. Check server logs for `[Staff Notifications]` errors
2. Verify Supabase migration ran successfully
3. Check `staff_notifications` table exists: 
   ```sql
   SELECT * FROM public.staff_notifications LIMIT 1;
   ```
4. Check staff member has phone:
   ```sql
   SELECT phone FROM public.staff_members WHERE id='...';
   ```
5. See troubleshooting in IMPLEMENTATION_SUMMARY.md
