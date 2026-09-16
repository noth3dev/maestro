#!/usr/bin/env node
if (process.argv[2] === "failed scenario") setTimeout(() => process.exit(0), 1000);
else process.exit(0);
