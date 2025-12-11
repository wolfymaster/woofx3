package services

import (
	// "context"
	"sync"

	"github.com/dgraph-io/badger/v3"
	"gorm.io/gorm"

	rpc "github.com/wolfymaster/woofx3/db/gen/go"
	"github.com/wolfymaster/woofx3/db/models"
)

type serviceFactory struct {
	db *gorm.DB

	// BadgerDB instance for key-value storage
	badgerDB *badger.DB

	// Services
	// userService       UserService
	permissionService rpc.PermissionService
	commandService    rpc.CommandService
	// appService        ApplicationService
	// eventService      EventService
	// workflowService   WorkflowService
	// authService       AuthService
	// settingService    SettingService
	// treatService      TreatService
	// storageService    *StorageService

	// For thread-safe lazy initialization
	initUserService       sync.Once
	initPermissionService sync.Once
	initCommandService    sync.Once
	initAppService        sync.Once
	initEventService      sync.Once
	initWorkflowService   sync.Once
	initAuthService       sync.Once
	initSettingService    sync.Once
	initTreatService      sync.Once
	initStorageService    sync.Once
}

// NewServiceFactory creates a new ServiceFactory
func NewServiceFactory(db *gorm.DB, badgerDB *badger.DB) (ServiceFactory, error) {
	return &serviceFactory{
		db:       db,
		badgerDB: badgerDB,
	}, nil
}

// // User returns the UserService instance
// func (f *serviceFactory) User() UserService {
// 	f.initUserService.Do(func() {
// 		service := &userService{
// 			baseService: baseService[models.User]{},
// 		}
// 		f.userService = service
// 	})
// 	return f.userService
// }

// Permission returns the PermissionService instance
func (f *serviceFactory) Permission() rpc.PermissionService {
	f.initPermissionService.Do(func() {
		service := &permissionService{
			baseService: baseService[models.Permission]{},
		}
		f.permissionService = service
	})
	return f.permissionService
}

// Command returns the CommandService instance
func (f *serviceFactory) Command() rpc.CommandService {
	f.initCommandService.Do(func() {
		service := &commandService{
			baseService:       baseService[models.Command]{},
			permissionService: f.Permission(),
		}
		f.commandService = service
	})
	return f.commandService
}

// // Application returns the ApplicationService instance
// func (f *serviceFactory) Application() ApplicationService {
// 	f.initAppService.Do(func() {
// 		service := &applicationService{
// 			baseService: baseService[models.Application]{},
// 		}
// 		f.appService = service
// 	})
// 	return f.appService
// }

// // Event returns the EventService instance
// func (f *serviceFactory) Event() EventService {
// 	f.initEventService.Do(func() {
// 		service := &eventService{
// 			baseService: baseService[models.UserEvent]{},
// 		}
// 		f.eventService = service
// 	})
// 	return f.eventService
// }

// // Workflow returns the WorkflowService instance
// func (f *serviceFactory) Workflow() WorkflowService {
// 	f.initWorkflowService.Do(func() {
// 		service := NewWorkflowService(f.Command(), f.Event())
// 		f.workflowService = service
// 	})
// 	return f.workflowService
// }

// // CancelWorkflow cancels a running workflow
// func (s *workflowService) CancelWorkflow(db *gorm.DB, workflowID string) error {
// 	// Implementation for canceling a workflow
// 	return nil
// }

// // Auth returns the AuthService instance
// func (f *serviceFactory) Auth() AuthService {
// 	f.initAuthService.Do(func() {
// 		service := &authService{
// 			baseService: baseService[models.User]{},
// 			userService: f.User(),
// 		}
// 		f.authService = service
// 	})
// 	return f.authService
// }

// // Setting returns the SettingService instance
// func (f *serviceFactory) Setting() SettingService {
// 	f.initSettingService.Do(func() {
// 		service := &settingService{
// 			baseService: baseService[models.Setting]{},
// 		}
// 		f.settingService = service
// 	})
// 	return f.settingService
// }

// // Treat returns the TreatService instance
// func (f *serviceFactory) Treat() TreatService {
// 	f.initTreatService.Do(func() {
// 		service := &treatService{
// 			baseService: baseService[models.Treat]{},
// 		}
// 		f.treatService = service
// 	})
// 	return f.treatService
// }

// // Storage returns the StorageService instance
// func (f *serviceFactory) Storage() *StorageService {
// 	f.initStorageService.Do(func() {
// 		service, err := NewStorageService(f.badgerDB)
// 		if err != nil {
// 			// Log the error or handle it appropriately
// 			panic(fmt.Errorf("failed to initialize storage service: %w", err))
// 		}
// 		f.storageService = service
// 	})
// 	return f.storageService
// }

// // GetWorkflowService returns the WorkflowService instance
// // Deprecated: Use Workflow() instead
// func (f *serviceFactory) GetWorkflowService() WorkflowService {
// 	return f.Workflow()
// }

// // GetApplicationService returns the ApplicationService instance
// // Deprecated: Use Application() instead
// func (f *serviceFactory) GetApplicationService() ApplicationService {
// 	return f.Application()
// }
