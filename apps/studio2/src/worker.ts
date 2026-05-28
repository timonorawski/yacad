import { startHost } from '@yacad/worker/host';

startHost(self as unknown as Parameters<typeof startHost>[0]);
