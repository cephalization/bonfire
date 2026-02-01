/**
 * Registry Service Module
 *
 * This module provides functionality for pulling OCI images from registries.
 */

export {
  RegistryService,
  createRegistryService,
  parseReference,
  generateImageId,
  createSafeDirName,
  getRegistryUrl,
  fetchManifest,
  fetchBlob,
  extractTarGz,
  ensureImagesDir,
  getImagePath,
  IMAGES_DIR,
  OCI_MEDIA_TYPES,
} from "./registry";

export type {
  ParsedReference,
  PullOptions,
  PullProgress,
  OCIDescriptor,
  OCIManifest,
  RegistryError,
  RegistryServiceConfig,
} from "./registry";
