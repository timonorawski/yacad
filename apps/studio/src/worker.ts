// Web Worker entry: hosts the evaluation backend (engine + tiered cache +
// Manifold kernel). Built as an ES worker by Vite so it can import those
// modules. The WASM URL arrives via an `init` message from the main thread.
import { startHost, type WorkerScope } from '@yacad/worker/host';

startHost(self as unknown as WorkerScope);
