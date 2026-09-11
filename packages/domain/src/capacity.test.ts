import { describe, expect, it } from "vitest";
import { capacityDemand, createCapacityInventory, reserveCapacity, releaseCapacity } from "./capacity.js";

const inventory = createCapacityInventory({ providerRate: 2, spendCents: 100, workerSlots: 1 });
const demand = (goalId: string, commandId: string) => capacityDemand({ goalId, projectId: "00000000-0000-4000-8000-000000000001", commandId, providerRate: 1, spendCents: 40, workerSlots: 1, requirement: "high", pressure: "elevated" });

describe("capacity reservations", () => {
  it("reserves provider rate, spend, and worker slots per Goal", () => {
    const result = reserveCapacity(inventory, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(result.kind).toBe("reserved");
    if (result.kind !== "reserved") return;
    expect(result.reservation.providerRate).toBe(1);
    expect(result.reservation.spendCents).toBe(40);
    expect(result.reservation.workerSlots).toBe(1);
  });

  it("queues instead of degrading when any dimension is exhausted", () => {
    const first = reserveCapacity(inventory, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(first.kind).toBe("reserved");
    const second = reserveCapacity(inventory, demand("00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"));
    expect(second).toMatchObject({ kind: "queued", reason: "worker_slots" });
  });

  it("preserves the declared requirement and pressure while queued", () => {
    const result = reserveCapacity(inventory, demand("00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"));
    expect(result.kind).toBe("reserved");
    if (result.kind !== "reserved") return;
    expect(result.reservation.requirement).toBe("high");
    expect(result.reservation.pressure).toBe("elevated");
  });

  it("releases a reservation exactly once", () => {
    const result = reserveCapacity(inventory, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(result.kind).toBe("reserved");
    if (result.kind !== "reserved") return;
    expect(releaseCapacity(inventory, result.reservation)).toBe(true);
    expect(releaseCapacity(inventory, result.reservation)).toBe(false);
  });

  it("does not consume a replayed command identity twice", () => {
    const first = reserveCapacity(inventory, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    const replay = reserveCapacity(inventory, demand("00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"));
    expect(first.kind).toBe("reserved");
    expect(replay).toMatchObject({ kind: "replayed" });
  });
});
