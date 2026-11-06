import { Router } from "express";
import {
  models,
  User,
  Project,
  Property,
  Tenant,
  RentPayment,
} from "../models/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  asyncRoute,
  clean,
  fail,
  same,
  parseAmount,
  validDate,
  take,
  idOr400,
} from "../utils/http.js";
import {
  canReadProject,
  canReadProperty,
  canManageProperty,
  adminOn,
  projectFields,
  profileFields,
} from "../services/permissions.js";
import { logAction } from "../services/audit.js";
import { propertyStatement } from "../services/ledger.js";
import { Transaction } from "../models/index.js";
const router = Router();
router.use(requireAuth);
const objectFields = {
  projects: projectFields,
  properties: [
    "name",
    "projectId",
    "ownerId",
    "adminIds",
    "location",
    "county",
    "units",
  ],
  tenants: [
    "propertyId",
    "userId",
    "name",
    "unit",
    "monthlyRent",
    "leaseStart",
    "leaseEnd",
    "openingCredit",
  ],
  rentPayments: [
    "tenantId",
    "propertyId",
    "amount",
    "date",
    "reference",
    "source",
  ],
  transactions: [
    "propertyId",
    "projectId",
    "ownerId",
    "type",
    "category",
    "amount",
    "date",
    "description",
    "reference",
  ],
  listings: ["title", "category", "description", "county", "price", "author"],
  bids: ["projectId", "amount", "proposal", "contractor"],
  deliverables: [
    "projectId",
    "title",
    "description",
    "date",
    "workers",
    "photos",
  ],
  documents: [
    "projectId",
    "title",
    "name",
    "url",
    "category",
    "visibility",
    "date",
  ],
  messages: ["projectId", "toId", "text", "message", "date"],
  notifications: ["title", "message", "type", "userId"],
  tenders: ["projectId", "title", "description", "deadline"],
  settings: ["key", "value"],
};
const noWrites = new Set(["audit", "users"]);
const all = async () =>
  Promise.all([Project.find(), Property.find(), Tenant.find()]);
const isProjectVisible = (auth, p, projects) => canReadProject(auth, p);
function visible(auth, name, rows, projects, properties, tenants) {
  const projectById = (id) => projects.find((p) => same(p.id, id));
  const propertyById = (id) => properties.find((p) => same(p.id, id));
  const ownProperty = (p) =>
    p && canReadProperty(auth, p, projectById(p.projectId));
  const ownTenant = (t) =>
    t &&
    ((auth.role === "tenant" && same(t.userId, auth.id)) ||
      ownProperty(propertyById(t.propertyId)));
  switch (name) {
    case "users":
      return auth.role === "super_admin"
        ? rows.map(clean)
        : auth.role === "admin"
          ? rows
              .filter(
                (u) =>
                  ["admin", "tenant"].includes(u.role) || same(u.id, auth.id),
              )
              .map(clean)
          : rows.filter((u) => same(u.id, auth.id)).map(clean);
    case "audit":
      return auth.role === "super_admin" ? rows : [];
    case "settings":
      return auth.role === "super_admin" ? rows : [];
    case "projects":
      return rows.filter((p) => isProjectVisible(auth, p, projects));
    case "properties":
      return rows.filter((p) => ownProperty(p));
    case "tenants":
      return rows.filter((t) => ownTenant(t));
    case "rentPayments":
      return rows.filter((p) =>
        ownTenant(tenants.find((t) => same(t.id, p.tenantId))),
      );
    case "transactions":
      return rows.filter((t) =>
        t.propertyId
          ? ownProperty(propertyById(t.propertyId))
          : t.projectId
            ? isProjectVisible(auth, projectById(t.projectId), projects)
            : auth.role === "super_admin" || same(t.ownerId, auth.id),
      );
    case "listings":
      return rows.filter(
        (r) =>
          r.status === "Published" ||
          auth.role === "super_admin" ||
          same(r.authorId, auth.id),
      );
    case "notifications":
      return rows.filter((r) => same(r.userId, auth.id));
    case "messages":
      return rows.filter(
        (r) =>
          same(r.fromId, auth.id) ||
          same(r.toId, auth.id) ||
          auth.role === "super_admin",
      );
    case "bids":
      return rows.filter(
        (r) =>
          auth.role === "super_admin" ||
          same(r.contractorId, auth.id) ||
          isProjectVisible(auth, projectById(r.projectId), projects),
      );
    case "deliverables":
    case "documents":
    case "tenders":
      return rows.filter(
        (r) =>
          (r.projectId &&
            isProjectVisible(auth, projectById(r.projectId), projects)) ||
          auth.role === "super_admin",
      );
    default:
      return [];
  }
}
const enforceProject = async (req, id, manage = false) => {
  const p = await Project.findOne({ id });
  if (!p) fail(404, "Project not found");
  if (!canReadProject(req.auth, p)) fail(403, "Project access denied");
  if (manage && !["admin", "super_admin"].includes(req.auth.role))
    fail(403, "Staff access required");
  return p;
};
const enforceProperty = async (req, id, manage = false) => {
  const p = await Property.findOne({ id });
  if (!p) fail(404, "Property not found");
  const project = p.projectId
    ? await Project.findOne({ id: p.projectId })
    : null;
  if (
    !(manage
      ? canManageProperty(req.auth, p, project)
      : canReadProperty(req.auth, p, project))
  )
    fail(403, "Property access denied");
  return p;
};
async function prepareCreate(req, name) {
  const auth = req.auth;
  const data = take(req.body, objectFields[name] || []);
  if (Object.keys(data).length === 0) fail(400, "No supported fields provided");
  switch (name) {
    case "projects":
      if (auth.role !== "client" && auth.role !== "super_admin")
        fail(403, "Only clients can submit projects");
      if (!String(data.name || "").trim() || !data.type)
        fail(400, "Project name and type required");
      data.ownerId =
        auth.role === "super_admin" && data.ownerId ? data.ownerId : auth.id;
      data.budget = parseAmount(data.budget || 0);
      data.status = "Under review";
      data.approvalStatus = "Pending";
      data.progress = 0;
      return data;
    case "properties": {
      if (auth.role !== "super_admin")
        fail(403, "Only super admin registers properties");
      if (!data.name || !data.projectId)
        fail(400, "Property name and project required");
      const p = await Project.findOne({
        id: data.projectId,
        approvalStatus: "Approved",
        type: "property",
      });
      if (!p) fail(409, "Approved property project is required");
      data.ownerId = p.ownerId;
      data.adminIds = [...new Set(p.adminAssignments.map((a) => a.adminId))];
      return data;
    }
    case "tenants": {
      if (!["admin", "super_admin"].includes(auth.role))
        fail(403, "Only staff register tenants");
      if (!data.propertyId || !data.userId || !data.unit)
        fail(400, "Property, tenant account and unit are required");
      await enforceProperty(req, data.propertyId, true);
      const u = await User.findOne({
        id: data.userId,
        role: "tenant",
        active: true,
      });
      if (!u) fail(400, "Select an active tenant account");
      if (u.invitedPropertyId && u.invitedPropertyId !== data.propertyId) {
        fail(403, "This tenant was invited to a different property");
      }
      if (await Tenant.exists({ userId: data.userId, status: "Active" }))
        fail(409, "User already has an active tenancy");
      if (
        await Tenant.exists({
          propertyId: data.propertyId,
          unit: data.unit,
          status: "Active",
        })
      )
        fail(409, "Unit already occupied");
      data.monthlyRent = parseAmount(data.monthlyRent, true);
      data.leaseStart = validDate(data.leaseStart);
      data.name = u.name;
      return data;
    }
    case "rentPayments": {
      if (!["admin", "super_admin"].includes(auth.role))
        fail(403, "Only staff record rent");
      const t = await Tenant.findOne({ id: data.tenantId, status: "Active" });
      if (!t) fail(404, "Active tenant not found");
      await enforceProperty(req, t.propertyId, true);
      if (!String(data.reference || "").trim())
        fail(400, "Payment reference required");
      data.amount = parseAmount(data.amount, true);
      data.date = validDate(data.date);
      data.propertyId = t.propertyId;
      data.recordedBy = auth.id;
      data.status = "Pending";
      data.source = data.source || "manual";
      return data;
    }
    case "transactions": {
      if (!["admin", "super_admin"].includes(auth.role))
        fail(403, "Staff only");
      if (!data.propertyId) fail(400, "Transaction propertyId required");
      const p = await enforceProperty(req, data.propertyId, true);
      if (
        ![
          "income",
          "expense",
          "remittance",
          "Income",
          "Expense",
          "Remittance",
        ].includes(data.type)
      )
        fail(400, "Invalid transaction type");
      if (
        ["remittance", "Remittance"].includes(data.type) &&
        auth.role !== "super_admin"
      )
        fail(403, "Owner remittances require super admin");
      data.amount = parseAmount(data.amount, true);
      data.date = validDate(data.date);
      if (["remittance", "Remittance"].includes(data.type)) {
        const [tenants, payments, transactions] = await Promise.all([
          Tenant.find({ propertyId: p.id }),
          RentPayment.find({ propertyId: p.id }),
          Transaction.find({ propertyId: p.id }),
        ]);
        const available = propertyStatement(
          p,
          tenants,
          payments,
          transactions,
          data.date,
        ).availableForOwner;
        if (data.amount > available)
          fail(409, "Remittance exceeds verified available balance");
      }
      data.ownerId = p.ownerId;
      data.recordedBy = auth.id;
      return data;
    }
    case "listings":
      if (!["client", "admin", "super_admin"].includes(auth.role))
        fail(403, "Listing access denied");
      data.authorId = auth.id;
      data.status = "Under review";
      return data;
    case "bids":
      if (auth.role !== "contractor") fail(403, "Contractor role required");
      if (!data.projectId) fail(400, "Project required");
      data.contractorId = auth.id;
      data.status = "Under review";
      return data;
    case "deliverables":
      if (!["contractor", "admin", "super_admin"].includes(auth.role))
        fail(403, "Staff or contractor required");
      await enforceProject(req, data.projectId);
      data.submittedBy = auth.id;
      data.status = "Pending";
      return data;
    case "documents":
      await enforceProject(req, data.projectId);
      data.uploadedBy = auth.id;
      return data;
    case "messages":
      if (!data.toId) fail(400, "Recipient required");
      data.fromId = auth.id;
      return data;
    case "notifications":
      if (auth.role !== "super_admin") fail(403, "Super admin only");
      return data;
    case "tenders":
      if (!["admin", "super_admin"].includes(auth.role))
        fail(403, "Staff only");
      data.createdBy = auth.id;
      return data;
    case "settings":
      if (auth.role !== "super_admin") fail(403, "Super admin only");
      data.updatedBy = auth.id;
      return data;
    default:
      fail(405, "Collection cannot be created");
  }
}
async function preparePatch(req, name, record) {
  const auth = req.auth;
  const data = take(
    req.body,
    {
      projects: ["name", "county", "details"],
      properties: ["name", "location", "county", "units"],
      tenants: [],
      rentPayments: [],
      transactions: [],
      listings: ["title", "description", "price", "status"],
      bids: ["proposal", "amount"],
      deliverables: ["description", "workers", "status"],
      documents: ["title", "name", "visibility"],
      messages: ["read"],
      notifications: ["read"],
      tenders: ["description", "deadline", "status"],
      settings: ["value"],
    }[name] || [],
  );
  switch (name) {
    case "projects":
      if (
        auth.role === "super_admin" &&
        (req.body?.approvalStatus !== undefined ||
          req.body?.adminAssignments !== undefined ||
          req.body?.status === "Active")
      ) {
        if (req.body?.adminAssignments !== undefined) {
          if (record.approvalStatus !== "Approved")
            fail(409, "Approve project before allocation");
          if (
            !Array.isArray(req.body.adminAssignments) ||
            req.body.adminAssignments.length > 30
          )
            fail(400, "Invalid assignments");
          for (const a of req.body.adminAssignments) {
            const admin = await User.findOne({
              id: a.adminId,
              role: "admin",
              active: true,
            });
            if (!admin || !admin.profileCompleted)
              fail(
                409,
                "Assigned admin must be active and have a completed profile",
              );
            if (
              typeof a.responsibility !== "string" ||
              !a.responsibility.trim()
            )
              fail(400, "Assignment responsibility is required");
          }
          return {
            adminAssignments: req.body.adminAssignments.map((a) => ({
              adminId: a.adminId,
              adminName: a.adminName || "",
              responsibility: a.responsibility,
              assignedBy: auth.id,
              assignedAt: new Date(),
            })),
            status: "Active",
          };
        }
        if (
          record.approvalStatus !== "Pending" &&
          req.body?.approvalStatus !== undefined
        )
          fail(409, "Project already reviewed");
        if (
          req.body?.approvalStatus !== undefined &&
          !["Approved", "Rejected"].includes(req.body.approvalStatus)
        )
          fail(400, "Invalid decision");
        const decision =
          req.body.approvalStatus ||
          (req.body.status === "Active" ? "Approved" : null);
        if (decision)
          return {
            approvalStatus: decision,
            status:
              decision === "Rejected"
                ? "Rejected"
                : req.body.status === "Active"
                  ? "Active"
                  : "Approved",
            reviewedBy: auth.id,
            reviewedAt: new Date(),
            reviewReason: String(req.body.reviewReason || "").slice(0, 1000),
          };
      }
      await enforceProject(req, record.id);
      if (auth.role !== "client" || !same(record.ownerId, auth.id))
        fail(403, "Only the owner can edit draft project details");
      if (record.approvalStatus !== "Pending")
        fail(409, "Reviewed project cannot be edited");
      break;
    case "properties":
      await enforceProperty(req, record.id, true);
      break;
    case "tenants":
      if (req.body?.status === "Removal requested") {
        await enforceProperty(req, record.propertyId, true);
        if (record.status !== "Active") fail(409, "Tenant not active");
        return {
          status: "Removal requested",
          removalRequestedBy: auth.id,
          removalRequestedAt: new Date(),
          removalReason: String(req.body.removalReason || ""),
        };
      }
      if (
        ["Removed", "Active"].includes(req.body?.status) &&
        record.status === "Removal requested"
      ) {
        if (auth.role !== "super_admin")
          fail(403, "Super admin decision required");
        return {
          status: req.body.status,
          removalReviewedBy: auth.id,
          removalReviewedAt: new Date(),
        };
      }
      fail(403, "Use tenant removal workflow to change status");
    case "rentPayments":
      fail(403, "Use payment verification/reversal endpoints");
    case "transactions":
      fail(403, "Financial records are immutable; use adjustment entries");
    case "listings":
      if (
        req.body?.status &&
        ["Published", "Rejected"].includes(req.body.status) &&
        auth.role !== "admin" &&
        auth.role !== "super_admin"
      )
        fail(403, "Staff moderation required");
      if (
        auth.role !== "super_admin" &&
        auth.role !== "admin" &&
        !same(record.authorId, auth.id)
      )
        fail(403, "Listing access denied");
      break;
    case "bids":
      if (
        !same(record.contractorId, auth.id) ||
        record.status !== "Under review"
      )
        fail(403, "Bid cannot be edited");
      break;
    case "deliverables":
      await enforceProject(req, record.projectId);
      if (auth.role === "client") fail(403, "Client cannot edit site updates");
      break;
    case "documents":
      await enforceProject(req, record.projectId);
      if (!same(record.uploadedBy, auth.id) && auth.role !== "super_admin")
        fail(403, "Document access denied");
      break;
    case "messages":
      if (!same(record.toId, auth.id))
        fail(403, "Only recipient can mark read");
      break;
    case "notifications":
      if (!same(record.userId, auth.id))
        fail(403, "Notification access denied");
      break;
    case "tenders":
      if (!["admin", "super_admin"].includes(auth.role))
        fail(403, "Staff only");
      break;
    case "settings":
      if (auth.role !== "super_admin") fail(403, "Super admin only");
      break;
    default:
      fail(403, "Updates are not permitted");
  }
  if (!Object.keys(data).length)
    fail(
      400,
      "No permitted changes. Use dedicated approval or role endpoints.",
    );
  return data;
}
router.get(
  "/:collection",
  asyncRoute(async (req, res) => {
    const name = req.params.collection,
      Model = models[name];
    if (!Model) fail(404, "Unknown collection");
    if (["audit", "settings"].includes(name) && req.auth.role !== "super_admin")
      fail(403, "Restricted collection");
    const [projects, properties, tenants] = await all();
    // Bounded query to avoid inadvertent full database downloads.
    const rows = await Model.find().sort({ createdAt: -1 }).limit(1000);
    const filtered = visible(
      req.auth,
      name,
      rows,
      projects,
      properties,
      tenants,
    ).map(clean);
    res.json({ items: filtered, count: filtered.length, limit: 1000 });
  }),
);
router.get(
  "/:collection/:id",
  asyncRoute(async (req, res) => {
    const name = req.params.collection,
      Model = models[name];
    if (!Model) fail(404, "Unknown collection");
    const [projects, properties, tenants] = await all();
    const row = await Model.findOne({ id: idOr400(req.params.id) });
    if (!row) fail(404, "Record not found");
    if (!visible(req.auth, name, [row], projects, properties, tenants).length)
      fail(403, "Access denied");
    res.json({ data: clean(row) });
  }),
);
router.post(
  "/:collection",
  asyncRoute(async (req, res) => {
    const name = req.params.collection,
      Model = models[name];
    if (!Model) fail(404, "Unknown collection");
    if (noWrites.has(name))
      fail(403, "Use dedicated endpoints for this collection");
    const data = await prepareCreate(req, name);
    // Client supplied ids are accepted for UI correlation only; never client supplied owner/privilege fields.
    if (req.body?.id && /^[A-Za-z0-9_-]{4,96}$/.test(String(req.body.id)))
      data.id = req.body.id;
    let saved;
    try {
      saved = await Model.create(data);
    } catch (e) {
      if (e.code === 11000)
        fail(409, "Duplicate identifier or receipt reference");
      throw e;
    }
    await logAction(req, "CREATE_" + name.toUpperCase(), name, saved.id);
    res.status(201).json({ data: clean(saved) });
  }),
);
router.patch(
  "/:collection/:id",
  asyncRoute(async (req, res) => {
    const name = req.params.collection,
      Model = models[name];
    if (!Model) fail(404, "Unknown collection");
    if (name === "users") {
      const u = await User.findOne({ id: req.params.id });
      if (!u) fail(404, "User not found");
      if (req.body?.role !== undefined) {
        if (req.auth.role !== "super_admin")
          fail(403, "Only super admin may convert roles");
        if (same(req.auth.id, u.id) || u.role === "super_admin")
          fail(403, "Super admin cannot be changed here");
        if (
          !["client", "contractor", "admin", "tenant"].includes(req.body.role)
        )
          fail(400, "Invalid target role");
        const before = u.role;
        u.role = req.body.role;
        u.tokenVersion++;
        u.refreshTokenHashes = [];
        if (u.role === "admin" && before !== "admin") {
          u.profileCompleted = false;
          u.specialties = [];
          u.specializations = [];
        }
        await u.save();
        await logAction(req, "ROLE_CHANGED", "users", u.id, {
          before,
          after: u.role,
        });
        return res.json({ data: clean(u) });
      }
      if (!same(req.auth.id, u.id))
        fail(403, "Only account owner may update profile");
      const data = take(req.body, profileFields.concat(["profileCompleted"]));
      delete data.profileCompleted;
      if (req.auth.role !== "admin")
        for (const field of [
          "specialties",
          "specializations",
          "otherSpecialty",
          "yearsExperience",
          "experience",
          "qualifications",
          "professionalRegistration",
          "professionalBio",
        ])
          delete data[field];
      Object.assign(u, data);
      if (
        req.auth.role === "admin" &&
        (u.specialties.length || u.otherSpecialty)
      )
        u.profileCompleted = true;
      await u.save();
      await logAction(req, "PROFILE_UPDATED", "users", u.id);
      return res.json({ data: clean(u) });
    }
    const row = await Model.findOne({ id: idOr400(req.params.id) });
    if (!row) fail(404, "Record not found");
    const patch = await preparePatch(req, name, row);
    Object.assign(row, patch);
    await row.save();
    await logAction(
      req,
      "UPDATE_" + name.toUpperCase(),
      name,
      row.id,
      Object.keys(patch),
    );
    res.json({ data: clean(row) });
  }),
);
export default router;
