#!/usr/bin/env node

import { getCredentials } from "../credentials/vault.js";
import { getConfig } from "../config.js";

getConfig();

const id = process.argv[2];
if (!id) {
  console.error("Usage: npm run get-creds -- <credential-id>");
  process.exit(1);
}

const result = await getCredentials(id);
console.log(JSON.stringify(result, null, 2));
