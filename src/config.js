import "dotenv/config";
const env = process.env;
export const config = {
  frontendUrl: env.FRONTEND_URL || "http://localhost:5173",

  smtp: {
    host: env.SMTP_HOST || "",
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER || "",
    password: env.SMTP_PASSWORD || "",
    from: env.EMAIL_FROM || "",
  },

  invitationExpiryHours: Math.max(1, Number(env.INVITATION_EXPIRY_HOURS || 48)),
  port: Number(env.PORT || 5000),
  mongo: env.MONGODB_URI || "mongodb://127.0.0.1:27017/bautek",
  origins: (env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim()),
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessMinutes: Math.max(1, Number(env.ACCESS_TOKEN_MINUTES || 15)),
  refreshDays: Math.max(1, Number(env.REFRESH_TOKEN_DAYS || 7)),
  cookieSecure: env.COOKIE_SECURE === "true" || env.NODE_ENV === "production",
  production: env.NODE_ENV === "production",
};
export function validateConfig() {
  for (const [key, val] of [
    ["JWT_ACCESS_SECRET", config.accessSecret],
    ["JWT_REFRESH_SECRET", config.refreshSecret],
  ]) {
    if (!val || val.length < 32 || val.startsWith("REPLACE_WITH"))
      throw new Error(
        `${key} must be a distinct random string with at least 32 characters`,
      );
  }
  if (config.accessSecret === config.refreshSecret)
    throw new Error("Access and refresh secrets must differ");
  if (!config.mongo) throw new Error("MONGO_URI is required");
}
