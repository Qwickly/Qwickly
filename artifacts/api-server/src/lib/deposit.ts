/**
 * Shared deposit-amount calculation, used identically by the WhatsApp AI
 * booking flow and the public booking-page payment-intent route so a
 * customer gets the same deposit requirement regardless of which channel
 * they booked through. Mirrors the precedence baked into create_public_booking
 * (069_booking_pending_expiry.sql) at the SQL level for booking-page bookings
 * created directly via the RPC.
 */

export type DepositService = {
  deposit_required: boolean;
  deposit_amount: number;
  price: number;
};

export type DepositSettings = {
  require_deposit: boolean;
  deposit_type: "percentage" | "fixed";
  deposit_amount: number;
} | null;

export function calculateDepositAmount(
  service: DepositService,
  depositSettings: DepositSettings,
  bookingPageRequireDeposit: boolean,
): { required: boolean; amount: number } {
  const required =
    service.deposit_required ||
    bookingPageRequireDeposit ||
    Boolean(depositSettings?.require_deposit);

  if (!required) return { required: false, amount: 0 };

  if (service.deposit_amount > 0) {
    return { required: true, amount: service.deposit_amount };
  }

  if (!depositSettings) return { required: true, amount: 0 };

  if (depositSettings.deposit_type === "percentage") {
    return {
      required: true,
      amount: Math.round(service.price * (depositSettings.deposit_amount / 100) * 100) / 100,
    };
  }

  return { required: true, amount: depositSettings.deposit_amount };
}
