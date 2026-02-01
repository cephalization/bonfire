CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`kernel_path` text NOT NULL,
	`rootfs_path` text NOT NULL,
	`size_bytes` integer,
	`pulled_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `images_reference_unique` ON `images` (`reference`);--> statement-breakpoint
CREATE TABLE `vms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`vcpus` integer DEFAULT 1 NOT NULL,
	`memory_mib` integer DEFAULT 512 NOT NULL,
	`image_id` text,
	`pid` integer,
	`socket_path` text,
	`tap_device` text,
	`mac_address` text,
	`ip_address` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vms_name_unique` ON `vms` (`name`);