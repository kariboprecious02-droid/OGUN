import { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { logger } from '@/infra/logger';
import { getRequestId, getContext } from '@/infra/requestContext';

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
    return req;
  });

  http.interceptors.response.use(
    (res: AxiosResponse) => {
      const startedAt = (res.config as unknown as Record<string, unknown>)['_ogun_started_at'];
      const ms = typeof startedAt === 'number' ? Date.now() - startedAt : undefined;
      logger.info({
        target: connectorName,
        method: res.config.method,
        url: res.config.url,
        status: res.status,
        latency_ms: ms,
        provider_status: res.data?.status,
        provider_message: res.data?.message,
        provider_reference: res.data?.data?.reference,
        request_id: getRequestId(),
      }, `${connectorName} response`);
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
      return Promise.reject(err);
    },
  );
}
