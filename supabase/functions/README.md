# Supabase Edge Functions for Bookza Subscription Management

This directory contains Supabase Edge Functions that handle subscription billing and PayFast payment processing.

## Functions

### 1. payfast-webhook
Handles PayFast webhook notifications for subscription payments.

**Endpoint:** `/functions/v1/payfast-webhook`
**Method:** POST

**Features:**
- Validates PayFast signature for security
- Activates subscriptions on successful payments
- Handles recurring payments
- Processes payment failures and cancellations
- Stores PayFast tokens for future API calls

**Environment Variables Required:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYFAST_SANDBOX_MERCHANT_ID` (default: "10036200")
- `PAYFAST_SANDBOX_MERCHANT_KEY` (default: "ztgkjo0djf02j")
- `PAYFAST_SANDBOX_PASSPHRASE` (default: "uber20206torbeN")
- `PAYFAST_PRODUCTION_MERCHANT_ID` (for production)
- `PAYFAST_PRODUCTION_MERCHANT_KEY` (for production)
- `PAYFAST_PRODUCTION_PASSPHRASE` (for production)
- `PAYFAST_MODE` (set to "sandbox" or "production")

### 2. subscription-management
Manages subscription CRUD operations and PayFast payment initiation.

**Endpoints:**
- `GET /functions/v1/subscription-management` - Fetch current subscription
- `POST /functions/v1/subscription-management/payfast` - Create PayFast subscription payment
- `POST /functions/v1/subscription-management/payfast/check-status` - Check payment status
- `PUT /functions/v1/subscription-management` - Update subscription (upgrade/downgrade)
- `DELETE /functions/v1/subscription-management` - Cancel subscription

**Features:**
- User authentication via Supabase Auth
- Business validation
- PayFast payment form generation
- Subscription plan management
- Prorated upgrade calculations
- Scheduled downgrades

**Environment Variables Required:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Deployment

### Prerequisites
1. Install Supabase CLI: `npm install -g supabase`
2. Login to Supabase: `supabase login`
3. Link your project: `supabase link --project-ref YOUR_PROJECT_ID`

### Deploy Functions

Deploy all functions:
```bash
supabase functions deploy
```

Deploy specific function:
```bash
supabase functions deploy payfast-webhook
supabase functions deploy subscription-management
```

### Set Environment Variables

Set secrets for payfast-webhook:
```bash
supabase secrets set PAYFAST_SANDBOX_PASSPHRASE=your_passphrase
supabase secrets set PAYFAST_PRODUCTION_PASSPHRASE=your_passphrase
supabase secrets set PAYFAST_MODE=sandbox
```

## Testing

### Test Webhook Locally
```bash
supabase functions serve payfast-webhook
```

### Test Subscription Management Locally
```bash
supabase functions serve subscription-management
```

## PayFast Configuration

### Sandbox Mode
- Merchant ID: 10036200
- Merchant Key: ztgkjo0djf02j
- Passphrase: uber20206torbeN
- URL: https://sandbox.payfast.co.za/eng/process

### Production Mode
Replace with your production PayFast credentials.

## Database Schema

The Edge Functions expect the following database tables:
- `subscriptions` - Subscription records
- `plans` - Plan definitions
- `businesses` - Business records

## Security

- All functions validate Supabase Auth tokens
- PayFast webhook validates signatures
- Service role key used for database operations
- Business ownership validation on all operations
