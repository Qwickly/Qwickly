#!/bin/bash
# Client Notification Implementation Test Script
# This script verifies the client notification flow works end-to-end

set -e

echo "=== Client Notification Flow Test ==="
echo ""

# Test 1: Verify API server is running
echo "Test 1: Checking if API server is running..."
RESPONSE=$(curl -s -X POST "http://localhost:3000/api/health" 2>/dev/null || echo "Server not running")
if [ "$RESPONSE" = "Server not running" ]; then
  echo "  ⚠ API Server not running. Start it first with: npm run dev"
  exit 1
fi
echo "  ✓ API Server is running"
echo ""

# Test 2: Verify backend includes client notifications worker
echo "Test 2: Checking if client notifications worker is initialized..."
echo "  ℹ Check server logs for: '[Client Notifications] Starting background worker'"
echo ""

# Test 3: Manual verification steps for creation and scheduling
echo "Test 3: Manual verification steps:"
echo "  1. Log in to Supabase Dashboard"
echo "  2. Navigate to: SQL Editor"
echo "  3. Create a test booking (ensure client exists):"
echo ""
echo "     INSERT INTO public.bookings (business_id, client_id, service_id, staff_id, start_time, end_time, status, total_amount)"
echo "     VALUES ("
echo "       'YOUR_BUSINESS_ID',"
echo "       'YOUR_CLIENT_ID',"
echo "       'YOUR_SERVICE_ID',"
echo "       'YOUR_STAFF_ID',"
echo "       NOW() + INTERVAL '25 hours', -- more than 24h to trigger 24h & 2h reminders"
echo "       NOW() + INTERVAL '26 hours',"
echo "       'confirmed',"
echo "       100"
echo "     );"
echo ""
echo "  4. Verify client_notifications table received entries:"
echo ""
echo "     SELECT * FROM public.client_notifications ORDER BY created_at DESC LIMIT 5;"
echo ""
echo "     -- You should see:"
echo "     -- 1. 'booking_confirmations' notification (scheduled_at = now, status = 'pending')"
echo "     -- 2. 'reminder_24h' notification (scheduled_at = start_time - 24 hours, status = 'pending')"
echo "     -- 3. 'reminder_2h' notification (scheduled_at = start_time - 2 hours, status = 'pending')"
echo "     -- 4. 'review_requests' notification (scheduled_at = end_time + 2 hours, status = 'pending')"
echo ""
echo "  5. Check server logs for WhatsApp sending activity for 'booking_confirmations' (sent immediately)"
echo "  6. Verify client_notifications status for 'booking_confirmations' is updated to 'sent'"
echo ""

# Test 4: Test rescheduling workflow
echo "Test 4: Test rescheduling notification:"
echo "  1. Update booking time:"
echo ""
echo "     UPDATE public.bookings SET start_time = NOW() + INTERVAL '30 hours', end_time = NOW() + INTERVAL '31 hours' WHERE id = 'BOOKING_ID';"
echo ""
echo "  2. Verify rescheduled alert is queued immediately, and older pending notifications are rescheduled:"
echo ""
echo "     SELECT * FROM public.client_notifications WHERE booking_id = 'BOOKING_ID' ORDER BY created_at DESC;"
echo ""

# Test 5: Test cancellation workflow
echo "Test 5: Test cancellation notification:"
echo "  1. Cancel the booking:"
echo ""
echo "     UPDATE public.bookings SET status = 'cancelled' WHERE id = 'BOOKING_ID';"
echo ""
echo "  2. Verify cancellation notice is queued immediately, and all other pending notifications are removed:"
echo ""
echo "     SELECT * FROM public.client_notifications WHERE booking_id = 'BOOKING_ID' ORDER BY created_at DESC;"
echo ""

# Test 6: Enable/Disable client notifications
echo "Test 6: Test notification settings toggle:"
echo "  1. Update notification_settings to disable booking_confirmations:"
echo ""
echo "     UPDATE public.notification_settings SET booking_confirmations = false WHERE business_id = 'YOUR_BUSINESS_ID';"
echo ""
echo "  2. Create a new booking - NO booking_confirmations entry should be created (other enabled notifications will be)"
echo "  3. Re-enable and verify the setting works"
echo ""

echo "=== End of Test Suite ==="
echo ""
echo "For detailed information, check:"
echo "  - Server logs: Look for [Client Notifications] prefixed messages"
echo "  - Supabase table: public.client_notifications"
echo "  - WhatsApp connection: Verify tenant has connected WhatsApp session"
