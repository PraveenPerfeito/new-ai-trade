import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/webhooks/stripe');

// Stripe webhook — skeleton implementation.
// Wire up the real Stripe SDK and signature verification when billing goes live.
// All events are idempotency-guarded via the stripe_events table.

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role env vars not set');
  return createClient(url, key);
}

type StripeEventPayload = {
  id:   string;
  type: string;
  data: { object: Record<string, unknown> };
};

async function markProcessed(eventId: string, type: string, payload: StripeEventPayload): Promise<boolean> {
  // Insert with conflict → already processed
  const { error } = await adminDb()
    .from('stripe_events')
    .insert({ id: eventId, type, payload, processed: false });

  if (error?.code === '23505') return false;  // duplicate — already seen
  return !error;
}

async function setProcessed(eventId: string): Promise<void> {
  await adminDb()
    .from('stripe_events')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('id', eventId);
}

async function updateUserPlan(
  stripeCustomerId: string,
  patch: { plan_id?: string; subscription_status: string; plan_expires_at?: string | null },
): Promise<void> {
  const { error } = await adminDb()
    .from('users')
    .update(patch)
    .eq('stripe_customer_id', stripeCustomerId);
  if (error) log.error({ stripeCustomerId, err: error.message }, 'updateUserPlan failed');
}

export async function POST(req: NextRequest) {
  // TODO: verify Stripe-Signature header with stripe.webhooks.constructEvent()
  //       once STRIPE_WEBHOOK_SECRET is in env.
  let event: StripeEventPayload;
  try {
    event = await req.json() as StripeEventPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const isNew = await markProcessed(event.id, event.type, event);
  if (!isNew) {
    log.info({ eventId: event.id, type: event.type }, 'Stripe event already processed — skipping');
    return NextResponse.json({ received: true });
  }

  log.info({ eventId: event.id, type: event.type }, 'Processing Stripe event');

  const obj = event.data.object;

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const customerId = obj.customer as string;
        const status     = obj.status as string;
        const planId     = (obj.metadata as Record<string, string>)?.plan_id ?? 'pro';
        const periodEnd  = obj.current_period_end ? new Date((obj.current_period_end as number) * 1000).toISOString() : null;
        await updateUserPlan(customerId, {
          plan_id:            planId,
          subscription_status: status,
          plan_expires_at:    periodEnd,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const customerId = obj.customer as string;
        await updateUserPlan(customerId, {
          plan_id:             'free',
          subscription_status: 'canceled',
          plan_expires_at:     null,
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        const customerId = obj.customer as string;
        await updateUserPlan(customerId, { subscription_status: 'active' });
        break;
      }

      case 'invoice.payment_failed': {
        const customerId = obj.customer as string;
        await updateUserPlan(customerId, { subscription_status: 'past_due' });
        break;
      }

      case 'checkout.session.completed': {
        const customerId   = obj.customer as string;
        const subscriptionId = obj.subscription as string;
        if (customerId && subscriptionId) {
          await adminDb()
            .from('users')
            .update({ stripe_customer_id: customerId, stripe_subscription_id: subscriptionId })
            .eq('stripe_customer_id', customerId);
        }
        break;
      }

      default:
        log.debug({ type: event.type }, 'Unhandled Stripe event type — ignored');
    }

    await setProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Handler error';
    log.error({ eventId: event.id, type: event.type, err: msg }, 'Stripe event handler failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
