/// <reference types="vite/client" />

interface BatteryManager extends EventTarget {
  level: number;
  addEventListener(type: 'levelchange', listener: () => void): void;
}
