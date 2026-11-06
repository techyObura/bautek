import mongoose from "mongoose";
const { Schema, model } = mongoose;
const common = { timestamps: true, strict: true, versionKey: false };
const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
import crypto from "node:crypto";
const str = (required = false) => ({ type: String, trim: true, required });
const roles = ["client", "contractor", "admin", "super_admin", "tenant"];
const userSchema = new Schema(
  {
    invitedPropertyId: {
      type: String,
      default: null,
    },

    invitedBy: {
      type: String,
      default: null,
    },

    invitationAcceptedAt: {
      type: Date,
      default: null,
    },
    id: { type: String, unique: true, default: () => makeId("USR") },
    name: str(true),
    email: {
      type: String,
      lowercase: true,
      trim: true,
      required: true,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: roles, default: "client" },
    active: { type: Boolean, default: true },
    phone: String,
    specialties: [String],
    specializations: [String],
    otherSpecialty: String,
    yearsExperience: { type: Number, min: 0 },
    experience: String,
    qualifications: [String],
    professionalRegistration: String,
    professionalBio: String,
    bio: String,
    profileCompleted: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    refreshTokenHashes: [{ hash: String, expiresAt: Date }],
    lastLogin: Date,
  },
  common,
);
userSchema.index({ role: 1 });
export const User = model("User", userSchema);
const assignment = new Schema(
  {
    adminId: String,
    adminName: String,
    responsibility: { type: String, required: true },
    assignedBy: String,
    assignedAt: Date,
  },
  { _id: false },
);

export const ContractorApplication = model(
  "ContractorApplication",
  new Schema(
    {
      id: {
        type: String,
        unique: true,
        default: () => makeId("APP"),
      },

      applicantId: {
        type: String,
        required: true,
        index: true,
      },

      companyName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150,
      },

      specialty: {
        type: String,
        required: true,
        maxlength: 150,
      },

      yearsExperience: {
        type: Number,
        required: true,
        min: 0,
        max: 80,
      },

      qualifications: {
        type: String,
        required: true,
        maxlength: 3000,
      },

      registrationNumber: {
        type: String,
        maxlength: 150,
        default: "",
      },

      notes: {
        type: String,
        maxlength: 3000,
        default: "",
      },

      status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected"],
        default: "Pending",
        index: true,
      },

      reviewedBy: String,
      reviewedAt: Date,
      reviewReason: String,
    },
    common,
  ),
);

ContractorApplication.schema.index({ applicantId: 1, status: 1 });

export const Invitation = model(
  "Invitation",
  new Schema(
    {
      id: {
        type: String,
        unique: true,
        default: () => makeId("INV"),
      },

      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true,
      },

      role: {
        type: String,
        required: true,
        enum: ["admin", "tenant"],
      },

      propertyId: {
        type: String,
        default: null,
      },

      tokenHash: {
        type: String,
        required: true,
        unique: true,
        select: false,
      },

      status: {
        type: String,
        enum: ["Pending", "Processing", "Accepted", "Revoked"],
        default: "Pending",
      },

      expiresAt: {
        type: Date,
        required: true,
      },

      invitedBy: {
        type: String,
        required: true,
      },

      acceptedBy: String,
      acceptedAt: Date,
    },
    common,
  ),
);

export const Project = model(
  "Project",
  new Schema(
    {
      id: { type: String, unique: true, default: () => makeId("PRJ") },
      name: str(true),
      type: { type: String, required: true },
      county: String,
      ownerId: { type: String, required: true, index: true },
      budget: { type: Number, default: 0, min: 0 },
      status: { type: String, default: "Under review" },
      approvalStatus: {
        type: String,
        enum: ["Pending", "Approved", "Rejected"],
        default: "Pending",
      },
      progress: { type: Number, default: 0, min: 0, max: 100 },
      delivery: String,
      contractor: String,
      details: Schema.Types.Mixed,
      visibility: { type: String, default: "private" },
      adminAssignments: [assignment],
      assignedAdminId: String,
      reviewedBy: String,
      reviewedAt: Date,
      reviewReason: String,
      updated: String,
      createdAt: String,
    },
    common,
  ),
);
export const Property = model(
  "Property",
  new Schema(
    {
      id: { type: String, unique: true, default: () => makeId("PROP") },
      name: str(true),
      projectId: String,
      ownerId: { type: String, required: true, index: true },
      adminIds: [String],
      location: String,
      county: String,
      units: Number,
      status: { type: String, default: "Active" },
    },
    common,
  ),
);
export const Tenant = model(
  "Tenant",
  new Schema(
    {
      id: { type: String, unique: true, default: () => makeId("TEN") },
      propertyId: { type: String, required: true, index: true },
      userId: { type: String, required: true, index: true },
      name: String,
      unit: { type: String, required: true },
      monthlyRent: { type: Number, required: true, min: 0 },
      leaseStart: { type: String, required: true },
      leaseEnd: String,
      openingCredit: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ["Active", "Removal requested", "Removed"],
        default: "Active",
      },
      removalRequestedBy: String,
      removalRequestedAt: Date,
      removalReviewedBy: String,
      removalReviewedAt: Date,
      removalReason: String,
    },
    common,
  ),
);
Tenant.schema.index({ propertyId: 1, unit: 1, status: 1 });
export const RentPayment = model(
  "RentPayment",
  new Schema(
    {
      id: { type: String, unique: true, default: () => makeId("RENT") },
      tenantId: { type: String, required: true, index: true },
      propertyId: { type: String, required: true, index: true },
      amount: { type: Number, required: true, min: 0 },
      date: { type: String, required: true },
      reference: { type: String, required: true, trim: true, unique: true },
      status: {
        type: String,
        enum: ["Pending", "Recorded", "Confirmed", "Reversed"],
        default: "Pending",
      },
      source: {
        type: String,
        enum: ["manual", "mpesa", "bank", "other"],
        default: "manual",
      },
      recordedBy: String,
      verifiedBy: String,
      verifiedAt: Date,
      verificationEvidence: String,
      reversalReason: String,
    },
    common,
  ),
);
export const Transaction = model(
  "Transaction",
  new Schema(
    {
      id: { type: String, unique: true, default: () => makeId("TXN") },
      propertyId: String,
      projectId: String,
      ownerId: String,
      type: {
        type: String,
        enum: [
          "income",
          "expense",
          "remittance",
          "Income",
          "Expense",
          "Remittance",
        ],
        required: true,
      },
      category: String,
      amount: { type: Number, required: true, min: 0 },
      date: String,
      description: String,
      reference: String,
      status: { type: String, default: "Recorded" },
      recordedBy: String,
    },
    common,
  ),
);
export const Audit = model(
  "Audit",
  new Schema(
    {
      id: { type: String, unique: true, default: () => makeId("AUD") },
      actorId: String,
      actorRole: String,
      action: String,
      entity: String,
      entityId: String,
      details: Schema.Types.Mixed,
      ip: String,
    },
    common,
  ),
);
const generic = (name, fields) =>
  model(
    name,
    new Schema(
      {
        id: {
          type: String,
          unique: true,
          default: () => makeId(name.toUpperCase().slice(0, 4)),
        },
        ...fields,
      },
      common,
    ),
  );
export const Listing = generic("Listing", {
  authorId: String,
  author: String,
  title: String,
  category: String,
  description: String,
  county: String,
  price: Number,
  status: { type: String, default: "Under review" },
});
export const Bid = generic("Bid", {
  contractorId: String,
  contractor: String,
  projectId: String,
  amount: Number,
  proposal: String,
  status: { type: String, default: "Under review" },
  date: String,
});
export const Deliverable = generic("Deliverable", {
  projectId: String,
  title: String,
  description: String,
  date: String,
  workers: Number,
  photos: [String],
  submittedBy: String,
  status: { type: String, default: "Pending" },
});
export const Document = generic("Document", {
  projectId: String,
  title: String,
  name: String,
  url: String,
  category: String,
  uploadedBy: String,
  visibility: { type: String, default: "private" },
  date: String,
});
export const Message = generic("Message", {
  projectId: String,
  fromId: String,
  toId: String,
  text: String,
  message: String,
  date: String,
  read: { type: Boolean, default: false },
});
export const Notification = generic("Notification", {
  userId: String,
  title: String,
  message: String,
  type: String,
  read: { type: Boolean, default: false },
});
export const Tender = generic("Tender", {
  projectId: String,
  title: String,
  description: String,
  deadline: String,
  status: String,
  createdBy: String,
});
export const Setting = generic("Setting", {
  key: String,
  value: Schema.Types.Mixed,
  updatedBy: String,
});
export const models = {
  users: User,
  projects: Project,
  properties: Property,
  tenants: Tenant,
  rentPayments: RentPayment,
  transactions: Transaction,
  audit: Audit,
  listings: Listing,
  bids: Bid,
  deliverables: Deliverable,
  documents: Document,
  messages: Message,
  notifications: Notification,
  tenders: Tender,
  settings: Setting,
};
export { roles };
