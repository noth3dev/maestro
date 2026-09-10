-- Add the durable below-requirement routing rule without changing an applied migration checksum.
ALTER TABLE metronome_findings DROP CONSTRAINT IF EXISTS metronome_findings_rule_id_check;
ALTER TABLE metronome_findings ADD CONSTRAINT metronome_findings_rule_id_check
  CHECK (rule_id IN ('stale_worker_superseded_plan', 'worker_missing_plan_item', 'missing_evidence_reference', 'device_command_unknown_outcome', 'below_requirement_routing'));
