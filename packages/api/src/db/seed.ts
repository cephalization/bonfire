/**
 * Database Seeding
 *
 * Seeds the database with initial data, including the admin user.
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { config } from "../lib/config";
import type { Auth } from "../lib/auth";

/**
 * Seed the initial admin user if configured and not already present.
 * This runs on server startup to ensure there's always an admin account.
 */
export async function seedInitialAdmin(
  db: BetterSQLite3Database<typeof schema>,
  auth: Auth
): Promise<void> {
  const { initialAdminEmail, initialAdminPassword, initialAdminName } = config;

  // Skip if admin credentials not configured
  if (!initialAdminEmail || !initialAdminPassword) {
    console.log("ℹ️  No INITIAL_ADMIN_EMAIL/PASSWORD configured, skipping admin seed");
    return;
  }

  try {
    // Try to create the user directly using Better Auth API
    // Better Auth will auto-create tables on first API call
    const response = await auth.api.signUpEmail({
      body: {
        email: initialAdminEmail,
        password: initialAdminPassword,
        name: initialAdminName,
      },
    });

    if (response) {
      // Update the user to have admin role
      await db
        .update(schema.user)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(schema.user.email, initialAdminEmail));

      console.log(`✅ Created initial admin user: ${initialAdminEmail}`);
    }
  } catch (error: any) {
    // If user already exists, Better Auth returns an error
    if (error?.message?.includes("User already exists") || 
        error?.body?.message?.includes("already exists")) {
      console.log(`ℹ️  Admin user ${initialAdminEmail} already exists`);
      
      // Ensure the user has admin role
      const existingUser = await db.query.user.findFirst({
        where: eq(schema.user.email, initialAdminEmail),
      });
      
      if (existingUser && existingUser.role !== "admin") {
        await db
          .update(schema.user)
          .set({ role: "admin", updatedAt: new Date() })
          .where(eq(schema.user.id, existingUser.id));
        console.log(`✅ Updated ${initialAdminEmail} to admin role`);
      }
      return;
    }
    
    console.error("❌ Failed to seed initial admin user:", error);
    // Don't throw - allow server to start even if seeding fails
  }
}
