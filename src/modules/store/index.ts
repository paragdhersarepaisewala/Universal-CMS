import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ModuleManifest } from '../types.js';
import { requireModule } from '../guard.js';
import { StoreService } from './service.js';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';

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
      const { items, couponCode } = req.body as {
        items: Array<{ productId: number; title: string; price: number; quantity: number }>;
        couponCode?: string;
      };

      let couponDiscount = 0;
      if (couponCode) {
        const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
        const check = await StoreService.validateCoupon(couponCode, subtotal);
        if (check.valid) {
          couponDiscount = check.discountAmount;
        }
      }

      const quote = StoreService.calculateTotals({ items, couponDiscount });
      return reply.send({ data: quote });
    }
  );

  // 4. POST /store/checkout - Place order
  fastify.post(
    '/checkout',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Place an order via Razorpay or Cash on Delivery',
        tags: ['Store'],
        body: Type.Object({
          customerEmail: Type.String({ format: 'email' }),
          paymentMethod: Type.Union([Type.Literal('razorpay'), Type.Literal('cod')]),
          items: Type.Array(
            Type.Object({
              productId: Type.Number(),
              title: Type.String(),
              price: Type.Number(),
              quantity: Type.Number(),
            })
          ),
          shippingAddress: Type.Record(Type.String(), Type.Any()),
          couponCode: Type.Optional(Type.String()),
          notes: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              orderNumber: Type.String(),
              total: Type.Number(),
              paymentMethod: Type.String(),
              status: Type.String(),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body as Parameters<typeof StoreService.createOrder>[0];
      try {
        const order = await StoreService.createOrder(body);
        return reply.send({
          data: {
            orderNumber: order.orderNumber,
            total: order.total,
            paymentMethod: order.paymentMethod,
            status: order.status,
          },
        });
      } catch (err: unknown) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Checkout failed',
        });
      }
    }
  );

  // 5. POST /store/checkout/razorpay/verify - Verify signature
  fastify.post(
    '/checkout/razorpay/verify',
    {
      preHandler: [requireModule('store')],
      schema: {
        description: 'Verify Razorpay payment signature and mark order captured',
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

      const secret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret_default';
      const valid = StoreService.verifyRazorpaySignature(
        body.razorpayOrderId,
        body.razorpayPaymentId,
        body.razorpaySignature,
        secret
      );

      if (!valid) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Razorpay signature verification failed',
        });
      }

      const order = await StoreService.markOrderPaid(body.orderNumber, body.razorpayPaymentId);
      return reply.send({ data: { success: true, order } });
    }
  );

  // 6. GET /store/products/:slug/reviews - Public reviews
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

  // 7. POST /store/products/:slug/reviews - Submit review
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
      const review = await StoreService.submitReview({ ...body, entityId: slug });
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

  // Admin create product
  fastify.post(
    '/products',
    {
      preHandler: [authenticate, requirePermission('store.products.edit')],
      schema: {
        description: 'Create ecommerce product',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
          description: Type.Optional(Type.String()),
          sku: Type.Optional(Type.String()),
          price: Type.Number(),
          compareAtPrice: Type.Optional(Type.Number()),
          stockQuantity: Type.Optional(Type.Number()),
          lowStockThreshold: Type.Optional(Type.Number()),
          status: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as Parameters<typeof StoreService.createProduct>[0];
      const prod = await StoreService.createProduct(body);
      return reply.send({ data: prod });
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
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const body = req.body as Partial<Parameters<typeof StoreService.updateProduct>[1]>;
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

  // Admin update order status
  fastify.put(
    '/orders/:id/status',
    {
      preHandler: [authenticate, requirePermission('store.orders.view')],
      schema: {
        description: 'Update order fulfillment status',
        tags: ['Admin Store'],
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.Number() }),
        body: Type.Object({
          status: Type.String(),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: number };
      const { status } = req.body as { status: Parameters<typeof StoreService.updateOrderStatus>[1] };
      const updated = await StoreService.updateOrderStatus(id, status);
      if (!updated) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      return reply.send({ data: updated });
    }
  );
};

export const storeModuleManifest: ModuleManifest = {
  name: 'store',
  version: '0.1.0',
  description: 'Ecommerce catalog, inventory, cart, checkout, and orders',
  isCore: false,
  dependsOn: ['media'],
  permissions: [
    { key: 'store.products.view', description: 'View store products' },
    { key: 'store.products.edit', description: 'Create and edit store products' },
    { key: 'store.orders.view', description: 'View and manage customer orders' },
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
