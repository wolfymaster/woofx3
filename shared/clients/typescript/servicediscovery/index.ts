import { networkInterfaces } from 'os';
import Bonjour, { Browser, Service } from 'bonjour-service';
export { Service };

interface ServiceHandlerCallbacks {
    onServiceFound(service: Service): void;
    onServiceLost(service: Service): void;
}

export interface ServiceHandler extends ServiceHandlerCallbacks {
    name: string;
}

interface ServiceDiscoveryConfig {
    serviceName: string; 
    serviceType: string;
    port: number;
    callbacks: ServiceHandlerCallbacks;
}

export class ServiceDiscovery {
    private serviceName: string;
    private serviceType: string;
    private port: number;
    private callbacks: ServiceHandlerCallbacks;
    private bonjour: Bonjour;
    private knownServices: Map<string, Service>;
    private service: Service | null;
    private browser: Browser | null;
    private serviceWaiters: Map<string, {
        resolve: (value: Service | PromiseLike<Service>) => void;
        reject: (reason?: any) => void;
        timeout: NodeJS.Timeout;
    }>;
    
    constructor(config: ServiceDiscoveryConfig) {
        this.serviceName = config.serviceName;
        this.serviceType = config.serviceType;
        this.port = config.port;
        this.callbacks = config.callbacks;

        this.bonjour = new Bonjour();
        this.knownServices = new Map();
        this.service = null;
        this.browser = null;
        this.serviceWaiters = new Map();
    }

    // Start service registration and discovery
    async start(capabilities = {}) {
        try {
            await this.registerService(capabilities);
            this.startDiscovery();
            console.log(`🚀 Service discovery started for ${this.serviceName}`);
        } catch (error) {
            console.error('Failed to start service discovery:', error);
            throw error;
        }
    }

    // Register this service
    async registerService(capabilities: any) {
        const txtRecord = {
            ...capabilities,
            started: Date.now().toString()
        };

        this.service = this.bonjour.publish({
            name: this.serviceName,
            type: this.serviceType,
            port: this.port,
            txt: txtRecord
        });

        console.log(`📡 Broadcasting service: ${this.serviceName}.${this.serviceType} on port ${this.port}`);
        console.log('   Capabilities:', capabilities);
    }

    // Start discovering other services
    startDiscovery() {
        this.browser = this.bonjour.find({ type: this.serviceType }, (service) => {
            this.handleServiceUp(service);
        });

        this.browser.on('down', (service) => {
            this.handleServiceDown(service);
        });

        console.log(`🔍 Started discovery for services of type: ${this.serviceType}`);
    }

    // Handle new service discovery
    handleServiceUp(service: Service) {
        // Skip our own service
        if (service.name === this.serviceName) {
            return;
        }

        const address = service.referer?.address || service.addresses?.[0] || 'unknown';
        const port = service.port;
        const txt = service.txt;
        const key = `${address}:${port}`;
        
        // Only trigger callback for truly new services
        if (!this.knownServices.has(key)) {
            this.knownServices.set(key, service);

            console.log(`🟢 NEW SERVICE FOUND: ${service.name} at ${address}:${port}`);
            if (Object.keys(txt).length > 0) {
                console.log('   Capabilities:', txt);
            }

            // Trigger callback
            if (this.callbacks?.onServiceFound) {
                this.callbacks.onServiceFound(service);
            }

            this.serviceWaiters.get(service.name)?.resolve(service);
        }
    }

    // Handle service going down
    handleServiceDown(service: Service) {
        if (service.name === this.serviceName) {
            return;
        }

        const address = service.referer?.address || service.addresses?.[0] || 'unknown';
        const key = `${address}:${service.port}`;
        
        if (this.knownServices.has(key)) {
            const serviceInfo = this.knownServices.get(key);
            this.knownServices.delete(key);
            
            console.log(`🔴 SERVICE LOST: ${serviceInfo.name} at ${serviceInfo.address}:${serviceInfo.port}`);

            // Trigger callback
            if (this.callbacks?.onServiceLost) {
                this.callbacks.onServiceLost(serviceInfo);
            }
        }
    }

    // Get all known services
    getKnownServices() {
        return Array.from(this.knownServices.values());
    }

    // Shutdown service discovery
    shutdown() {
        if (this.browser) {
            this.browser.stop();
        }
        if (this.service) {
            this.service.stop();
        }
        this.bonjour.destroy();
        console.log('🛑 Service discovery stopped');
    }

    // Wait for a specific service to become available
    async waitForService(serviceName: string, timeoutMs = 30000): Promise<Service> {
        // Check if service is already available
        const existingService = this.knownServices.get(serviceName);
        if (existingService) {
            console.log(`✅ Service ${serviceName} already available`);
            return existingService;
        }

        console.log(`⏳ Waiting for service: ${serviceName}...`);

        return new Promise((resolve, reject) => {
            // Set up timeout
            const timeout = setTimeout(() => {
                this.serviceWaiters.delete(serviceName);
                reject(new Error(`Timeout waiting for service: ${serviceName} (${timeoutMs}ms)`));
            }, timeoutMs);

            // Store the waiter
            const waiter = { resolve, reject, timeout };
            
            if (!this.serviceWaiters.has(serviceName)) {
                this.serviceWaiters.set(serviceName, waiter);
            }
        });
    }
        
}

// Get local IP address
export function getLocalIP() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        if(!nets[name]) {
            continue;
        }

        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// Main function
// async function main() {
//     const args = process.argv.slice(2);
//     if (args.length < 2) {
//         console.error('Usage: node service.js <service-name> <port>');
//         process.exit(1);
//     }

//     const serviceName = args[0];
//     const port = parseInt(args[1]);

//     if (isNaN(port)) {
//         console.error('Invalid port number');
//         process.exit(1);
//     }

//     // Create service handler
//     const handler = new MyServiceHandler(serviceName);

//     // Create service discovery
//     const discovery = new ServiceDiscovery(
//         serviceName,
//         '_myapp._tcp',
//         port,
//         {
//             onServiceFound: (service) => handler.onServiceFound(service),
//             onServiceLost: (service) => handler.onServiceLost(service)
//         }
//     );

//     // Define service capabilities
//     const capabilities = {
//         version: '1.0.0',
//         api: 'rest',
//         features: 'chat,file-sharing,notifications',
//         ip: getLocalIP()
//     };

//     try {
//         // Start discovery
//         await discovery.start(capabilities);

//         // Print status periodically
//         setInterval(() => {
//             const services = discovery.getKnownServices();
//             console.log(`📊 Status: ${services.length} known services`);
//         }, 30000);

//         // Handle shutdown gracefully
//         process.on('SIGINT', () => {
//             console.log(`\nShutting down ${serviceName}...`);
//             discovery.shutdown();
//             process.exit(0);
//         });

//         console.log(`Service ${serviceName} running on port ${port}`);
//         console.log('Press Ctrl+C to stop');

//     } catch (error) {
//         console.error('Failed to start service:', error);
//         process.exit(1);
//     }
// }