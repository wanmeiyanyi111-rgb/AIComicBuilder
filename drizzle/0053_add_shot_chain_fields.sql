ALTER TABLE shots ADD COLUMN chain_group_id TEXT;
--> statement-breakpoint
ALTER TABLE shots ADD COLUMN chain_index INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE shots ADD COLUMN chain_total INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE shots ADD COLUMN prev_shot_id TEXT;
--> statement-breakpoint
ALTER TABLE shots ADD COLUMN inherit_prev_last_frame INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE shots ADD COLUMN original_duration INTEGER NOT NULL DEFAULT 0;
