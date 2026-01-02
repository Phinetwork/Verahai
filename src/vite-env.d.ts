/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface BatteryManager extends EventTarget {
  level: number;
  addEventListener(type: 'levelchange', listener: () => void): void;
}
