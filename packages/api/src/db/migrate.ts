/**
 * Database Migration
 *
 * Creates all required database tables using SQLite.
 * This runs before the server starts to ensure tables exist.
 */

import Database from "better-sqlite3";
import { config } from "../lib/config";

export function runMigrations(dbPath: string = config.dbPath): void {
  console.log("🔧 Running database migrations...");
  
  const db = new Database(dbPath);
  
  try {
    // Enable foreign keys
    db.exec("PRAGMA foreign_keys = ON;");
    
    // Better Auth user table
    db.exec(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL UNIQUE,
        "email_verified" INTEGER DEFAULT 0 NOT NULL,
        "image" TEXT,
        "role" TEXT DEFAULT 'member' NOT NULL,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL
      );
    `);

    // Better Auth session table
    db.exec(`
      CREATE TABLE IF NOT EXISTS "session" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT NOT NULL,
        "token" TEXT NOT NULL UNIQUE,
        "expires_at" INTEGER NOT NULL,
        "ip_address" TEXT,
        "user_agent" TEXT,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
      );
    `);

    // Better Auth account table
    db.exec(`
      CREATE TABLE IF NOT EXISTS "account" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "user_id" TEXT NOT NULL,
        "account_id" TEXT NOT NULL,
        "provider_id" TEXT NOT NULL,
        "access_token" TEXT,
        "refresh_token" TEXT,
        "access_token_expires_at" INTEGER,
        "refresh_token_expires_at" INTEGER,
        "scope" TEXT,
        "id_token" TEXT,
        "password" TEXT,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
      );
    `);

    // Better Auth verification table
    db.exec(`
      CREATE TABLE IF NOT EXISTS "verification" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "identifier" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "expires_at" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL
      );
    `);

    // Application: images table
    db.exec(`
      CREATE TABLE IF NOT EXISTS "images" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "reference" TEXT NOT NULL UNIQUE,
        "kernel_path" TEXT NOT NULL,
        "rootfs_path" TEXT NOT NULL,
        "size_bytes" INTEGER,
        "pulled_at" INTEGER NOT NULL
      );
    `);

    // Application: VMs table
    db.exec(`
      CREATE TABLE IF NOT EXISTS "vms" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "name" TEXT NOT NULL UNIQUE,
        "status" TEXT DEFAULT 'creating' NOT NULL,
        "vcpus" INTEGER DEFAULT 1 NOT NULL,
        "memory_mib" INTEGER DEFAULT 512 NOT NULL,
        "image_id" TEXT,
        "pid" INTEGER,
        "socket_path" TEXT,
        "tap_device" TEXT,
        "mac_address" TEXT,
        "ip_address" TEXT,
        "created_at" INTEGER NOT NULL,
        "updated_at" INTEGER NOT NULL,
        FOREIGN KEY ("image_id") REFERENCES "images"("id")
      );
    `);

    // Create indexes for better performance
    db.exec(`CREATE INDEX IF NOT EXISTS idx_session_user_id ON "session"("user_id");`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_account_user_id ON "account"("user_id");`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vms_status ON "vms"("status");`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vms_image_id ON "vms"("image_id");`);
    
    console.log("✅ Database migrations complete");
  } finally {
    db.close();
  }
}
