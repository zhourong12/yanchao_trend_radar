ALTER TABLE opportunity_feedback
  ADD COLUMN outcome_json JSON NULL AFTER evidence_url;
