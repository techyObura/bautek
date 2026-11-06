import mongoose from "mongoose";
import app from "./app.js";
import { config, validateConfig } from "./config.js";
validateConfig();
await mongoose.connect(config.mongo, { serverSelectionTimeoutMS: 10000 });
const server = app.listen(config.port, () =>
  console.log(`Bautek API listening on http://localhost:${config.port}/api/v1`),
);
const shutdown = async () => {
  server.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
