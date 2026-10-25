export type OrderStatus =
  | 'pending_payment'
  | 'payment_failed'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'return_requested'
  | 'returned'
  | 'refunded'
  | 'partially_refunded'
  | 'payment_received_after_expiry';

export type OrderKind = 'physical' | 'digital' | 'mixed';

export interface StateTransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  requiredPermission?: string;
  allowedKinds?: OrderKind[];
  description: string;
}

export const STATE_TRANSITIONS: StateTransitionRule[] = [
  // 1. Initial checkout -> payment outcomes
  {
    from: 'pending_payment',
    to: 'confirmed',
    description: 'Payment successfully captured',
  },
  {
    from: 'pending_payment',
    to: 'payment_failed',
    description: 'Payment attempt failed',
  },
  {
    from: 'pending_payment',
    to: 'cancelled',
    description: 'Order expired or cancelled before payment',
  },

  // 2. Retry from payment_failed
  {
    from: 'payment_failed',
    to: 'pending_payment',
    description: 'Customer retries payment checkout',
  },
  {
    from: 'payment_failed',
    to: 'cancelled',
    description: 'Abandoned failed order cancelled',
  },

  // 3. Confirmed orders
  {
    from: 'confirmed',
    to: 'completed',
    allowedKinds: ['digital'],
    description: 'Digital-only order automatically completed upon entitlement grant',
  },
  {
    from: 'confirmed',
    to: 'processing',
    allowedKinds: ['physical', 'mixed'],
    requiredPermission: 'store.orders.edit',
    description: 'Warehouse picks and packs physical order',
  },
  {
    from: 'confirmed',
    to: 'cancelled',
    requiredPermission: 'store.orders.edit',
    description: 'Order cancelled by customer or staff before processing',
  },
  {
    from: 'confirmed',
    to: 'refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Order refunded before processing',
  },

  // 4. Processing orders (physical or mixed)
  {
    from: 'processing',
    to: 'shipped',
    allowedKinds: ['physical', 'mixed'],
    requiredPermission: 'store.orders.edit',
    description: 'Order dispatched with tracking number',
  },
  {
    from: 'processing',
    to: 'cancelled',
    allowedKinds: ['physical', 'mixed'],
    requiredPermission: 'store.orders.edit',
    description: 'Processing cancelled by merchant',
  },
  {
    from: 'processing',
    to: 'refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Order refunded while processing',
  },
  {
    from: 'processing',
    to: 'partially_refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Order partially refunded while processing',
  },

  // 5. Shipped orders
  {
    from: 'shipped',
    to: 'delivered',
    allowedKinds: ['physical', 'mixed'],
    description: 'Courier tracking confirms delivery',
  },
  {
    from: 'shipped',
    to: 'return_requested',
    allowedKinds: ['physical', 'mixed'],
    description: 'Return requested while in transit or delivery failed',
  },

  // 6. Delivered orders
  {
    from: 'delivered',
    to: 'completed',
    allowedKinds: ['physical', 'mixed'],
    description: 'Order fulfilled and return window elapsed',
  },
  {
    from: 'delivered',
    to: 'return_requested',
    allowedKinds: ['physical', 'mixed'],
    description: 'Customer requests return within allowed return window',
  },
  {
    from: 'delivered',
    to: 'refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Merchant grants full refund on delivered order',
  },
  {
    from: 'delivered',
    to: 'partially_refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Merchant grants partial refund on delivered order',
  },

  // 7. Returns flow
  {
    from: 'return_requested',
    to: 'returned',
    allowedKinds: ['physical', 'mixed'],
    requiredPermission: 'store.orders.edit',
    description: 'Returned items received and inspected at warehouse',
  },
  {
    from: 'return_requested',
    to: 'delivered',
    allowedKinds: ['physical', 'mixed'],
    requiredPermission: 'store.orders.edit',
    description: 'Return request rejected or cancelled; status reverts to delivered',
  },
  {
    from: 'returned',
    to: 'refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Full refund issued after return inspection',
  },
  {
    from: 'returned',
    to: 'partially_refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Partial refund issued after return inspection',
  },

  // 8. Completed orders can still receive refunds or return requests
  {
    from: 'completed',
    to: 'return_requested',
    allowedKinds: ['physical', 'mixed'],
    description: 'Customer requests return on completed order within window',
  },
  {
    from: 'completed',
    to: 'refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Customer goodwill refund issued on completed order',
  },
  {
    from: 'completed',
    to: 'partially_refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Partial refund issued on completed order',
  },

  // 9. Late payment arrival after expiry
  {
    from: 'cancelled',
    to: 'payment_received_after_expiry',
    description: 'Payment arrived late for an expired/cancelled order',
  },
  {
    from: 'cancelled',
    to: 'confirmed',
    description: 'Stock successfully re-reserved after late payment on expired order',
  },
  {
    from: 'payment_received_after_expiry',
    to: 'refunded',
    description: 'Auto-refund issued when stock unavailable for late payment',
  },
  {
    from: 'payment_received_after_expiry',
    to: 'confirmed',
    description: 'Admin manually allocates stock and confirms order',
  },

  // 10. Multi-refund transitions
  {
    from: 'partially_refunded',
    to: 'refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Remaining order balance refunded',
  },
  {
    from: 'partially_refunded',
    to: 'partially_refunded',
    requiredPermission: 'store.orders.refund',
    description: 'Additional partial refund issued',
  },
];

// Monotonic ranks to prevent out-of-order webhook regression
const STATUS_RANKS: Record<OrderStatus, number> = {
  pending_payment: 10,
  payment_failed: 10,
  cancelled: 20,
  payment_received_after_expiry: 25,
  confirmed: 30,
  processing: 40,
  shipped: 50,
  delivered: 60,
  completed: 70,
  return_requested: 75,
  returned: 80,
  partially_refunded: 85,
  refunded: 90,
};

export function canTransition(from: OrderStatus, to: OrderStatus, kind: OrderKind = 'physical'): boolean {
  if (from === to && from !== 'partially_refunded') {
    return false;
  }

  const rule = STATE_TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) {
    return false;
  }

  if (rule.allowedKinds && !rule.allowedKinds.includes(kind)) {
    return false;
  }

  return true;
}

export function isMonotonicRegression(currentStatus: OrderStatus, incomingStatus: OrderStatus): boolean {
  // If order is confirmed or later, incoming payment_failed must be ignored
  if (STATUS_RANKS[currentStatus] >= STATUS_RANKS.confirmed && incomingStatus === 'payment_failed') {
    return true;
  }
  return false;
}
