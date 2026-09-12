import * as crypto from 'crypto';

export function generateHMAC(key: string, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}
