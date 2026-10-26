import { moduleRegistry } from './registry.js';
import { blogModuleManifest } from './blog/index.js';
import { storeModuleManifest } from './store/index.js';
import { shippingModuleManifest } from './shipping/index.js';
import { digitalModuleManifest } from './digital/index.js';
import { donationModuleManifest } from './donations/index.js';

export function initializeModules(): void {
  moduleRegistry.registerManifest(blogModuleManifest);
  moduleRegistry.registerManifest(storeModuleManifest);
  moduleRegistry.registerManifest(shippingModuleManifest);
  moduleRegistry.registerManifest(digitalModuleManifest);
  moduleRegistry.registerManifest(donationModuleManifest);
  moduleRegistry.setModuleState('store', true);
  moduleRegistry.setModuleState('shipping', true);
  moduleRegistry.setModuleState('digital-delivery', true);
  moduleRegistry.setModuleState('donations', true);
}

export * from './types.js';
export * from './registry.js';
export * from './guard.js';
