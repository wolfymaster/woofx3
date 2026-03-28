package v1

import http "net/http"

// Client encapsulates all route-specific service clients
type DbProxyClient struct {
	baseURL     string
	Common      CommonService
	Application ApplicationService
	Command     CommandService
	Module      ModuleService
	Permission  PermissionService
	Setting     SettingService
	Storage     StorageService
	Treat       TreatService
	User        UserService
	Workflow    WorkflowService
}

// NewClient creates a new composite client for all db routes
// baseURL is the base URL of the database proxy service (e.g., "http://localhost:8080")
// httpClient is the HTTP client to use for requests (can be nil to use default)
func NewDbProxyClient(baseURL string, httpClient *http.Client) *DbProxyClient {
	if httpClient == nil {
		httpClient = &http.Client{}
	}

	return &DbProxyClient{
		baseURL:     baseURL,
		Common:      NewCommonServiceProtobufClient(baseURL, httpClient),
		Application: NewApplicationServiceProtobufClient(baseURL, httpClient),
		Command:     NewCommandServiceProtobufClient(baseURL, httpClient),
		Module:      NewModuleServiceProtobufClient(baseURL, httpClient),
		Permission:  NewPermissionServiceProtobufClient(baseURL, httpClient),
		Setting:     NewSettingServiceProtobufClient(baseURL, httpClient),
		Storage:     NewStorageServiceProtobufClient(baseURL, httpClient),
		Treat:       NewTreatServiceProtobufClient(baseURL, httpClient),
		User:        NewUserServiceProtobufClient(baseURL, httpClient),
		Workflow:    NewWorkflowServiceProtobufClient(baseURL, httpClient),
	}
}
