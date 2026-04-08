const URL_SCHEME_REGEX = /^[a-z][a-z\d+\-.]*:\/\//i;

export const normalizeAnkiConnectUrl = (ankiConnectUrl: string): string => {
  const trimmedUrl = ankiConnectUrl.trim();

  if (!trimmedUrl.length) {
    throw new Error('Anki URL is not set');
  }

  const parsed = new URL(URL_SCHEME_REGEX.test(trimmedUrl) ? trimmedUrl : `http://${trimmedUrl}`);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Anki URL must use http or https');
  }

  if (!parsed.hostname.length) {
    throw new Error('Anki URL is invalid');
  }

  if (parsed.hostname === '127.0.0.1') {
    parsed.hostname = 'localhost';
  }

  parsed.hash = '';
  parsed.search = '';

  return parsed.toString();
};
