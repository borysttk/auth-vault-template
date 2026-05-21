#!/usr/bin/env node

import { listSecrets } from "../secrets/manager.js";
import { getConfig } from "../config.js";

getConfig();

const service = process.argv[2];
const entries = await listSecrets(service || undefined);
console.log(JSON.stringify(entries, null, 2));
