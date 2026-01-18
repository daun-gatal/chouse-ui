// Global setup - runs once before all test files
export default function globalSetup() {
  // Mock storage before any tests run
  const storageMock = () => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (index: number) => Object.keys(store)[index] || null,
    };
  };

  (global as any).localStorage = storageMock();
  (global as any).sessionStorage = storageMock();
  
  return () => {
    // Teardown if needed
  };
}
