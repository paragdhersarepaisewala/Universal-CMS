import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { CustomerService } from './customer-service.js';
import { authenticate } from '../../auth/middleware.js';
import { requirePermission } from '../../rbac/middleware.js';
import { requireModule } from '../guard.js';

export const customerStorefrontRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireModule('store'));
  fastify.addHook('preHandler', authenticate);

  // 1. Profile
  fastify.get('/profile', {
    schema: {
      description: 'Get authenticated customer profile and order stats',
      tags: ['Customer Accounts'],
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const profile = await CustomerService.getProfile(user.id);
    return reply.send({ data: profile });
  });

  fastify.put('/profile', {
    schema: {
      description: 'Update customer profile and communication preferences',
      tags: ['Customer Accounts'],
      body: Type.Object({
        name: Type.Optional(Type.String()),
        phone: Type.Optional(Type.String()),
        dateOfBirth: Type.Optional(Type.String()),
        communicationPreferences: Type.Optional(
          Type.Object({
            emailMarketing: Type.Optional(Type.Boolean()),
            smsOrderUpdates: Type.Optional(Type.Boolean()),
            whatsappUpdates: Type.Optional(Type.Boolean()),
          })
        ),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const body = req.body as any;
    const updated = await CustomerService.updateProfile(user.id, body);
    return reply.send({ data: updated });
  });

  fastify.post('/change-password', {
    schema: {
      description: 'Change customer password and invalidate active sessions',
      tags: ['Customer Accounts'],
      body: Type.Object({
        currentPassword: Type.String(),
        newPassword: Type.String(),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    try {
      await CustomerService.changePassword(user.id, currentPassword, newPassword);
      return reply.send({ success: true, message: 'Password changed successfully' });
    } catch (err: any) {
      return reply.status(400).send({ error: { code: 'INVALID_PASSWORD', message: err.message } });
    }
  });

  // 2. Saved Addresses
  fastify.get('/addresses', {
    schema: {
      description: 'List saved customer delivery addresses',
      tags: ['Customer Accounts'],
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const addresses = await CustomerService.listAddresses(user.id);
    return reply.send({ data: addresses });
  });

  fastify.post('/addresses', {
    schema: {
      description: 'Add a new delivery address',
      tags: ['Customer Accounts'],
      body: Type.Object({
        fullName: Type.String(),
        phone: Type.String(),
        addressLine1: Type.String(),
        addressLine2: Type.Optional(Type.String()),
        city: Type.String(),
        state: Type.String(),
        stateCode: Type.Optional(Type.String()),
        postalCode: Type.String(),
        country: Type.Optional(Type.String()),
        isDefault: Type.Optional(Type.Boolean()),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const body = req.body as any;
    const address = await CustomerService.addAddress(user.id, body);
    return reply.status(201).send({ data: address });
  });

  fastify.put('/addresses/:id', {
    schema: {
      description: 'Update an existing delivery address',
      tags: ['Customer Accounts'],
      params: Type.Object({ id: Type.Number() }),
      body: Type.Object({
        fullName: Type.Optional(Type.String()),
        phone: Type.Optional(Type.String()),
        addressLine1: Type.Optional(Type.String()),
        addressLine2: Type.Optional(Type.String()),
        city: Type.Optional(Type.String()),
        state: Type.Optional(Type.String()),
        stateCode: Type.Optional(Type.String()),
        postalCode: Type.Optional(Type.String()),
        country: Type.Optional(Type.String()),
        isDefault: Type.Optional(Type.Boolean()),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: number };
    const body = req.body as any;
    try {
      const address = await CustomerService.updateAddress(user.id, id, body);
      return reply.send({ data: address });
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    }
  });

  fastify.delete('/addresses/:id', {
    schema: {
      description: 'Delete a saved delivery address',
      tags: ['Customer Accounts'],
      params: Type.Object({ id: Type.Number() }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: number };
    try {
      await CustomerService.deleteAddress(user.id, id);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    }
  });

  fastify.post('/addresses/:id/default', {
    schema: {
      description: 'Set an address as default',
      tags: ['Customer Accounts'],
      params: Type.Object({ id: Type.Number() }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: number };
    try {
      const address = await CustomerService.setDefaultAddress(user.id, id);
      return reply.send({ data: address });
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    }
  });

  // 3. Wishlist
  fastify.get('/wishlist', {
    schema: {
      description: 'List customer wishlist products',
      tags: ['Customer Accounts'],
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const wishlist = await CustomerService.listWishlist(user.id);
    return reply.send({ data: wishlist });
  });

  fastify.post('/wishlist', {
    schema: {
      description: 'Add product to wishlist',
      tags: ['Customer Accounts'],
      body: Type.Object({
        productId: Type.Number(),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { productId } = req.body as { productId: number };
    try {
      const res = await CustomerService.addToWishlist(user.id, productId);
      return reply.status(201).send(res);
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'PRODUCT_NOT_FOUND', message: err.message } });
    }
  });

  fastify.delete('/wishlist/:productId', {
    schema: {
      description: 'Remove product from wishlist',
      tags: ['Customer Accounts'],
      params: Type.Object({ productId: Type.Number() }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { productId } = req.params as { productId: number };
    const res = await CustomerService.removeFromWishlist(user.id, productId);
    return reply.send(res);
  });

  // 4. Order History & Reorder
  fastify.get('/orders', {
    schema: {
      description: 'List customer orders with tracking information',
      tags: ['Customer Accounts'],
      querystring: Type.Object({
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
        status: Type.Optional(Type.String()),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const query = req.query as any;
    const result = await CustomerService.listCustomerOrders(user.id, user.email, query);
    return reply.send({ data: result.orders, meta: { total: result.total, page: result.page, perPage: result.perPage } });
  });

  fastify.get('/orders/:id', {
    schema: {
      description: 'Get customer order details with line items and tracking',
      tags: ['Customer Accounts'],
      params: Type.Object({ id: Type.Number() }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: number };
    try {
      const order = await CustomerService.getCustomerOrder(user.id, user.email, id);
      return reply.send({ data: order });
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    }
  });

  fastify.post('/orders/:id/reorder', {
    schema: {
      description: 'Prepare reorder payload with live stock validation',
      tags: ['Customer Accounts'],
      params: Type.Object({ id: Type.Number() }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: number };
    try {
      const reorder = await CustomerService.prepareReorder(user.id, user.email, id);
      return reply.send({ data: reorder });
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    }
  });

  // 5. Return Requests
  fastify.post('/orders/:id/return-request', {
    schema: {
      description: 'Submit a return/refund request for an order line item',
      tags: ['Customer Accounts'],
      params: Type.Object({ id: Type.Number() }),
      body: Type.Object({
        orderItemId: Type.Number(),
        reason: Type.String(),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: number };
    const { orderItemId, reason } = req.body as { orderItemId: number; reason: string };
    try {
      const returnReq = await CustomerService.submitReturnRequest(user.id, user.email, {
        orderId: id,
        orderItemId,
        reason,
      });
      return reply.status(201).send({ data: returnReq });
    } catch (err: any) {
      return reply.status(400).send({ error: { code: 'INVALID_RETURN_REQUEST', message: err.message } });
    }
  });

  fastify.get('/return-requests', {
    schema: {
      description: 'List customer return requests',
      tags: ['Customer Accounts'],
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const requests = await CustomerService.listCustomerReturnRequests(user.id);
    return reply.send({ data: requests });
  });

  // 6. DPDP Personal Data Export & Deletion
  fastify.post('/export-data', {
    schema: {
      description: 'Export all personal customer data under DPDP Act',
      tags: ['Customer Accounts'],
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const exportData = await CustomerService.exportPersonalData(user.id);
    return reply.send({ data: exportData });
  });

  fastify.post('/delete-account', {
    schema: {
      description: 'Request account deletion and personal data anonymization under DPDP Act',
      tags: ['Customer Accounts'],
      body: Type.Object({
        passwordConfirm: Type.String(),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { passwordConfirm } = req.body as { passwordConfirm: string };
    try {
      const res = await CustomerService.deleteAccount(user.id, passwordConfirm);
      return reply.send(res);
    } catch (err: any) {
      return reply.status(400).send({ error: { code: 'DELETION_FAILED', message: err.message } });
    }
  });
};

export const customerAdminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireModule('store'));
  fastify.addHook('preHandler', authenticate);

  // 1. List customers (paginated, search, segment)
  fastify.get('/customers', {
    preHandler: [requirePermission('store.customers.view')],
    schema: {
      description: 'Admin paginated customer directory with order stats and segments',
      tags: ['Admin Store'],
      querystring: Type.Object({
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
        search: Type.Optional(Type.String()),
        segment: Type.Optional(Type.String()),
      }),
    },
  }, async (req, reply) => {
    const query = req.query as any;
    const result = await CustomerService.adminListCustomers(query);
    return reply.send({
      data: result.customers,
      meta: { total: result.total, page: result.page, perPage: result.perPage },
    });
  });

  // 2. Customer CSV Export
  fastify.get('/customers/export', {
    preHandler: [requirePermission('store.customers.view')],
    schema: {
      description: 'Export customer directory to CSV format',
      tags: ['Admin Store'],
    },
  }, async (_req, reply) => {
    const csvData = await CustomerService.adminExportCustomersCsv();
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="customers-export.csv"');
    return reply.send(csvData);
  });

  // 3. Get single customer details
  fastify.get('/customers/:id', {
    preHandler: [requirePermission('store.customers.view')],
    schema: {
      description: 'Get customer profile, addresses, orders, return requests, and internal notes',
      tags: ['Admin Store'],
      params: Type.Object({ id: Type.Number() }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: number };
    try {
      const customer = await CustomerService.adminGetCustomer(id);
      return reply.send({ data: customer });
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    }
  });

  // 4. Update customer segment
  fastify.put('/customers/:id/segment', {
    preHandler: [requirePermission('store.customers.manage')],
    schema: {
      description: 'Assign customer segment (standard, vip, wholesale, at_risk)',
      tags: ['Admin Store'],
      params: Type.Object({ id: Type.Number() }),
      body: Type.Object({
        segment: Type.String(),
      }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: number };
    const { segment } = req.body as { segment: string };
    try {
      const res = await CustomerService.adminUpdateSegment(id, segment);
      return reply.send(res);
    } catch (err: any) {
      return reply.status(400).send({ error: { code: 'INVALID_SEGMENT', message: err.message } });
    }
  });

  // 5. Add staff note
  fastify.post('/customers/:id/notes', {
    preHandler: [requirePermission('store.customers.manage')],
    schema: {
      description: 'Add an internal staff note to customer record',
      tags: ['Admin Store'],
      params: Type.Object({ id: Type.Number() }),
      body: Type.Object({
        note: Type.String(),
      }),
    },
  }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: number };
    const { note } = req.body as { note: string };
    const newNote = await CustomerService.adminAddNote(id, user.id, note);
    return reply.status(201).send({ data: newNote });
  });

  // 6. Admin Return Requests List
  fastify.get('/return-requests', {
    preHandler: [requirePermission('store.customers.view')],
    schema: {
      description: 'List all return requests across customers',
      tags: ['Admin Store'],
      querystring: Type.Object({
        status: Type.Optional(Type.String()),
      }),
    },
  }, async (req, reply) => {
    const query = req.query as any;
    const requests = await CustomerService.adminListReturnRequests(query);
    return reply.send({ data: requests });
  });

  // 7. Admin Transition Return Request
  fastify.post('/return-requests/:id/transition', {
    preHandler: [requirePermission('store.customers.manage')],
    schema: {
      description: 'Approve, reject, or complete a customer return request',
      tags: ['Admin Store'],
      params: Type.Object({ id: Type.Number() }),
      body: Type.Object({
        status: Type.String(),
        adminNotes: Type.Optional(Type.String()),
      }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: number };
    const { status, adminNotes } = req.body as {
      status: 'approved' | 'rejected' | 'completed';
      adminNotes?: string;
    };
    try {
      const updated = await CustomerService.adminTransitionReturnRequest(id, status, adminNotes);
      return reply.send({ data: updated });
    } catch (err: any) {
      return reply.status(400).send({ error: { code: 'TRANSITION_FAILED', message: err.message } });
    }
  });
};
