import { after } from "next/server";
import { deliverPendingNotifications } from "@dienstplan/db";

/** Sends pending pushes after the response has gone out, so nobody waits for push providers when they click a button. */
export const deliverSoon = () => after(() => deliverPendingNotifications().then(() => undefined));
