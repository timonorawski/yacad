// Provides a structured-clone-backed IndexedDB implementation in the Node test
// environment so @yacad/cache's L2 tier can be exercised without a browser.
import 'fake-indexeddb/auto';
