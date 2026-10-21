import { NativeModule, requireNativeModule } from 'expo';

export type WifiInfo = {
  isWifi: boolean;
  ssid: string | null;
  frequency: number | null;
  ip: string | null;
  prefixLength: number | null;
  gateway: string | null;
};

export type WifiNetwork = { ssid: string; frequency: number; level: number };

type Events = {
  onTcpLine(e: { id: string; line: string }): void;
  onTcpClose(e: { id: string; error: string | null }): void;
  onHotspotLost(e: {}): void;
};

declare class YeenetModule extends NativeModule<Events> {
  md5(hex: string): string;
  aesEncrypt(keyHex: string, ivHex: string, dataHex: string): string;
  aesDecrypt(keyHex: string, ivHex: string, dataHex: string): string;
  udpRequest(host: string, port: number, dataHex: string, timeoutMs: number, onHotspot: boolean): Promise<string | null>;
  udpSweep(hosts: string[], port: number, dataHex: string, timeoutMs: number): Promise<{ ip: string; data: string }[]>;
  ssdpSearch(timeoutMs: number): Promise<{ ip: string; text: string }[]>;
  tcpOpen(id: string, host: string, port: number, timeoutMs: number): Promise<void>;
  tcpWrite(id: string, text: string): Promise<void>;
  tcpClose(id: string): void;
  getWifiInfo(): WifiInfo;
  scanWifi(timeoutMs: number): Promise<WifiNetwork[]>;
  joinHotspot(prefix: string, timeoutMs: number): Promise<{ gateway: string; ssid: string | null }>;
  releaseHotspot(): void;
}

export default requireNativeModule<YeenetModule>('Yeenet');
