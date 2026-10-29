// native.ts
import { createServer, IncomingMessage, ServerResponse, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { URL } from "url";

let serverPort = 0;
let serverInstance: ReturnType<typeof createServer> | null = null;

export async function startProxy(): Promise<number> {
    if (serverPort && serverInstance) return serverPort;
    
    return new Promise((resolve, reject) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            // Handle CORS preflight (OPTIONS)
            if (req.method === "OPTIONS") {
                res.writeHead(204, {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "PUT, POST, GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Authorization, Content-Type, *",
                    "Access-Control-Max-Age": "86400"
                });
                res.end();
                return;
            }

            if (req.method === "PUT" && req.url?.startsWith("/upload/")) {
                const targetUrl = decodeURIComponent(req.url.replace("/upload/", ""));
                const authHeader = req.headers["authorization"] as string;
                const contentType = req.headers["content-type"] as string;
                
                try {
                    const parsedUrl = new URL(targetUrl);
                    // Dynamically use http or https based on the target URL
                    const requestFn = parsedUrl.protocol === "https:" ? httpsRequest : httpRequest;
                    
                    const proxyReq = requestFn(parsedUrl, {
                        method: "PUT",
                        headers: {
                            "Authorization": authHeader,
                            "Content-Type": contentType || "application/octet-stream",
                            "Content-Length": req.headers["content-length"]
                        }
                    }, (proxyRes) => {
                        const headers = { ...proxyRes.headers };
                        
                        // --- FIX: Strip upstream CORS headers to prevent duplicates ---
                        // Node.js automatically lowercases incoming header keys
                        delete headers["access-control-allow-origin"];
                        delete headers["access-control-allow-methods"];
                        delete headers["access-control-allow-headers"];
                        delete headers["access-control-expose-headers"];
                        delete headers["access-control-max-age"];
                        delete headers["access-control-allow-credentials"];
                        
                        // Attach exactly one clean CORS header
                        headers["access-control-allow-origin"] = "*";
                        
                        res.writeHead(proxyRes.statusCode || 500, headers);
                        proxyRes.pipe(res);
                    });
                    
                    proxyReq.on("error", (e) => {
                        console.error("[CustomCdnUploads Proxy] Request error:", e);
                        if (!res.headersSent) {
                            res.writeHead(500, { "Access-Control-Allow-Origin": "*" });
                            res.end(e.message);
                        }
                    });
                    
                    req.pipe(proxyReq);
                } catch (e: any) {
                    console.error("[CustomCdnUploads Proxy] URL parse error:", e);
                    if (!res.headersSent) {
                        res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
                        res.end("Invalid URL");
                    }
                }
            } else {
                res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
                res.end();
            }
        });
        
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address === "object") {
                serverPort = address.port;
                serverInstance = server;
                console.log(`[CustomCdnUploads Proxy] Listening on 127.0.0.1:${serverPort}`);
                resolve(serverPort);
            } else {
                reject(new Error("Failed to get server address"));
            }
        });
    });
}

export function stopProxy(): void {
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
        serverPort = 0;
    }
}