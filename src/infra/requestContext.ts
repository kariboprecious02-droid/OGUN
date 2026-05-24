import { AsyncLocalStorage } from 'node:async_hooks';

type RequestContext = {
  request_id: string;
  correlation_id?: string;
  merchant_id?: string;
  collection_id?: string;
  payout_id?: string;
};

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return als.getStore();
}

export function getRequestId(): string | undefined {
  return als.getStore()?.request_id;
}

export function setContextField(key: keyof RequestContext, value: string): void {
  const store = als.getStore();
  if (store) (store as Record<string, unknown>)[key] = value;
}
