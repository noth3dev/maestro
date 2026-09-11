export type CapacityResource = "provider_rate" | "spend_cents" | "worker_slots";
export type CapacityQueueReason = CapacityResource;
export type CapacityRequirement = "low" | "medium" | "high";
export type CapacityPressure = "normal" | "elevated" | "critical";
export interface CapacityDemand { readonly goalId: string; readonly projectId: string; readonly commandId: string; readonly providerRate: number; readonly spendCents: number; readonly workerSlots: number; readonly requirement: CapacityRequirement; readonly pressure: CapacityPressure; readonly priority?: number; readonly actorId?: string; readonly sessionRef?: string; readonly fencingToken?: string; readonly admission?: { readonly councilId: string; readonly departmentId: string; readonly planVersion: number; readonly itemId: string; readonly operatorId: string; readonly credentialId: string; readonly model?: string; readonly repositoryPath?: string; readonly worktreePath?: string; }; }
export interface CapacityReservation extends CapacityDemand { readonly reservationId: string; readonly status: "reserved" | "released"; readonly queuedAt: number; }
export interface QueuedCapacityDemand extends CapacityDemand { readonly queueId: string; readonly queuedAt: number; }
export interface CapacityInventory { readonly providerRate: number; readonly spendCents: number; readonly workerSlots: number; readonly providerRateFloor: number; readonly spendCentsFloor: number; readonly workerSlotsFloor: number; readonly reservations: Map<string, CapacityReservation>; readonly queue: QueuedCapacityDemand[]; readonly releasedReservationIds: Set<string>; readonly history: Map<string, CapacityReservation | QueuedCapacityDemand>; readonly nextSequence: { value: number }; }
export type CapacityAdmission =
  | { readonly kind: "reserved"; readonly reservation: CapacityReservation }
  | { readonly kind: "queued"; readonly reason: CapacityQueueReason; readonly demand: CapacityDemand; readonly queueId: string }
  | { readonly kind: "replayed"; readonly reservation: CapacityReservation | QueuedCapacityDemand };
function positive(value: number, name: string, allowZero = false): void { if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be a ${allowZero ? "nonnegative" : "positive"} safe integer`); }
export function createCapacityInventory(input: { providerRate: number; spendCents: number; workerSlots: number; providerRateFloor?: number; spendCentsFloor?: number; workerSlotsFloor?: number }): CapacityInventory {
  positive(input.providerRate, "providerRate", true); positive(input.spendCents, "spendCents", true); positive(input.workerSlots, "workerSlots", true);
  const floors = { providerRateFloor: input.providerRateFloor ?? 0, spendCentsFloor: input.spendCentsFloor ?? 0, workerSlotsFloor: input.workerSlotsFloor ?? 0 };
  for (const [key, floor, capacity] of [["providerRateFloor", floors.providerRateFloor, input.providerRate], ["spendCentsFloor", floors.spendCentsFloor, input.spendCents], ["workerSlotsFloor", floors.workerSlotsFloor, input.workerSlots]] as const) { positive(floor, key, true); if (floor > capacity) throw new Error(`${key} cannot exceed capacity`); }
  return { ...input, ...floors, reservations: new Map(), queue: [], releasedReservationIds: new Set(), history: new Map(), nextSequence: { value: 0 } };
}
export function capacityDemand(input: CapacityDemand): CapacityDemand { positive(input.providerRate, "providerRate"); positive(input.spendCents, "spendCents"); positive(input.workerSlots, "workerSlots"); if (!input.goalId.trim() || !input.projectId.trim() || !input.commandId.trim()) throw new Error("Capacity demand identities are required"); if (input.priority !== undefined) positive(input.priority, "priority", true); return { ...input }; }
function used(inventory: CapacityInventory, key: "providerRate" | "spendCents" | "workerSlots"): number { return [...inventory.reservations.values()].reduce((total, reservation) => total + reservation[key], 0); }
function reasonFor(inventory: CapacityInventory, demand: CapacityDemand): CapacityQueueReason | undefined {
  if (used(inventory, "providerRate") + demand.providerRate > inventory.providerRate - inventory.providerRateFloor) return "provider_rate";
  if (used(inventory, "spendCents") + demand.spendCents > inventory.spendCents - inventory.spendCentsFloor) return "spend_cents";
  if (used(inventory, "workerSlots") + demand.workerSlots > inventory.workerSlots - inventory.workerSlotsFloor) return "worker_slots";
  return undefined;
}
export function reserveCapacity(inventory: CapacityInventory, input: CapacityDemand): CapacityAdmission {
  const demand = capacityDemand(input); const existing = inventory.history.get(demand.commandId) ?? [...inventory.reservations.values()].find((row) => row.commandId === demand.commandId) ?? inventory.queue.find((row) => row.commandId === demand.commandId);
  if (existing !== undefined) return { kind: "replayed", reservation: existing };
  const reason = reasonFor(inventory, demand); if (reason !== undefined) { const queueId = `${demand.goalId}:${demand.commandId}`; const queued = { ...demand, queueId, queuedAt: inventory.nextSequence.value++ }; inventory.queue.push(queued); inventory.history.set(demand.commandId, queued); return { kind: "queued", reason, demand, queueId }; }
  const reservation: CapacityReservation = { ...demand, reservationId: `${demand.goalId}:${demand.commandId}`, queuedAt: inventory.nextSequence.value++, status: "reserved" }; inventory.reservations.set(reservation.reservationId, reservation); inventory.history.set(demand.commandId, reservation); return { kind: "reserved", reservation };
}
export function releaseCapacity(inventory: CapacityInventory, reservation: CapacityReservation): boolean { if (!inventory.reservations.delete(reservation.reservationId)) return false; inventory.releasedReservationIds.add(reservation.reservationId); inventory.history.set(reservation.commandId, { ...reservation, status: "released" }); return true; }
export function claimQueuedCapacity(inventory: CapacityInventory): readonly CapacityReservation[] {
  const claimed: CapacityReservation[] = []; const pending = [...inventory.queue].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.queuedAt - b.queuedAt);
  for (const queued of pending) { if (reasonFor(inventory, queued) !== undefined) continue; const reservation: CapacityReservation = { ...queued, reservationId: queued.queueId, status: "reserved" }; delete (reservation as { queueId?: string }).queueId; inventory.reservations.set(reservation.reservationId, reservation); inventory.history.set(reservation.commandId, reservation); inventory.queue.splice(inventory.queue.indexOf(queued), 1); claimed.push(reservation); }
  return claimed;
}
