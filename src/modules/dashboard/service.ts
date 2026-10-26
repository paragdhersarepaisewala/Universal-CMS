import { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';
import { moduleRegistry } from '../registry.js';

export interface DashboardStatsDTO {
  orders: {
    totalOrders: number;
    pendingOrders: number;
    processingOrders: number;
    completedOrders: number;
    totalRevenuePaise: number;
    averageOrderValuePaise: number;
  };
  business: {
    totalOrders: number;
    pendingOrders: number;
    processingOrders: number;
    completedOrders: number;
    totalRevenuePaise: number;
    averageOrderValuePaise: number;
  };
  catalog: {
    totalProducts: number;
    activeProducts: number;
    lowStockProducts: number;
    digitalAssetsCount: number;
  };
  customers: {
    totalCustomers: number;
    vipCustomers: number;
    segments: {
      standard: number;
      vip: number;
      wholesale: number;
    };
  };
  content: {
    totalPages: number;
    totalArticles: number;
    totalFormSubmissions: number;
  };
  donations: {
    activeCampaigns: number;
    totalDonationsPaise: number;
  };
  system: {
    uptimeSeconds: number;
    memoryUsageBytes: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    nodeVersion: string;
    databasePool: {
      totalConnections: number;
      idleConnections: number;
    };
    enabledModules: string[];
  };
}

export class DashboardService {
  public static async getStats(): Promise<DashboardStatsDTO> {
    // 1. Orders metrics
    let totalOrders = 0;
    let pendingOrders = 0;
    let processingOrders = 0;
    let completedOrders = 0;
    let totalRevenuePaise = 0;

    try {
      const [orderRows] = await pool.query<RowDataPacket[]>(
        `SELECT
          COUNT(*) as total_orders,
          COALESCE(SUM(CASE WHEN status = 'pending_payment' THEN 1 ELSE 0 END), 0) as pending_orders,
          COALESCE(SUM(CASE WHEN status IN ('confirmed', 'processing') THEN 1 ELSE 0 END), 0) as processing_orders,
          COALESCE(SUM(CASE WHEN status IN ('delivered', 'fulfilled', 'completed') THEN 1 ELSE 0 END), 0) as completed_orders,
          COALESCE(SUM(CASE WHEN payment_status = 'captured' THEN total ELSE 0 END), 0) as total_revenue
         FROM orders`
      );
      if (orderRows.length > 0) {
        totalOrders = Number(orderRows[0].total_orders || 0);
        pendingOrders = Number(orderRows[0].pending_orders || 0);
        processingOrders = Number(orderRows[0].processing_orders || 0);
        completedOrders = Number(orderRows[0].completed_orders || 0);
        totalRevenuePaise = Number(orderRows[0].total_revenue || 0);
      }
    } catch {
      // Store module or table might not exist
    }

    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenuePaise / totalOrders) : 0;

    // 2. Catalog metrics
    let totalProducts = 0;
    let activeProducts = 0;
    let lowStockProducts = 0;
    let digitalAssetsCount = 0;

    try {
      const [prodRows] = await pool.query<RowDataPacket[]>(
        `SELECT
          COUNT(*) as total_products,
          COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) as active_products,
          COALESCE(SUM(CASE WHEN stock_quantity <= low_stock_threshold AND track_stock = TRUE THEN 1 ELSE 0 END), 0) as low_stock_products
         FROM products`
      );
      if (prodRows.length > 0) {
        totalProducts = Number(prodRows[0].total_products || 0);
        activeProducts = Number(prodRows[0].active_products || 0);
        lowStockProducts = Number(prodRows[0].low_stock_products || 0);
      }

      const [assetRows] = await pool.query<RowDataPacket[]>(
        'SELECT COUNT(*) as total_assets FROM digital_assets'
      );
      if (assetRows.length > 0) {
        digitalAssetsCount = Number(assetRows[0].total_assets || 0);
      }
    } catch {
      // ignore
    }

    // 3. Customers metrics
    let totalCustomers = 0;
    let vipCustomers = 0;
    let wholesaleCustomers = 0;
    let standardCustomers = 0;

    try {
      const [custRows] = await pool.query<RowDataPacket[]>(
        `SELECT
          COUNT(*) as total_customers,
          COALESCE(SUM(CASE WHEN customer_segment = 'vip' THEN 1 ELSE 0 END), 0) as vip_customers,
          COALESCE(SUM(CASE WHEN customer_segment = 'wholesale' THEN 1 ELSE 0 END), 0) as wholesale_customers,
          COALESCE(SUM(CASE WHEN customer_segment = 'standard' OR customer_segment IS NULL THEN 1 ELSE 0 END), 0) as standard_customers
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'customer'`
      );
      if (custRows.length > 0) {
        totalCustomers = Number(custRows[0].total_customers || 0);
        vipCustomers = Number(custRows[0].vip_customers || 0);
        wholesaleCustomers = Number(custRows[0].wholesale_customers || 0);
        standardCustomers = Number(custRows[0].standard_customers || 0);
      }
    } catch {
      // ignore
    }

    // 4. Content metrics
    let totalPages = 0;
    let totalArticles = 0;
    let totalFormSubmissions = 0;

    try {
      const [pageRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as total_pages FROM pages');
      if (pageRows.length > 0) totalPages = Number(pageRows[0].total_pages || 0);

      const [postRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as total_posts FROM blog_posts');
      if (postRows.length > 0) totalArticles = Number(postRows[0].total_posts || 0);

      const [formRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as total_subs FROM forms_submissions');
      if (formRows.length > 0) totalFormSubmissions = Number(formRows[0].total_subs || 0);
    } catch {
      // ignore
    }

    // 5. Donations metrics
    let activeCampaigns = 0;
    let totalDonationsPaise = 0;

    try {
      const [donRows] = await pool.query<RowDataPacket[]>(
        `SELECT
          COUNT(*) as active_campaigns,
          COALESCE(SUM(raised_amount), 0) as total_donations
         FROM donation_campaigns WHERE is_active = TRUE`
      );
      if (donRows.length > 0) {
        activeCampaigns = Number(donRows[0].active_campaigns || 0);
        totalDonationsPaise = Number(donRows[0].total_donations || 0);
      }
    } catch {
      // ignore
    }

    // 6. System health & memory
    const mem = process.memoryUsage();
    const enabledModules = moduleRegistry.getAllModules().filter((m) => m.isEnabled).map((m) => m.name);

    const ordersData = {
      totalOrders,
      pendingOrders,
      processingOrders,
      completedOrders,
      totalRevenuePaise,
      averageOrderValuePaise: avgOrderValue,
    };

    return {
      orders: ordersData,
      business: ordersData,
      catalog: {
        totalProducts,
        activeProducts,
        lowStockProducts,
        digitalAssetsCount,
      },
      customers: {
        totalCustomers,
        vipCustomers,
        segments: {
          standard: standardCustomers,
          vip: vipCustomers,
          wholesale: wholesaleCustomers,
        },
      },
      content: {
        totalPages,
        totalArticles,
        totalFormSubmissions,
      },
      donations: {
        activeCampaigns,
        totalDonationsPaise,
      },
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageBytes: {
          rss: mem.rss,
          heapTotal: mem.heapTotal,
          heapUsed: mem.heapUsed,
          external: mem.external,
        },
        nodeVersion: process.version,
        databasePool: {
          totalConnections: (pool as any).pool?._allConnections?.length || 1,
          idleConnections: (pool as any).pool?._freeConnections?.length || 1,
        },
        enabledModules,
      },
    };
  }
}
