package v1

import (
	"errors"
	"net/http"
	"strings"
)

// Client encapsulates all route-specific service clients
type DbProxyClient struct {
	baseURL    string
	Common     CommonService
	Command    CommandService
	Module     ModuleService
	Permission PermissionService
	Setting    SettingService
	Storage    StorageService
	Treat      TreatService
	User       UserService
	Workflow   WorkflowService
	Client     ClientService
}

// NewClient creates a new composite client for all db routes
// baseURL is the base URL of the database proxy service (e.g., "http://localhost:8080")
// httpClient is the HTTP client to use for requests (can be nil to use default)
func NewDbProxyClient(baseURL string, httpClient *http.Client) *DbProxyClient {
	if httpClient == nil {
		httpClient = &http.Client{}
	}

	return &DbProxyClient{
		baseURL:    baseURL,
		Common:     NewCommonServiceProtobufClient(baseURL, httpClient),
		Command:    NewCommandServiceProtobufClient(baseURL, httpClient),
		Module:     NewModuleServiceProtobufClient(baseURL, httpClient),
		Permission: NewPermissionServiceProtobufClient(baseURL, httpClient),
		Setting:    NewSettingServiceProtobufClient(baseURL, httpClient),
		Storage:    NewStorageServiceProtobufClient(baseURL, httpClient),
		Treat:      NewTreatServiceProtobufClient(baseURL, httpClient),
		User:       NewUserServiceProtobufClient(baseURL, httpClient),
		Workflow:   NewWorkflowServiceProtobufClient(baseURL, httpClient),
		Client:     NewClientServiceProtobufClient(baseURL, httpClient),
	}
}

// WithServiceToken returns a copy of base whose every request carries
// `Authorization: Bearer <token>`, the service token db-proxy requires of its
// callers. base may be nil for a default client; its transport, timeout and
// other settings are kept.
func WithServiceToken(base *http.Client, token string) (*http.Client, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("db proxy service token is empty")
	}
	client := &http.Client{}
	if base != nil {
		copied := *base
		client = &copied
	}
	next := client.Transport
	if next == nil {
		next = http.DefaultTransport
	}
	client.Transport = &serviceTokenTransport{authorization: "Bearer " + token, next: next}
	return client, nil
}

type serviceTokenTransport struct {
	authorization string
	next          http.RoundTripper
}

// RoundTrip sets the header on a clone: a RoundTripper must not modify the
// request it was given.
func (t *serviceTokenTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	authorized := req.Clone(req.Context())
	authorized.Header.Set("Authorization", t.authorization)
	return t.next.RoundTrip(authorized)
}
