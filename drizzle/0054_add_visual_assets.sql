CREATE TABLE `visual_assets` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `episode_id` text,
  `type` text DEFAULT 'scene' NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `prompt` text DEFAULT '' NOT NULL,
  `image_url` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `error_message` text DEFAULT '',
  `model_provider` text,
  `model_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `visual_assets_project_idx` ON `visual_assets` (`project_id`);
--> statement-breakpoint
CREATE INDEX `visual_assets_episode_idx` ON `visual_assets` (`episode_id`);
--> statement-breakpoint
CREATE INDEX `visual_assets_type_idx` ON `visual_assets` (`type`);
