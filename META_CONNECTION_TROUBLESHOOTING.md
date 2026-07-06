# Meta Connection Troubleshooting Guide

## Issue
When clicking "Connect" on the "Enable New Contact Sending" feature, you're asked for permissions but then get the error:
```
(#200) Requires business_management permission to manage the object
```

## Root Cause
Even though you grant permissions in the Facebook login dialog, your Meta app **doesn't have permission to request `business_management`** at the application level. This needs to be approved by Meta.

## Solution - 3 Steps

### Step 1: Verify Your Meta Business Account Setup
1. Go to https://business.facebook.com and sign in
2. Check that you have a **Business Account** created
3. Check that you have **Admin** or **Editor** role on the Business Account
4. Check that you have a **WhatsApp Business Account** under your Business Account

If any of these are missing:
- Create a Business Account if needed
- Ask your Business Account admin to give you Admin/Editor role
- Create a WhatsApp Business Account (available from Business Manager → WhatsApp Manager)

---

### Step 2: Request Permission in Meta App Settings
1. Go to https://developers.facebook.com/apps
2. Select your app (App ID: `1519664722812785`)
3. Go to **Settings → Basic** and note your App ID and App Secret
4. Go to **Settings → Roles and Permissions**
5. Look for **User Roles** section and verify your role (should be Admin)
6. Check if **"business_management"** permission is available under "Requested Permissions"
7. If you see a yellow warning icon next to `business_management`:
   - Click "Request Permission" next to it
   - Submit the request to Meta for review
   - **Wait 1-3 days for Meta's approval**
8. If you don't see it at all:
   - Go to **Settings → App Roles**
   - Make sure your user account has "Admin" or "Developer" role

---

### Step 3: Add Permissions to Your App Configuration
1. In the Meta App Dashboard, go to **Settings → Basic**
2. Go to **App Roles** and verify your role
3. Go to the **Products** section and make sure you have:
   - Facebook Login (with `business_management` scope)
   - WhatsApp Business Platform

4. Click on **Facebook Login** 
5. Go to **Settings → Basic**
6. In **OAuth Redirect URIs**, add your Bookza URL:
   - `https://bookza.yourdomain.com/` 
   - Or your local testing URL if applicable

7. Save changes

---

## What This Fix Improves

I've updated the error handling to:
1. **Show better error messages** - You'll now see exactly what permission is missing
2. **Provide step-by-step guidance** - The error message includes instructions
3. **Display errors clearly** - Multi-line errors are now formatted nicely
4. **Log permission details** - Check browser console (F12) to see which scopes were granted vs requested

---

## Debugging Steps (if still having issues)

### Check Browser Console
1. Open your browser DevTools (F12)
2. Go to Console tab
3. Try connecting again
4. Look for lines starting with "Granted scopes:" and "Required scopes:"
5. Compare them - this tells you exactly which permissions were granted

### Required Scopes
Your app needs to request these three scopes:
- `business_management` - Access to your business account
- `whatsapp_business_management` - Manage WhatsApp Business Account
- `whatsapp_business_messaging` - Send WhatsApp messages

### Verify Your Setup
Visit this URL to test if your credentials work:
```
https://graph.facebook.com/v16.0/me?fields=businesses{whatsapp_business_accounts}&access_token=YOUR_ACCESS_TOKEN
```

If you get an error containing "(#200) Requires business_management", your access token doesn't have the permission despite what the login dialog showed.

---

## Common Issues & Solutions

### "Meta login succeeded but business_management permission was not granted"
- **Cause**: Permission dialog appeared but you clicked "Don't Allow" or the app isn't approved for this permission
- **Fix**: 
  1. Try again and click "Allow" on ALL permissions
  2. If you can't see the option to allow, your app needs Meta's approval (Step 2 above)

### "No WhatsApp Business Account was found"
- **Cause**: You don't have a WhatsApp Business Account in your Meta Business Account
- **Fix**:
  1. Go to https://business.facebook.com
  2. Go to Tools → WhatsApp Manager
  3. Click "Create Account"
  4. Complete the setup

### Error persists after all steps
- Try using an **incognito/private browser window** to clear cached permissions
- Make sure you're using the same Meta account that owns the Business Account
- Wait 24 hours for Meta's permission approval to fully propagate
- Contact Meta Support if stuck on permission approval

---

## Scopes Explanation

| Scope | Purpose |
|-------|---------|
| `business_management` | Access your Meta Business Account and manage it |
| `whatsapp_business_management` | Manage WhatsApp Business Account settings |
| `whatsapp_business_messaging` | Send messages via WhatsApp Business Platform |

All three must be granted for the connection to work.

---

## Timeline Expectations

1. **Immediate**: Connect with existing approved permissions - ✅ Usually instant
2. **1-3 days**: If requesting new permissions from Meta - ⏳ Wait for review
3. **After Meta approval**: Your app can request `business_management` - ✅ Try connecting again

---

## Support
If you continue having issues:
1. Take a screenshot of the error message
2. Check browser console (F12) and share the "Granted scopes" vs "Required scopes"
3. Verify your app ID is correct: `1519664722812785`
4. Contact Meta Developer Support at https://developers.facebook.com/community
