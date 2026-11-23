import { Expo } from "expo-server-sdk";
import { logger } from "./logger";

const expo = new Expo();

/** Sends a single push notification via Expo's push service. Silently skips
 * (with a warning) invalid tokens rather than throwing — a bad/stale token
 * shouldn't fail the whole notification job when email is sent alongside it. */
export async function sendPushNotification(
  token: string,
  title: string,
  body: string
): Promise<void> {
  if (!Expo.isExpoPushToken(token)) {
    logger.warn(`⚠️  Not a valid Expo push token, skipping: ${token}`);
    return;
  }

  const [ticket] = await expo.sendPushNotificationsAsync([
    { to: token, title, body, sound: "default" },
  ]);

  if (ticket?.status === "error") {
    logger.warn(`⚠️  Push notification error: ${ticket.details?.error ?? ticket.message}`);
  }
}
