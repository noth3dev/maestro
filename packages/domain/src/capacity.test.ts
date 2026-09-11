import { describe, expect, it } from "vitest";
import { capacityDemand, claimQueuedCapacity, createCapacityInventory, reserveCapacity, releaseCapacity } from "./capacity.js";

const inventory = () => createCapacityInventory({ providerRate: 2, spendCents: 100, workerSlots: 1 });
const demand = (goalId: string, commandId: string) => capacityDemand({ goalId, projectId: "00000000-0000-4000-8000-000000000001", commandId, providerRate: 1, spendCents: 40, workerSlots: 1, requirement: "high", pressure: "elevated" });

describe("capacity reservations", () => {
  it("reserves provider rate, spend, and worker slots per Goal", () => {
    const result = reserveCapacity(inventory(), demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(result.kind).toBe("reserved");
    if (result.kind !== "reserved") return;
    expect(result.reservation.providerRate).toBe(1);
    expect(result.reservation.spendCents).toBe(40);
    expect(result.reservation.workerSlots).toBe(1);
  });

  it("queues instead of degrading when any dimension is exhausted", () => {
    const current = inventory();
    const first = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(first.kind).toBe("reserved");
    const second = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"));
    expect(second).toMatchObject({ kind: "queued", reason: "worker_slots" });
  });

  it("preserves the declared requirement and pressure while queued", () => {
    const current = inventory();
    reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    const result = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"));
    expect(result).toMatchObject({ kind: "queued", reason: "worker_slots", demand: { requirement: "high", pressure: "elevated" } });
  });

  it("releases a reservation exactly once", () => {
    const current = inventory();
    const result = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(result.kind).toBe("reserved");
    if (result.kind !== "reserved") return;
    expect(releaseCapacity(current, result.reservation)).toBe(true);
    expect(releaseCapacity(current, result.reservation)).toBe(false);
  });

  it("queues a replayed command only once and remembers a released command", () => {
    const current = createCapacityInventory({ providerRate: 0, spendCents: 0, workerSlots: 0 });
    const first = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    const replay = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(first.kind).toBe("queued");
    expect(replay).toMatchObject({ kind: "replayed" });
  });

  it("replays a claimed queue entry as the reserved identity", () => {
    const current = createCapacityInventory({ providerRate: 2, spendCents: 100, workerSlots: 1 });
    const first = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(first.kind).toBe("reserved");
    if (first.kind !== "reserved") return;
    const queued = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"));
    expect(queued.kind).toBe("queued");
    releaseCapacity(current, first.reservation);
    const claimed = claimQueuedCapacity(current);
    expect(claimed).toHaveLength(1);
    expect(reserveCapacity(current, demand("00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"))).toMatchObject({ kind: "replayed", reservation: { status: "reserved" } });
  });

  it("does not consume a replayed command identity twice", () => {
    const current = inventory();
    const first = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    const replay = reserveCapacity(current, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(first.kind).toBe("reserved");
    expect(replay).toMatchObject({ kind: "replayed" });
  });
});
