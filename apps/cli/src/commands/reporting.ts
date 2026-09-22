import { readFileSync } from "node:fs";
import type { CommandCtx } from "./ctx.js";
import { printEvents, printState } from "./ctx.js";

export async function runReportingCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "metronome-challenges" && action === "list") { const result = await ctx.client.listMetronomeChallenges(ctx.string("goal-id"), { projectId: ctx.string("project-id") }); printState(ctx.io.stdout, result, ctx.json); return true; }
  if (resource === "encore-council" && action === "list") { const result = await ctx.client.listEncoreCouncilRounds(ctx.string("goal-id"), { projectId: ctx.string("project-id") }); printState(ctx.io.stdout, result, ctx.json); return true; }
  if (resource === "certifications" && action === "list") { const result = await ctx.client.listCertifications(ctx.string("goal-id"), { projectId: ctx.string("project-id") }); printState(ctx.io.stdout, result, ctx.json); return true; }
  if (resource === "concertmaster-report" && action === "generate") { const result = await ctx.client.generateConcertmasterReport(ctx.string("goal-id"), { projectId: ctx.string("project-id") }, ctx.string("command-id")); printState(ctx.io.stdout, result, ctx.json); return true; }
  if (resource === "concertmaster-report" && action === "get") { const result = await ctx.client.getConcertmasterReport(ctx.string("goal-id"), { projectId: ctx.string("project-id") }); printState(ctx.io.stdout, result, ctx.json); return true; }
  if (resource === "evidence" && action === "capture") {
    const contentFile = ctx.value("content-file");
    const contentBase64 = contentFile === undefined ? ctx.string("content-base64") : readFileSync(ctx.string("content-file")).toString("base64");
    if (contentFile !== undefined && ctx.value("content-base64") !== undefined) throw new Error("Use only one of --content-base64 or --content-file");
    const result = await ctx.client.captureEvidence(ctx.string("goal-id"), { projectId: ctx.string("project-id"), correlationId: ctx.string("correlation-id"), commandId: ctx.string("command-id"), kind: ctx.string("kind"), mediaType: ctx.string("media-type"), contentBase64 });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "evidence" && action === "dump") {
    const result = await ctx.client.getEvidenceDump(ctx.string("goal-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "events" && action === "list") {
    const page = await ctx.client.listEvents({ projectId: ctx.string("project-id"), after: ctx.value("after") === undefined ? "0" : ctx.string("after") });
    if (ctx.json) ctx.io.stdout(`${JSON.stringify(page)}\n`);
    else printEvents(ctx.io.stdout, page.events, page.nextCursor);
    return true;
  }
  return false;
}
