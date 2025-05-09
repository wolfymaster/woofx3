// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.6
// 	protoc        (unknown)
// source: user.proto

package buf

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	reflect "reflect"
	sync "sync"
	unsafe "unsafe"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type GetUserTokenRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	UserId        string                 `protobuf:"bytes,1,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *GetUserTokenRequest) Reset() {
	*x = GetUserTokenRequest{}
	mi := &file_user_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *GetUserTokenRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetUserTokenRequest) ProtoMessage() {}

func (x *GetUserTokenRequest) ProtoReflect() protoreflect.Message {
	mi := &file_user_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GetUserTokenRequest.ProtoReflect.Descriptor instead.
func (*GetUserTokenRequest) Descriptor() ([]byte, []int) {
	return file_user_proto_rawDescGZIP(), []int{0}
}

func (x *GetUserTokenRequest) GetUserId() string {
	if x != nil {
		return x.UserId
	}
	return ""
}

type GetUserTokenResponse struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Token         string                 `protobuf:"bytes,1,opt,name=token,proto3" json:"token,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *GetUserTokenResponse) Reset() {
	*x = GetUserTokenResponse{}
	mi := &file_user_proto_msgTypes[1]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *GetUserTokenResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetUserTokenResponse) ProtoMessage() {}

func (x *GetUserTokenResponse) ProtoReflect() protoreflect.Message {
	mi := &file_user_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GetUserTokenResponse.ProtoReflect.Descriptor instead.
func (*GetUserTokenResponse) Descriptor() ([]byte, []int) {
	return file_user_proto_rawDescGZIP(), []int{1}
}

func (x *GetUserTokenResponse) GetToken() string {
	if x != nil {
		return x.Token
	}
	return ""
}

type GetBroadcasterTokenRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	BroadcasterId string                 `protobuf:"bytes,1,opt,name=broadcaster_id,json=broadcasterId,proto3" json:"broadcaster_id,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *GetBroadcasterTokenRequest) Reset() {
	*x = GetBroadcasterTokenRequest{}
	mi := &file_user_proto_msgTypes[2]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *GetBroadcasterTokenRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetBroadcasterTokenRequest) ProtoMessage() {}

func (x *GetBroadcasterTokenRequest) ProtoReflect() protoreflect.Message {
	mi := &file_user_proto_msgTypes[2]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GetBroadcasterTokenRequest.ProtoReflect.Descriptor instead.
func (*GetBroadcasterTokenRequest) Descriptor() ([]byte, []int) {
	return file_user_proto_rawDescGZIP(), []int{2}
}

func (x *GetBroadcasterTokenRequest) GetBroadcasterId() string {
	if x != nil {
		return x.BroadcasterId
	}
	return ""
}

type GetBroadcasterTokenResponse struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Token         string                 `protobuf:"bytes,1,opt,name=token,proto3" json:"token,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *GetBroadcasterTokenResponse) Reset() {
	*x = GetBroadcasterTokenResponse{}
	mi := &file_user_proto_msgTypes[3]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *GetBroadcasterTokenResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetBroadcasterTokenResponse) ProtoMessage() {}

func (x *GetBroadcasterTokenResponse) ProtoReflect() protoreflect.Message {
	mi := &file_user_proto_msgTypes[3]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use GetBroadcasterTokenResponse.ProtoReflect.Descriptor instead.
func (*GetBroadcasterTokenResponse) Descriptor() ([]byte, []int) {
	return file_user_proto_rawDescGZIP(), []int{3}
}

func (x *GetBroadcasterTokenResponse) GetToken() string {
	if x != nil {
		return x.Token
	}
	return ""
}

type CreateUserChatMessageRequest struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	UserId        string                 `protobuf:"bytes,1,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
	Message       string                 `protobuf:"bytes,2,opt,name=message,proto3" json:"message,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *CreateUserChatMessageRequest) Reset() {
	*x = CreateUserChatMessageRequest{}
	mi := &file_user_proto_msgTypes[4]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *CreateUserChatMessageRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateUserChatMessageRequest) ProtoMessage() {}

func (x *CreateUserChatMessageRequest) ProtoReflect() protoreflect.Message {
	mi := &file_user_proto_msgTypes[4]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use CreateUserChatMessageRequest.ProtoReflect.Descriptor instead.
func (*CreateUserChatMessageRequest) Descriptor() ([]byte, []int) {
	return file_user_proto_rawDescGZIP(), []int{4}
}

func (x *CreateUserChatMessageRequest) GetUserId() string {
	if x != nil {
		return x.UserId
	}
	return ""
}

func (x *CreateUserChatMessageRequest) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

type CreateUserChatMessageResponse struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	UserId        string                 `protobuf:"bytes,1,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
	Message       string                 `protobuf:"bytes,2,opt,name=message,proto3" json:"message,omitempty"`
	CreatedAt     string                 `protobuf:"bytes,4,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"` // Timestamp in RFC 3339 format
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *CreateUserChatMessageResponse) Reset() {
	*x = CreateUserChatMessageResponse{}
	mi := &file_user_proto_msgTypes[5]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *CreateUserChatMessageResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateUserChatMessageResponse) ProtoMessage() {}

func (x *CreateUserChatMessageResponse) ProtoReflect() protoreflect.Message {
	mi := &file_user_proto_msgTypes[5]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use CreateUserChatMessageResponse.ProtoReflect.Descriptor instead.
func (*CreateUserChatMessageResponse) Descriptor() ([]byte, []int) {
	return file_user_proto_rawDescGZIP(), []int{5}
}

func (x *CreateUserChatMessageResponse) GetUserId() string {
	if x != nil {
		return x.UserId
	}
	return ""
}

func (x *CreateUserChatMessageResponse) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

func (x *CreateUserChatMessageResponse) GetCreatedAt() string {
	if x != nil {
		return x.CreatedAt
	}
	return ""
}

var File_user_proto protoreflect.FileDescriptor

const file_user_proto_rawDesc = "" +
	"\n" +
	"\n" +
	"user.proto\x12\rwolfyttv.user\".\n" +
	"\x13GetUserTokenRequest\x12\x17\n" +
	"\auser_id\x18\x01 \x01(\tR\x06userId\",\n" +
	"\x14GetUserTokenResponse\x12\x14\n" +
	"\x05token\x18\x01 \x01(\tR\x05token\"C\n" +
	"\x1aGetBroadcasterTokenRequest\x12%\n" +
	"\x0ebroadcaster_id\x18\x01 \x01(\tR\rbroadcasterId\"3\n" +
	"\x1bGetBroadcasterTokenResponse\x12\x14\n" +
	"\x05token\x18\x01 \x01(\tR\x05token\"Q\n" +
	"\x1cCreateUserChatMessageRequest\x12\x17\n" +
	"\auser_id\x18\x01 \x01(\tR\x06userId\x12\x18\n" +
	"\amessage\x18\x02 \x01(\tR\amessage\"q\n" +
	"\x1dCreateUserChatMessageResponse\x12\x17\n" +
	"\auser_id\x18\x01 \x01(\tR\x06userId\x12\x18\n" +
	"\amessage\x18\x02 \x01(\tR\amessage\x12\x1d\n" +
	"\n" +
	"created_at\x18\x04 \x01(\tR\tcreatedAt2\xd4\x01\n" +
	"\vUserService\x12W\n" +
	"\fGetUserToken\x12\".wolfyttv.user.GetUserTokenRequest\x1a#.wolfyttv.user.GetUserTokenResponse\x12l\n" +
	"\x13GetBroadcasterToken\x12).wolfyttv.user.GetBroadcasterTokenRequest\x1a*.wolfyttv.user.GetBroadcasterTokenResponseB%Z#github.com/wolfymaster/wolfyttv/bufb\x06proto3"

var (
	file_user_proto_rawDescOnce sync.Once
	file_user_proto_rawDescData []byte
)

func file_user_proto_rawDescGZIP() []byte {
	file_user_proto_rawDescOnce.Do(func() {
		file_user_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_user_proto_rawDesc), len(file_user_proto_rawDesc)))
	})
	return file_user_proto_rawDescData
}

var file_user_proto_msgTypes = make([]protoimpl.MessageInfo, 6)
var file_user_proto_goTypes = []any{
	(*GetUserTokenRequest)(nil),           // 0: wolfyttv.user.GetUserTokenRequest
	(*GetUserTokenResponse)(nil),          // 1: wolfyttv.user.GetUserTokenResponse
	(*GetBroadcasterTokenRequest)(nil),    // 2: wolfyttv.user.GetBroadcasterTokenRequest
	(*GetBroadcasterTokenResponse)(nil),   // 3: wolfyttv.user.GetBroadcasterTokenResponse
	(*CreateUserChatMessageRequest)(nil),  // 4: wolfyttv.user.CreateUserChatMessageRequest
	(*CreateUserChatMessageResponse)(nil), // 5: wolfyttv.user.CreateUserChatMessageResponse
}
var file_user_proto_depIdxs = []int32{
	0, // 0: wolfyttv.user.UserService.GetUserToken:input_type -> wolfyttv.user.GetUserTokenRequest
	2, // 1: wolfyttv.user.UserService.GetBroadcasterToken:input_type -> wolfyttv.user.GetBroadcasterTokenRequest
	1, // 2: wolfyttv.user.UserService.GetUserToken:output_type -> wolfyttv.user.GetUserTokenResponse
	3, // 3: wolfyttv.user.UserService.GetBroadcasterToken:output_type -> wolfyttv.user.GetBroadcasterTokenResponse
	2, // [2:4] is the sub-list for method output_type
	0, // [0:2] is the sub-list for method input_type
	0, // [0:0] is the sub-list for extension type_name
	0, // [0:0] is the sub-list for extension extendee
	0, // [0:0] is the sub-list for field type_name
}

func init() { file_user_proto_init() }
func file_user_proto_init() {
	if File_user_proto != nil {
		return
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_user_proto_rawDesc), len(file_user_proto_rawDesc)),
			NumEnums:      0,
			NumMessages:   6,
			NumExtensions: 0,
			NumServices:   1,
		},
		GoTypes:           file_user_proto_goTypes,
		DependencyIndexes: file_user_proto_depIdxs,
		MessageInfos:      file_user_proto_msgTypes,
	}.Build()
	File_user_proto = out.File
	file_user_proto_goTypes = nil
	file_user_proto_depIdxs = nil
}
