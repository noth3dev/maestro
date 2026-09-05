import { createPublicKey, sign, verify, type KeyLike } from "node:crypto";
import { assertValidDeviceGrantEnvelope, type DeviceGrantEnvelope } from "@maestro/domain";

export type UnsignedDeviceGrantEnvelope = Omit<DeviceGrantEnvelope, "signature">;

/** Canonical field order is part of the wire signature contract. */
export function canonicalDeviceGrantEnvelope(value: UnsignedDeviceGrantEnvelope): string {
  return JSON.stringify({
    version: value.version, grantId: value.grantId, commandId: value.commandId, goalId: value.goalId,
    projectId: value.projectId, deviceId: value.deviceId, action: value.action, target: value.target,
    projectPath: value.projectPath, application: value.application, dataResource: value.dataResource,
    networkTarget: value.networkTarget, policyVersion: value.policyVersion, goalFencingToken: value.goalFencingToken,
    sequence: value.sequence, issuedAt: value.issuedAt, expiresAt: value.expiresAt, nonce: value.nonce,
    issuerKeyId: value.issuerKeyId,
  });
}

export function signDeviceGrantEnvelope(value: UnsignedDeviceGrantEnvelope, privateKey: KeyLike): DeviceGrantEnvelope {
  const signature = sign(null, Buffer.from(canonicalDeviceGrantEnvelope(value), "utf8"), privateKey).toString("base64url");
  const envelope = { ...value, signature };
  assertValidDeviceGrantEnvelope(envelope);
  return envelope;
}

export function verifyDeviceGrantEnvelope(envelope: DeviceGrantEnvelope, publicKey: KeyLike | string | Buffer): boolean {
  assertValidDeviceGrantEnvelope(envelope);
  const { signature: _signature, ...unsigned } = envelope;
  try {
    const key = typeof publicKey === "string" || Buffer.isBuffer(publicKey) ? createPublicKey(publicKey) : publicKey;
    return verify(null, Buffer.from(canonicalDeviceGrantEnvelope(unsigned), "utf8"), key, Buffer.from(envelope.signature, "base64url"));
  } catch {
    return false;
  }
}
