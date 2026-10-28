-- Migration 016: upload consent is a recorded account state.
-- The service now refuses an upload from an account with no account_state row, because only
-- POST /consent records consent. Accounts that already registered a device or stored a copy
-- consented on their Mac before that rule, so they get an open row at generation 0: their devices
-- send no generation header, which the service reads as 0, so they keep uploading unchanged.

ALTER TABLE account_state DROP CONSTRAINT account_state_generation_check;
ALTER TABLE account_state ADD CONSTRAINT account_state_generation_check CHECK (generation>=0);

INSERT INTO account_state(owner_id,generation,uploads_allowed)
 SELECT owner_id,0,true FROM account_devices
 UNION SELECT owner_id,0,true FROM meeting_lifecycle
 ON CONFLICT (owner_id) DO NOTHING;

INSERT INTO cloud_migrations VALUES (16);
