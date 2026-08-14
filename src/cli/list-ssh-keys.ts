#!/usr/bin/env node

import { listSSHKeys } from "../ssh/vault.js";
import { getConfig } from "../config.js";

getConfig();

const entries = await listSSHKeys();
console.log(JSON.stringify(entries, null, 2));
