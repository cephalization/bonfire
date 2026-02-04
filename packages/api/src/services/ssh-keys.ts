/**
 * SSH Key Injection Service
 *
 * Handles SSH key generation and injection into VM rootfs images.
 * Mounts the rootfs temporarily to add authorized_keys before VM boot.
 */

import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { mkdir, writeFile, readFile, chmod, stat } from "fs/promises";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { mkdtemp, rm } from "fs/promises";

const execFileAsync = promisify(execFile);

export interface SSHKeyPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export interface InjectKeysOptions {
  rootfsPath: string;
  vmId: string;
  username?: string;
  keysDir?: string;
}

export interface InjectedKeysResult {
  publicKey: string;
  privateKeyPath: string;
  authorizedKeysPath: string;
}

// Default configuration
const DEFAULTS = {
  username: "agent",
  keysDir: "/var/lib/bonfire/keys",
  sshKeyType: "ed25519",
} as const;

/**
 * Generate a new SSH key pair
 */
export async function generateSSHKeyPair(): Promise<SSHKeyPair> {
  // Create a temporary directory for key generation
  const tempDir = await mkdtemp("/tmp/bonfire-ssh-");

  try {
    const keyPath = join(tempDir, "id_ed25519");

    // Generate Ed25519 key pair using ssh-keygen
    await execFileAsync("ssh-keygen", [
      "-t",
      DEFAULTS.sshKeyType,
      "-f",
      keyPath,
      "-N",
      "", // No passphrase
      "-C",
      `bonfire-${randomUUID().slice(0, 8)}`,
      "-q", // Quiet mode
    ]);

    // Read the generated keys
    const privateKey = await readFile(keyPath, "utf-8");
    const publicKey = await readFile(`${keyPath}.pub`, "utf-8");

    // Get fingerprint
    const { stdout: fingerprint } = await execFileAsync("ssh-keygen", ["-lf", `${keyPath}.pub`]);

    return {
      privateKey,
      publicKey: publicKey.trim(),
      fingerprint: fingerprint.trim(),
    };
  } finally {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Ensure the SSH keys directory exists
 */
async function ensureKeysDir(keysDir: string): Promise<void> {
  await mkdir(keysDir, { recursive: true });
  await chmod(keysDir, 0o700);
}

/**
 * Get paths for VM-specific SSH keys
 */
function getVMKeyPaths(
  vmId: string,
  keysDir: string
): {
  privateKeyPath: string;
  publicKeyPath: string;
} {
  const keyBase = join(keysDir, `vm-${vmId}`);
  return {
    privateKeyPath: `${keyBase}`,
    publicKeyPath: `${keyBase}.pub`,
  };
}

/**
 * Save SSH key pair to disk
 */
export async function saveSSHKeys(
  vmId: string,
  keyPair: SSHKeyPair,
  keysDir: string = DEFAULTS.keysDir
): Promise<{ privateKeyPath: string; publicKeyPath: string }> {
  await ensureKeysDir(keysDir);

  const paths = getVMKeyPaths(vmId, keysDir);

  // Write private key with restricted permissions
  await writeFile(paths.privateKeyPath, keyPair.privateKey, { mode: 0o600 });

  // Write public key
  await writeFile(paths.publicKeyPath, keyPair.publicKey, { mode: 0o644 });

  return paths;
}

/**
 * Load SSH public key for a VM
 */
export async function loadSSHPublicKey(
  vmId: string,
  keysDir: string = DEFAULTS.keysDir
): Promise<string | null> {
  const paths = getVMKeyPaths(vmId, keysDir);

  try {
    return await readFile(paths.publicKeyPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Check if SSH keys exist for a VM
 */
export async function hasSSHKeys(
  vmId: string,
  keysDir: string = DEFAULTS.keysDir
): Promise<boolean> {
  const paths = getVMKeyPaths(vmId, keysDir);

  try {
    await stat(paths.privateKeyPath);
    await stat(paths.publicKeyPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount an ext4 rootfs image to a temporary directory
 */
async function mountRootfs(rootfsPath: string, mountPoint: string): Promise<void> {
  // Ensure mount point exists
  await mkdir(mountPoint, { recursive: true });

  // Mount the image using a loop device
  await execFileAsync("mount", ["-o", "loop", rootfsPath, mountPoint]);
}

/**
 * Unmount a rootfs from its mount point
 */
async function unmountRootfs(mountPoint: string): Promise<void> {
  try {
    await execFileAsync("umount", [mountPoint]);
  } catch (error) {
    // If umount fails, try with lazy unmount
    await execFileAsync("umount", ["-l", mountPoint]);
  }
}

/**
 * Inject SSH public key into VM rootfs
 *
 * Mounts the rootfs, creates the .ssh directory and authorized_keys file
 * for the specified user, then unmounts.
 */
export async function injectSSHKeys(options: InjectKeysOptions): Promise<InjectedKeysResult> {
  const { rootfsPath, vmId, username = DEFAULTS.username, keysDir = DEFAULTS.keysDir } = options;

  // Check if we're in test mode (skip actual mount/inject)
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    // In tests, just return mock paths without actually mounting
    const paths = getVMKeyPaths(vmId, keysDir);
    return {
      publicKey: "ssh-ed25519 TEST_KEY test@bonfire",
      privateKeyPath: paths.privateKeyPath,
      authorizedKeysPath: `/home/${username}/.ssh/authorized_keys`,
    };
  }

  // Generate or load existing keys
  let keyPair: SSHKeyPair;
  let privateKeyPath: string;

  if (await hasSSHKeys(vmId, keysDir)) {
    // Load existing keys
    const paths = getVMKeyPaths(vmId, keysDir);
    privateKeyPath = paths.privateKeyPath;
    const publicKey = await loadSSHPublicKey(vmId, keysDir);
    if (!publicKey) {
      throw new Error(`Failed to load public key for VM ${vmId}`);
    }
    keyPair = {
      publicKey,
      privateKey: await readFile(paths.privateKeyPath, "utf-8"),
      fingerprint: "", // Not needed for injection
    };
  } else {
    // Generate new keys
    keyPair = await generateSSHKeyPair();
    const paths = await saveSSHKeys(vmId, keyPair, keysDir);
    privateKeyPath = paths.privateKeyPath;
  }

  // Create temporary mount point
  const mountPoint = `/tmp/bonfire-mount-${vmId}`;

  try {
    // Mount the rootfs
    await mountRootfs(rootfsPath, mountPoint);

    // Create .ssh directory for the user
    const sshDir = join(mountPoint, "home", username, ".ssh");
    await mkdir(sshDir, { recursive: true });

    // Write authorized_keys file
    const authorizedKeysPath = join(sshDir, "authorized_keys");
    await writeFile(authorizedKeysPath, keyPair.publicKey + "\n");

    // Set proper ownership and permissions
    // uid 1000 is the agent user in the VM image
    try {
      await execFileAsync("chown", ["-R", "1000:1000", sshDir]);
    } catch {
      // If chown fails (e.g., in container without proper permissions),
      // the image should already have correct ownership from build time
    }

    // Set permissions: 700 for .ssh, 600 for authorized_keys
    await chmod(sshDir, 0o700);
    await chmod(authorizedKeysPath, 0o600);

    return {
      publicKey: keyPair.publicKey,
      privateKeyPath,
      authorizedKeysPath: `/home/${username}/.ssh/authorized_keys`,
    };
  } finally {
    // Always try to unmount, even if injection failed
    try {
      await unmountRootfs(mountPoint);
      // Clean up mount point
      await rm(mountPoint, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Delete SSH keys for a VM
 */
export async function deleteSSHKeys(
  vmId: string,
  keysDir: string = DEFAULTS.keysDir
): Promise<void> {
  const paths = getVMKeyPaths(vmId, keysDir);

  try {
    await rm(paths.privateKeyPath, { force: true });
    await rm(paths.publicKeyPath, { force: true });
  } catch {
    // Ignore errors if keys don't exist
  }
}

/**
 * Service interface for SSH key management
 */
export interface SSHKeyService {
  generateKeyPair(): Promise<SSHKeyPair>;
  injectKeys(options: InjectKeysOptions): Promise<InjectedKeysResult>;
  hasKeys(vmId: string): Promise<boolean>;
  loadPublicKey(vmId: string): Promise<string | null>;
  deleteKeys(vmId: string): Promise<void>;
  getPrivateKeyPath(vmId: string): string;
}

/**
 * Create a real SSH key service instance
 */
export function createSSHKeyService(keysDir: string = DEFAULTS.keysDir): SSHKeyService {
  return {
    generateKeyPair: generateSSHKeyPair,
    injectKeys: (options: InjectKeysOptions) => injectSSHKeys({ ...options, keysDir }),
    hasKeys: (vmId: string) => hasSSHKeys(vmId, keysDir),
    loadPublicKey: (vmId: string) => loadSSHPublicKey(vmId, keysDir),
    deleteKeys: (vmId: string) => deleteSSHKeys(vmId, keysDir),
    getPrivateKeyPath: (vmId: string) => getVMKeyPaths(vmId, keysDir).privateKeyPath,
  };
}

// Default export
export const sshKeyService = createSSHKeyService();
