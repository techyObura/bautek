import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { config, validateConfig } from "../src/config.js";
import {
  User,
  Project,
  Property,
  Tenant,
  RentPayment,
  Transaction,
} from "../src/models/index.js";
validateConfig();
await mongoose.connect(config.mongo);
const password = process.env.BOOTSTRAP_SUPERADMIN_PASSWORD,
  email = process.env.BOOTSTRAP_SUPERADMIN_EMAIL?.toLowerCase();
if (!email || !password || password.length < 12)
  throw new Error(
    "Set BOOTSTRAP_SUPERADMIN_EMAIL and a 12+ character BOOTSTRAP_SUPERADMIN_PASSWORD before running seed",
  );
if (!(await User.exists({ role: "super_admin" }))) {
  await User.create({
    name: "Bautek Director",
    email,
    role: "super_admin",
    passwordHash: await bcrypt.hash(password, 12),
  });
  console.log("Created initial super admin:", email);
} else console.log("Existing super admin found: skipped creation");
if (process.argv.includes("--demo")) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeding is forbidden in production");
  const account = async (role, name, address) => {
    let u = await User.findOne({ email: address });
    if (!u)
      u = await User.create({
        role,
        name,
        email: address,
        passwordHash: await bcrypt.hash("DemoPass12345!", 12),
        profileCompleted: role === "admin",
        specialties:
          role === "admin" ? ["Property management", "Land survey"] : [],
      });
    return u;
  };
  const client = await account("client", "Grace Achieng", "client@demo.bautek");
  const admin = await account("admin", "Mercy Wanjiku", "admin@demo.bautek");
  const tenant = await account(
    "tenant",
    "Bautek Demo Tenant",
    "tenant@demo.bautek",
  );
  const contractor = await account(
    "contractor",
    "Daniel Otieno",
    "contractor@demo.bautek",
  );
  let project = await Project.findOne({ name: "Demo Kisumu Apartments" });
  if (!project)
    project = await Project.create({
      name: "Demo Kisumu Apartments",
      type: "property",
      county: "Kisumu",
      ownerId: client.id,
      budget: 3000000,
      approvalStatus: "Approved",
      status: "Active",
      adminAssignments: [
        {
          adminId: admin.id,
          adminName: admin.name,
          responsibility: "Property management",
          assignedAt: new Date(),
        },
      ],
    });
  let property = await Property.findOne({ projectId: project.id });
  if (!property)
    property = await Property.create({
      name: "Demo Kisumu Apartments",
      projectId: project.id,
      ownerId: client.id,
      adminIds: [admin.id],
    });
  let tenancy = await Tenant.findOne({ userId: tenant.id });
  if (!tenancy)
    tenancy = await Tenant.create({
      userId: tenant.id,
      name: tenant.name,
      propertyId: property.id,
      unit: "A1",
      monthlyRent: 25000,
      leaseStart: "2026-10-01",
    });
  if (!(await RentPayment.exists({ reference: "DEMO-RENT-001" })))
    await RentPayment.create({
      tenantId: tenancy.id,
      propertyId: property.id,
      amount: 25000,
      date: "2026-10-05",
      reference: "DEMO-RENT-001",
      status: "Confirmed",
      source: "manual",
    });
  console.log(
    "Demo sample created. All demo users (except super admin) password: DemoPass12345!",
  );
}
await mongoose.disconnect();
