export type RequestConfig = {
  locale: string;
  messages: Record<string, unknown>;
};

export type RequestConfigFactory = (args: {
  locale?: string;
}) => RequestConfig | Promise<RequestConfig>;

export function getRequestConfig(factory: RequestConfigFactory): RequestConfigFactory {
  return factory;
}

