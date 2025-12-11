import { Service } from "bonjour-service";
import { type ServiceHandler } from "../index";

class MessageBusServiceHandler implements ServiceHandler {
    constructor(public name: string) {}

    async onServiceFound(service: Service) {
        console.log(`👋 Discovered: ${service.name}`);
        
        // Example: automatically ping the new service
        await this.pingNewService(service);
    }

    onServiceLost(service: Service) {
        console.log(`💔 Lost connection to: ${service.name}`);
        // Handle service removal (update routes, close connections, etc.)
    }

    async pingNewService(service: Service) {
        try {
            // Wait a moment for service to be ready
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log(`🏓 Pinging ${service.name} at ${service.addresses?.[0]}:${service.port}`);
            
            // Example HTTP ping (if it's a web service)
            const response = await fetch(`http://${service.addresses?.[0]}:${service.port}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });
            
            if (response.ok) {
                console.log(`✅ Successfully pinged ${service.name}`);
                const data = await response.text();
                console.log(`   Response: ${data}`);
            }
        } catch (error: any) {
            console.log(`❌ Failed to ping ${service.name}: ${error.message}`);
        }
    }
}

export default new MessageBusServiceHandler('messagebus');