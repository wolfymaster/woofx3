package servicediscovery

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/grandcat/zeroconf"
)

// ServiceInfo represents a discovered service
type ServiceInfo struct {
	Name    string
	Address string
	Port    int
	TXT     map[string]string
}

// ServiceCallbacks defines the callback interface
type ServiceCallbacks interface {
	OnServiceFound(service ServiceInfo)
	OnServiceLost(service ServiceInfo)
}

// Service implements the callback interface
type Service struct {
	Name string
}

// OnServiceFound is called when a new service is discovered
func (s *Service) OnServiceFound(service ServiceInfo) {
	log.Printf("🟢 NEW SERVICE FOUND: %s at %s:%d", service.Name, service.Address, service.Port)

	// Print service capabilities from TXT records
	if len(service.TXT) > 0 {
		log.Printf("   Capabilities:")
		for key, value := range service.TXT {
			log.Printf("     %s: %s", key, value)
		}
	}

	// Here you could:
	// - Add the service to your load balancer
	// - Establish a connection
	// - Register for health checks
	// - Update your service mesh configuration

	// Example: automatically ping the new service
	go s.pingNewService(service)
}

// OnServiceLost is called when a service disappears
func (s *Service) OnServiceLost(service ServiceInfo) {
	log.Printf("🔴 SERVICE LOST: %s at %s:%d", service.Name, service.Address, service.Port)

	// Here you could:
	// - Remove from load balancer
	// - Close connections
	// - Update routing tables
	// - Trigger failover procedures
}

// pingNewService demonstrates interacting with a newly discovered service
func (s *Service) pingNewService(service ServiceInfo) {
	// Wait a moment for the service to be fully ready
	time.Sleep(2 * time.Second)

	log.Printf("👋 Attempting to connect to %s...", service.Name)

	// Example: try to establish a TCP connection
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", service.Address, service.Port), 5*time.Second)
	if err != nil {
		log.Printf("❌ Failed to connect to %s: %v", service.Name, err)
		return
	}
	defer conn.Close()

	log.Printf("✅ Successfully connected to %s", service.Name)

	// You could send a handshake message here
	// conn.Write([]byte("HELLO"))
}

// ServiceDiscovery manages mDNS service discovery with callbacks
type ServiceDiscovery struct {
	serviceName   string
	serviceType   string
	port          int
	server        *zeroconf.Server
	callbacks     ServiceCallbacks
	knownServices map[string]ServiceInfo
	ctx           context.Context
	cancel        context.CancelFunc
}

// NewServiceDiscovery creates a new service discovery manager
func NewServiceDiscovery(serviceName, serviceType string, port int, callbacks ServiceCallbacks) *ServiceDiscovery {
	ctx, cancel := context.WithCancel(context.Background())

	return &ServiceDiscovery{
		serviceName:   serviceName,
		serviceType:   serviceType,
		port:          port,
		callbacks:     callbacks,
		knownServices: make(map[string]ServiceInfo),
		ctx:           ctx,
		cancel:        cancel,
	}
}

// Start begins service registration and discovery
func (sd *ServiceDiscovery) Start(capabilities map[string]string) error {
	// Register our own service
	if err := sd.registerService(capabilities); err != nil {
		return fmt.Errorf("failed to register service: %v", err)
	}

	// Start discovery in background
	go sd.continuousDiscovery()

	log.Printf("🚀 Service discovery started for %s", sd.serviceName)
	return nil
}

// registerService advertises this service on the network
func (sd *ServiceDiscovery) registerService(capabilities map[string]string) error {
	// Convert capabilities to TXT records
	var txtRecords []string
	for key, value := range capabilities {
		txtRecords = append(txtRecords, fmt.Sprintf("%s=%s", key, value))
	}

	// Add some default metadata
	txtRecords = append(txtRecords, fmt.Sprintf("started=%d", time.Now().Unix()))

	// Get local IPs
	// ips, err := getLocalIPs()
	// if err != nil {
	// 	return err
	// }

	// Get interfaces
	interfaces, err := getInterfaces()
	if err != nil {
		return err
	}

	// Register the service
	server, err := zeroconf.Register(
		sd.serviceName,
		sd.serviceType,
		"local.",
		sd.port,
		txtRecords,
		interfaces,
	)
	if err != nil {
		return err
	}

	sd.server = server
	log.Printf("📡 Broadcasting service: %s.%s on port %d", sd.serviceName, sd.serviceType, sd.port)

	return nil
}

// continuousDiscovery runs discovery in a loop
func (sd *ServiceDiscovery) continuousDiscovery() {
	for {
		select {
		case <-sd.ctx.Done():
			return
		default:
			sd.performDiscovery()
			time.Sleep(10 * time.Second) // Discover every 10 seconds
		}
	}
}

// performDiscovery looks for services and triggers callbacks
func (sd *ServiceDiscovery) performDiscovery() {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		log.Printf("Failed to create resolver: %v", err)
		return
	}

	entries := make(chan *zeroconf.ServiceEntry)

	// Create a timeout context for this discovery round
	ctx, cancel := context.WithTimeout(sd.ctx, 5*time.Second)
	defer cancel()

	// Start browsing
	go func() {
		if err := resolver.Browse(ctx, sd.serviceType, "local.", entries); err != nil {
			log.Printf("Browse error: %v", err)
		}
	}()

	currentServices := make(map[string]ServiceInfo)

	// Collect discovered services
	for {
		select {
		case entry := <-entries:
			if entry.Instance == sd.serviceName {
				continue // Skip our own service
			}

			service := sd.entryToServiceInfo(entry)
			if service.Address != "" {
				key := fmt.Sprintf("%s:%d", service.Address, service.Port)
				currentServices[key] = service
			}

		case <-ctx.Done():
			// Discovery round complete, check for changes
			sd.processServiceChanges(currentServices)
			return
		}
	}
}

// entryToServiceInfo converts a zeroconf entry to our ServiceInfo
func (sd *ServiceDiscovery) entryToServiceInfo(entry *zeroconf.ServiceEntry) ServiceInfo {
	service := ServiceInfo{
		Name: entry.Instance,
		Port: entry.Port,
		TXT:  make(map[string]string),
	}

	// Get IP address
	if len(entry.AddrIPv4) > 0 {
		service.Address = entry.AddrIPv4[0].String()
	} else if len(entry.AddrIPv6) > 0 {
		service.Address = entry.AddrIPv6[0].String()
	}

	// Parse TXT records
	for _, txt := range entry.Text {
		if len(txt) > 0 {
			parts := splitTXT(txt)
			if len(parts) == 2 {
				service.TXT[parts[0]] = parts[1]
			}
		}
	}

	return service
}

// processServiceChanges compares current vs known services and triggers callbacks
func (sd *ServiceDiscovery) processServiceChanges(currentServices map[string]ServiceInfo) {
	// Check for new services
	for key, service := range currentServices {
		if _, exists := sd.knownServices[key]; !exists {
			sd.knownServices[key] = service
			sd.callbacks.OnServiceFound(service)
		}
	}

	// Check for lost services
	for key, service := range sd.knownServices {
		if _, exists := currentServices[key]; !exists {
			delete(sd.knownServices, key)
			sd.callbacks.OnServiceLost(service)
		}
	}
}

// GetKnownServices returns all currently known services
func (sd *ServiceDiscovery) GetKnownServices() map[string]ServiceInfo {
	return sd.knownServices
}

// Shutdown stops service discovery and unregisters the service
func (sd *ServiceDiscovery) Shutdown() {
	sd.cancel()
	if sd.server != nil {
		sd.server.Shutdown()
	}
	log.Printf("🛑 Service discovery stopped")
}

func getInterfaces() ([]net.Interface, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	return interfaces, nil
}

// Helper functions
// func getLocalIPs() ([]net.IP, error) {
// 	var ips []net.IP
// 	interfaces, err := net.Interfaces()
// 	if err != nil {
// 		return nil, err
// 	}

// 	for _, iface := range interfaces {
// 		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
// 			continue
// 		}

// 		addrs, err := iface.Addrs()
// 		if err != nil {
// 			continue
// 		}

// 		for _, addr := range addrs {
// 			var ip net.IP
// 			switch v := addr.(type) {
// 			case *net.IPNet:
// 				ip = v.IP
// 			case *net.IPAddr:
// 				ip = v.IP
// 			}

// 			if ip != nil && !ip.IsLoopback() && ip.To4() != nil {
// 				ips = append(ips, ip)
// 			}
// 		}
// 	}
// 	return ips, nil
// }

func splitTXT(txt string) []string {
	for i, char := range txt {
		if char == '=' {
			return []string{txt[:i], txt[i+1:]}
		}
	}
	return []string{txt}
}

// func main() {
// 	if len(os.Args) < 3 {
// 		log.Fatal("Usage: go run main.go <service-name> <port>")
// 	}

// 	serviceName := os.Args[1]
// 	port, err := strconv.Atoi(os.Args[2])
// 	if err != nil {
// 		log.Fatal("Invalid port number")
// 	}

// 	// Create callback handler
// 	handler := &MyServiceHandler{myServiceName: serviceName}

// 	// Create service discovery
// 	discovery := NewServiceDiscovery(serviceName, "_myapp._tcp", port, handler)

// 	// Define this service's capabilities
// 	capabilities := map[string]string{
// 		"version":   "1.0.0",
// 		"api":       "rest",
// 		"features":  "chat,file-sharing,notifications",
// 		"max_conns": "100",
// 	}

// 	// Start discovery
// 	if err := discovery.Start(capabilities); err != nil {
// 		log.Fatal(err)
// 	}
// 	defer discovery.Shutdown()

// 	// Print status periodically
// 	go func() {
// 		for {
// 			time.Sleep(30 * time.Second)
// 			services := discovery.GetKnownServices()
// 			log.Printf("📊 Status: %d known services", len(services))
// 		}
// 	}()

// 	// Handle shutdown
// 	sigChan := make(chan os.Signal, 1)
// 	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
// 	<-sigChan

// 	log.Printf("Shutting down %s...", serviceName)
// }
