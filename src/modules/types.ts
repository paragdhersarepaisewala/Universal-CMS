export interface ModuleAdminNavEntry {
  id: string;
  label: string;
  route: string;
  permission: string;
  order?: number;
  children?: ModuleAdminNavEntry[];
}

export interface ModuleManifest {
  name: string;
  version: string;
  description: string;
  dependsOn?: string[];
  isCore: boolean;
  permissions: {
    key: string;
    description: string;
  }[];
  adminNav: ModuleAdminNavEntry[];
  settingsSchema?: Record<string, unknown>;
  routesPrefix: string;
}
