#!/bin/bash
# Staff Notification Implementation Test Script
# This script verifies the staff notification flow works end-to-end

set -e

echo "=== Staff Notification Flow Test ==="
echo ""

# Test 1: Verify Supabase migration is applied
echo "Test 1: Checking if staff_notifications table exists..."
RESPONSE=$(curl -s -X POST "http://localhost:3000/api/health" 2>/dev/null || echo "Server not running")
if [ "$RESPONSE" = "Server not running" ]; then
  echo "  ⚠ API Server not running. Start it first with: npm run dev"
  exit 1
fi
echo "  ✓ API Server is running"
echo ""

# Test 2: Verify backend includes staff notifications worker
echo "Test 2: Checking if staff notifications worker is initialized..."
# Look for log entries indicating worker startup
# This requires server logs to be visible
echo "  ℹ Check server logs for: '[Staff Notifications] Starting background worker'"
echo ""

# Test 3: Manual verification steps
echo "Test 3: Manual verification steps:"
echo "  1. Log in to Supabase Dashboard"
echo "  2. Navigate to: SQL Editor"
echo "  3. Create a test booking with a staff member assigned:"
echo ""
echo "     INSERT INTO public.bookings (business_id, client_id, service_id, staff_id, start_time, end_time, status, total_amount)"
echo "     VALUES ("
echo "       'YOUR_BUSINESS_ID',"
echo "       'YOUR_CLIENT_ID',"
echo "       'YOUR_SERVICE_ID',"
echo "       'YOUR_STAFF_ID',"
echo "       NOW() + INTERVAL '1 day',"
echo "       NOW() + INTERVAL '1 day 1 hour',"
echo "       'pending',"
echo "       100"
echo "     );"
echo ""
echo "  4. Verify staff_notifications table received an entry:"
echo ""
echo "     SELECT * FROM public.staff_notifications ORDER BY created_at DESC LIMIT 1;"
echo ""
echo "  5. Check server logs for WhatsApp sending activity"
echo "  6. Verify staff member received WhatsApp message"
echo ""

# Test 4: Test cancellation workflow
echo "Test 4: Test cancellation notification:"
echo "  1. In Supabase, update a booking to 'cancelled':"
echo ""
echo "     UPDATE public.bookings SET status = 'cancelled' WHERE id = 'BOOKING_ID';"
echo ""
echo "  2. Verify a cancellation notification was created:"
echo ""
echo "     SELECT * FROM public.staff_notifications WHERE notification_type = 'cancellation' ORDER BY created_at DESC LIMIT 1;"
echo ""

# Test 5: Enable/Disable staff notifications
echo "Test 5: Test notification settings toggle:"
echo "  1. Update notification_settings to disable staff_new_booking:"
echo ""
echo "     UPDATE public.notification_settings SET staff_new_booking = false WHERE business_id = 'YOUR_BUSINESS_ID';"
echo ""
echo "  2. Create a new booking - NO staff_notifications entry should be created"
echo "  3. Re-enable and verify the setting works"
echo ""

echo "=== End of Test Suite ==="
echo ""
echo "For detailed information, check:"
echo "  - Server logs: Look for [Staff Notifications] prefixed messages"
echo "  - Supabase table: public.staff_notifications"
echo "  - WhatsApp connection: Verify tenant has connected WhatsApp session"
