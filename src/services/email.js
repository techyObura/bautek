import nodemailer from "nodemailer";
import { config } from "../config.js";

export function emailConfigured() {
  const smtp = config.smtp;

  return Boolean(smtp.host && smtp.user && smtp.password && smtp.from);
}

export async function sendInvitationEmail({ email, role, token, expiresAt }) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured. Invitation email was not sent.");
  }

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
  });

  const activationUrl = new URL("/activate-invitation", config.frontendUrl);

  activationUrl.searchParams.set("token", token);

  const roleName = role === "admin" ? "Administrator" : "Tenant";

  const subject = `Your Bautek Flink ${roleName} Invitation`;

  const text = [
    "You have been invited to join Bautek Flink.",
    "",
    `Account type: ${roleName}`,
    "",
    "Activate your account using this link:",
    activationUrl.toString(),
    "",
    `Invitation expires: ${expiresAt.toISOString()}`,
    "",
    "If you did not expect this invitation,",
    "you can safely ignore this email.",
    "",
    "Bautek Flink",
  ].join("\n");

  await transport.sendMail({
    from: config.smtp.from,
    to: email,
    subject,
    text,
  });

  return true;
}
