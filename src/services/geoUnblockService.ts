import * as https from 'https';
import * as http from 'http';
import * as net from 'net';

const SOUNDCLOUD_API_HOST = 'api-v2.soundcloud.com';

export class GeoUnblockService {
    private enabled: boolean = false;
    private sessionInstance: Electron.Session;
    private proxyHost: string | null = null;
    private proxyPort: number | null = null;
    private server: http.Server | null = null;
    private localPort: number = 19876;

    constructor(sessionInstance: Electron.Session) {
        this.sessionInstance = sessionInstance;
    }

    public async setEnabled(enabled: boolean): Promise<void> {
        this.enabled = enabled;
        if (enabled) {
            const ok = await this.fetchProxy();
            if (!ok) return;
            await this.startLocalProxy();
            await this.sessionInstance.setProxy({
                proxyRules: `http://127.0.0.1:${this.localPort}`,
                proxyBypassRules: '<-loopback>',
            });
        } else {
            await this.stopLocalProxy();
            await this.sessionInstance.setProxy({ mode: 'direct' });
        }
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    private async fetchProxy(): Promise<boolean> {
        return new Promise((resolve) => {
            const url = 'https://pubproxy.com/api/proxy?limit=1&format=json&type=http&country=US&https=true&last_check=60';
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        const proxy = json?.data?.[0];
                        if (proxy) {
                            this.proxyHost = proxy.ip;
                            this.proxyPort = parseInt(proxy.port);
                            console.log(`[GeoUnblock] Using proxy: ${this.proxyHost}:${this.proxyPort}`);
                            resolve(true);
                        } else {
                            console.error('[GeoUnblock] No proxy returned from pubproxy');
                            resolve(false);
                        }
                    } catch (e) {
                        console.error('[GeoUnblock] Failed to parse proxy response', e);
                        resolve(false);
                    }
                });
            }).on('error', (e) => {
                console.error('[GeoUnblock] Failed to fetch proxy', e);
                resolve(false);
            });
        });
    }

    private startLocalProxy(): Promise<void> {
        return new Promise((resolve) => {
            this.server = http.createServer((req, res) => {
                const targetHost = new URL(req.url!).hostname;
                const useProxy = targetHost === SOUNDCLOUD_API_HOST;

                if (useProxy && this.proxyHost && this.proxyPort) {
                    const proxyReq = http.request({
                        host: this.proxyHost,
                        port: this.proxyPort,
                        method: req.method,
                        path: req.url,
                        headers: req.headers,
                    }, (proxyRes) => {
                        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
                        proxyRes.pipe(res);
                    });
                    req.pipe(proxyReq);
                    proxyReq.on('error', () => res.end());
                } else {
                    const parsed = new URL(req.url!);
                    const directReq = https.request({
                        host: parsed.hostname,
                        port: parsed.port || 443,
                        method: req.method,
                        path: parsed.pathname + parsed.search,
                        headers: req.headers,
                    }, (directRes) => {
                        res.writeHead(directRes.statusCode!, directRes.headers);
                        directRes.pipe(res);
                    });
                    req.pipe(directReq);
                    directReq.on('error', () => res.end());
                }
            });

            this.server.on('connect', (req, socket, head) => {
                const [host, portStr] = req.url!.split(':');
                const port = parseInt(portStr) || 443;
                const useProxy = host === SOUNDCLOUD_API_HOST;

                if (useProxy && this.proxyHost && this.proxyPort) {
                    const proxySocket = net.connect(this.proxyPort, this.proxyHost, () => {
                        proxySocket.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n\r\n`);
                        proxySocket.once('data', () => {
                            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                            proxySocket.write(head);
                            socket.pipe(proxySocket);
                            proxySocket.pipe(socket);
                        });
                    });
                    proxySocket.on('error', () => socket.destroy());
                } else {
                    const directSocket = net.connect(port, host, () => {
                        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                        directSocket.write(head);
                        socket.pipe(directSocket);
                        directSocket.pipe(socket);
                    });
                    directSocket.on('error', () => socket.destroy());
                }
            });

            this.server.listen(this.localPort, '127.0.0.1', () => {
                console.log(`[GeoUnblock] Local proxy started on port ${this.localPort}`);
                resolve();
            });
        });
    }

    private stopLocalProxy(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}
