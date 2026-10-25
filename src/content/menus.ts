import { db } from '../db/index.js';
import { menus, menuItems } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { cache, CACHE_TAGS } from '../cache/index.js';

export interface MenuItemData {
  id?: number;
  parentId?: number | null;
  label: string;
  url: string;
  target?: string;
  sortOrder: number;
  isActive?: boolean;
  children?: MenuItemData[];
}

export interface MenuData {
  id: number;
  name: string;
  slug: string;
  location: string | null;
  items: MenuItemData[];
  createdAt: Date;
  updatedAt: Date;
}

let inMemoryMenus: MenuData[] = [
  {
    id: 1,
    name: 'Main Navigation',
    slug: 'main-navigation',
    location: 'header',
    items: [
      { id: 1, parentId: null, label: 'Home', url: '/', target: '_self', sortOrder: 1, isActive: true },
      { id: 2, parentId: null, label: 'Store', url: '/store', target: '_self', sortOrder: 2, isActive: true },
      { id: 3, parentId: null, label: 'Blog', url: '/blog', target: '_self', sortOrder: 3, isActive: true },
      { id: 4, parentId: null, label: 'About', url: '/about', target: '_self', sortOrder: 4, isActive: true },
      { id: 5, parentId: null, label: 'Contact', url: '/contact', target: '_self', sortOrder: 5, isActive: true },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 2,
    name: 'Footer Links',
    slug: 'footer-links',
    location: 'footer',
    items: [
      { id: 6, parentId: null, label: 'Privacy Policy', url: '/privacy-policy', target: '_self', sortOrder: 1, isActive: true },
      { id: 7, parentId: null, label: 'Terms & Conditions', url: '/terms', target: '_self', sortOrder: 2, isActive: true },
      { id: 8, parentId: null, label: 'Refund Policy', url: '/refund-policy', target: '_self', sortOrder: 3, isActive: true },
      { id: 9, parentId: null, label: 'Grievance Redressal', url: '/grievance', target: '_self', sortOrder: 4, isActive: true },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
let menuIdCounter = 3;

export class MenuService {
  static async listMenus(): Promise<MenuData[]> {
    return await cache.getOrSet('menus:list', async () => {
      try {
        const rows = await db.select().from(menus);
        if (rows.length > 0) {
          const result: MenuData[] = [];
          for (const r of rows) {
            const items = await db
              .select()
              .from(menuItems)
              .where(eq(menuItems.menuId, r.id))
              .orderBy(menuItems.sortOrder);

            result.push({
              id: r.id,
              name: r.name,
              slug: r.slug,
              location: r.location,
              items: items.map((i: typeof menuItems.$inferSelect) => ({
                id: i.id,
                parentId: i.parentId,
                label: i.label,
                url: i.url,
                target: i.target,
                sortOrder: i.sortOrder,
                isActive: i.isActive,
              })),
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
            });
          }
          return result;
        }
      } catch {
        // Fallback
      }
      return inMemoryMenus;
    }, 3600, [CACHE_TAGS.MENUS]);
  }

  static async getMenuByLocation(location: string): Promise<MenuData | null> {
    return await cache.getOrSet(`menu:location:${location}`, async () => {
      const all = await this.listMenus();
      const found = all.find(m => m.location === location);
      return found || null;
    }, 3600, [CACHE_TAGS.MENUS]);
  }

  static async getMenuById(id: number): Promise<MenuData | null> {
    const all = await this.listMenus();
    return all.find(m => m.id === id) || null;
  }

  static async saveMenu(data: {
    id?: number;
    name: string;
    slug: string;
    location?: string;
    items?: MenuItemData[];
  }): Promise<MenuData> {
    let saved: MenuData;

    if (data.id) {
      const idx = inMemoryMenus.findIndex(m => m.id === data.id);
      saved = {
        id: data.id,
        name: data.name,
        slug: data.slug,
        location: data.location || null,
        items: data.items || [],
        createdAt: inMemoryMenus[idx]?.createdAt || new Date(),
        updatedAt: new Date(),
      };
      if (idx !== -1) inMemoryMenus[idx] = saved;
    } else {
      saved = {
        id: menuIdCounter++,
        name: data.name,
        slug: data.slug,
        location: data.location || null,
        items: data.items || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      inMemoryMenus.push(saved);
    }

    try {
      if (data.id) {
        await db
          .update(menus)
          .set({ name: data.name, slug: data.slug, location: data.location, updatedAt: new Date() })
          .where(eq(menus.id, data.id));

        await db.delete(menuItems).where(eq(menuItems.menuId, data.id));
        if (data.items) {
          for (const item of data.items) {
            await db.insert(menuItems).values({
              menuId: data.id,
              parentId: item.parentId || null,
              label: item.label,
              url: item.url,
              target: item.target || '_self',
              sortOrder: item.sortOrder || 0,
              isActive: item.isActive !== undefined ? item.isActive : true,
            });
          }
        }
      }
    } catch {
      // Fallback
    }

    await cache.invalidateTags([CACHE_TAGS.MENUS]);
    return saved;
  }

  static async deleteMenu(id: number): Promise<boolean> {
    inMemoryMenus = inMemoryMenus.filter(m => m.id !== id);
    try {
      await db.delete(menuItems).where(eq(menuItems.menuId, id));
      await db.delete(menus).where(eq(menus.id, id));
    } catch {
      // Fallback
    }
    await cache.invalidateTags([CACHE_TAGS.MENUS]);
    return true;
  }
}
