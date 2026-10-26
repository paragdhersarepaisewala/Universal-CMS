import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';
import { moduleRegistry } from '../registry.js';
import { StoreService } from './service.js';
import { TaxEngine } from './tax.js';
import { InvoiceService } from './invoice.js';
import { AuditService } from '../../content/audit.js';
import { pool } from '../../db/pool.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { cache, CACHE_TAGS } from '../../cache/index.js';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { OrderStatus } from './state-machine.js';
import { getPaymentGateway } from './payment-gateway.js';
import { customerStorefrontRoutes, customerAdminRoutes } from './customer-routes.js';

const storeRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /store/products - Public product catalog
  fastify.get(
    '/products',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Browse active ecommerce product catalog with search and pagination',
        tags: ['Store'],
        querystring: Type.Object({
          q: Type.Optional(Type.String()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Object({
            data: Type.Array(
              Type.Object({
                id: Type.Number(),
                name: Type.String(),
                slug: Type.String(),
                price: Type.Number(),
                compareAtPrice: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
                productType: Type.String(),
                stockQuantity: Type.Number(),
                isAgeRestricted: Type.Boolean(),
              })
            ),
            meta: Type.Object({
              total: Type.Number(),
              page: Type.Number(),
              perPage: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { q, page = 1, perPage = 12 } = req.query as { q?: string; page?: number; perPage?: number };
      const { data, total } = await StoreService.listProducts({ status: 'active', search: q, page, perPage });
      return reply.send({ data, meta: { total, page, perPage } });
    }
  );

  // 2. GET /store/products/:slug - Public product detail
  fastify.get(
    '/products/:slug',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Get product details by slug',
        tags: ['Store'],
        params: Type.Object({
          slug: Type.String(),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              id: Type.Number(),
              name: Type.String(),
              slug: Type.String(),
              description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              sku: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              price: Type.Number(),
              compareAtPrice: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
              productType: Type.String(),
              stockQuantity: Type.Number(),
              trackInventory: Type.Boolean(),
              isAgeRestricted: Type.Boolean(),
            }),
          }),
          404: Type.Object({
            error: Type.Object({ code: Type.String(), message: Type.String() }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const prod = await StoreService.getProductBySlug(slug);
      if (!prod || prod.status !== 'active') {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Product '${slug}' not found` },
        });
      }
      return reply.send({ data: prod });
    }
  );

  // 3. POST /store/cart/quote - Calculate order totals with tax, shipping, and coupon
  fastify.post(
    '/cart/quote',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Calculate subtotal, tax, shipping, coupon discount, and grand total',
        tags: ['Store'],
        body: Type.Object({
          items: Type.Array(
            Type.Object({
              productId: Type.Number(),
              title: Type.Optional(Type.String()),
              price: Type.Optional(Type.Number()),
              quantity: Type.Number(),
            })
          ),
          couponCode: Type.Optional(Type.String()),
          shippingAmount: Type.Optional(Type.Number()),
          placeOfSupplyState: Type.Optional(Type.String()),
          shippingPincode: Type.Optional(Type.String()),
          paymentMethod: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      try {
        const quote = await StoreService.quoteCart(body);
        return reply.send({ data: quote });
      } catch (err: any) {
        const statusCode = err.statusCode || 400;
        return reply.status(statusCode).send({
          error: {
            code: err.code || 'QUOTE_FAILED',
            message: err.message,
          },
        });
      }
    }
  );

  // 4. POST /store/checkout - Atomic checkout with stock reservation
  fastify.post(
    '/checkout',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Place an order via Razorpay or Cash on Delivery with atomic stock reservation',
        tags: ['Store'],
        headers: Type.Object({
          'idempotency-key': Type.Optional(Type.String()),
        }),
        body: Type.Object({
          customerEmail: Type.String({ format: 'email' }),
          paymentMethod: Type.Union([Type.Literal('razorpay'), Type.Literal('cod')]),
          items: Type.Array(
            Type.Object({
              productId: Type.Number(),
              title: Type.Optional(Type.String()),
              price: Type.Optional(Type.Number()),
              quantity: Type.Number(),
            })
          ),
          shippingAddress: Type.Optional(Type.Record(Type.String(), Type.Any())),
          billingAddress: Type.Optional(Type.Record(Type.String(), Type.Any())),
          billingState: Type.Optional(Type.String()),
          couponCode: Type.Optional(Type.String()),
          notes: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const idempotencyKey = (req.headers['idempotency-key'] as string) || undefined;

      // Rule: Check digital delivery module requirement if digital items in cart
      for (const it of body.items) {
        const prod = await StoreService.getProductBySlug(`id-${it.productId}`).catch(() => null);
        if (prod?.productType === 'digital' && !moduleRegistry.isEnabled('digital-delivery')) {
          return reply.status(400).send({
            error: {
              code: 'MODULE_DISABLED',
              message: 'Digital products are disabled because the digital-delivery module is not enabled',
            },
          });
        }
      }

      try {
        const user = (req as any).user;
        const result = await StoreService.checkout({
          ...body,
          customerId: user?.id || null,
          idempotencyKey,
          rawPayload: body,
        });

        return reply.status(201).send({
          data: {
            orderNumber: result.order.orderNumber,
            total: result.order.total,
            paymentMethod: result.order.paymentMethod,
            status: result.order.status,
            expiresAt: result.order.expiresAt,
            guestAccessToken: result.order.guestAccessToken,
            gatewayOrder: result.gatewayOrder,
          },
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 400;
        return reply.status(statusCode).send({
          error: {
            code: err.code || 'CHECKOUT_FAILED',
            message: err.message || 'Checkout failed',
          },
        });
      }
    }
  );

  // Legacy /checkout/razorpay/verify alias
  fastify.post(
    '/checkout/razorpay/verify',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Verify razorpay signature (legacy alias)',
        tags: ['Store'],
        body: Type.Object({
          orderNumber: Type.String(),
          razorpayOrderId: Type.String(),
          razorpayPaymentId: Type.String(),
          razorpaySignature: Type.String(),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as {
        orderNumber: string;
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
      };
      const order = await StoreService.getOrderByNumber(body.orderNumber);
      if (!order) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      const gateway = getPaymentGateway();
      const valid = gateway.verifySignature(
        body.razorpayOrderId,
        body.razorpayPaymentId,
        body.razorpaySignature
      );
      if (!valid) {
        return reply.status(400).send({ statusCode: 400, message: 'Signature verification failed' });
      }
      const res = await StoreService.confirmOrderPayment(order.id, {
        gatewayPaymentId: body.razorpayPaymentId,
        gatewayOrderId: body.razorpayOrderId,
        amountPaise: order.total,
        currency: 'INR',
      });
      return reply.status(200).send({ data: { success: true, order: res.order } });
    }
  );

  // 5. POST /store/orders/:id/verify-payment - Payment verification
  fastify.post(
    '/orders/:id/verify-payment',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Verify payment signature with Razorpay and confirm order',
        tags: ['Store'],
        params: Type.Object({
          id: Type.Number(),
        }),
        body: Type.Object({
          razorpayOrderId: Type.Optional(Type.String()),
          razorpayPaymentId: Type.String(),
          razorpaySignature: Type.Optional(Type.String()),
          guestToken: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as {
        razorpayOrderId?: string;
        razorpayPaymentId: string;
        razorpaySignature?: string;
        guestToken?: string;
      };
      const headerToken = req.headers['x-guest-token'] as string;
      const guestToken = body.guestToken || headerToken;
      const user = (req as any).user;

      try {
        const res = await StoreService.verifyPayment({
          orderId: id,
          razorpayOrderId: body.razorpayOrderId,
          razorpayPaymentId: body.razorpayPaymentId,
          razorpaySignature: body.razorpaySignature,
          userId: user?.id || null,
          userRole: user?.roleName || null,
          guestToken,
        });

        return reply.send({ data: { success: res.success, order: res.order } });
      } catch (err: any) {
        const statusCode = err.statusCode || 400;
        return reply.status(statusCode).send({
          error: {
            code: err.code || 'PAYMENT_VERIFICATION_FAILED',
            message: err.message,
          },
        });
      }
    }
  );

  // 5b. GET /store/orders/:id - Customer Order Details with Ownership Guard
  fastify.get(
    '/orders/:id',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Get order details with customer ownership validation',
        tags: ['Store'],
        params: Type.Object({ id: Type.Number() }),
        querystring: Type.Object({ guestToken: Type.Optional(Type.String()) }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { guestToken } = req.query as { guestToken?: string };
      const headerToken = req.headers['x-guest-token'] as string;
      const effectiveToken = guestToken || headerToken;
      const user = (req as any).user;

      const order = await StoreService.getOrderById(id);
      if (!order) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }

      const isOwner =
        (user && order.customerId === user.id) ||
        user?.roleName === 'admin' ||
        user?.roleName === 'owner';

      if (!isOwner) {
        if (!effectiveToken || !StoreService.verifyGuestAccessToken(effectiveToken, id)) {
          return reply.status(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Forbidden: You do not have permission to view this order',
            },
          });
        }
      }

      return reply.send({ data: order });
    }
  );

  // 5c. GET /store/orders/:id/invoice - Customer Order Tax Invoice (JSON metadata)
  fastify.get(
    '/orders/:id/invoice',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Get formal GST tax invoice or bill of supply for an order',
        tags: ['Store'],
        params: Type.Object({ id: Type.Number() }),
        querystring: Type.Object({ guestToken: Type.Optional(Type.String()) }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { guestToken } = req.query as { guestToken?: string };
      const headerToken = req.headers['x-guest-token'] as string;
      const effectiveToken = guestToken || headerToken;
      const user = (req as any).user;

      const order = await StoreService.getOrderById(id);
      if (!order) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }

      const isOwner =
        (user && order.customerId === user.id) ||
        user?.roleName === 'admin' ||
        user?.roleName === 'owner';

      if (!isOwner) {
        if (!effectiveToken || !StoreService.verifyGuestAccessToken(effectiveToken, id)) {
          return reply.status(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Forbidden: You do not have permission to view this invoice',
            },
          });
        }
      }

      const invoice = await InvoiceService.getInvoiceByOrderId(id);
      if (!invoice) {
        return reply.status(404).send({
          error: {
            code: 'INVOICE_NOT_FOUND',
            message: 'Invoice has not been issued for this order yet',
          },
        });
      }

      return reply.send({ data: invoice });
    }
  );

  // 5d. GET /store/orders/:id/invoice/pdf - Customer Order Tax Invoice (PDF Download)
  fastify.get(
    '/orders/:id/invoice/pdf',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Download printable PDF of a GST tax invoice or bill of supply',
        tags: ['Store'],
        params: Type.Object({ id: Type.Number() }),
        querystring: Type.Object({ guestToken: Type.Optional(Type.String()) }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { guestToken } = req.query as { guestToken?: string };
      const headerToken = req.headers['x-guest-token'] as string;
      const effectiveToken = guestToken || headerToken;
      const user = (req as any).user;

      const order = await StoreService.getOrderById(id);
      if (!order) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }

      const isOwner =
        (user && order.customerId === user.id) ||
        user?.roleName === 'admin' ||
        user?.roleName === 'owner';

      if (!isOwner) {
        if (!effectiveToken || !StoreService.verifyGuestAccessToken(effectiveToken, id)) {
          return reply.status(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Forbidden: You do not have permission to download this invoice',
            },
          });
        }
      }

      const invoice = await InvoiceService.getInvoiceByOrderId(id);
      if (!invoice) {
        return reply.status(404).send({
          error: {
            code: 'INVOICE_NOT_FOUND',
            message: 'Invoice has not been issued for this order yet',
          },
        });
      }

      const pdfBuffer = await InvoiceService.renderInvoicePdf(invoice);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${invoice.invoiceNumber.replace(/\//g, '_')}.pdf"`);
      return reply.send(pdfBuffer);
    }
  );

  // 6. POST /store/webhooks/razorpay - Razorpay Webhook Endpoint
  fastify.post(
    '/webhooks/razorpay',
    {
      config: {
        rateLimit: false, // Rate limit exempt per requirement
      },
      schema: {
        description: 'Razorpay webhook receiver with HMAC verification and deduplication',
        tags: ['Store'],
        headers: Type.Object({
          'x-razorpay-signature': Type.String(),
        }),
      },
    },
    async (req, reply) => {
      const signature = req.headers['x-razorpay-signature'] as string;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      try {
        const res = await StoreService.processRazorpayWebhook(rawBody, signature);
        return reply.status(200).send({
          data: {
            received: true,
            status: res.status,
            eventId: res.eventId,
          },
        });
      } catch (err: any) {
        // Return 500 on unexpected errors so Razorpay retries
        const status = err.statusCode === 400 ? 400 : 500;
        return reply.status(status).send({
          error: {
            code: 'WEBHOOK_FAILED',
            message: err.message,
          },
        });
      }
    }
  );

  // 7. Reviews
  fastify.get(
    '/products/:slug/reviews',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Get approved customer reviews for a product',
        tags: ['Store'],
        params: Type.Object({ slug: Type.String() }),
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const reviews = await StoreService.listApprovedReviews(slug);
      return reply.send({ data: reviews });
    }
  );

  fastify.post(
    '/products/:slug/reviews',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Submit product review (queued for moderation)',
        tags: ['Store'],
        params: Type.Object({ slug: Type.String() }),
        body: Type.Object({
          authorName: Type.String({ minLength: 1 }),
          authorEmail: Type.Optional(Type.String()),
          rating: Type.Number({ minimum: 1, maximum: 5 }),
          comment: Type.String({ minLength: 3 }),
        }),
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const body = req.body as { authorName: string; authorEmail?: string; rating: number; comment: string };
      const user = (req as any).user;
      const review = await StoreService.submitReview({ ...body, entityId: slug, userId: user?.id || null });
      return reply.send({ data: review });
    }
  );

  // 17. GET /store/products/feed/meta.xml - Meta (Facebook) Catalog XML Feed
  fastify.get(
    '/products/feed/meta.xml',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Generate Meta Business Manager compliant product catalog XML feed',
        tags: ['Store'],
      },
    },
    async (req, reply) => {
      const baseUrl = `${req.protocol}://${req.hostname}`;
      const xml = await StoreService.generateMetaCatalogFeed('xml', baseUrl);
      return reply.header('Content-Type', 'application/xml').send(xml);
    }
  );

  // 18. GET /store/products/feed/meta.csv - Meta (Facebook) Catalog CSV Feed
  fastify.get(
    '/products/feed/meta.csv',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Generate Meta Business Manager compliant product catalog CSV feed',
        tags: ['Store'],
      },
    },
    async (req, reply) => {
      const baseUrl = `${req.protocol}://${req.hostname}`;
      const csv = await StoreService.generateMetaCatalogFeed('csv', baseUrl);
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="meta-catalog.csv"')
        .send(csv);
    }
  );

  // Customer account & profile storefront routes
  await fastify.register(customerStorefrontRoutes, { prefix: '/customer' });
};

export const adminStoreRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Admin list products
  fastify.get(
    '/products',
    {
      preHandler: [authenticate, requirePermission('store.products.view')],
      schema: {
        description: 'Admin list all products with inventory levels',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          status: Type.Optional(Type.String()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const { status, page = 1, perPage = 20 } = req.query as { status?: string; page?: number; perPage?: number };
      const res = await StoreService.listProducts({
        status: status as 'draft' | 'active' | 'archived',
        page,
        perPage,
      });
      return reply.send({ data: res.data, meta: { total: res.total, page, perPage } });
    }
  );

  // Admin export products CSV
  fastify.get(
    '/products/export',
    {
      preHandler: [authenticate, requirePermission('store.products.view')],
      schema: {
        description: 'Export all products to a CSV file with formula-injection defenses',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const csv = await StoreService.exportProductsCsv();
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="products.csv"')
        .send(csv);
    }
  );

  // Admin import products CSV
  fastify.post(
    '/products/import',
    {
      preHandler: [authenticate, requirePermission('store.products.edit')],
      schema: {
        description: 'Bulk import products via CSV content with atomic stock adjustment tracking',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          csv: Type.String({ minLength: 1 }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              totalRows: Type.Number(),
              created: Type.Number(),
              updated: Type.Number(),
              errors: Type.Array(
                Type.Object({
                  row: Type.Number(),
                  error: Type.String(),
                })
              ),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { csv: string };
      const user = (req as any).user;
      const res = await StoreService.importProductsCsv(body.csv, user?.id || null);
      return reply.send({ data: res });
    }
  );

  // Admin get stock movements ledger
  fastify.get(
    '/inventory/history',
    {
      preHandler: [authenticate, requirePermission('store.products.view')],
      schema: {
        description: 'Retrieve paginated stock movement audit ledger for inventory tracking',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          productId: Type.Optional(Type.Number()),
          variantId: Type.Optional(Type.Number()),
          changeType: Type.Optional(Type.String()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const q = req.query as { productId?: number; variantId?: number; changeType?: string; page?: number; perPage?: number };
      const res = await StoreService.getStockMovements(q);
      return reply.send(res);
    }
  );

  // Admin manual stock adjustment
  fastify.post(
    '/inventory/adjust',
    {
      preHandler: [authenticate, requirePermission('store.products.edit')],
      schema: {
        description: 'Manually adjust inventory stock quantity with required reason string and ledger logging',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          productId: Type.Number(),
          variantId: Type.Optional(Type.Number()),
          quantityDelta: Type.Number(),
          changeType: Type.Optional(
            Type.Union([
              Type.Literal('restock'),
              Type.Literal('adjustment'),
              Type.Literal('release'),
              Type.Literal('reservation'),
              Type.Literal('damaged'),
            ])
          ),
          reason: Type.String({ minLength: 3 }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              productId: Type.Number(),
              newStockQuantity: Type.Number(),
              stockMovementId: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        productId: number;
        variantId?: number;
        quantityDelta: number;
        changeType?: 'restock' | 'adjustment' | 'release' | 'reservation' | 'damaged';
        reason: string;
      };
      const user = (req as any).user;
      const res = await StoreService.adjustStock(
        body.productId,
        body.variantId || null,
        body.quantityDelta,
        body.changeType || 'adjustment',
        body.reason,
        user?.id || null
      );
      return reply.send({ data: res });
    }
  );

  // Admin create product (Enforcing digital-delivery module check)
  fastify.post(
    '/products',
    {
      preHandler: [authenticate, requirePermission('store.products.edit')],
      schema: {
        description: 'Create ecommerce product (digital products require digital-delivery module)',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          description: Type.Optional(Type.String()),
          sku: Type.Optional(Type.String()),
          price: Type.Number(),
          compareAtPrice: Type.Optional(Type.Number()),
          productType: Type.Optional(Type.Union([Type.Literal('physical'), Type.Literal('digital')])),
          stockQuantity: Type.Optional(Type.Number()),
          lowStockThreshold: Type.Optional(Type.Number()),
          trackStock: Type.Optional(Type.Boolean()),
          allowBackorder: Type.Optional(Type.Boolean()),
          status: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;

      if (body.productType === 'digital' && !moduleRegistry.isEnabled('digital-delivery')) {
        return reply.status(400).send({
          error: {
            code: 'MODULE_DISABLED',
            message: 'Digital products cannot be created because the digital-delivery module is not enabled',
          },
        });
      }

      const prod = await StoreService.createProduct(body);
      return reply.status(201).send({ data: prod });
    }
  );

  // Admin update product
  fastify.put(
    '/products/:id',
    {
      preHandler: [authenticate, requirePermission('store.products.edit')],
      schema: {
        description: 'Update ecommerce product and inventory',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          name: Type.Optional(Type.String()),
          price: Type.Optional(Type.Number()),
          stockQuantity: Type.Optional(Type.Number()),
          status: Type.Optional(Type.String()),
          productType: Type.Optional(Type.Union([Type.Literal('physical'), Type.Literal('digital')])),
          trackStock: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as any;

      if (body.productType === 'digital' && !moduleRegistry.isEnabled('digital-delivery')) {
        return reply.status(400).send({
          error: {
            code: 'MODULE_DISABLED',
            message: 'Digital products cannot be enabled because the digital-delivery module is not enabled',
          },
        });
      }

      const prod = await StoreService.updateProduct(id, body);
      if (!prod) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
      }
      return reply.send({ data: prod });
    }
  );

  // Admin list orders
  fastify.get(
    '/orders',
    {
      preHandler: [authenticate, requirePermission('store.orders.view')],
      schema: {
        description: 'List customer orders',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          status: Type.Optional(Type.String()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const { status, page = 1, perPage = 20 } = req.query as { status?: string; page?: number; perPage?: number };
      const res = await StoreService.listOrders({ status, page, perPage });
      return reply.send({ data: res.data, meta: { total: res.total, page, perPage } });
    }
  );

  // Admin get order detail
  fastify.get(
    '/orders/:id',
    {
      preHandler: [authenticate, requirePermission('store.orders.view')],
      schema: {
        description: 'Get detailed order record by ID',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const order = await StoreService.getOrderById(id);
      if (!order) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      return reply.send({ data: order });
    }
  );

  // Admin update order status transition (store.orders.edit)
  fastify.post(
    '/orders/:id/transition',
    {
      preHandler: [authenticate, requirePermission('store.orders.edit')],
      schema: {
        description: 'Execute validated state machine transition for an order (returns 409 CONFLICT on invalid)',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          status: Type.String(),
          reason: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { status, reason } = req.body as { status: OrderStatus; reason?: string };
      const user = (req as any).user;

      try {
        const updated = await StoreService.transitionOrderStatus(
          id,
          status,
          user?.name || `user_${user?.id || 'admin'}`,
          reason
        );
        return reply.send({ data: updated });
      } catch (err: any) {
        const statusCode = err.statusCode || 400;
        return reply.status(statusCode).send({
          error: {
            code: err.code || 'TRANSITION_FAILED',
            message: err.message,
          },
        });
      }
    }
  );

  // Admin add order note (store.orders.edit)
  fastify.post(
    '/orders/:id/notes',
    {
      preHandler: [authenticate, requirePermission('store.orders.edit')],
      schema: {
        description: 'Add internal or customer-visible note to an order',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          note: Type.String({ minLength: 1 }),
          isCustomerVisible: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { note, isCustomerVisible } = req.body as { note: string; isCustomerVisible?: boolean };
      const user = (req as any).user;

      const record = await StoreService.addOrderNote(id, note, isCustomerVisible || false, user?.id || null);
      return reply.status(201).send({ data: record });
    }
  );

  // Admin issue refund (store.orders.refund)
  fastify.post(
    '/orders/:id/refund',
    {
      preHandler: [authenticate, requirePermission('store.orders.refund')],
      schema: {
        description: 'Issue full or partial refund with gateway sync and optional restock',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          amountPaise: Type.Optional(Type.Number()),
          lineItems: Type.Optional(
            Type.Array(
              Type.Object({
                orderItemId: Type.Number(),
                quantity: Type.Number(),
              })
            )
          ),
          reason: Type.String({ minLength: 3 }),
          idempotencyKey: Type.String({ minLength: 5 }),
          restock: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as any;
      const user = (req as any).user;

      try {
        const refundRecord = await StoreService.createRefund({
          ...body,
          orderId: id,
          actorId: user?.id || null,
        });
        return reply.status(201).send({ data: refundRecord });
      } catch (err: any) {
        const statusCode = err.statusCode || 400;
        return reply.status(statusCode).send({
          error: {
            code: err.code || 'REFUND_FAILED',
            message: err.message,
          },
        });
      }
    }
  );

  // Admin list all Indian states and UTs with GST codes
  fastify.get(
    '/states',
    {
      preHandler: [authenticate, requirePermission('store.products.view')],
      schema: {
        description: 'Get all Indian states and Union Territories with official GST codes',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const allStates = await TaxEngine.getAllStates();
      return reply.send({ data: allStates });
    }
  );

  // Admin list tax classes
  fastify.get(
    '/tax-classes',
    {
      preHandler: [authenticate, requirePermission('store.products.view')],
      schema: {
        description: 'Get all GST tax classes',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const taxClasses = await TaxEngine.getAllTaxClasses();
      return reply.send({ data: taxClasses });
    }
  );

  // Admin create tax class
  fastify.post(
    '/tax-classes',
    {
      preHandler: [authenticate, requirePermission('store.tax.manage')],
      schema: {
        description: 'Create a new GST tax class',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          kind: Type.Optional(Type.Union([Type.Literal('goods'), Type.Literal('service')])),
          codeType: Type.Optional(Type.Union([Type.Literal('HSN'), Type.Literal('SAC')])),
          code: Type.String({ minLength: 2 }),
          rateBasisPoints: Type.Number({ minimum: 0 }),
          cessBasisPoints: Type.Optional(Type.Number({ minimum: 0 })),
          isExempt: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const user = (req as any).user;
      const connection = await pool.getConnection();
      try {
        const [res] = await connection.query<ResultSetHeader>(
          `INSERT INTO tax_classes (name, kind, code_type, code, rate_basis_points, cess_basis_points, is_exempt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            body.name,
            body.kind || 'goods',
            body.codeType || 'HSN',
            body.code,
            body.rateBasisPoints,
            body.cessBasisPoints || 0,
            body.isExempt || false,
          ]
        );
        await cache.invalidateTags([CACHE_TAGS.SETTINGS]);
        await AuditService.log({
          userId: user?.id,
          action: 'tax_class.create',
          entityType: 'tax_class',
          entityId: String(res.insertId),
          afterValues: body,
        });
        return reply.status(201).send({ data: { id: res.insertId, ...body } });
      } finally {
        connection.release();
      }
    }
  );

  // Admin update tax class
  fastify.put(
    '/tax-classes/:id',
    {
      preHandler: [authenticate, requirePermission('store.tax.manage')],
      schema: {
        description: 'Update a GST tax class',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1 })),
          kind: Type.Optional(Type.Union([Type.Literal('goods'), Type.Literal('service')])),
          codeType: Type.Optional(Type.Union([Type.Literal('HSN'), Type.Literal('SAC')])),
          code: Type.Optional(Type.String({ minLength: 2 })),
          rateBasisPoints: Type.Optional(Type.Number({ minimum: 0 })),
          cessBasisPoints: Type.Optional(Type.Number({ minimum: 0 })),
          isExempt: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as any;
      const user = (req as any).user;
      const connection = await pool.getConnection();
      try {
        const [existing] = await connection.query<RowDataPacket[]>(
          'SELECT * FROM tax_classes WHERE id = ?',
          [id]
        );
        if (existing.length === 0) {
          return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Tax class not found' } });
        }
        const prev = existing[0];
        const updates: string[] = [];
        const params: any[] = [];
        if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
        if (body.kind !== undefined) { updates.push('kind = ?'); params.push(body.kind); }
        if (body.codeType !== undefined) { updates.push('code_type = ?'); params.push(body.codeType); }
        if (body.code !== undefined) { updates.push('code = ?'); params.push(body.code); }
        if (body.rateBasisPoints !== undefined) { updates.push('rate_basis_points = ?'); params.push(body.rateBasisPoints); }
        if (body.cessBasisPoints !== undefined) { updates.push('cess_basis_points = ?'); params.push(body.cessBasisPoints); }
        if (body.isExempt !== undefined) { updates.push('is_exempt = ?'); params.push(body.isExempt); }

        if (updates.length > 0) {
          params.push(id);
          await connection.query(`UPDATE tax_classes SET ${updates.join(', ')} WHERE id = ?`, params);
          await cache.invalidateTags([CACHE_TAGS.SETTINGS]);
        }

        await AuditService.log({
          userId: user?.id,
          action: 'tax_class.update',
          entityType: 'tax_class',
          entityId: String(id),
          beforeValues: prev,
          afterValues: body,
        });

        const [updated] = await connection.query<RowDataPacket[]>('SELECT * FROM tax_classes WHERE id = ?', [id]);
        return reply.send({ data: updated[0] });
      } finally {
        connection.release();
      }
    }
  );

  // Admin get store tax and COD settings
  fastify.get(
    '/settings/tax-cod',
    {
      preHandler: [authenticate, requirePermission('store.tax.manage')],
      schema: {
        description: 'Get store tax, GST, and COD settings',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (_req, reply) => {
      const settings = await TaxEngine.getStoreSettings();
      return reply.send({ data: settings });
    }
  );

  // Admin update store tax and COD settings
  fastify.put(
    '/settings/tax-cod',
    {
      preHandler: [authenticate, requirePermission('store.tax.manage')],
      schema: {
        description: 'Update store tax, GST, and COD settings',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          sellerRegistrationType: Type.Optional(Type.Union([Type.Literal('regular'), Type.Literal('composition'), Type.Literal('unregistered')])),
          sellerGstin: Type.Optional(Type.String()),
          sellerLegalName: Type.Optional(Type.String()),
          sellerTradeName: Type.Optional(Type.String()),
          sellerState: Type.Optional(Type.String()),
          priceIncludesTax: Type.Optional(Type.Boolean()),
          roundingMode: Type.Optional(Type.Union([Type.Literal('per_line'), Type.Literal('per_invoice')])),
          shippingTaxMode: Type.Optional(Type.Union([Type.Literal('product_proportional'), Type.Literal('highest_product_rate'), Type.Literal('fixed_service_rate')])),
          shippingTaxClassId: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
          codEnabled: Type.Optional(Type.Boolean()),
          codMinOrderPaise: Type.Optional(Type.Number()),
          codMaxOrderPaise: Type.Optional(Type.Number()),
          codFeePaise: Type.Optional(Type.Number()),
          codBlockedPincodes: Type.Optional(Type.Array(Type.String())),
          codRequiresConfirmation: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      const user = (req as any).user;
      const prev = await TaxEngine.getStoreSettings();
      const updated = await TaxEngine.updateStoreSettings(body);

      await AuditService.log({
        userId: user?.id,
        action: 'store_settings.update',
        entityType: 'store_settings',
        entityId: 'store_settings',
        beforeValues: prev,
        afterValues: updated,
      });

      return reply.send({ data: updated });
    }
  );

  // Admin list all customer GST tax invoices
  fastify.get(
    '/invoices',
    {
      preHandler: [authenticate, requirePermission('store.invoices.view')],
      schema: {
        description: 'Admin list all customer GST tax invoices with pagination and filters',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          financialYear: Type.Optional(Type.String()),
          status: Type.Optional(Type.String()),
          orderId: Type.Optional(Type.Number()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const { financialYear, status, orderId, page = 1, perPage = 20 } = req.query as any;
      const offset = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, perPage));

      const connection = await pool.getConnection();
      try {
        let query = 'SELECT * FROM invoices WHERE 1=1';
        const params: any[] = [];
        if (financialYear) { query += ' AND financial_year = ?'; params.push(financialYear); }
        if (status) { query += ' AND status = ?'; params.push(status); }
        if (orderId) { query += ' AND order_id = ?'; params.push(orderId); }

        const [countRows] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) as cnt FROM (${query}) as sub`,
          params
        );
        const total = Number(countRows[0]?.cnt || 0);

        query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(perPage, offset);
        const [rows] = await connection.query<RowDataPacket[]>(query, params);

        return reply.send({
          data: rows.map((r) => ({
            id: Number(r.id),
            orderId: Number(r.order_id),
            invoiceNumber: r.invoice_number,
            financialYear: r.financial_year,
            invoiceType: r.invoice_type,
            status: r.status,
            taxableAmountPaise: Number(r.taxable_amount_paise),
            totalTaxPaise: Number(r.total_tax_paise),
            totalAmountPaise: Number(r.total_amount_paise),
            issuedAt: new Date(r.issued_at).toISOString(),
          })),
          meta: { total, page, perPage },
        });
      } finally {
        connection.release();
      }
    }
  );

  // Admin get single invoice details
  fastify.get(
    '/invoices/:id',
    {
      preHandler: [authenticate, requirePermission('store.invoices.view')],
      schema: {
        description: 'Get full details and snapshots of a GST tax invoice',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const invoice = await InvoiceService.getInvoiceById(id);
      if (!invoice) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
      }
      return reply.send({ data: invoice });
    }
  );

  // Admin download invoice PDF
  fastify.get(
    '/invoices/:id/pdf',
    {
      preHandler: [authenticate, requirePermission('store.invoices.view')],
      schema: {
        description: 'Download printable PDF of a GST tax invoice',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const invoice = await InvoiceService.getInvoiceById(id);
      if (!invoice) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
      }
      const pdfBuffer = await InvoiceService.renderInvoicePdf(invoice);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${invoice.invoiceNumber.replace(/\//g, '_')}.pdf"`);
      return reply.send(pdfBuffer);
    }
  );

  // Admin list all credit notes
  fastify.get(
    '/credit-notes',
    {
      preHandler: [authenticate, requirePermission('store.invoices.view')],
      schema: {
        description: 'Admin list all GST credit notes with pagination',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          financialYear: Type.Optional(Type.String()),
          page: Type.Optional(Type.Number()),
          perPage: Type.Optional(Type.Number()),
        }),
      },
    },
    async (req, reply) => {
      const { financialYear, page = 1, perPage = 20 } = req.query as any;
      const offset = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, perPage));

      const connection = await pool.getConnection();
      try {
        let query = 'SELECT * FROM credit_notes WHERE 1=1';
        const params: any[] = [];
        if (financialYear) { query += ' AND financial_year = ?'; params.push(financialYear); }

        const [countRows] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) as cnt FROM (${query}) as sub`,
          params
        );
        const total = Number(countRows[0]?.cnt || 0);

        query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(perPage, offset);
        const [rows] = await connection.query<RowDataPacket[]>(query, params);

        return reply.send({
          data: rows.map((r) => ({
            id: Number(r.id),
            invoiceId: Number(r.invoice_id),
            orderId: Number(r.order_id),
            creditNoteNumber: r.credit_note_number,
            financialYear: r.financial_year,
            reason: r.reason,
            taxableAmountPaise: Number(r.taxable_amount_paise),
            totalTaxPaise: Number(r.total_tax_paise),
            totalAmountPaise: Number(r.total_amount_paise),
            issuedAt: new Date(r.issued_at).toISOString(),
          })),
          meta: { total, page, perPage },
        });
      } finally {
        connection.release();
      }
    }
  );

  // Admin get credit note details
  fastify.get(
    '/credit-notes/:id',
    {
      preHandler: [authenticate, requirePermission('store.invoices.view')],
      schema: {
        description: 'Get details of a credit note',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const cn = await InvoiceService.getCreditNoteById(id);
      if (!cn) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Credit note not found' } });
      }
      return reply.send({ data: cn });
    }
  );

  // Admin download credit note PDF
  fastify.get(
    '/credit-notes/:id/pdf',
    {
      preHandler: [authenticate, requirePermission('store.invoices.view')],
      schema: {
        description: 'Download printable PDF of a credit note',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const cn = await InvoiceService.getCreditNoteById(id);
      if (!cn) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Credit note not found' } });
      }
      const pdfBuffer = await InvoiceService.renderCreditNotePdf(cn);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${cn.creditNoteNumber.replace(/\//g, '_')}.pdf"`);
      return reply.send(pdfBuffer);
    }
  );

  // Customer admin routes (customers directory, notes, segments, return requests)
  await fastify.register(customerAdminRoutes);
};

export const storeModuleManifest: ModuleManifest = {
  name: 'store',
  version: '0.2.6',
  description: 'Ecommerce catalog, inventory, cart, checkout, payments, taxes, invoices, orders, customers, and wishlist',
  isCore: false,
  dependsOn: ['media'],
  permissions: [
    { key: 'store.products.view', description: 'View store products' },
    { key: 'store.products.edit', description: 'Create and edit store products' },
    { key: 'store.orders.view', description: 'View customer orders' },
    { key: 'store.orders.edit', description: 'Manage order status transitions and notes' },
    { key: 'store.orders.refund', description: 'Issue full and partial refunds for orders' },
    { key: 'store.tax.manage', description: 'Manage GST tax classes, rules, and store tax/COD configuration' },
    { key: 'store.invoices.view', description: 'View and download customer GST tax invoices and credit notes' },
    { key: 'store.customers.view', description: 'View customer directory, profiles, and order history' },
    { key: 'store.customers.manage', description: 'Manage customer segments, staff notes, and return requests' },
  ],
  adminNav: [
    {
      id: 'store-products',
      label: 'Products',
      route: '/admin/store/products',
      permission: 'store.products.view',
      order: 30,
    },
    {
      id: 'store-orders',
      label: 'Orders',
      route: '/admin/store/orders',
      permission: 'store.orders.view',
      order: 31,
    },
    {
      id: 'store-invoices',
      label: 'Invoices',
      route: '/admin/store/invoices',
      permission: 'store.invoices.view',
      order: 32,
    },
    {
      id: 'store-customers',
      label: 'Customers',
      route: '/admin/store/customers',
      permission: 'store.customers.view',
      order: 33,
    },
    {
      id: 'store-tax-cod',
      label: 'Tax & COD',
      route: '/admin/store/settings/tax-cod',
      permission: 'store.tax.manage',
      order: 34,
    },
    {
      id: 'store-inventory',
      label: 'Inventory',
      route: '/admin/store/inventory',
      permission: 'store.products.view',
      order: 35,
    },
  ],
  routesPrefix: '/store',
  routes: storeRoutes,
};
