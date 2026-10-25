export interface SystemPermission {
  key: string;
  module: string;
  description: string;
}

export const SYSTEM_PERMISSIONS: SystemPermission[] = [
  // Core Dashboard
  { key: 'core.dashboard.view', module: 'dashboard', description: 'View admin dashboard statistics' },

  // Pages & Content
  { key: 'core.pages.view', module: 'pages', description: 'View pages list' },
  { key: 'core.pages.edit', module: 'pages', description: 'Create and edit pages and content blocks' },
  { key: 'core.pages.delete', module: 'pages', description: 'Delete pages' },

  // Menus
  { key: 'core.menus.view', module: 'menus', description: 'View menus and menu items' },
  { key: 'core.menus.edit', module: 'menus', description: 'Create and edit menus and navigation structure' },

  // Media Library
  { key: 'core.media.view', module: 'media', description: 'View media library' },
  { key: 'core.media.upload', module: 'media', description: 'Upload media files' },
  { key: 'core.media.delete', module: 'media', description: 'Delete media files' },

  // Theme & Styling
  { key: 'core.theme.view', module: 'theme', description: 'View theme tokens' },
  { key: 'core.theme.edit', module: 'theme', description: 'Edit theme tokens, fonts, and colors' },

  // SEO
  { key: 'core.seo.view', module: 'seo', description: 'View SEO metadata' },
  { key: 'core.seo.edit', module: 'seo', description: 'Edit SEO metadata, sitemaps, and robots.txt' },

  // Redirects
  { key: 'core.redirects.view', module: 'redirects', description: 'View URL redirects' },
  { key: 'core.redirects.edit', module: 'redirects', description: 'Create and edit 301/302 redirects' },

  // Users & Staff
  { key: 'core.users.view', module: 'users', description: 'View users list' },
  { key: 'core.users.edit', module: 'users', description: 'Create, edit, and invite users' },
  { key: 'core.users.delete', module: 'users', description: 'Deactivate or delete users' },

  // Roles & Permissions
  { key: 'core.roles.view', module: 'roles', description: 'View roles and permission matrix' },
  { key: 'core.roles.edit', module: 'roles', description: 'Edit role permissions' },

  // Settings
  { key: 'core.settings.view', module: 'settings', description: 'View site settings' },
  { key: 'core.settings.edit', module: 'settings', description: 'Modify site configuration' },

  // Email & SMTP
  { key: 'core.email.view', module: 'email', description: 'View email templates and logs' },
  { key: 'core.email.edit', module: 'email', description: 'Edit email templates and automated triggers' },
  { key: 'core.email.settings', module: 'email', description: 'Configure SMTP credentials and run test sends' },

  // Legal & Compliance
  { key: 'core.legal.view', module: 'legal', description: 'View legal policy pages and consent logs' },
  { key: 'core.legal.edit', module: 'legal', description: 'Edit legal policies and compliance settings' },

  // Cache & Operations
  { key: 'core.cache.manage', module: 'cache', description: 'Purge cache tags and flush cache' },
  { key: 'core.modules.manage', module: 'modules', description: 'Enable and disable feature modules' },
  { key: 'core.logs.view', module: 'audit', description: 'View audit, error, and activity logs' },
  { key: 'core.backup.manage', module: 'backup', description: 'Trigger and manage database backups' },

  // Module Permissions (Optional modules)
  { key: 'blog.posts.view', module: 'blog', description: 'View blog posts' },
  { key: 'blog.posts.edit', module: 'blog', description: 'Create and edit blog posts' },
  { key: 'blog.taxonomy.view', module: 'blog', description: 'View blog categories and tags' },
  { key: 'store.products.view', module: 'store', description: 'View ecommerce products' },
  { key: 'store.products.edit', module: 'store', description: 'Create and edit products' },
  { key: 'store.orders.view', module: 'store', description: 'View orders and fulfillments' },
  { key: 'store.orders.edit', module: 'store', description: 'Update order status transitions and notes' },
  { key: 'store.orders.refund', module: 'store', description: 'Issue full and partial refunds for orders' },
  { key: 'store.tax.manage', module: 'store', description: 'Manage GST tax classes, rules, and store tax/COD configuration' },
  { key: 'store.invoices.view', module: 'store', description: 'View and download customer GST tax invoices and credit notes' },
  { key: 'shipping.view', module: 'shipping', description: 'View shipping zones, rates, and shipments' },
  { key: 'shipping.manage', module: 'shipping', description: 'Manage shipping zones, rates, and carrier settings' },
  { key: 'shipping.shipments.manage', module: 'shipping', description: 'Create shipments, generate AWBs, and update tracking' },
  { key: 'digital.view', module: 'digital', description: 'View digital assets, entitlements, and license keys' },
  { key: 'digital.manage', module: 'digital', description: 'Manage digital product files, license pools, and revoke entitlements' },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  // owner has wildcard access to everything
  owner: ['*'],

  admin: [
    'core.dashboard.view',
    'core.pages.view',
    'core.pages.edit',
    'core.pages.delete',
    'core.menus.view',
    'core.menus.edit',
    'core.media.view',
    'core.media.upload',
    'core.media.delete',
    'core.theme.view',
    'core.theme.edit',
    'core.seo.view',
    'core.seo.edit',
    'core.redirects.view',
    'core.redirects.edit',
    'core.users.view',
    'core.users.edit',
    'core.roles.view',
    'core.roles.edit',
    'core.settings.view',
    'core.settings.edit',
    'core.email.view',
    'core.email.edit',
    'core.email.settings',
    'core.legal.view',
    'core.legal.edit',
    'core.cache.manage',
    'core.modules.manage',
    'core.logs.view',
    'core.backup.manage',
    'blog.posts.view',
    'blog.posts.edit',
    'blog.taxonomy.view',
    'store.products.view',
    'store.products.edit',
    'store.orders.view',
    'store.orders.edit',
    'store.orders.refund',
    'store.tax.manage',
    'store.invoices.view',
    'shipping.view',
    'shipping.manage',
    'shipping.shipments.manage',
    'digital.view',
    'digital.manage',
  ],

  manager: [
    'core.dashboard.view',
    'core.pages.view',
    'core.pages.edit',
    'core.menus.view',
    'core.media.view',
    'core.media.upload',
    'core.seo.view',
    'core.email.view',
    'core.logs.view',
    'blog.posts.view',
    'blog.posts.edit',
    'store.products.view',
    'store.products.edit',
    'store.orders.view',
    'shipping.view',
    'shipping.shipments.manage',
  ],

  editor: [
    'core.dashboard.view',
    'core.pages.view',
    'core.pages.edit',
    'core.media.view',
    'core.media.upload',
    'core.menus.view',
    'blog.posts.view',
    'blog.posts.edit',
  ],

  support: [
    'core.dashboard.view',
    'core.users.view',
    'core.email.view',
    'core.logs.view',
    'store.orders.view',
  ],

  // customer has zero admin panel permissions
  customer: [],
};
