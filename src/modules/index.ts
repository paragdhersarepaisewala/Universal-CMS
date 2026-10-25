import { moduleRegistry } from './registry.js';
import { blogModuleManifest } from './blog/index.js';
import { storeModuleManifest } from './store/index.js';

export function initializeModules(): void {
  moduleRegistry.registerManifest(blogModuleManifest);
  moduleRegistry.registerManifest(storeModuleManifest);
}

export * from './types.js';
export * from './registry.js';
export * from './guard.js';
