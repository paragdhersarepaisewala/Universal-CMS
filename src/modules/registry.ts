import { ModuleManifest, ModuleStatus, ModuleAdminNavEntry } from './types.js';

export class ModuleRegistry {
  private static instance: ModuleRegistry;
  private manifests: Map<string, ModuleManifest> = new Map();
  private enabledState: Map<string, boolean> = new Map();

  private constructor() {
    this.registerCorePlaceholders();
  }

  public static getInstance(): ModuleRegistry {
    if (!ModuleRegistry.instance) {
      ModuleRegistry.instance = new ModuleRegistry();
    }
    return ModuleRegistry.instance;
  }

  // Pre-register always-on core modules per AGENTS.md section 4
  private registerCorePlaceholders(): void {
    const coreModuleNames = [
      'auth',
      'rbac',
      'settings',
      'theme',
      'media',
      'pages',
      'menus',
      'seo',
      'email',
      'cache',
      'audit',
    ];

    for (const name of coreModuleNames) {
      this.registerManifest({
        name,
        version: '0.1.0',
        description: `Core system module: ${name}`,
        isCore: true,
        permissions: [{ key: `core.${name}.manage`, description: `Manage ${name} module` }],
        adminNav: [
          {
            id: `core-${name}`,
            label: name.charAt(0).toUpperCase() + name.slice(1),
            route: `/admin/${name}`,
            permission: `core.${name}.view`,
            order: 10,
          },
        ],
        routesPrefix: `/${name}`,
      });
      this.enabledState.set(name, true);
    }
  }

  public registerManifest(manifest: ModuleManifest): void {
    this.manifests.set(manifest.name, manifest);
    if (manifest.isCore) {
      this.enabledState.set(manifest.name, true);
    } else if (!this.enabledState.has(manifest.name)) {
      this.enabledState.set(manifest.name, false);
    }
  }

  public isEnabled(moduleName: string): boolean {
    const manifest = this.manifests.get(moduleName);
    if (!manifest) {
      return false;
    }
    if (manifest.isCore) {
      return true;
    }
    return this.enabledState.get(moduleName) ?? false;
  }

  public isModuleEnabled(moduleName: string): boolean {
    return this.isEnabled(moduleName);
  }

  public setModuleState(moduleName: string, enabled: boolean): void {
    const manifest = this.manifests.get(moduleName);
    if (!manifest) {
      throw new Error(`Module '${moduleName}' not found.`);
    }

    if (manifest.isCore && !enabled) {
      throw new Error(`Core module '${moduleName}' cannot be disabled.`);
    }

    // Check if disabling causes broken dependencies in other enabled modules
    if (!enabled) {
      for (const [name, other] of this.manifests.entries()) {
        if (this.isEnabled(name) && other.dependsOn?.includes(moduleName)) {
          throw new Error(
            `Cannot disable '${moduleName}' because enabled module '${name}' depends on it.`
          );
        }
      }
    }

    // Check dependencies when enabling
    if (enabled && manifest.dependsOn) {
      for (const dep of manifest.dependsOn) {
        if (!this.isEnabled(dep)) {
          throw new Error(
            `Cannot enable '${moduleName}' because required dependency '${dep}' is disabled.`
          );
        }
      }
    }

    this.enabledState.set(moduleName, enabled);
  }

  public getModule(name: string): ModuleManifest | undefined {
    return this.manifests.get(name);
  }

  public getAllModules(): ModuleStatus[] {
    const result: ModuleStatus[] = [];
    for (const manifest of this.manifests.values()) {
      result.push({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        isCore: manifest.isCore,
        isEnabled: this.isEnabled(manifest.name),
        dependsOn: manifest.dependsOn || [],
      });
    }
    return result;
  }

  public getAdminNavigation(userPermissions?: string[]): ModuleAdminNavEntry[] {
    const navEntries: ModuleAdminNavEntry[] = [];

    for (const manifest of this.manifests.values()) {
      if (!this.isEnabled(manifest.name)) {
        continue;
      }

      for (const entry of manifest.adminNav) {
        // If user permissions are passed, filter out entries the user cannot access
        if (userPermissions && !userPermissions.includes(entry.permission)) {
          continue;
        }
        navEntries.push(entry);
      }
    }

    return navEntries.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  public reset(): void {
    this.manifests.clear();
    this.enabledState.clear();
    this.registerCorePlaceholders();
  }
}

export const moduleRegistry = ModuleRegistry.getInstance();
