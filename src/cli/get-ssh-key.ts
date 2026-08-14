#!/usr/bin/env node

import { getSSHKey } from "../ssh/vault.js";
import { getConfig } from "../config.js";

getConfig();

const id = process.argv[2];
if (!id) {
  console.error("Usage: npm run get-ssh-key -- <ssh-key-id>");
  process.exit(1);
}

const result = await getSSHKey(id);
console.log(JSON.stringify(result, null, 2));
