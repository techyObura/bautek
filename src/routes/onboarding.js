import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import {
  User,
  Property,
  ContractorApplication,
  Invitation,
} from "../models/index.js";

import { requireAuth, requireRole } from "../middleware/auth.js";

import { asyncRoute, clean, fail } from "../utils/http.js";

import { logAction } from "../services/audit.js";
import { config } from "../config.js";

import { sendInvitationEmail, emailConfigured } from "../services/email.js";

const router = Router();

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

const applicationSchema = z.object({
  companyName: z.string().trim().min(2).max(150),
  specialty: z.string().trim().min(2).max(150),
  yearsExperience: z.coerce.number().min(0).max(80),
  qualifications: z.string().trim().min(5).max(3000),
  registrationNumber: z.string().max(150).optional(),
  notes: z.string().max(3000).optional(),
});

const invitationSchema = z.object({
  email: emailSchema,
  role: z.enum(["admin", "tenant"]),
  propertyId: z.string().trim().optional(),
});

const activationSchema = z.object({
  token: z.string().min(32).max(256),
  name: z.string().trim().min(2).max(150),
  password: z.string().min(10).max(128),
});

const decisionSchema = z.object({
  decision: z.enum(["Approved", "Rejected"]),
  reason: z.string().max(1000).optional(),
});

const parse = (schema, body) => {
  const result = schema.safeParse(body);

  if (!result.success) {
    fail(400, result.error.issues.map((issue) => issue.message).join("; "));
  }

  return result.data;
};

// =====================================================
// PUBLIC: ACCEPT ADMIN OR TENANT INVITATION
// =====================================================

router.post(
  "/auth/invitations/accept",

  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),

  asyncRoute(async (req, res) => {
    const input = parse(activationSchema, req.body);

    const tokenHash = hashToken(input.token);
    const now = new Date();

    const invitation = await Invitation.findOne({
      tokenHash,
      status: "Pending",
      expiresAt: { $gt: now },
    }).select("+tokenHash");

    if (!invitation) {
      fail(400, "Invitation is invalid, expired or used");
    }

    if (await User.exists({ email: invitation.email })) {
      fail(409, "An account already exists with this email. Contact Bautek.");
    }

    const session = await mongoose.startSession();

    let createdUser;

    try {
      await session.withTransaction(async () => {
        const invite = await Invitation.findOne({
          id: invitation.id,
          status: "Pending",
          expiresAt: { $gt: new Date() },
        }).session(session);

        if (!invite) {
          fail(409, "Invitation is no longer available");
        }

        const passwordHash = await bcrypt.hash(input.password, 12);

        const created = await User.create(
          [
            {
              name: input.name,
              email: invite.email,
              passwordHash,
              role: invite.role,
              active: true,

              invitedPropertyId:
                invite.role === "tenant" ? invite.propertyId : null,

              invitedBy: invite.invitedBy,
              invitationAcceptedAt: new Date(),

              profileCompleted: false,
            },
          ],
          { session },
        );

        createdUser = created[0];

        invite.status = "Accepted";
        invite.acceptedBy = createdUser.id;
        invite.acceptedAt = new Date();

        await invite.save({ session });
      });
    } catch (error) {
      if (error.code === 11000) {
        fail(409, "Account or invitation already used");
      }

      throw error;
    } finally {
      await session.endSession();
    }

    // Audit uses the existing service.
    await logAction(req, "INVITATION_ACCEPTED", "invitations", invitation.id, {
      userId: createdUser.id,
      role: createdUser.role,
    });

    return res.status(201).json({
      message: "Account activated. Please sign in.",
      user: clean(createdUser),
    });
  }),
);

// Every route below requires authentication.
router.use(requireAuth);

// =====================================================
// CLIENT: SUBMIT CONTRACTOR APPLICATION
// =====================================================

router.post(
  "/contractor-applications",
  requireRole("client"),

  asyncRoute(async (req, res) => {
    const input = parse(applicationSchema, req.body);

    const existing = await ContractorApplication.findOne({
      applicantId: req.auth.id,
      status: "Pending",
    });

    if (existing) {
      fail(409, "You already have a pending application");
    }

    const application = await ContractorApplication.create({
      ...input,
      applicantId: req.auth.id,
      status: "Pending",
    });

    await logAction(
      req,
      "CONTRACTOR_APPLICATION_SUBMITTED",
      "contractorApplications",
      application.id,
    );

    res.status(201).json({
      message: "Application submitted for review",
      data: clean(application),
    });
  }),
);

// =====================================================
// CLIENT / SUPER ADMIN: VIEW APPLICATIONS
// =====================================================

router.get(
  "/contractor-applications",

  asyncRoute(async (req, res) => {
    if (!["client", "super_admin"].includes(req.auth.role)) {
      fail(403, "Access denied");
    }

    const filter =
      req.auth.role === "super_admin" ? {} : { applicantId: req.auth.id };

    const applications = await ContractorApplication.find(filter)
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({
      items: applications.map(clean),
      count: applications.length,
    });
  }),
);

// =====================================================
// SUPER ADMIN: APPROVE OR REJECT CONTRACTOR
// =====================================================

router.patch(
  "/contractor-applications/:id/decision",
  requireRole("super_admin"),

  asyncRoute(async (req, res) => {
    const input = parse(decisionSchema, req.body);

    const session = await mongoose.startSession();

    let application;
    let applicant;

    try {
      await session.withTransaction(async () => {
        application = await ContractorApplication.findOne({
          id: req.params.id,
          status: "Pending",
        }).session(session);

        if (!application) {
          fail(404, "Pending application not found");
        }

        applicant = await User.findOne({
          id: application.applicantId,
          role: "client",
          active: true,
        }).session(session);

        if (!applicant) {
          fail(409, "Applicant is not an active client");
        }

        if (input.decision === "Approved") {
          applicant.role = "contractor";

          // Revoke old sessions after role conversion.
          applicant.tokenVersion += 1;
          applicant.refreshTokenHashes = [];

          applicant.specialties = [application.specialty];

          applicant.yearsExperience = application.yearsExperience;

          applicant.qualifications = [application.qualifications];

          applicant.professionalRegistration =
            application.registrationNumber || "";

          applicant.profileCompleted = true;

          await applicant.save({ session });
        }

        application.status = input.decision;
        application.reviewedBy = req.auth.id;
        application.reviewedAt = new Date();
        application.reviewReason = input.reason || "";

        await application.save({ session });
      });
    } finally {
      await session.endSession();
    }

    await logAction(
      req,
      "CONTRACTOR_APPLICATION_DECIDED",
      "contractorApplications",
      application.id,
      {
        decision: input.decision,
        applicantId: applicant.id,
      },
    );

    res.json({
      message: `Application ${input.decision.toLowerCase()}`,
      data: clean(application),
      user: clean(applicant),
    });
  }),
);

// =====================================================
// SUPER ADMIN: ISSUE ADMIN / TENANT INVITATION
// =====================================================

router.post(
  "/invitations",
  requireRole("super_admin"),

  asyncRoute(async (req, res) => {
    const input = parse(invitationSchema, req.body);

    if (!emailConfigured()) {
      fail(503, "Email service is not configured. Invitation was not sent.");
    }

    if (await User.exists({ email: input.email })) {
      fail(409, "An account already exists. Use role management instead.");
    }

    if (input.role === "tenant") {
      if (!input.propertyId) {
        fail(400, "Tenant invitation requires a property");
      }

      const property = await Property.findOne({
        id: input.propertyId,
        status: "Active",
      });

      if (!property) {
        fail(404, "Active property not found");
      }
    }

    const existing = await Invitation.findOne({
      email: input.email,
      status: "Pending",
      expiresAt: { $gt: new Date() },
    });

    if (existing) {
      fail(409, "An unexpired invitation already exists");
    }

    const token = crypto.randomBytes(32).toString("hex");

    const expiresAt = new Date(
      Date.now() + config.invitationExpiryHours * 60 * 60 * 1000,
    );

    const invitation = await Invitation.create({
      email: input.email,
      role: input.role,

      propertyId: input.role === "tenant" ? input.propertyId : null,

      tokenHash: hashToken(token),
      expiresAt,
      invitedBy: req.auth.id,
    });

    try {
      await sendInvitationEmail({
        email: input.email,
        role: input.role,
        token,
        expiresAt,
      });
    } catch (error) {
      // An unsent invitation must not remain active.
      await Invitation.updateOne(
        { id: invitation.id },
        { $set: { status: "Revoked" } },
      );

      console.error("Invitation delivery failed:", error.message);

      fail(502, "Unable to deliver invitation email");
    }

    await logAction(req, "INVITATION_CREATED", "invitations", invitation.id, {
      email: input.email,
      role: input.role,
    });

    const safeInvitation = clean(invitation);

    delete safeInvitation.tokenHash;

    res.status(201).json({
      message: "Invitation email sent",
      data: safeInvitation,
    });
  }),
);

// =====================================================
// SUPER ADMIN: VIEW INVITATIONS
// =====================================================

router.get(
  "/invitations",
  requireRole("super_admin"),

  asyncRoute(async (req, res) => {
    const invitations = await Invitation.find()
      .sort({ createdAt: -1 })
      .limit(200);

    const items = invitations.map((item) => {
      const value = clean(item);

      return {
        ...value,
        expired: item.status === "Pending" && item.expiresAt < new Date(),
      };
    });

    res.json({
      items,
      count: items.length,
    });
  }),
);

router.patch(
  "/invitations/:id/revoke",
  requireRole("super_admin"),

  asyncRoute(async (req, res) => {
    const invitation = await Invitation.findOneAndUpdate(
      {
        id: req.params.id,
        status: "Pending",
      },
      {
        $set: {
          status: "Revoked",
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!invitation) {
      fail(404, "Pending invitation not found");
    }

    await logAction(req, "INVITATION_REVOKED", "invitations", invitation.id);

    res.json({
      message: "Invitation revoked",
      data: clean(invitation),
    });
  }),
);

export default router;
