-- Bharat BaaS: make complaint raise race-safe (R review #1, docs/agents/R.md).
-- Idempotent: safe to run more than once. Additive only (indexes, no table changes).
-- nbbl/api.raiseComplaint and cou/api.raiseComplaint catch unique_violation (23505) on these
-- and return the existing open complaint / ticket.

-- At most one OPEN complaint per (COU, order, reason). A CLOSED one does not block a new raise.
create unique index if not exists nbbl_complaints_open_uq
  on nbbl_complaints (cou_id, order_id, reason)
  where status = 'OPEN';

-- One COU ticket per NBBL complaint.
create unique index if not exists cou_complaints_complaint_uq
  on cou_complaints (complaint_id);
