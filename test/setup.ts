import { tmpdir } from "node:os";

// Integration fixtures create disposable repositories under the system temp
// directory. Production requires an explicit root; tests use the same
// bounded fixture root unless a caller provides one.
process.env.MAESTRO_WORKTREE_ROOT ??= tmpdir();
