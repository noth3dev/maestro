import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DiscordAuthenticationError, DiscordFreshnessError, DiscordReplayError, deriveDiscordIncidentFingerprint, signDiscordSignal, verifyDiscordSignal, type DiscordSignal } from "@maestro/domain";
import { createDiscord, createHttpDelivery, resolveDelivery } from "./main.js";
const signal=(overrides:Partial<DiscordSignal>={}):DiscordSignal=>{const now=Date.now(); const value:DiscordSignal={incidentFingerprint:"",firstObservedAt:new Date(now-2000).toISOString(),lastObservedAt:new Date(now-1000).toISOString(),severity:"warning",confidence:.9,affectedComponent:"control-plane",affectedVersion:"1.0.0",minimalReproductionEvidence:["GET /health -> 503"],source:"health-probe",sourceFreshness:new Date(now-1000).toISOString(),deduplicationRelationship:"new",discordHealthState:"healthy",...overrides}; return {...value,incidentFingerprint:deriveDiscordIncidentFingerprint(value)};};
describe("Discord authentication",()=>{it("rejects tampering, stale timestamps, and replay",()=>{const issuedAt=new Date(Date.now()+1000).toISOString(); const now=Date.parse(issuedAt)+5000; const e=signDiscordSignal(signal(),"secret","n1",1,issuedAt); const state=verifyDiscordSignal(e,"secret",now,10_000); expect(()=>verifyDiscordSignal({...e,signal:{...e.signal,severity:"critical"}},"secret",now,10_000)).toThrow(DiscordAuthenticationError); expect(()=>verifyDiscordSignal(e,"secret",now+20_000,10_000)).toThrow(DiscordFreshnessError); expect(()=>verifyDiscordSignal(e,"secret",now,10_000,state)).toThrow(DiscordReplayError);});});
describe("Discord durable buffer",()=>{it("buffers during outage and delivers after recovery",async()=>{const path=join(await mkdtemp(join(tmpdir(),"discord-")),"buffer.jsonl"); let healthy=false; const delivered:string[]=[]; const f=createDiscord({bufferPath:path,credential:"x",flushIntervalMs:100,freshnessWindowMs:100000},{deliver:async e=>{if(!healthy) throw new Error("down"); delivered.push(e.nonce);}}); const e=signDiscordSignal(signal(),"x","n1",1); await f.emit(e); expect(f.pendingCount()).toBe(1); healthy=true; await f.flush(); expect(delivered).toEqual(["n1"]); expect(f.pendingCount()).toBe(0); const lines=(await readFile(path,"utf8")).trim().split("\n"); expect(lines).toHaveLength(2);});});

describe("Discord emission validation",()=>{it("rejects a tampered envelope before buffering or delivery",async()=>{const path=join(await mkdtemp(join(tmpdir(),"discord-")),"buffer.jsonl"); let deliveries=0; const f=createDiscord({bufferPath:path,credential:"x",flushIntervalMs:100,freshnessWindowMs:100000},{deliver:async()=>{deliveries+=1;}}); const e=signDiscordSignal(signal(),"x",randomUUID(),1); const tampered={...e,signal:{...e.signal,severity:"critical" as const}}; await expect(f.emit(tampered)).rejects.toThrow(DiscordAuthenticationError); expect(f.pendingCount()).toBe(0); expect(deliveries).toBe(0); await expect(readFile(path,"utf8")).rejects.toThrow();});});

describe("Discord concurrent buffering",()=>{it("flushes a signal emitted while another delivery is in flight",async()=>{const path=join(await mkdtemp(join(tmpdir(),"discord-")),"buffer.jsonl"); const delivered:string[]=[]; let release!:()=>void; const blocked=new Promise<void>(resolve=>{release=resolve;}); let started!:()=>void; const firstStarted=new Promise<void>(resolve=>{started=resolve;}); const f=createDiscord({bufferPath:path,credential:"x",flushIntervalMs:100,freshnessWindowMs:100000},{deliver:async e=>{delivered.push(e.nonce); if(e.nonce==="n1"){started(); await blocked;}}}); const first=f.emit(signDiscordSignal(signal(),"x","n1",1)); await firstStarted; const second=f.emit(signDiscordSignal(signal(),"x","n2",2)); release(); await Promise.all([first,second]); expect(delivered).toEqual(["n1","n2"]); expect(f.pendingCount()).toBe(0);});});


describe("Discord buffer privacy",()=>{it("redacts secret-like evidence before the local append-only buffer",async()=>{const path=join(await mkdtemp(join(tmpdir(),"discord-")),"buffer.jsonl"); const secret="buffer-secret-value"; const f=createDiscord({bufferPath:path,credential:"x",flushIntervalMs:100,freshnessWindowMs:100000},{deliver:async()=>{throw new Error("down");}}); await f.emit(signDiscordSignal(signal({minimalReproductionEvidence:[`Authorization: Bearer ${secret}`,`token=${secret}`,"safe evidence"]}),"x","privacy",1)); const text=await readFile(path,"utf8"); expect(text).not.toContain(secret); expect(text).toContain("[REDACTED]"); expect(text).toContain("safe evidence");});});


describe("Discord HTTP delivery adapter", () => {
  it("POSTs the exact signed envelope to /v1/discord/signals with the configured bearer token", async () => {
    const e = signDiscordSignal(signal(), "x", "n1", 1);
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    const delivery = createHttpDelivery("http://127.0.0.1:4310", "op-secret", fetchStub);
    await delivery.deliver(e);

    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:4310/v1/discord/signals");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer op-secret");
    expect(JSON.parse(String(init?.body))).toEqual(e);
  });

  it("throws on a non-2xx response instead of silently dropping the signal", async () => {
    const e = signDiscordSignal(signal(), "x", "n1", 1);
    const fetchStub = (async () => new Response(null, { status: 401 })) as typeof fetch;
    const delivery = createHttpDelivery("http://127.0.0.1:4310", "bad-secret", fetchStub);
    await expect(delivery.deliver(e)).rejects.toThrow("HTTP 401");
  });
});

describe("Discord delivery resolution", () => {
  it("fails closed with a clear message when no target is configured", async () => {
    const e = signDiscordSignal(signal(), "x", "n1", 1);
    const delivery = resolveDelivery({ bufferPath: "/tmp/unused", credential: "x", flushIntervalMs: 1000, freshnessWindowMs: 100000 });
    await expect(delivery.deliver(e)).rejects.toThrow("No delivery transport configured");
  });

  it("builds a real HTTP delivery once both target settings are configured", () => {
    const delivery = resolveDelivery({ bufferPath: "/tmp/unused", credential: "x", flushIntervalMs: 1000, freshnessWindowMs: 100000, targetApiUrl: "http://127.0.0.1:4310", targetApiToken: "op-secret" });
    expect(delivery).toBeDefined();
  });
});
