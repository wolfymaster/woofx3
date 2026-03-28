// Manually maintained protobuf-compatible message types for module trigger RPCs.
// These extend the ModuleService defined in module.pb.go and module.twirp.go.

package v1

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
	unsafe "unsafe"
)

type ModuleTrigger struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Id            string                 `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	ModuleId      string                 `protobuf:"bytes,2,opt,name=module_id,json=moduleId,proto3" json:"module_id,omitempty"`
	ModuleName    string                 `protobuf:"bytes,3,opt,name=module_name,json=moduleName,proto3" json:"module_name,omitempty"`
	Category      string                 `protobuf:"bytes,4,opt,name=category,proto3" json:"category,omitempty"`
	Name          string                 `protobuf:"bytes,5,opt,name=name,proto3" json:"name,omitempty"`
	Description   string                 `protobuf:"bytes,6,opt,name=description,proto3" json:"description,omitempty"`
	Event         string                 `protobuf:"bytes,7,opt,name=event,proto3" json:"event,omitempty"`
	ConfigSchema  string                 `protobuf:"bytes,8,opt,name=config_schema,json=configSchema,proto3" json:"config_schema,omitempty"`
	AllowVariants bool                   `protobuf:"varint,9,opt,name=allow_variants,json=allowVariants,proto3" json:"allow_variants,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ModuleTrigger) Reset() {
	*x = ModuleTrigger{}
	mi := &file_module_trigger_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ModuleTrigger) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ModuleTrigger) ProtoMessage() {}

func (x *ModuleTrigger) ProtoReflect() protoreflect.Message {
	mi := &file_module_trigger_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

func (*ModuleTrigger) Descriptor() ([]byte, []int) {
	return file_module_trigger_proto_rawDescGZIP(), []int{0}
}

func (x *ModuleTrigger) GetId() string {
	if x != nil {
		return x.Id
	}
	return ""
}

func (x *ModuleTrigger) GetModuleId() string {
	if x != nil {
		return x.ModuleId
	}
	return ""
}

func (x *ModuleTrigger) GetModuleName() string {
	if x != nil {
		return x.ModuleName
	}
	return ""
}

func (x *ModuleTrigger) GetCategory() string {
	if x != nil {
		return x.Category
	}
	return ""
}

func (x *ModuleTrigger) GetName() string {
	if x != nil {
		return x.Name
	}
	return ""
}

func (x *ModuleTrigger) GetDescription() string {
	if x != nil {
		return x.Description
	}
	return ""
}

func (x *ModuleTrigger) GetEvent() string {
	if x != nil {
		return x.Event
	}
	return ""
}

func (x *ModuleTrigger) GetConfigSchema() string {
	if x != nil {
		return x.ConfigSchema
	}
	return ""
}

func (x *ModuleTrigger) GetAllowVariants() bool {
	if x != nil {
		return x.AllowVariants
	}
	return false
}

type RegisterTriggerRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	ModuleName    string                 `protobuf:"bytes,1,opt,name=module_name,json=moduleName,proto3" json:"module_name,omitempty"`
	Category      string                 `protobuf:"bytes,2,opt,name=category,proto3" json:"category,omitempty"`
	Name          string                 `protobuf:"bytes,3,opt,name=name,proto3" json:"name,omitempty"`
	Description   string                 `protobuf:"bytes,4,opt,name=description,proto3" json:"description,omitempty"`
	Event         string                 `protobuf:"bytes,5,opt,name=event,proto3" json:"event,omitempty"`
	ConfigSchema  string                 `protobuf:"bytes,6,opt,name=config_schema,json=configSchema,proto3" json:"config_schema,omitempty"`
	AllowVariants bool                   `protobuf:"varint,7,opt,name=allow_variants,json=allowVariants,proto3" json:"allow_variants,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *RegisterTriggerRequest) Reset() {
	*x = RegisterTriggerRequest{}
	mi := &file_module_trigger_proto_msgTypes[1]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *RegisterTriggerRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RegisterTriggerRequest) ProtoMessage() {}

func (x *RegisterTriggerRequest) ProtoReflect() protoreflect.Message {
	mi := &file_module_trigger_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

func (*RegisterTriggerRequest) Descriptor() ([]byte, []int) {
	return file_module_trigger_proto_rawDescGZIP(), []int{1}
}

func (x *RegisterTriggerRequest) GetModuleName() string {
	if x != nil {
		return x.ModuleName
	}
	return ""
}

func (x *RegisterTriggerRequest) GetCategory() string {
	if x != nil {
		return x.Category
	}
	return ""
}

func (x *RegisterTriggerRequest) GetName() string {
	if x != nil {
		return x.Name
	}
	return ""
}

func (x *RegisterTriggerRequest) GetDescription() string {
	if x != nil {
		return x.Description
	}
	return ""
}

func (x *RegisterTriggerRequest) GetEvent() string {
	if x != nil {
		return x.Event
	}
	return ""
}

func (x *RegisterTriggerRequest) GetConfigSchema() string {
	if x != nil {
		return x.ConfigSchema
	}
	return ""
}

func (x *RegisterTriggerRequest) GetAllowVariants() bool {
	if x != nil {
		return x.AllowVariants
	}
	return false
}

type ListTriggersRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	ModuleName    string                 `protobuf:"bytes,1,opt,name=module_name,json=moduleName,proto3" json:"module_name,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ListTriggersRequest) Reset() {
	*x = ListTriggersRequest{}
	mi := &file_module_trigger_proto_msgTypes[2]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ListTriggersRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ListTriggersRequest) ProtoMessage() {}

func (x *ListTriggersRequest) ProtoReflect() protoreflect.Message {
	mi := &file_module_trigger_proto_msgTypes[2]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

func (*ListTriggersRequest) Descriptor() ([]byte, []int) {
	return file_module_trigger_proto_rawDescGZIP(), []int{2}
}

func (x *ListTriggersRequest) GetModuleName() string {
	if x != nil {
		return x.ModuleName
	}
	return ""
}

type ListTriggersResponse struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Status        *ResponseStatus        `protobuf:"bytes,1,opt,name=status,proto3" json:"status,omitempty"`
	Triggers      []*ModuleTrigger       `protobuf:"bytes,2,rep,name=triggers,proto3" json:"triggers,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ListTriggersResponse) Reset() {
	*x = ListTriggersResponse{}
	mi := &file_module_trigger_proto_msgTypes[3]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ListTriggersResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ListTriggersResponse) ProtoMessage() {}

func (x *ListTriggersResponse) ProtoReflect() protoreflect.Message {
	mi := &file_module_trigger_proto_msgTypes[3]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

func (*ListTriggersResponse) Descriptor() ([]byte, []int) {
	return file_module_trigger_proto_rawDescGZIP(), []int{3}
}

func (x *ListTriggersResponse) GetStatus() *ResponseStatus {
	if x != nil {
		return x.Status
	}
	return nil
}

func (x *ListTriggersResponse) GetTriggers() []*ModuleTrigger {
	if x != nil {
		return x.Triggers
	}
	return nil
}

type ModuleTriggerResponse struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Status        *ResponseStatus        `protobuf:"bytes,1,opt,name=status,proto3" json:"status,omitempty"`
	Trigger       *ModuleTrigger         `protobuf:"bytes,2,opt,name=trigger,proto3" json:"trigger,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ModuleTriggerResponse) Reset() {
	*x = ModuleTriggerResponse{}
	mi := &file_module_trigger_proto_msgTypes[4]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ModuleTriggerResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ModuleTriggerResponse) ProtoMessage() {}

func (x *ModuleTriggerResponse) ProtoReflect() protoreflect.Message {
	mi := &file_module_trigger_proto_msgTypes[4]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

func (*ModuleTriggerResponse) Descriptor() ([]byte, []int) {
	return file_module_trigger_proto_rawDescGZIP(), []int{4}
}

func (x *ModuleTriggerResponse) GetStatus() *ResponseStatus {
	if x != nil {
		return x.Status
	}
	return nil
}

func (x *ModuleTriggerResponse) GetTrigger() *ModuleTrigger {
	if x != nil {
		return x.Trigger
	}
	return nil
}

type DeleteTriggersByModuleRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	ModuleName    string                 `protobuf:"bytes,1,opt,name=module_name,json=moduleName,proto3" json:"module_name,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *DeleteTriggersByModuleRequest) Reset() {
	*x = DeleteTriggersByModuleRequest{}
	mi := &file_module_trigger_proto_msgTypes[5]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *DeleteTriggersByModuleRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*DeleteTriggersByModuleRequest) ProtoMessage() {}

func (x *DeleteTriggersByModuleRequest) ProtoReflect() protoreflect.Message {
	mi := &file_module_trigger_proto_msgTypes[5]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

func (*DeleteTriggersByModuleRequest) Descriptor() ([]byte, []int) {
	return file_module_trigger_proto_rawDescGZIP(), []int{5}
}

func (x *DeleteTriggersByModuleRequest) GetModuleName() string {
	if x != nil {
		return x.ModuleName
	}
	return ""
}

// Proto descriptor for module trigger messages.
// Package: module, extends module.proto service.
const file_module_trigger_proto_rawDesc = "" +
	"\n" +
	"\x14module_trigger.proto\x12\x06module\x1a\fcommon.proto\"\xcb\x01\n" +
	"\rModuleTrigger\x12\x0e\n" +
	"\x02id\x18\x01 \x01(\tR\x02id\x12\x1b\n" +
	"\tmodule_id\x18\x02 \x01(\tR\bmoduleId\x12\x1f\n" +
	"\vmodule_name\x18\x03 \x01(\tR\n" +
	"moduleName\x12\x1a\n" +
	"\bcategory\x18\x04 \x01(\tR\bcategory\x12\x12\n" +
	"\x04name\x18\x05 \x01(\tR\x04name\x12 \n" +
	"\vdescription\x18\x06 \x01(\tR\vdescription\x12\x14\n" +
	"\x05event\x18\a \x01(\tR\x05event\x12#\n" +
	"\rconfig_schema\x18\b \x01(\tR\fconfigSchema\x12%\n" +
	"\x0eallow_variants\x18\t \x01(\bR\rallowVariants\"\xcb\x01\n" +
	"\x16RegisterTriggerRequest\x12\x1f\n" +
	"\vmodule_name\x18\x01 \x01(\tR\n" +
	"moduleName\x12\x1a\n" +
	"\bcategory\x18\x02 \x01(\tR\bcategory\x12\x12\n" +
	"\x04name\x18\x03 \x01(\tR\x04name\x12 \n" +
	"\vdescription\x18\x04 \x01(\tR\vdescription\x12\x14\n" +
	"\x05event\x18\x05 \x01(\tR\x05event\x12#\n" +
	"\rconfig_schema\x18\x06 \x01(\tR\fconfigSchema\x12%\n" +
	"\x0eallow_variants\x18\a \x01(\bR\rallowVariants\"7\n" +
	"\x13ListTriggersRequest\x12 \n" +
	"\vmodule_name\x18\x01 \x01(\tR\n" +
	"moduleName\"v\n" +
	"\x14ListTriggersResponse\x12.\n" +
	"\x06status\x18\x01 \x01(\v2\x16.common.ResponseStatusR\x06status\x12.\n" +
	"\btriggers\x18\x02 \x03(\v2\x15.module.ModuleTriggerR\btriggers\"s\n" +
	"\x15ModuleTriggerResponse\x12.\n" +
	"\x06status\x18\x01 \x01(\v2\x16.common.ResponseStatusR\x06status\x12*\n" +
	"\atrigger\x18\x02 \x01(\v2\x15.module.ModuleTriggerR\atrigger\"?\n" +
	"\x1dDeleteTriggersByModuleRequest\x12\x1e\n" +
	"\vmodule_name\x18\x01 \x01(\tR\n" +
	"moduleNameB)Z'github.com/wolfymaster/woofx3/db/gen/v1b\x06proto3"

var (
	file_module_trigger_proto_rawDescOnce sync.Once
	file_module_trigger_proto_rawDescData []byte
)

func file_module_trigger_proto_rawDescGZIP() []byte {
	file_module_trigger_proto_rawDescOnce.Do(func() {
		file_module_trigger_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_module_trigger_proto_rawDesc), len(file_module_trigger_proto_rawDesc)))
	})
	return file_module_trigger_proto_rawDescData
}

var file_module_trigger_proto_msgTypes = make([]protoimpl.MessageInfo, 6)
var file_module_trigger_proto_goTypes = []any{
	(*ModuleTrigger)(nil),                 // 0: module.ModuleTrigger
	(*RegisterTriggerRequest)(nil),        // 1: module.RegisterTriggerRequest
	(*ListTriggersRequest)(nil),           // 2: module.ListTriggersRequest
	(*ListTriggersResponse)(nil),          // 3: module.ListTriggersResponse
	(*ModuleTriggerResponse)(nil),         // 4: module.ModuleTriggerResponse
	(*DeleteTriggersByModuleRequest)(nil), // 5: module.DeleteTriggersByModuleRequest
	(*ResponseStatus)(nil),               // 6: common.ResponseStatus
}
var file_module_trigger_proto_depIdxs = []int32{
	6, // 0: module.ListTriggersResponse.status:type_name -> common.ResponseStatus
	0, // 1: module.ListTriggersResponse.triggers:type_name -> module.ModuleTrigger
	6, // 2: module.ModuleTriggerResponse.status:type_name -> common.ResponseStatus
	0, // 3: module.ModuleTriggerResponse.trigger:type_name -> module.ModuleTrigger
	4, // [4:4] is the sub-list for method output_type
	4, // [4:4] is the sub-list for method input_type
	4, // [4:4] is the sub-list for extension type_name
	4, // [4:4] is the sub-list for extension extendee
	0, // [0:4] is the sub-list for field type_name
}

var File_module_trigger_proto protoreflect.FileDescriptor

func init() { file_module_trigger_proto_init() }
func file_module_trigger_proto_init() {
	if File_module_trigger_proto != nil {
		return
	}
	file_common_proto_init()
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_module_trigger_proto_rawDesc), len(file_module_trigger_proto_rawDesc)),
			NumEnums:      0,
			NumMessages:   6,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_module_trigger_proto_goTypes,
		DependencyIndexes: file_module_trigger_proto_depIdxs,
		MessageInfos:      file_module_trigger_proto_msgTypes,
	}.Build()
	File_module_trigger_proto = out.File
	file_module_trigger_proto_goTypes = nil
	file_module_trigger_proto_depIdxs = nil
}
