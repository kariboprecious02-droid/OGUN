import { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { logger } from '@/infra/logger';
import { getRequestId, getContext } from '@/infra/requestContext';
import { recordCollectionEvent } from '@/modules/observability/collectionEvents';

function redactBody(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const obj = { ...(data as Record<string, unknown>) };
  if (obj.email && typeof obj.email === 'string') {
    obj.email = obj.email.replace(/^(.).+(@.+)$/, '$1***$2');
  }
  if (obj.mobile_money && typeof obj.mobile_money === 'object') {
    const mm = { ...(obj.mobile_money as Record<string, unknown>) };
    if (mm.phone && typeof mm.phone === 'string') {
      mm.phone = mm.phone.slice(0, 4) + '***' + mm.phone.slice(-2);
    }
    obj.mobile_money = mm;
  }
  if (obj.data && typeof obj.data === 'object') {
    const d = { ...(obj.data as Record<string, unknown>) };
    if (d.customer && typeof d.customer === 'object') {
      const cust = { ...(d.customer as Record<string, unknown>) };
      if (cust.email && typeof cust.email === 'string') {
        cust.email = (cust.email as string).replace(/^(.).+(@.+)$/, '$1***$2');
      }
      if (cust.phone && typeof cust.phone === 'string') {
        cust.phone = (cust.phone as string).slice(0, 4) + '***' + (cust.phone as string).slice(-2);
      }
      d.customer = cust;
    }
    obj.data = d;
  }
  return obj;
}

function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out = { ...headers };
  if (out.Authorization || out.authorization) {
    out.Authorization = '***';
    delete out.authorization;
  }
  return out;
}

export function attachPaystackInterceptors(http: AxiosInstance, connectorName: string): void {
  http.interceptors.request.use((req: InternalAxiosRequestConfig) => {
    (req as unknown as Record<string, unknown>)['_ogun_started_at'] = Date.now();
    const ctx = getContext();
    logger.info({
      target: connectorName,
      method: req.method,
      url: req.url,
      body: redactBody(req.data),
      headers: redactHeaders((req.headers ?? {}) as Record<string, unknown>),
      request_id: ctx?.request_id,
      collection_id: ctx?.collection_id,
    }, `${connectorName} request`);

    if (ctx?.collection_id) {
      recordCollectionEvent({
        collection_id: ctx.collection_id,
        event_type: 'provider.requested',
        source: 'connector',
        payload: {
          direction: 'Ogun → Paystack',
          method: req.method?.toUpperCase(),
          url: req.url,
          request_body: redactBody(req.data),
        },
        message: `${req.method?.toUpperCase()} ${req.url}`,
      });
    }
    return req;
  });

  http.interceptors.response.use(
    (res: AxiosResponse) => {
      const startedAt = (res.config as unknown as Record<string, unknown>)['_ogun_started_at'];
      const ms = typeof startedAt === 'number' ? Date.now() - startedAt : undefined;
      const txData = res.data?.data as Record<string, unknown> | undefined;
      logger.info({
        target: connectorName,
        method: res.config.method,
        url: res.config.url,
        status: res.status,
        latency_ms: ms,
        provider_status: txData?.status ?? res.data?.status,
        provider_message: txData?.gateway_response ?? res.data?.message,
        provider_reference: txData?.reference ?? res.data?.data?.reference,
        provider_call_state: txData?.status,
        response_data: redactBody(res.data),
        request_id: getRequestId(),
      }, `${connectorName} response`);

      const ctx = getContext();
      if (ctx?.collection_id) {
        recordCollectionEvent({
          collection_id: ctx.collection_id,
          event_type: 'provider.responded',
          source: 'connector',
          http_status: res.status,
          latency_ms: ms,
          payload: {
            direction: 'Paystack → Ogun',
            method: res.config.method?.toUpperCase(),
            url: res.config.url,
            response_body: redactBody(res.data),
          },
          message: `${res.status} ${res.config.url} (${ms}ms)`,
        });
      }
      return res;
    },
    (err: AxiosError) => {
      const startedAt = (err.config as unknown as Record<string, unknown> | undefined)?.['_ogun_started_at'];
      const ms = typeof startedAt === 'number' ? Date.now() - startedAt : undefined;
      logger.error({
        target: connectorName,
        method: err.config?.method,
        url: err.config?.url,
        latency_ms: ms,
        err_code: err.code,
        status: err.response?.status,
        response_data: redactBody(err.response?.data),
        request_id: getRequestId(),
      }, `${connectorName} request failed`);

      const ctx = getContext();
      if (ctx?.collection_id) {
        recordCollectionEvent({
          collection_id: ctx.collection_id,
          event_type: 'provider.errored',
          source: 'connector',
          http_status: err.response?.status,
          latency_ms: ms,
          payload: {
            direction: 'Paystack → Ogun',
            method: err.config?.method?.toUpperCase(),
            url: err.config?.url,
            err_code: err.code,
            response_body: redactBody(err.response?.data),
          },
          message: `${err.code ?? 'ERROR'} ${err.config?.url} (${ms}ms)`,
        });
      }
      return Promise.reject(err);
    },
  );
}
