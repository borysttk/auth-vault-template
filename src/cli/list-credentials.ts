#!/usr/bin/env node

import { listCredentials } from "../credentials/vault.js";
import { getConfig } from "../config.js";

getConfig();

const entries = await listCredentials();
console.log(JSON.stringify(entries, null, 2));
