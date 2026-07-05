/**
 * Timezone Awareness - Handles timezone conversion and optimal send times
 */

/**
 * Convert a time from one timezone to another
 */
export function convertTimezone(
  date: Date,
  fromTimezone: string,
  toTimezone: string
): Date {
  // Simple implementation - in production use a library like luxon or date-fns-tz
  // For now, we'll just return the date as-is since proper timezone handling
  // requires a full timezone database
  return date;
}

/**
 * Get current time in a specific timezone
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  return new Date();
}

/**
 * Check if a time is within business hours for a timezone
 * @param date The date/time to check
 * @param timezone The timezone
 * @param startHour Business start hour (0-23)
 * @param endHour Business end hour (0-23)
 */
export function isWithinBusinessHours(
  date: Date,
  timezone: string,
  startHour: number = 9,
  endHour: number = 17
): boolean {
  const hour = date.getHours();
  return hour >= startHour && hour < endHour;
}

/**
 * Get the next business day time for a timezone
 */
export function getNextBusinessDayTime(
  timezone: string,
  startHour: number = 9
): Date {
  const now = getCurrentTimeInTimezone(timezone);
  const next = new Date(now);
  
  // If it's past business hours, move to tomorrow
  if (now.getHours() >= startHour) {
    next.setDate(next.getDate() + 1);
  }
  
  next.setHours(startHour, 0, 0, 0);
  return next;
}

/**
 * Group recipients by timezone
 */
export function groupRecipientsByTimezone(
  recipients: Array<{ phone: string; timezone?: string }>
): Map<string, Array<{ phone: string; timezone?: string }>> {
  const groups = new Map<string, Array<{ phone: string; timezone?: string }>>();
  
  for (const recipient of recipients) {
    const tz = recipient.timezone || 'Africa/Johannesburg'; // Default to SA time
    if (!groups.has(tz)) {
      groups.set(tz, []);
    }
    groups.get(tz)!.push(recipient);
  }
  
  return groups;
}

/**
 * Get optimal send time for a timezone
 * Returns the best time to send messages based on typical engagement patterns
 */
export function getOptimalSendTime(timezone: string): Date {
  const now = getCurrentTimeInTimezone(timezone);
  const optimal = new Date(now);
  
  // Best times: 10 AM, 2 PM, 6 PM
  const optimalHours = [10, 14, 18];
  const currentHour = now.getHours();
  
  // Find the next optimal hour
  let nextOptimalHour = optimalHours.find(h => h > currentHour);
  
  if (!nextOptimalHour) {
    // All optimal hours have passed, use tomorrow's first optimal hour
    optimal.setDate(optimal.getDate() + 1);
    nextOptimalHour = optimalHours[0];
  }
  
  optimal.setHours(nextOptimalHour, 0, 0, 0);
  return optimal;
}

/**
 * Calculate delay to reach optimal send time
 */
export function getDelayToOptimalTime(timezone: string): number {
  const optimal = getOptimalSendTime(timezone);
  const now = getCurrentTimeInTimezone(timezone);
  return optimal.getTime() - now.getTime();
}
