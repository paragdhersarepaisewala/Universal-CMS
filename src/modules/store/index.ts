import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';
import { moduleRegistry } from '../registry.js';
import { StoreService } from './service.js';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { OrderStatus } from './state-machine.js';
import { getPaymentGateway } from './payment-gateway.js';

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
              title: Type.String(),
              price: Type.Number(),
              quantity: Type.Number(),
            })
          ),
          couponCode: Type.Optional(Type.String()),
          shippingAmount: Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              subtotal: Type.Number(),
              discountTotal: Type.Number(),
              taxTotal: Type.Number(),
              shippingTotal: Type.Number(),
              total: Type.Number(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const { items, couponCode, shippingAmount } = req.body as {
        items: Array<{ productId: number; title: string; price: number; quantity: number }>;
        couponCode?: string;
        shippingAmount?: number;
      };

      let couponDiscount = 0;
      if (couponCode) {
        const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
        const check = await StoreService.validateCoupon(couponCode, subtotal);
        if (check.valid) {
          couponDiscount = check.discountAmount;
        }
      }

      const quote = StoreService.calculateTotals({ items, couponDiscount, shippingAmount });
      return reply.send({ data: quote });
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
};

export const storeModuleManifest: ModuleManifest = {
  name: 'store',
  version: '0.2.0',
  description: 'Ecommerce catalog, inventory, cart, checkout, payments, and orders',
  isCore: false,
  dependsOn: ['media'],
  permissions: [
    { key: 'store.products.view', description: 'View store products' },
    { key: 'store.products.edit', description: 'Create and edit store products' },
    { key: 'store.orders.view', description: 'View customer orders' },
    { key: 'store.orders.edit', description: 'Manage order status transitions and notes' },
    { key: 'store.orders.refund', description: 'Issue full and partial refunds for orders' },
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
  ],
  routesPrefix: '/store',
  routes: storeRoutes,
};
