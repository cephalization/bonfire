CREATE TABLE `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author_kind` text NOT NULL,
	`external_id` text,
	`author_id` text,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_messages_conversation_created_idx` ON `conversation_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversation_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_participants_conversation_user_idx` ON `conversation_participants` (`conversation_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`created_by_id` text,
	`agent_vm_id` text,
	`agent_model` text,
	`agent_session_id` text,
	`agent_status` text DEFAULT 'offline' NOT NULL,
	`agent_error` text,
	`last_message_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_vm_id`) REFERENCES `vms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversations_organization_id_idx` ON `conversations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`label` text,
	`key_ciphertext` text NOT NULL,
	`key_hint` text NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_credentials_org_provider_idx` ON `provider_credentials` (`organization_id`,`provider_id`);--> statement-breakpoint
ALTER TABLE `vms` ADD `agent_password_ciphertext` text;